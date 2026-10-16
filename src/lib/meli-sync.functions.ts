import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { avaliarSincronizacao } from "@/lib/meli-sync-state";

export type MeliSyncBase = {
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  ultimo_sucesso_em: string | null;
  ultima_tentativa_em: string | null;
  status: string | null;
  sessao_status: string | null;
  mensagem_segura: string | null;
  rotas_encontradas: number;
  pacotes_encontrados: number;
  erros: number;
  data_rota: string | null;
  sincronizando?: boolean | null;
  lote_ativo?: string | null;
  estado_integracao?: string;
  proxima_acao?: string;
  ultimo_heartbeat_em?: string | null;
  integridade_totais?: string;
};

export type MeliSyncStatusResult = {
  status: "ok" | "erro";
  erro?: string;
  server_time?: string;
  bases?: MeliSyncBase[];
};

type CicloPiloto = {
  id: string;
  base_id: string;
  base_codigo: string;
  status: string;
  iniciado_em: string;
  finalizado_em: string | null;
  rotas_recebidas: number | null;
  pacotes_recebidos: number | null;
  erros?: number | null;
  rotas_esperadas: number | null;
  pacotes_esperados: number | null;
};

export const meliSyncStatusBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeliSyncStatusResult> => {
    const sb = context.supabase;
    const [{ data: ciclos, error }, { data: bases }] = await Promise.all([
      sb
        .from("meli_piloto_ciclos")
        .select("id,base_id,base_codigo,status,iniciado_em,finalizado_em,rotas_recebidas,pacotes_recebidos,rotas_esperadas,pacotes_esperados,erro")
        .order("iniciado_em", { ascending: false })
        .limit(500),
      sb.from("bases").select("id,codigo,nome").in("codigo", ["ESP15","ESP16","ESP17","ESP18","SSP45","SSP23","SSP06","SSP17","SSP15","SSP37/03","SSP38","SSP20","SSP5"]),
    ]);

    if (error) return { status: "erro", erro: error.message };

    const nomePorId = new Map((bases ?? []).map((b) => [b.id, b.nome]));
    const ultimoPorBase = new Map<string, CicloPiloto>();
    for (const ciclo of (ciclos ?? []) as CicloPiloto[]) {
      if (!ultimoPorBase.has(ciclo.base_id)) ultimoPorBase.set(ciclo.base_id, ciclo);
    }

    // Contagem real de erros por ciclo vem de meli_piloto_erros
    // (meli_piloto_ciclos só tem a coluna `erro`, sem contador).
    const ids = [...ultimoPorBase.values()].map(ciclo => ciclo.id);
    const { data: errosRows, error: errosError } = ids.length
      ? await sb.from("meli_piloto_erros").select("ciclo_id").in("ciclo_id", ids)
      : { data: [] as { ciclo_id: string }[] | null, error: null };
    const errosPorCiclo = new Map<string, number>();
    if (errosError) console.error("meliSyncStatusBases: falha ao contar erros", errosError.message);
    for (const r of (errosRows ?? []) as { ciclo_id: string }[]) {
      errosPorCiclo.set(r.ciclo_id, (errosPorCiclo.get(r.ciclo_id) ?? 0) + 1);
    }

    const sucessos = await Promise.all([...ultimoPorBase.values()].map(async ciclo => {
      const consulta = await sb.from("meli_piloto_ciclos").select("base_id,finalizado_em")
        .eq("base_id",ciclo.base_id).eq("status","concluido")
        .order("finalizado_em",{ascending:false}).limit(1);
      return { baseId: ciclo.base_id, sucesso: consulta.data?.[0]?.finalizado_em ?? null, erro: consulta.error };
    }));
    if (sucessos.some(s=>s.erro)) return {status:"erro",erro:"Não foi possível consultar a última sincronização."};
    const ultimoSucesso = new Map(sucessos.map(s=>[s.baseId,s.sucesso]));
    const {data: heartbeats, error: heartbeatError} = await sb.from("meli_piloto_heartbeat")
      .select("bases,sessao_adminml,ultimo_sinal_em,detalhe").order("ultimo_sinal_em",{ascending:false}).limit(20);
    if (heartbeatError) return {status:"erro",erro:"Não foi possível consultar o sinal do worker."};

    return {
      status: "ok",
      server_time: new Date().toISOString(),
      bases: [...ultimoPorBase.values()].map((ciclo) => {
        const heartbeat=heartbeats?.find(h=>h.bases?.includes(ciclo.base_codigo));
        const detalhe=heartbeat?.detalhe as Record<string,unknown> | undefined;
        const avaliacao=avaliarSincronizacao(ultimoSucesso.get(ciclo.base_id) ?? null,
          heartbeat?.ultimo_sinal_em ?? null, detalhe?.intervencao_manual === true,Date.now());
        return ({
        base_id: ciclo.base_id,
        base_codigo: ciclo.base_codigo,
        base_nome: nomePorId.get(ciclo.base_id) ?? ciclo.base_codigo,
        ultimo_sucesso_em: ultimoSucesso.get(ciclo.base_id) ?? null,
        ultima_tentativa_em: ciclo.iniciado_em,
        status: ciclo.status,
        sessao_status: heartbeat?.sessao_adminml ?? null,
        mensagem_segura: avaliacao.estado === 'autenticacao_necessaria' ? 'Login oficial confirmado: aguarda aprovação manual.'
          : avaliacao.estado === 'worker_sem_sinal' ? 'Worker sem sinal recente: verificar execução.'
          : avaliacao.estado === 'sem_atualizacao' ? 'Sem sincronização recente, mesmo com sinal do worker.' : null,
        estado_integracao: avaliacao.estado,
        proxima_acao: avaliacao.acao,
        ultimo_heartbeat_em: heartbeat?.ultimo_sinal_em ?? null,
        integridade_totais: ciclo.rotas_esperadas == null || ciclo.pacotes_esperados == null ? 'não verificada'
          : ciclo.rotas_esperadas === ciclo.rotas_recebidas && ciclo.pacotes_esperados === ciclo.pacotes_recebidos ? 'conferida' : 'divergente',
        rotas_encontradas: ciclo.rotas_recebidas ?? 0,
        pacotes_encontrados: ciclo.pacotes_recebidos ?? 0,
        erros: errosPorCiclo.get(ciclo.id) ?? 0,
        data_rota: null,
        sincronizando: ciclo.status === "em_andamento",
        lote_ativo: ciclo.id,
      }); }),
    };
  });
