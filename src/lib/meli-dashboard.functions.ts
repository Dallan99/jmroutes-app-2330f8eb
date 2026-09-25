import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filtroSchema = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
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
  sincronizacao_por_base?: {
    base_id: string | null;
    base_codigo: string | null;
    last_synced_at: string | null;
  }[];
  snapshot_fallback?: boolean;
  snapshot_at?: string | null;
  sla_geral?: {
    bases_total: number;
    rotas_total: number;
    pacotes_total: number;
    entregues_total: number;
    pendentes_total: number;
    insucessos_total: number;
    percentual: number;
    ultima_coleta: string | null;
    updated_at: string;
  } | null;
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export function temDadosDashboard(resultado: MeliDashboardResult | null | undefined): boolean {
  if (!resultado || resultado.status !== "ok") return false;
  if ((resultado.cards?.total ?? 0) > 0 || (resultado.cards?.rotas ?? 0) > 0) return true;
  return (resultado.bases ?? []).some((base) => (base.total ?? 0) > 0 || (base.rotas ?? 0) > 0);
}

async function carregarUltimoSnapshotMultibase(
  client: any,
  dataLimite: string,
): Promise<MeliDashboardResult | null> {
  const { data: leituras, error } = await client
    .from("meli_monitoramento_snapshots")
    .select(
      "base_codigo,data_operacional,service_center_id,rotas_totais,rotas_em_andamento,pacotes,pendentes,com_falhas,bem_sucedidos,coletado_em,performance_logistics_max",
    )
    .lte("data_operacional", dataLimite)
    .or("pacotes.gt.0,rotas_totais.gt.0")
    .order("data_operacional", { ascending: false })
    .order("coletado_em", { ascending: false })
    .limit(100);
  if (error || !leituras?.length) return null;

  // Cada base pode parar em um instante diferente. Preserva a leitura mais
  // recente de cada uma em vez de transformar um ciclo parcial no estado total.
  const dia = dataLimite;
  const snapshots = selecionarUltimoSnapshotPorBase(leituras);
  const codigos = snapshots.map((linha: any) => linha.base_codigo);
  const { data: unidades } = await client
    .from("meli_unidades_operacionais")
    .select("id,codigo,nome,ordem")
    .in("codigo", codigos)
    .eq("ativo", true);
  const { data: cadastros } = await client
    .from("bases")
    .select("id,codigo,nome")
    .in("codigo", codigos);
  const unidadePorCodigo = new Map((unidades ?? []).map((base: any) => [base.codigo, base]));
  const cadastroPorCodigo = new Map<string, any>(
    (cadastros ?? []).map((base: any) => [base.codigo as string, base]),
  );
  const idsBase = (cadastros ?? []).map((base: any) => base.id);
  const { data: rotasRisco } = idsBase.length
    ? await client
        .from("meli_rotas")
        .select(
          "id,route_id,cluster,base_id,service_center_id,driver_name,vehicle_license,carrier,data_rota,last_synced_at,rota_area_risco,area_risco_parcial,total_pacotes,delivered_total,pending_total,occurrence_total",
        )
        .eq("data_rota", dia)
        .in("base_id", idsBase)
        .or("rota_area_risco.eq.true,area_risco_parcial.eq.true")
    : { data: [] };
  const riscoPorBase = new Map<string, { total: number; integrais: number; parciais: number }>();
  for (const rota of rotasRisco ?? []) {
    if (!rota.base_id) continue;
    const atual = riscoPorBase.get(rota.base_id) ?? { total: 0, integrais: 0, parciais: 0 };
    atual.total += 1;
    if (rota.rota_area_risco) atual.integrais += 1;
    else if (rota.area_risco_parcial) atual.parciais += 1;
    riscoPorBase.set(rota.base_id, atual);
  }

  const bases: MeliDashboardBase[] = snapshots
    .map((snapshot: any) => {
      const unidade: any = unidadePorCodigo.get(snapshot.base_codigo);
      const cadastro: any = cadastroPorCodigo.get(snapshot.base_codigo);
      const total = Number(snapshot.pacotes ?? 0);
      const entregue = Number(snapshot.bem_sucedidos ?? 0);
      const risco = cadastro?.id ? riscoPorBase.get(cadastro.id) : undefined;
      return {
        // O filtro detalhado usa bases.id; o id da unidade operacional pertence
        // a outro cadastro e não pode ser enviado como se fosse uma base.
        base_id: cadastro?.id ?? null,
        base_codigo: snapshot.base_codigo,
        base_nome: unidade?.nome ?? cadastro?.nome ?? snapshot.base_codigo,
        service_center: snapshot.service_center_id ?? null,
        rotas: Number(snapshot.rotas_totais ?? 0),
        rotas_risco: risco?.total ?? 0,
        rotas_risco_integral: risco?.integrais ?? 0,
        rotas_risco_parcial: risco?.parciais ?? 0,
        total,
        pacotes_risco: 0,
        entregue,
        em_rota: Number(snapshot.pendentes ?? 0),
        insucesso: Number(snapshot.com_falhas ?? 0),
        perc_entrega: Number(
          snapshot.performance_logistics_max ?? (total > 0 ? (100 * entregue) / total : 0),
        ),
        pm_nao_iniciadas: 0,
        pm_pacotes_fora: 0,
        _ordem: Number(unidade?.ordem ?? 9999),
      };
    })
    .sort(
      (a: any, b: any) =>
        a._ordem - b._ordem || String(a.base_codigo).localeCompare(String(b.base_codigo)),
    )
    .map(({ _ordem, ...base }: any) => base as MeliDashboardBase);
  const total = bases.reduce((soma, base) => soma + base.total, 0);
  const entregue = bases.reduce((soma, base) => soma + base.entregue, 0);
  const insucesso = bases.reduce((soma, base) => soma + base.insucesso, 0);
  const pendentes = bases.reduce((soma, base) => soma + base.em_rota, 0);
  const totalRotasRisco = bases.reduce((soma, base) => soma + base.rotas_risco, 0);
  const rotasRiscoIntegrais = bases.reduce((soma, base) => soma + base.rotas_risco_integral, 0);
  const rotasRiscoParciais = bases.reduce((soma, base) => soma + base.rotas_risco_parcial, 0);
  const rotas: MeliDashboardRota[] = (rotasRisco ?? []).map((rota: any) => {
    const cadastro: any = (cadastros ?? []).find((base: any) => base.id === rota.base_id);
    const totalRota = Number(rota.total_pacotes ?? 0);
    const entregueRota = Number(rota.delivered_total ?? 0);
    const emRota = Number(rota.pending_total ?? 0);
    const insucessoRota = Number(rota.occurrence_total ?? 0);
    return {
      rota_id: rota.id,
      route_id: rota.route_id,
      nome_operacional: String(rota.cluster ?? "").trim() || rota.route_id,
      cluster: rota.cluster,
      base_id: rota.base_id,
      base_codigo: cadastro?.codigo ?? null,
      base_nome: cadastro?.nome ?? null,
      service_center: rota.service_center_id ?? null,
      driver_name: rota.driver_name,
      vehicle_license: rota.vehicle_license,
      carrier: rota.carrier,
      data_rota: rota.data_rota,
      last_synced_at: rota.last_synced_at,
      rota_area_risco: Boolean(rota.rota_area_risco),
      area_risco_parcial: Boolean(rota.area_risco_parcial),
      total: totalRota,
      nao_iniciado: Math.max(0, totalRota - entregueRota - emRota - insucessoRota),
      em_rota: emRota,
      entregue: entregueRota,
      insucesso: insucessoRota,
      cancelado: 0,
      pacotes_risco: totalRota,
      perc_entrega: totalRota > 0 ? Math.round((1000 * entregueRota) / totalRota) / 10 : 0,
    };
  });
  const pacotesRisco = rotas.reduce((soma, rota) => soma + rota.pacotes_risco, 0);
  const entreguesRisco = rotas.reduce((soma, rota) => soma + rota.entregue, 0);
  const emRotaRisco = rotas.reduce((soma, rota) => soma + rota.em_rota, 0);
  const insucessosRisco = rotas.reduce((soma, rota) => soma + rota.insucesso, 0);

  const snapshotAt = snapshots.reduce<string | null>(
    (maisRecente, linha: any) =>
      !maisRecente || linha.coletado_em > maisRecente ? linha.coletado_em : maisRecente,
    null,
  );

  return {
    status: "ok",
    data_operacional: dia,
    server_time: new Date().toISOString(),
    cards: {
      total,
      nao_iniciado: pendentes,
      em_rota: pendentes,
      entregue,
      insucesso,
      cancelado: 0,
      desconhecido: 0,
      area_risco_pacotes: pacotesRisco,
      elegiveis: total,
      perc_entrega: total > 0 ? Math.round((1000 * entregue) / total) / 10 : 0,
      rotas: bases.reduce((soma, base) => soma + base.rotas, 0),
      rotas_risco: totalRotasRisco,
      pm_nao_iniciadas: 0,
      pm_pacotes_fora: 0,
    },
    bases,
    rotas,
    motivos_insucesso:
      insucesso > 0
        ? [
            {
              codigo: "sem_detalhamento_adminml",
              descricao: "Aguardando detalhamento do motivo pelo AdminML",
              cadastrado: true,
              total: insucesso,
            },
          ]
        : [],
    pm_programadas: [],
    snapshot_fallback: true,
    snapshot_at: snapshotAt,
    ultima_sincronizacao: snapshotAt,
    sincronizacao_por_base: snapshots.map((snapshot: any) => ({
      base_id: cadastroPorCodigo.get(snapshot.base_codigo)?.id ?? null,
      base_codigo: snapshot.base_codigo,
      last_synced_at: snapshot.coletado_em ?? null,
    })),
    area_risco: {
      rotas: totalRotasRisco,
      integrais: rotasRiscoIntegrais,
      parciais: rotasRiscoParciais,
      pacotes: pacotesRisco,
      entregue: entreguesRisco,
      em_rota: emRotaRisco,
      insucesso: insucessosRisco,
      perc_conclusao:
        pacotesRisco > 0 ? Math.round((1000 * entreguesRisco) / pacotesRisco) / 10 : 0,
    },
  };
}

type MonitoramentoPreservado = {
  base_codigo: string;
  data_operacional?: string | null;
  base_id?: string | null;
  base_nome?: string | null;
  service_center_id?: string | null;
  rotas_totais: number;
  pacotes: number;
  pendentes: number;
  com_falhas: number;
  bem_sucedidos: number;
  performance_logistics_max: number | null;
  coletado_em?: string | null;
};

/** A consulta vem em ordem decrescente; mantém a primeira leitura de cada base. */
export function selecionarUltimoSnapshotPorBase<T extends { base_codigo: string }>(
  snapshots: T[],
): T[] {
  const porCodigo = new Map<string, T>();
  for (const snapshot of snapshots) {
    const codigo = String(snapshot.base_codigo ?? "").trim().toUpperCase();
    if (codigo && !porCodigo.has(codigo)) porCodigo.set(codigo, snapshot);
  }
  return [...porCodigo.values()];
}

async function anexarSlaGeral(
  client: any,
  resultado: MeliDashboardResult,
  dataOperacional: string,
): Promise<MeliDashboardResult> {
  const { data } = await client
    .from("meli_sla_diario")
    .select(
      "bases_total,rotas_total,pacotes_total,entregues_total,pendentes_total,insucessos_total,sla_geral,ultima_coleta,updated_at",
    )
    .eq("data_operacional", dataOperacional)
    .maybeSingle();

  const bases = resultado.bases ?? [];
  const pacotesTotal = Math.max(
    Number(data?.pacotes_total ?? 0),
    resultado.cards?.total ?? bases.reduce((s, b) => s + b.total, 0),
  );
  const entreguesTotal = Math.max(
    Number(data?.entregues_total ?? 0),
    resultado.cards?.entregue ?? bases.reduce((s, b) => s + b.entregue, 0),
  );
  const rotasTotal = Math.max(
    Number(data?.rotas_total ?? 0),
    resultado.cards?.rotas ?? bases.reduce((s, b) => s + b.rotas, 0),
  );
  const basesTotal = Math.max(Number(data?.bases_total ?? 0), bases.length);
  const insucessosTotal = Math.max(
    Number(data?.insucessos_total ?? 0),
    resultado.cards?.insucesso ?? bases.reduce((s, b) => s + b.insucesso, 0),
  );
  const pendentesTotal = Math.max(0, pacotesTotal - entreguesTotal);
  const percentual =
    pacotesTotal > 0
      ? (entreguesTotal / pacotesTotal) * 100
      : Number(data?.sla_geral ?? 0);

  if (pacotesTotal === 0 && !data) return resultado;

  return {
    ...resultado,
    sla_geral: {
      bases_total: basesTotal,
      rotas_total: rotasTotal,
      pacotes_total: pacotesTotal,
      entregues_total: entreguesTotal,
      pendentes_total: pendentesTotal,
      insucessos_total: insucessosTotal,
      percentual: Math.round(percentual * 100) / 100,
      ultima_coleta: data?.ultima_coleta ?? resultado.ultima_sincronizacao ?? null,
      updated_at: data?.updated_at ?? new Date().toISOString(),
    },
  };
}

type CadastroBaseSnapshot = { id: string; codigo: string; nome: string };

function maior(atual: number | null | undefined, preservado: number | null | undefined) {
  return Math.max(Number(atual ?? 0), Number(preservado ?? 0));
}

/**
 * Une o resumo operacional com todas as bases confirmadas no snapshot do dia e
 * preserva o maior valor já observado. Detalhes de rota não são inventados.
 */
export function aplicarMonitoramentoPreservado(
  resultado: MeliDashboardResult,
  snapshots: MonitoramentoPreservado[],
): MeliDashboardResult {
  if (resultado.status !== "ok" || snapshots.length === 0) return resultado;

  const porCodigo = new Map(snapshots.map((s) => [s.base_codigo.toUpperCase(), s]));
  const bases = (resultado.bases ?? []).map((base) => {
    const snapshot = porCodigo.get((base.base_codigo ?? "").toUpperCase());
    if (!snapshot) return base;
    if (
      snapshot.data_operacional &&
      resultado.data_operacional &&
      snapshot.data_operacional !== resultado.data_operacional
    ) {
      return base;
    }
    return {
      ...base,
      rotas: maior(base.rotas, snapshot.rotas_totais),
      total: maior(base.total, snapshot.pacotes),
      entregue: maior(base.entregue, snapshot.bem_sucedidos),
      insucesso: maior(base.insucesso, snapshot.com_falhas),
      perc_entrega: maior(base.perc_entrega, snapshot.performance_logistics_max),
    };
  });

  const codigosAtuais = new Set(bases.map((base) => (base.base_codigo ?? "").toUpperCase()));
  for (const snapshot of snapshots) {
    const codigo = snapshot.base_codigo.trim().toUpperCase();
    if (!codigo || codigosAtuais.has(codigo)) continue;
    const total = Number(snapshot.pacotes ?? 0);
    const entregue = Number(snapshot.bem_sucedidos ?? 0);
    bases.push({
      base_id: snapshot.base_id ?? null,
      base_codigo: codigo,
      base_nome: snapshot.base_nome ?? codigo,
      service_center: snapshot.service_center_id ?? null,
      rotas: Number(snapshot.rotas_totais ?? 0),
      rotas_risco: 0,
      rotas_risco_integral: 0,
      rotas_risco_parcial: 0,
      total,
      pacotes_risco: 0,
      entregue,
      em_rota: Number(snapshot.pendentes ?? 0),
      insucesso: Number(snapshot.com_falhas ?? 0),
      perc_entrega: Number(
        snapshot.performance_logistics_max ?? (total > 0 ? (100 * entregue) / total : 0),
      ),
    });
    codigosAtuais.add(codigo);
  }

  const cards = resultado.cards
    ? {
        ...resultado.cards,
        rotas: bases.reduce((soma, base) => soma + base.rotas, 0),
        total: bases.reduce((soma, base) => soma + base.total, 0),
        entregue: bases.reduce((soma, base) => soma + base.entregue, 0),
        insucesso: bases.reduce((soma, base) => soma + base.insucesso, 0),
        perc_entrega:
          bases.reduce((total, base) => total + base.total, 0) > 0
            ? Math.round(
                (1000 * bases.reduce((soma, base) => soma + base.entregue, 0)) /
                  bases.reduce((soma, base) => soma + base.total, 0),
              ) / 10
            : resultado.cards.perc_entrega,
      }
    : resultado.cards;

  const motivosAtuais = resultado.motivos_insucesso ?? [];
  const totalMotivos = motivosAtuais.reduce((soma, motivo) => soma + Number(motivo.total ?? 0), 0);
  const semDetalhamento = Math.max(0, Number(cards?.insucesso ?? 0) - totalMotivos);
  const motivos_insucesso =
    semDetalhamento > 0
      ? [
          ...motivosAtuais,
          {
            codigo: "sem_detalhamento_adminml",
            descricao: "Aguardando detalhamento do motivo pelo AdminML",
            cadastrado: true,
            total: semDetalhamento,
          },
        ]
      : motivosAtuais;

  const sincronizacaoPorCodigo = new Map(
    (resultado.sincronizacao_por_base ?? [])
      .filter((item) => item.base_codigo)
      .map((item) => [item.base_codigo!.toUpperCase(), item]),
  );
  for (const snapshot of snapshots) {
    if (!snapshot.coletado_em) continue;
    const codigo = snapshot.base_codigo.toUpperCase();
    const atual = sincronizacaoPorCodigo.get(codigo);
    sincronizacaoPorCodigo.set(codigo, {
      base_id: snapshot.base_id ?? atual?.base_id ?? null,
      base_codigo: snapshot.base_codigo,
      last_synced_at: snapshot.coletado_em,
    });
  }
  const snapshotAt = snapshots.reduce<string | null>(
    (maisRecente, snapshot) =>
      snapshot.coletado_em && (!maisRecente || snapshot.coletado_em > maisRecente)
        ? snapshot.coletado_em
        : maisRecente,
    null,
  );

  return {
    ...resultado,
    bases,
    cards,
    motivos_insucesso,
    sincronizacao_por_base: [...sincronizacaoPorCodigo.values()],
    snapshot_at:
      snapshotAt && (!resultado.snapshot_at || snapshotAt > resultado.snapshot_at)
        ? snapshotAt
        : resultado.snapshot_at,
    ultima_sincronizacao:
      snapshotAt && (!resultado.ultima_sincronizacao || snapshotAt > resultado.ultima_sincronizacao)
        ? snapshotAt
        : resultado.ultima_sincronizacao,
  };
}

type RotaRiscoPersistida = {
  id: string;
  route_id: string;
  cluster?: string | null;
  base_id?: string | null;
  service_center_id?: string | null;
  driver_name?: string | null;
  vehicle_license?: string | null;
  carrier?: string | null;
  data_rota?: string | null;
  last_synced_at?: string | null;
  rota_area_risco?: boolean | null;
  area_risco_parcial?: boolean | null;
  total_pacotes?: number | null;
  delivered_total?: number | null;
  pending_total?: number | null;
  occurrence_total?: number | null;
};

/** Inclui no painel rotas marcadas pelo Rostering mesmo quando ainda não há
 * pacotes detalhados em meli_pacotes. O selo persistido na rota é a fonte de
 * verdade para a classificação de risco. */
export function aplicarRotasRiscoPersistidas(
  resultado: MeliDashboardResult,
  persistidas: RotaRiscoPersistida[],
): MeliDashboardResult {
  if (resultado.status !== "ok" || persistidas.length === 0) return resultado;

  const basesOriginais = resultado.bases ?? [];
  const basePorId = new Map(basesOriginais.filter((b) => b.base_id).map((b) => [b.base_id!, b]));
  const rotasPorId = new Map((resultado.rotas ?? []).map((rota) => [rota.rota_id, rota]));

  for (const rota of persistidas) {
    const existente = rotasPorId.get(rota.id);
    if (existente) {
      rotasPorId.set(rota.id, {
        ...existente,
        rota_area_risco: Boolean(rota.rota_area_risco) || existente.rota_area_risco,
        area_risco_parcial: Boolean(rota.area_risco_parcial) || existente.area_risco_parcial,
      });
      continue;
    }
    const base = rota.base_id ? basePorId.get(rota.base_id) : undefined;
    const total = Number(rota.total_pacotes ?? 0);
    const entregue = Number(rota.delivered_total ?? 0);
    const emRota = Number(rota.pending_total ?? 0);
    const insucesso = Number(rota.occurrence_total ?? 0);
    rotasPorId.set(rota.id, {
      rota_id: rota.id,
      route_id: rota.route_id,
      nome_operacional: String(rota.cluster ?? "").trim() || rota.route_id,
      cluster: rota.cluster ?? null,
      base_id: rota.base_id ?? null,
      base_codigo: base?.base_codigo ?? null,
      base_nome: base?.base_nome ?? null,
      service_center: rota.service_center_id ?? base?.service_center ?? null,
      driver_name: rota.driver_name ?? null,
      vehicle_license: rota.vehicle_license ?? null,
      carrier: rota.carrier ?? null,
      data_rota: rota.data_rota ?? null,
      last_synced_at: rota.last_synced_at ?? null,
      rota_area_risco: Boolean(rota.rota_area_risco),
      area_risco_parcial: Boolean(rota.area_risco_parcial),
      total,
      nao_iniciado: Math.max(0, total - entregue - emRota - insucesso),
      em_rota: emRota,
      entregue,
      insucesso,
      cancelado: 0,
      pacotes_risco: Boolean(rota.rota_area_risco) ? total : 0,
      perc_entrega: total > 0 ? Math.round((1000 * entregue) / total) / 10 : 0,
    });
  }

  const rotas = [...rotasPorId.values()];
  const risco = rotas.filter((rota) => rota.rota_area_risco || rota.area_risco_parcial);
  const bases = basesOriginais.map((base) => {
    const daBase = base.base_id ? risco.filter((rota) => rota.base_id === base.base_id) : [];
    return {
      ...base,
      rotas_risco: daBase.length,
      rotas_risco_integral: daBase.filter((rota) => rota.rota_area_risco).length,
      rotas_risco_parcial: daBase.filter((rota) => rota.area_risco_parcial && !rota.rota_area_risco)
        .length,
    };
  });
  const pacotes = risco.reduce(
    (soma, rota) => soma + (rota.rota_area_risco ? rota.total : rota.pacotes_risco),
    0,
  );
  const entregue = risco.reduce((soma, rota) => soma + rota.entregue, 0);
  const emRota = risco.reduce((soma, rota) => soma + rota.em_rota, 0);
  const insucesso = risco.reduce((soma, rota) => soma + rota.insucesso, 0);

  return {
    ...resultado,
    rotas,
    bases,
    cards: resultado.cards
      ? { ...resultado.cards, rotas_risco: risco.length, area_risco_pacotes: pacotes }
      : resultado.cards,
    area_risco: {
      rotas: risco.length,
      integrais: risco.filter((rota) => rota.rota_area_risco).length,
      parciais: risco.filter((rota) => rota.area_risco_parcial && !rota.rota_area_risco).length,
      pacotes,
      entregue,
      em_rota: emRota,
      insucesso,
      perc_conclusao: pacotes > 0 ? Math.round((1000 * entregue) / pacotes) / 10 : 0,
    },
  };
}

export function meliDashboardQueryKey(filtros: MeliDashboardFiltros) {
  const normalizados = Object.fromEntries(
    Object.entries(filtros).filter(
      ([, valor]) => valor !== null && valor !== undefined && valor !== "",
    ),
  );
  return ["meli-dashboard-operacional", normalizados] as const;
}

export const meliDashboardOperacional = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filtroSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliDashboardResult> => {
    const semFiltroDeDetalhe =
      !data.base_id &&
      !data.motorista &&
      !data.rota &&
      !data.status &&
      !data.transportadora &&
      !data.risco;
    const dataSolicitada =
      data.data ??
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

    // A consulta operacional também traz os motivos de insucesso. Os snapshots
    // são usados como proteção dos acumulados e como fallback, mas não podem
    // substituir esta leitura antecipadamente — isso deixava o Modo TV sem os
    // principais motivos mesmo havendo insucessos nas bases.

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
    let resultado = res as MeliDashboardResult | undefined;

    if (
      semFiltroDeDetalhe &&
      (error || !resultado || resultado.status !== "ok" || !temDadosDashboard(resultado))
    ) {
      const fallback = await carregarUltimoSnapshotMultibase(
        context.supabase as any,
        dataSolicitada,
      );
      if (fallback) {
        return anexarSlaGeral(
          context.supabase as any,
          fallback,
          fallback.data_operacional ?? dataSolicitada,
        );
      }
    }

    if (error) {
      return { status: "erro", erro: error.message };
    }

    if (!resultado || !semFiltroDeDetalhe || resultado.status !== "ok") {
      return resultado ?? { status: "erro", erro: "Resposta vazia da RPC." };
    }

    const dataOperacional = data.data ?? resultado.data_operacional;
    if (!dataOperacional) return resultado;
    const { data: rotasRisco } = await (context.supabase as any)
      .from("meli_rotas")
      .select(
        "id,route_id,cluster,base_id,service_center_id,driver_name,vehicle_license,carrier,data_rota,last_synced_at,rota_area_risco,area_risco_parcial,total_pacotes,delivered_total,pending_total,occurrence_total",
      )
      .eq("data_rota", dataOperacional)
      .or("rota_area_risco.eq.true,area_risco_parcial.eq.true");
    const { data: snapshots } = await (context.supabase as any)
      .from("meli_monitoramento_snapshots")
      .select(
        "base_codigo,data_operacional,service_center_id,rotas_totais,pacotes,pendentes,com_falhas,bem_sucedidos,performance_logistics_max,coletado_em",
      )
      .lte("data_operacional", dataOperacional)
      .or("pacotes.gt.0,rotas_totais.gt.0")
      .order("data_operacional", { ascending: false })
      .order("coletado_em", { ascending: false })
      .limit(500);
    const snapshotsTipados = selecionarUltimoSnapshotPorBase(
      (snapshots ?? []) as MonitoramentoPreservado[],
    );
    const codigos = [
      ...new Set(
        snapshotsTipados.map((snapshot) => snapshot.base_codigo.toUpperCase()).filter(Boolean),
      ),
    ];
    const { data: cadastros } = codigos.length
      ? await (context.supabase as any).from("bases").select("id,codigo,nome").in("codigo", codigos)
      : { data: [] };
    const cadastroPorCodigo = new Map<string, CadastroBaseSnapshot>(
      ((cadastros ?? []) as CadastroBaseSnapshot[]).map((base) => [
        base.codigo.toUpperCase(),
        base,
      ]),
    );
    const snapshotsComCadastro = snapshotsTipados.map((snapshot) => {
      const cadastro = cadastroPorCodigo.get(snapshot.base_codigo.toUpperCase());
      return {
        ...snapshot,
        base_id: cadastro?.id ?? null,
        base_nome: cadastro?.nome ?? snapshot.base_codigo,
      };
    });

    resultado = aplicarMonitoramentoPreservado(
      resultado,
      snapshotsComCadastro as MonitoramentoPreservado[],
    );
    resultado = aplicarRotasRiscoPersistidas(
      resultado,
      (rotasRisco ?? []) as RotaRiscoPersistida[],
    );
    return anexarSlaGeral(context.supabase as any, resultado, dataOperacional);
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
