import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filtroSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  motorista: z.string().trim().max(120).optional().nullable(),
  rota: z.string().trim().max(120).optional().nullable(),
  status: z
    .enum(["nao_iniciado", "em_rota", "entregue", "insucesso", "cancelado", "desconhecido"])
    .optional()
    .nullable(),
  transportadora: z.string().trim().max(120).optional().nullable(),
  risco: z.enum(["qualquer", "integral", "parcial"]).optional().nullable(),
});

export type MeliDashboardFiltros = z.infer<typeof filtroSchema>;

export type MeliDashboardCards = {
  total: number;
  nao_iniciado: number;
  em_rota: number;
  entregue: number;
  insucesso: number;
  cancelado: number;
  desconhecido: number;
  area_risco_pacotes: number;
  elegiveis: number;
  perc_entrega: number;
  rotas: number;
  rotas_risco: number;
  /** Rotas PM da ESP16 ainda não iniciadas — fora dos indicadores de hoje. */
  pm_nao_iniciadas?: number;
  /** Pacotes dessas rotas PM não iniciadas (fora do numerador e do denominador). */
  pm_pacotes_fora?: number;
};


export type MeliDashboardRota = {
  rota_id: string;
  route_id: string;
  nome_operacional: string;
  cluster: string | null;
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  service_center: string | null;
  driver_name: string | null;
  vehicle_license: string | null;
  carrier: string | null;
  data_rota: string | null;
  last_synced_at: string | null;
  rota_area_risco: boolean;
  area_risco_parcial: boolean;
  total: number;
  nao_iniciado: number;
  em_rota: number;
  entregue: number;
  insucesso: number;
  cancelado: number;
  pacotes_risco: number;
  perc_entrega: number;
};

export type MeliDashboardBase = {
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  service_center: string | null;
  rotas: number;
  rotas_risco: number;
  rotas_risco_integral: number;
  rotas_risco_parcial: number;
  total: number;
  pacotes_risco: number;
  entregue: number;
  em_rota: number;
  insucesso: number;
  perc_entrega: number;
  /** PM não iniciadas desta base (não entram nos números acima). */
  pm_nao_iniciadas?: number;
  pm_pacotes_fora?: number;
};

/** Rota PM da ESP16 ainda não iniciada — programada para o dia seguinte. */
export type MeliDashboardPmProgramada = {
  rota_id: string;
  route_id: string;
  nome_operacional: string;
  cluster: string | null;
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  driver_name: string | null;
  vehicle_license: string | null;
  data_rota: string | null;
  last_synced_at: string | null;
  total: number;
};

export type MeliDashboardResult = {
  status: "ok" | "erro";
  erro?: string;
  data_operacional?: string;
  server_time?: string;
  cards?: MeliDashboardCards;
  motivos_insucesso?: { codigo: string; descricao: string; cadastrado: boolean; total: number }[];
  rotas?: MeliDashboardRota[];
  bases?: MeliDashboardBase[];
  pm_programadas?: MeliDashboardPmProgramada[];

  area_risco?: {
    rotas: number;
    integrais: number;
    parciais: number;
    pacotes: number;
    entregue: number;
    em_rota: number;
    insucesso: number;
    perc_conclusao: number;
  };
  ultima_sincronizacao?: string | null;
  sincronizacao_por_base?: { base_id: string | null; base_codigo: string | null; last_synced_at: string | null }[];
};

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

type MonitoramentoPreservado = {
  base_codigo: string;
  rotas_totais: number;
  pacotes: number;
  pendentes: number;
  com_falhas: number;
  bem_sucedidos: number;
  performance_logistics_max: number | null;
};

function maior(atual: number | null | undefined, preservado: number | null | undefined) {
  return Math.max(Number(atual ?? 0), Number(preservado ?? 0));
}

/**
 * Aplica o maior valor confirmado no dia apenas ao resumo por base. Os detalhes
 * de rota continuam vindo da fonte operacional e, portanto, não são inventados.
 */
export function aplicarMonitoramentoPreservado(
  resultado: MeliDashboardResult,
  snapshots: MonitoramentoPreservado[],
): MeliDashboardResult {
  if (resultado.status !== "ok" || !resultado.bases?.length || snapshots.length === 0) return resultado;

  const porCodigo = new Map(snapshots.map((s) => [s.base_codigo.toUpperCase(), s]));
  const bases = resultado.bases.map((base) => {
    const snapshot = porCodigo.get((base.base_codigo ?? "").toUpperCase());
    if (!snapshot) return base;
    return {
      ...base,
      rotas: maior(base.rotas, snapshot.rotas_totais),
      total: maior(base.total, snapshot.pacotes),
      entregue: maior(base.entregue, snapshot.bem_sucedidos),
      insucesso: maior(base.insucesso, snapshot.com_falhas),
      perc_entrega: maior(base.perc_entrega, snapshot.performance_logistics_max),
    };
  });

  const cards = resultado.cards
    ? {
        ...resultado.cards,
        rotas: bases.reduce((soma, base) => soma + base.rotas, 0),
        total: bases.reduce((soma, base) => soma + base.total, 0),
        entregue: bases.reduce((soma, base) => soma + base.entregue, 0),
        insucesso: bases.reduce((soma, base) => soma + base.insucesso, 0),
        perc_entrega: bases.reduce((total, base) => total + base.total, 0) > 0
          ? Math.round(
              (1000 * bases.reduce((soma, base) => soma + base.entregue, 0)) /
                bases.reduce((soma, base) => soma + base.total, 0),
            ) / 10
          : resultado.cards.perc_entrega,
      }
    : resultado.cards;

  return { ...resultado, bases, cards };
}

export function meliDashboardQueryKey(filtros: MeliDashboardFiltros) {
  const normalizados = Object.fromEntries(
    Object.entries(filtros).filter(([, valor]) => valor !== null && valor !== undefined && valor !== ""),
  );
  return ["meli-dashboard-operacional", normalizados] as const;
}

export const meliDashboardOperacional = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filtroSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliDashboardResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_dashboard_operacional",
      {
        p_data: data.data ?? null,
        p_base_id: data.base_id ?? null,
        p_motorista: data.motorista || null,
        p_rota: data.rota || null,
        p_status: data.status ?? null,
        p_transportadora: data.transportadora || null,
        p_risco: data.risco ?? null,
      },
    );
    if (error) return { status: "erro", erro: error.message };

    const resultado = res as MeliDashboardResult;
    const semFiltroDeDetalhe = !data.base_id && !data.motorista && !data.rota && !data.status &&
      !data.transportadora && !data.risco;
    if (!semFiltroDeDetalhe || resultado.status !== "ok") return resultado;

    const dataOperacional = data.data ?? resultado.data_operacional;
    if (!dataOperacional) return resultado;
    const { data: snapshots } = await (context.supabase as any)
      .from("meli_monitoramento_snapshots")
      .select("base_codigo,rotas_totais,pacotes,pendentes,com_falhas,bem_sucedidos,performance_logistics_max")
      .eq("data_operacional", dataOperacional);

    return aplicarMonitoramentoPreservado(resultado, (snapshots ?? []) as MonitoramentoPreservado[]);
  });

const pacotesSchema = z.object({
  rota_id: z.string().uuid(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export type MeliDashboardPacote = {
  tracking_id: string;
  shipment_id: string | null;
  stop_id: string | null;
  ordem: number | null;
  status: string | null;
  substatus: string | null;
  occurrence_code: string | null;
  situacao: string;
  descricao_ocorrencia: string | null;
  pacote_area_risco: boolean;
  motivo_area_risco: string | null;
  origem_area_risco: string | null;
  ultima_atualizacao_meli: string | null;
  jm_recebido: boolean | null;
  jm_recebido_em: string | null;
  jm_triado: boolean | null;
  jm_triado_em: string | null;
};

export type MeliDashboardPacotesResult = {
  status: "ok" | "erro";
  erro?: string;
  rota?: {
    id: string;
    route_id: string;
    cluster: string | null;
    nome_operacional: string;
    base_codigo: string | null;
    base_nome: string | null;
    driver_name: string | null;
    vehicle_license: string | null;
    data_rota: string | null;
    last_synced_at: string | null;
    rota_area_risco: boolean;
    area_risco_parcial: boolean;
    motivo_area_risco: string | null;
    origem_area_risco: string | null;
    dia_anterior: boolean;
  };
  pacotes?: MeliDashboardPacote[];
};

export const meliDashboardPacotesRota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => pacotesSchema.parse(d))
  .handler(async ({ data, context }): Promise<MeliDashboardPacotesResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_dashboard_pacotes_rota",
      { p_rota_id: data.rota_id, p_limit: data.limit ?? 500 },
    );
    if (error) return { status: "erro", erro: error.message };
    return res as MeliDashboardPacotesResult;
  });
