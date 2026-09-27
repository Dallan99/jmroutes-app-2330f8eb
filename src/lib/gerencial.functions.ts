import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const inputSchema = z.object({
  periodo: z.enum(["hoje", "7d", "30d"]).default("7d"),
});

export type OperadorProd = {
  operador_id: string;
  nome: string;
  total_leituras: number;
  ok: number;
  erros: number;
  rotas_atendidas: number;
  tempo_medio_ms: number | null;
  taxa_acerto: number;
};

export type GerencialData = {
  periodo: "hoje" | "7d" | "30d";
  totais: {
    total_leituras: number;
    ok: number;
    erros: number;
    operadores_ativos: number;
    tempo_medio_ms: number | null;
  };
  porOperador: OperadorProd[];
  top3: OperadorProd[];
  bottom3: OperadorProd[];
  porDia: { dia: string; total: number; ok: number; erros: number }[];
  comparativo: { operador: string; hoje: number; semana: number; mes: number }[];
};

export type TransferenciasGerencialData = {
  periodo: "hoje" | "7d" | "30d";
  totais: {
    total: number;
    disponibilizados_ate_7: number;
    aguardando_carga: number;
    saidas_apos_9: number;
    taxa_disponibilizacao: number;
    media_service_min: number | null;
    maior_service_min: number | null;
    media_deslocamento_min: number | null;
  };
  porBase: {
    base_id: string;
    base_codigo: string;
    base_nome: string;
    total: number;
    disponibilizados_ate_7: number;
    aguardando_carga: number;
    saidas_apos_9: number;
    media_service_min: number | null;
    media_deslocamento_min: number | null;
  }[];
  rankingMotoristas: {
    motorista: string;
    viagens_atrasadas: number;
    minutos_atraso: number;
  }[];
  motivos: {
    motivo: string;
    responsabilidade: string;
    ocorrencias: number;
    minutos_atraso: number;
  }[];
};

export type RotaBaseRow = {
  base_id: string;
  base_codigo: string;
  base_nome: string;
  nro_rota: string;
  motorista: string | null;
  placa: string | null;
  total: number;
  recebido: number;
  devolvido: number;
  faltando: number;
  pct: number;
  status: "completa" | "parcial" | "vazia";
};

export type RotasPorBaseData = {
  data: string;
  bases: {
    base_id: string;
    codigo: string;
    nome: string;
    total_rotas: number;
    rotas_completas: number;
    rotas_parciais: number;
    total_pacotes: number;
    recebidos: number;
    devolvidos: number;
    faltando: number;
    pct: number;
  }[];
  rotas: RotaBaseRow[];
};

export type MeliSlaDiario = {
  data_operacional: string;
  bases_total: number;
  rotas_total: number;
  pacotes_total: number;
  entregues_total: number;
  insucessos_total: number;
  sla_geral: number;
  ultima_coleta: string | null;
};

function inicioPeriodo(p: "hoje" | "7d" | "30d") {
  const now = new Date();
  if (p === "hoje") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const dias = p === "7d" ? 7 : 30;
  return new Date(now.getTime() - dias * 24 * 3600 * 1000);
}

export const meliSlaHistorico = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => inputSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliSlaDiario[]> => {
    const inicio = inicioPeriodo(data.periodo).toISOString().slice(0, 10);
    const { data: linhas, error } = await context.supabase
      .from("meli_sla_diario")
      .select(
        "data_operacional,bases_total,rotas_total,pacotes_total,entregues_total,insucessos_total,sla_geral,ultima_coleta",
      )
      .gte("data_operacional", inicio)
      .order("data_operacional", { ascending: false })
      .limit(data.periodo === "hoje" ? 1 : data.periodo === "7d" ? 7 : 30);
    if (error) throw new Error(error.message);
    return (linhas ?? []).map((linha) => ({
      ...linha,
      bases_total: Number(linha.bases_total ?? 0),
      rotas_total: Number(linha.rotas_total ?? 0),
      pacotes_total: Number(linha.pacotes_total ?? 0),
      entregues_total: Number(linha.entregues_total ?? 0),
      insucessos_total: Number(linha.insucessos_total ?? 0),
      sla_geral: Number(linha.sla_geral ?? 0),
    }));
  });

/** Lê todas as páginas respeitando o limite de linhas da Data API. */
async function buscarPaginado<T>(
  criarConsulta: (
    inicio: number,
    fim: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const tamanho = 1000;
  const resultado: T[] = [];
  for (let inicio = 0; ; inicio += tamanho) {
    const { data, error } = await criarConsulta(inicio, inicio + tamanho - 1);
    if (error) throw new Error(error.message);
    const pagina = data ?? [];
    resultado.push(...pagina);
    if (pagina.length < tamanho) break;
  }
  return resultado;
}

export const gerencialData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<GerencialData> => {
    const { supabase } = context;
    const desde = inicioPeriodo(data.periodo);

    const inicioHoje = inicioPeriodo("hoje");
    const inicioSemana = inicioPeriodo("7d");
    const inicioMes = inicioPeriodo("30d");

    type Rec = {
      dia: string;
      operador_id: string | null;
      nome: string | null;
      total: number;
      ok: number;
      erros: number;
      rotas: number;
      tempo_soma: number;
      tempo_qtd: number;
    };
    const { data: rpcRows, error: rpcErro } = await (supabase as any).rpc(
      "gerencial_produtividade_agregada",
      { p_inicio_mes: inicioMes.toISOString() },
    );
    if (rpcErro) throw new Error(rpcErro.message);
    const all = ((rpcRows ?? []) as Rec[]).map((r) => ({
      ...r,
      total: Number(r.total ?? 0),
      ok: Number(r.ok ?? 0),
      erros: Number(r.erros ?? 0),
      rotas: Number(r.rotas ?? 0),
      tempo_soma: Number(r.tempo_soma ?? 0),
      tempo_qtd: Number(r.tempo_qtd ?? 0),
    }));
    const desdeDia = desde.toISOString().slice(0, 10);
    const periodoRows = all.filter((r) => r.dia >= desdeDia);

    // Agrupamento por operador no período
    const grupos = new Map<string, Rec[]>();
    for (const r of periodoRows) {
      if (!r.operador_id) continue;
      const arr = grupos.get(r.operador_id) ?? [];
      arr.push(r);
      grupos.set(r.operador_id, arr);
    }

    const porOperador: OperadorProd[] = Array.from(grupos.entries()).map(([id, arr]) => {
      const total = arr.reduce((s, r) => s + r.total, 0);
      const ok = arr.reduce((s, r) => s + r.ok, 0);
      const erros = arr.reduce((s, r) => s + r.erros, 0);
      const rotas = arr.reduce((s, r) => s + r.rotas, 0);
      const tempoSoma = arr.reduce((s, r) => s + r.tempo_soma, 0);
      const tempoQtd = arr.reduce((s, r) => s + r.tempo_qtd, 0);
      return {
        operador_id: id,
        nome: arr.find((r) => r.nome)?.nome ?? "—",
        total_leituras: total,
        ok,
        erros,
        rotas_atendidas: rotas,
        tempo_medio_ms: tempoQtd ? tempoSoma / tempoQtd : null,
        taxa_acerto: total ? (ok / total) * 100 : 0,
      };
    });
    porOperador.sort((a, b) => b.total_leituras - a.total_leituras);

    const totais = {
      total_leituras: periodoRows.reduce((s, r) => s + r.total, 0),
      ok: periodoRows.reduce((s, r) => s + r.ok, 0),
      erros: periodoRows.reduce((s, r) => s + r.erros, 0),
      operadores_ativos: porOperador.length,
      tempo_medio_ms: (() => {
        const soma = periodoRows.reduce((s, r) => s + r.tempo_soma, 0);
        const qtd = periodoRows.reduce((s, r) => s + r.tempo_qtd, 0);
        return qtd ? soma / qtd : null;
      })(),
    };

    // Série por dia
    const porDiaMap = new Map<string, { total: number; ok: number; erros: number }>();
    for (const r of periodoRows) {
      const dia = r.dia;
      const cur = porDiaMap.get(dia) ?? { total: 0, ok: 0, erros: 0 };
      cur.total += r.total;
      cur.ok += r.ok;
      cur.erros += r.erros;
      porDiaMap.set(dia, cur);
    }
    const porDia = Array.from(porDiaMap.entries())
      .map(([dia, v]) => ({ dia, ...v }))
      .sort((a, b) => a.dia.localeCompare(b.dia));

    // Comparativo hoje / semana / mês por operador (top 10)
    const contar = (rows: Rec[], id: string) =>
      rows.filter((r) => r.operador_id === id).reduce((s, r) => s + r.total, 0);
    const rowsHoje = all.filter((r) => r.dia >= inicioHoje.toISOString().slice(0, 10));
    const rowsSem = all.filter((r) => r.dia >= inicioSemana.toISOString().slice(0, 10));
    const rowsMes = all;
    const comparativo = porOperador.slice(0, 10).map((op) => ({
      operador: op.nome,
      hoje: contar(rowsHoje, op.operador_id),
      semana: contar(rowsSem, op.operador_id),
      mes: contar(rowsMes, op.operador_id),
    }));

    return {
      periodo: data.periodo,
      totais,
      porOperador,
      top3: porOperador.slice(0, 3),
      bottom3: [...porOperador]
        .filter((o) => o.total_leituras > 0)
        .sort((a, b) => a.total_leituras - b.total_leituras)
        .slice(0, 3),
      porDia,
      comparativo,
    };
  });
export const transferenciasGerencial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }): Promise<TransferenciasGerencialData> => {
    const { supabase } = context;
    const desde = inicioPeriodo(data.periodo).toISOString().slice(0, 10);

    type TransferenciaRow = {
      id: string;
      base_id: string;
      motorista: string;
      status: string;
    };
    type EventoRow = {
      transferencia_id: string;
      etapa: "chegada_service" | "saida_service" | "chegada_xpt" | "saida_xpt";
      ocorrido_em: string;
    };
    type OcorrenciaRow = {
      transferencia_id: string;
      motivo_id: string | null;
      responsabilidade: string;
      minutos_atraso: number;
    };

    const transferencias = await buscarPaginado<TransferenciaRow>(
      (inicio, fim) =>
        supabase
          .from("transferencias")
          .select("id, base_id, motorista, status")
          .gte("data_operacional", desde)
          .order("data_operacional", { ascending: false })
          .range(inicio, fim) as any,
    );
    const rows = transferencias.filter((t) => t.status !== "cancelada");
    if (!rows.length) {
      return {
        periodo: data.periodo,
        totais: {
          total: 0,
          disponibilizados_ate_7: 0,
          aguardando_carga: 0,
          saidas_apos_9: 0,
          taxa_disponibilizacao: 0,
          media_service_min: null,
          maior_service_min: null,
          media_deslocamento_min: null,
        },
        porBase: [],
        rankingMotoristas: [],
        motivos: [],
      };
    }

    const ids = rows.map((t) => t.id);
    const eventos: EventoRow[] = [];
    const ocorrencias: OcorrenciaRow[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      const [eventosRes, ocorrenciasRes] = await Promise.all([
        supabase
          .from("transferencia_eventos")
          .select("transferencia_id, etapa, ocorrido_em")
          .in("transferencia_id", lote),
        supabase
          .from("transferencia_ocorrencias")
          .select("transferencia_id, motivo_id, responsabilidade, minutos_atraso")
          .in("transferencia_id", lote)
          .gt("minutos_atraso", 0),
      ]);
      if (eventosRes.error) throw new Error(eventosRes.error.message);
      if (ocorrenciasRes.error) throw new Error(ocorrenciasRes.error.message);
      eventos.push(...((eventosRes.data ?? []) as EventoRow[]));
      ocorrencias.push(...((ocorrenciasRes.data ?? []) as OcorrenciaRow[]));
    }

    const baseIds = Array.from(new Set(rows.map((t) => t.base_id)));
    const motivoIds = Array.from(
      new Set(ocorrencias.map((o) => o.motivo_id).filter(Boolean)),
    ) as string[];
    const [basesRes, motivosRes] = await Promise.all([
      supabase.from("bases").select("id, codigo, nome").in("id", baseIds),
      motivoIds.length
        ? supabase.from("transferencia_motivos").select("id, nome").in("id", motivoIds)
        : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null }),
    ]);
    if (basesRes.error) throw new Error(basesRes.error.message);
    if (motivosRes.error) throw new Error(motivosRes.error.message);

    const baseMap = new Map((basesRes.data ?? []).map((b) => [b.id, b] as const));
    const motivoMap = new Map((motivosRes.data ?? []).map((m) => [m.id, m.nome] as const));
    const eventosMap = new Map<string, EventoRow[]>();
    for (const evento of eventos) {
      const lista = eventosMap.get(evento.transferencia_id) ?? [];
      lista.push(evento);
      eventosMap.set(evento.transferencia_id, lista);
    }

    const minutosEntre = (inicio?: string, fim?: string) =>
      inicio && fim
        ? Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 60000))
        : null;
    const minutosDoDiaEmSaoPaulo = (iso?: string) => {
      if (!iso) return null;
      const partes = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(iso));
      const hora = Number(partes.find((parte) => parte.type === "hour")?.value);
      const minuto = Number(partes.find((parte) => parte.type === "minute")?.value);
      return Number.isFinite(hora) && Number.isFinite(minuto) ? hora * 60 + minuto : null;
    };
    const metricas = rows.map((t) => {
      const lista = eventosMap.get(t.id) ?? [];
      const chegadaService = lista.find((e) => e.etapa === "chegada_service")?.ocorrido_em;
      const saidaService = lista.find((e) => e.etapa === "saida_service")?.ocorrido_em;
      const chegadaXpt = lista.find((e) => e.etapa === "chegada_xpt")?.ocorrido_em;
      const saidaXpt = lista.find((e) => e.etapa === "saida_xpt")?.ocorrido_em;
      return {
        ...t,
        chegadaService,
        saidaService,
        disponibilizadaAte7: (minutosDoDiaEmSaoPaulo(chegadaService) ?? Infinity) <= 7 * 60,
        aguardandoCarga: !!chegadaService && !saidaService,
        saidaApos9: (minutosDoDiaEmSaoPaulo(saidaService) ?? -Infinity) > 9 * 60,
        permanencia: minutosEntre(chegadaService, saidaService),
        deslocamento: minutosEntre(saidaService, chegadaXpt),
        concluida: !!saidaXpt,
      };
    });

    const media = (valores: Array<number | null>) => {
      const validos = valores.filter((v): v is number => v !== null);
      return validos.length
        ? Math.round(validos.reduce((total, valor) => total + valor, 0) / validos.length)
        : null;
    };
    const contarService = (lista: typeof metricas) => ({
      disponibilizados_ate_7: lista.filter((t) => t.disponibilizadaAte7).length,
      aguardando_carga: lista.filter((t) => t.aguardandoCarga).length,
      saidas_apos_9: lista.filter((t) => t.saidaApos9).length,
    });

    const service = contarService(metricas);
    const permanencias = metricas
      .map((t) => t.permanencia)
      .filter((valor): valor is number => valor !== null);
    const totais: TransferenciasGerencialData["totais"] = {
      total: metricas.length,
      ...service,
      taxa_disponibilizacao: metricas.length
        ? (service.disponibilizados_ate_7 / metricas.length) * 100
        : 0,
      media_service_min: media(permanencias),
      maior_service_min: permanencias.length ? Math.max(...permanencias) : null,
      media_deslocamento_min: media(metricas.map((t) => t.deslocamento)),
    };

    const porBase = baseIds
      .map((baseId) => {
        const lista = metricas.filter((t) => t.base_id === baseId);
        const base = baseMap.get(baseId);
        return {
          base_id: baseId,
          base_codigo: base?.codigo ?? "—",
          base_nome: base?.nome ?? "Base não encontrada",
          total: lista.length,
          ...contarService(lista),
          media_service_min: media(lista.map((t) => t.permanencia)),
          media_deslocamento_min: media(lista.map((t) => t.deslocamento)),
        };
      })
      .sort((a, b) => b.saidas_apos_9 - a.saidas_apos_9 || b.total - a.total);

    const motoristasMap = new Map<string, { viagens_atrasadas: number; minutos_atraso: number }>();
    for (const t of metricas) {
      if (t.permanencia === null) continue;
      const atual = motoristasMap.get(t.motorista) ?? { viagens_atrasadas: 0, minutos_atraso: 0 };
      atual.viagens_atrasadas++;
      atual.minutos_atraso += t.permanencia;
      motoristasMap.set(t.motorista, atual);
    }
    const rankingMotoristas = Array.from(motoristasMap.entries())
      .map(([motorista, valores]) => ({ motorista, ...valores }))
      .sort(
        (a, b) => b.minutos_atraso - a.minutos_atraso || b.viagens_atrasadas - a.viagens_atrasadas,
      )
      .slice(0, 10);

    const motivosMap = new Map<
      string,
      { motivo: string; responsabilidade: string; ocorrencias: number; minutos_atraso: number }
    >();
    for (const ocorrencia of ocorrencias) {
      const motivo = ocorrencia.motivo_id
        ? (motivoMap.get(ocorrencia.motivo_id) ?? "Motivo não encontrado")
        : "Em análise";
      const chave = `${ocorrencia.responsabilidade}::${motivo}`;
      const atual = motivosMap.get(chave) ?? {
        motivo,
        responsabilidade: ocorrencia.responsabilidade,
        ocorrencias: 0,
        minutos_atraso: 0,
      };
      atual.ocorrencias++;
      atual.minutos_atraso += ocorrencia.minutos_atraso;
      motivosMap.set(chave, atual);
    }
    const motivos = Array.from(motivosMap.values())
      .sort((a, b) => b.minutos_atraso - a.minutos_atraso || b.ocorrencias - a.ocorrencias)
      .slice(0, 10);

    return { periodo: data.periodo, totais, porBase, rankingMotoristas, motivos };
  });

const rotasInputSchema = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  baseId: z.string().uuid().optional(),
});

function hojeYMD(): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return f.format(new Date()); // YYYY-MM-DD
}

export const rotasPorBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => rotasInputSchema.parse(input))
  .handler(async ({ data, context }): Promise<RotasPorBaseData> => {
    const { supabase, userId } = context;
    let dia = data.data ?? hojeYMD();

    // Bases permitidas ao usuário (RLS já filtra, mas garantimos ordenação/uso)
    const { data: bases, error: eb } = await supabase
      .from("bases")
      .select("id, codigo, nome")
      .order("nome");
    if (eb) throw new Error(eb.message);
    const allowedBases = (bases ?? []).filter((b) => !data.baseId || b.id === data.baseId);
    const baseMap = new Map(allowedBases.map((b) => [b.id, b] as const));

    if (allowedBases.length === 0) {
      return { data: dia, bases: [], rotas: [] };
    }

    // Importações ativas no dia para essas bases
    const importacoesIniciais = await supabase
      .from("importacoes_escala")
      .select("id, base_id")
      .eq("data_operacional", dia)
      .eq("ativa", true)
      .in(
        "base_id",
        allowedBases.map((b) => b.id),
      );
    let imports = importacoesIniciais.data;
    if (importacoesIniciais.error) throw new Error(importacoesIniciais.error.message);

    // Sem importação para o dia solicitado — usa o dia mais recente com dados.
    if (!data.data && (imports ?? []).length === 0) {
      const { data: recente } = await supabase
        .from("importacoes_escala")
        .select("data_operacional")
        .eq("ativa", true)
        .in(
          "base_id",
          allowedBases.map((b) => b.id),
        )
        .order("data_operacional", { ascending: false })
        .limit(1);
      const nova = recente?.[0]?.data_operacional as string | undefined;
      if (nova && nova !== dia) {
        dia = nova;
        const r2 = await supabase
          .from("importacoes_escala")
          .select("id, base_id")
          .eq("data_operacional", dia)
          .eq("ativa", true)
          .in(
            "base_id",
            allowedBases.map((b) => b.id),
          );
        imports = r2.data ?? [];
      }
    }

    const importIds = (imports ?? []).map((i) => i.id);
    const importBaseMap = new Map((imports ?? []).map((i) => [i.id, i.base_id] as const));

    // Agregação feita no banco: uma única passagem por importação/rota.
    // Trazer dezenas de milhares de linhas paginadas estourava o statement_timeout.
    type AgregadoRota = {
      importacao_id: string | null;
      base_operacional_id: string | null;
      nro_rota: string | null;
      motorista: string | null;
      placa: string | null;
      total: number;
      triado: number;
      devolvido: number;
    };

    let agregados: AgregadoRota[] = [];
    if (importIds.length > 0) {
      const { data: rpcData, error: rpcErro } = await supabase.rpc("gerencial_rotas_por_base", {
        p_importacao_ids: importIds,
      });
      if (rpcErro) throw new Error(rpcErro.message);
      agregados = (rpcData ?? []) as AgregadoRota[];
    }

    // Agrupamento por base+rota
    const grupos = new Map<string, RotaBaseRow>();
    for (const e of agregados) {
      const baseId = importBaseMap.get(e.importacao_id ?? "") ?? e.base_operacional_id;
      if (!baseId) continue;
      const b = baseMap.get(baseId);
      if (!b) continue;
      const rota = (e.nro_rota ?? "").trim() || "—";
      const key = `${baseId}::${rota}`;
      const cur = grupos.get(key) ?? {
        base_id: baseId,
        base_codigo: b.codigo,
        base_nome: b.nome,
        nro_rota: rota,
        motorista: e.motorista,
        placa: e.placa,
        total: 0,
        recebido: 0,
        devolvido: 0,
        faltando: 0,
        pct: 0,
        status: "vazia" as const,
      };
      cur.motorista = cur.motorista ?? e.motorista;
      cur.placa = cur.placa ?? e.placa;
      cur.total += Number(e.total ?? 0);
      // Neste painel, "bipado" representa a leitura feita na Triagem.
      cur.recebido += Number(e.triado ?? 0);
      cur.devolvido += Number(e.devolvido ?? 0);
      grupos.set(key, cur);
    }

    const rotas: RotaBaseRow[] = Array.from(grupos.values()).map((r) => {
      const processados = r.recebido + r.devolvido;
      const faltando = Math.max(0, r.total - processados);
      const pct = r.total ? (r.recebido / r.total) * 100 : 0;
      const status: RotaBaseRow["status"] =
        processados === 0 ? "vazia" : r.recebido >= r.total ? "completa" : "parcial";
      return { ...r, faltando, pct, status };
    });
    rotas.sort(
      (a, b) =>
        a.base_nome.localeCompare(b.base_nome) ||
        a.nro_rota.localeCompare(b.nro_rota, "pt-BR", { numeric: true }),
    );

    const resumoBases = allowedBases.map((b) => {
      const rs = rotas.filter((r) => r.base_id === b.id);
      const total_pacotes = rs.reduce((s, r) => s + r.total, 0);
      const recebidos = rs.reduce((s, r) => s + r.recebido, 0);
      const devolvidos = rs.reduce((s, r) => s + r.devolvido, 0);
      const faltando = rs.reduce((s, r) => s + r.faltando, 0);
      return {
        base_id: b.id,
        codigo: b.codigo,
        nome: b.nome,
        total_rotas: rs.length,
        rotas_completas: rs.filter((r) => r.status === "completa").length,
        rotas_parciais: rs.filter((r) => r.status === "parcial").length,
        total_pacotes,
        recebidos,
        devolvidos,
        faltando,
        pct: total_pacotes ? (recebidos / total_pacotes) * 100 : 0,
      };
    });

    // Silence unused var
    void userId;

    return { data: dia, bases: resumoBases, rotas };
  });

// ============================================================
// Resumo operacional por base (usado no Dashboard Gerencial)
// ============================================================

export type ResumoBaseRow = {
  base_id: string;
  codigo: string;
  nome: string;
  triados: number; // recebimentos com resultado "ok" / "primeira_leitura"
  recebimentos: number; // total de leituras registradas
  devolucoes: number;
  inventario: number;
  transferencias: number;
  contagens: number;
};

export type ResumoPorBaseData = {
  dia: string; // início do período (YYYY-MM-DD) — mantido para compat
  periodo: "hoje" | "7d" | "30d";
  inicio: string;
  fim: string;
  bases: ResumoBaseRow[];
  totais: Omit<ResumoBaseRow, "base_id" | "codigo" | "nome">;
};

const resumoInputSchema = z.object({
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  periodo: z.enum(["hoje", "7d", "30d"]).optional(),
});

function ymd(d: Date): string {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

export const resumoOperacionalPorBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => resumoInputSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ResumoPorBaseData> => {
    const { supabase } = context;

    // Define intervalo. Se `periodo` for informado, prevalece sobre `dia`.
    let inicio: string;
    let fim: string;
    const periodo = data.periodo ?? (data.dia ? "hoje" : "hoje");
    if (data.periodo) {
      const hoje = new Date();
      fim = ymd(hoje);
      if (data.periodo === "hoje") {
        inicio = fim;
      } else {
        const dias = data.periodo === "7d" ? 6 : 29; // inclusivo
        const ini = new Date(hoje.getTime() - dias * 24 * 3600 * 1000);
        inicio = ymd(ini);
      }
    } else {
      inicio = data.dia ?? ymd(new Date());
      fim = inicio;
    }

    const zeroRow = () => ({
      triados: 0,
      recebimentos: 0,
      devolucoes: 0,
      inventario: 0,
      transferencias: 0,
      contagens: 0,
    });
    const { data: rpcRows, error: rpcErro } = await (supabase as any).rpc(
      "gerencial_resumo_bases",
      { p_inicio: inicio, p_fim: fim },
    );
    if (rpcErro) throw new Error(rpcErro.message);

    const rows: ResumoBaseRow[] = ((rpcRows ?? []) as any[]).map((r) => ({
      base_id: r.base_id,
      codigo: r.codigo,
      nome: r.nome,
      triados: Number(r.triados ?? 0),
      recebimentos: Number(r.recebimentos ?? 0),
      devolucoes: Number(r.devolucoes ?? 0),
      inventario: Number(r.inventario ?? 0),
      transferencias: Number(r.transferencias ?? 0),
      contagens: Number(r.contagens ?? 0),
    }));

    const totais = rows.reduce(
      (acc, r) => ({
        triados: acc.triados + r.triados,
        recebimentos: acc.recebimentos + r.recebimentos,
        devolucoes: acc.devolucoes + r.devolucoes,
        inventario: acc.inventario + r.inventario,
        transferencias: acc.transferencias + r.transferencias,
        contagens: acc.contagens + r.contagens,
      }),
      zeroRow(),
    );

    return { dia: inicio, periodo, inicio, fim, bases: rows, totais };
  });

// ============================================================
// Detalhes das métricas do resumo por base (drill-down)
// ============================================================

export type MetricaResumo =
  "recebimentos" | "triados" | "devolucoes" | "inventario" | "transferencias" | "contagens";

export type DetalheItem = {
  id: string;
  quando: string; // ISO
  base_codigo: string | null;
  base_nome: string | null;
  titulo: string; // linha principal
  subtitulo?: string | null;
  extra?: string | null;
  operador_nome?: string | null;
};

export type DetalhesMetricaData = {
  metrica: MetricaResumo;
  periodo: "hoje" | "7d" | "30d";
  inicio: string;
  fim: string;
  dia?: string | null;
  total: number;
  itens: DetalheItem[];
};

const detalhesInput = z.object({
  metrica: z.enum([
    "recebimentos",
    "triados",
    "devolucoes",
    "inventario",
    "transferencias",
    "contagens",
  ]),
  periodo: z.enum(["hoje", "7d", "30d"]).default("hoje"),
  base_id: z.string().uuid().optional(),
  dia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(1000).default(300),
});

export const detalhesResumoPorBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => detalhesInput.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<DetalhesMetricaData> => {
    const { supabase } = context;

    const hoje = new Date();
    const fim = data.dia ?? ymd(hoje);
    const inicio = data.dia
      ? data.dia
      : data.periodo === "hoje"
        ? fim
        : ymd(new Date(hoje.getTime() - (data.periodo === "7d" ? 6 : 29) * 24 * 3600 * 1000));
    const iniISO = `${inicio}T00:00:00.000Z`;
    const fimISO = `${fim}T23:59:59.999Z`;

    const { data: bases } = await supabase.from("bases").select("id, codigo, nome");
    const bmap = new Map<string, { codigo: string; nome: string }>();
    for (const b of bases ?? []) bmap.set(b.id, { codigo: b.codigo, nome: b.nome });

    const itens: DetalheItem[] = [];

    if (data.metrica === "recebimentos" || data.metrica === "triados") {
      let q = supabase
        .from("recebimentos")
        .select("id, codigo_bipado, resultado, mensagem, base_id, created_at, data_operacional")
        .gte("data_operacional", inicio)
        .lte("data_operacional", fim)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (data.base_id) q = q.eq("base_id", data.base_id);
      if (data.metrica === "triados") q = q.eq("resultado", "ok");
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const b = r.base_id ? bmap.get(r.base_id) : null;
        itens.push({
          id: r.id,
          quando: r.created_at,
          base_codigo: b?.codigo ?? null,
          base_nome: b?.nome ?? null,
          titulo: r.codigo_bipado ?? "—",
          subtitulo: r.resultado,
          extra: r.mensagem,
        });
      }
    } else if (data.metrica === "devolucoes") {
      let q = supabase
        .from("devolucoes")
        .select(
          "id, shipment_codigo, rota, motorista, motivo, observacao, base_id, devolvido_em, cancelado, devolvido_por",
        )
        .gte("devolvido_em", iniISO)
        .lte("devolvido_em", fimISO)
        .eq("cancelado", false)
        .order("devolvido_em", { ascending: false })
        .limit(data.limit);
      if (data.base_id) q = q.eq("base_id", data.base_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      const userIds = Array.from(
        new Set((rows ?? []).map((r) => r.devolvido_por).filter(Boolean)),
      ) as string[];
      const nomes = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, nome")
          .in("id", userIds);
        (profs ?? []).forEach((p) => nomes.set(p.id as string, p.nome as string));
      }
      for (const r of rows ?? []) {
        const b = r.base_id ? bmap.get(r.base_id) : null;
        const operador = r.devolvido_por ? (nomes.get(r.devolvido_por) ?? null) : null;
        itens.push({
          id: r.id,
          quando: r.devolvido_em,
          base_codigo: b?.codigo ?? null,
          base_nome: b?.nome ?? null,
          titulo: r.shipment_codigo ?? "—",
          subtitulo: `${r.rota ?? "sem rota"} · ${r.motivo ?? "—"}`,
          extra: [r.motorista, r.observacao].filter(Boolean).join(" · ") || null,
          operador_nome: operador,
        });
      }
    } else if (data.metrica === "inventario") {
      let q = supabase
        .from("inventario_leituras")
        .select("id, codigo, base_id, bipado_em, cancelado, dia_operacional")
        .gte("dia_operacional", inicio)
        .lte("dia_operacional", fim)
        .eq("cancelado", false)
        .order("bipado_em", { ascending: false })
        .limit(data.limit);
      if (data.base_id) q = q.eq("base_id", data.base_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const b = r.base_id ? bmap.get(r.base_id) : null;
        itens.push({
          id: r.id,
          quando: r.bipado_em,
          base_codigo: b?.codigo ?? null,
          base_nome: b?.nome ?? null,
          titulo: r.codigo ?? "—",
          subtitulo: `Dia ${r.dia_operacional}`,
        });
      }
    } else if (data.metrica === "transferencias") {
      let q = supabase
        .from("transferencias")
        .select(
          "id, codigo, service, motorista, placa, status, base_id, data_operacional, created_at, finalizada_em",
        )
        .gte("data_operacional", inicio)
        .lte("data_operacional", fim)
        .neq("status", "cancelada")
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (data.base_id) q = q.eq("base_id", data.base_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const b = r.base_id ? bmap.get(r.base_id) : null;
        itens.push({
          id: r.id,
          quando: r.created_at ?? r.finalizada_em ?? `${r.data_operacional}T00:00:00.000Z`,
          base_codigo: b?.codigo ?? null,
          base_nome: b?.nome ?? null,
          titulo: `${r.codigo ?? "—"} · ${r.service ?? ""}`.trim(),
          subtitulo: `${r.motorista ?? "—"} · ${r.placa ?? "—"}`,
          extra: r.status,
        });
      }
    } else if (data.metrica === "contagens") {
      let q = supabase
        .from("contagens")
        .select(
          "id, base_id, data_operacional, iniciada_em, finalizada_em, total_esperado, total_contado, divergencia",
        )
        .gte("data_operacional", inicio)
        .lte("data_operacional", fim)
        .order("iniciada_em", { ascending: false })
        .limit(data.limit);
      if (data.base_id) q = q.eq("base_id", data.base_id);
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      for (const r of rows ?? []) {
        const b = r.base_id ? bmap.get(r.base_id) : null;
        itens.push({
          id: r.id,
          quando: r.iniciada_em ?? `${r.data_operacional}T00:00:00.000Z`,
          base_codigo: b?.codigo ?? null,
          base_nome: b?.nome ?? null,
          titulo: `Contagem ${r.data_operacional}`,
          subtitulo: `Esperado ${r.total_esperado ?? 0} · Contado ${r.total_contado ?? 0}`,
          extra: (r.divergencia ?? 0) !== 0 ? `Divergência ${r.divergencia}` : "Sem divergência",
        });
      }
    }

    return {
      metrica: data.metrica,
      periodo: data.periodo,
      inicio,
      fim,
      dia: data.dia ?? null,
      total: itens.length,
      itens,
    };
  });
