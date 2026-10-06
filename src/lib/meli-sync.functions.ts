import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
  erros: number | null;
};

export const meliSyncStatusBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeliSyncStatusResult> => {
    const sb = context.supabase;
    const [{ data: ciclos, error }, { data: bases }] = await Promise.all([
      sb
        .from("meli_piloto_ciclos")
        .select("id,base_id,base_codigo,status,iniciado_em,finalizado_em,rotas_recebidas,pacotes_recebidos,erros")
        .order("iniciado_em", { ascending: false })
        .limit(500),
      sb.from("bases").select("id,codigo,nome").in("codigo", ["ESP15", "ESP16", "ESP17"]),
    ]);

    if (error) return { status: "erro", erro: error.message };

    const nomePorId = new Map((bases ?? []).map((b) => [b.id, b.nome]));
    const ultimoPorBase = new Map<string, CicloPiloto>();
    for (const ciclo of (ciclos ?? []) as CicloPiloto[]) {
      if (!ultimoPorBase.has(ciclo.base_id)) ultimoPorBase.set(ciclo.base_id, ciclo);
    }

    return {
      status: "ok",
      server_time: new Date().toISOString(),
      bases: [...ultimoPorBase.values()].map((ciclo) => ({
        base_id: ciclo.base_id,
        base_codigo: ciclo.base_codigo,
        base_nome: nomePorId.get(ciclo.base_id) ?? ciclo.base_codigo,
        ultimo_sucesso_em: ciclo.status === "concluido" ? ciclo.finalizado_em : null,
        ultima_tentativa_em: ciclo.iniciado_em,
        status: ciclo.status,
        sessao_status: null,
        mensagem_segura: null,
        rotas_encontradas: ciclo.rotas_recebidas ?? 0,
        pacotes_encontrados: ciclo.pacotes_recebidos ?? 0,
        erros: ciclo.erros ?? 0,
        data_rota: null,
        sincronizando: ciclo.status === "em_andamento",
        lote_ativo: ciclo.id,
      })),
    };
  });
