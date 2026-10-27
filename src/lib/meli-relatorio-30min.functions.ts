import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BASES_RELATORIO_30MIN = [
  { codigo: "ESP15", nome: "Ibiúna" },
  { codigo: "ESP16", nome: "Guarujá" },
  { codigo: "ESP17", nome: "XPT Embu Guaçu" },
  { codigo: "ESP18", nome: "Franco da Rocha" },
  { codigo: "SSP06", nome: "Mauá" },
  { codigo: "SSP15", nome: "São Vicente" },
  { codigo: "SSP17", nome: "São Bernardo do Campo" },
  { codigo: "SSP20", nome: "Sorocaba" },
  { codigo: "SSP23", nome: "Suzano" },
  { codigo: "SSP37/03", nome: "Campinas" },
  { codigo: "SSP38", nome: "Itupeva" },
  { codigo: "SSP45", nome: "Itaquera" },
  { codigo: "SSP5", nome: "Barueri" },
] as const;

const codigosPermitidos = new Set<string>(BASES_RELATORIO_30MIN.map((base) => base.codigo));

const entradaSchema = z.object({
  base_codigo: z
    .string()
    .trim()
    .toUpperCase()
    .refine((codigo) => codigosPermitidos.has(codigo), "Base não permitida"),
});

export type Relatorio30MinMetricas = {
  rotas_totais: number;
  rotas_entrega: number;
  rotas_coleta: number;
  rotas_mistas: number;
  rotas_em_andamento: number;
  pacotes: number;
  sacas: number;
  pendentes: number;
  com_falhas: number;
  bem_sucedidos: number;
  percentual_entrega: number;
  percentual_coleta: number;
  percentual_mistas: number;
  percentual_pendentes: number;
  percentual_falhas: number;
  percentual_bem_sucedidos: number;
};

export type Relatorio30MinResult =
  | {
      status: "ok";
      base_codigo: string;
      base_nome: string;
      data_operacional: string;
      atualizado_em: string;
      proxima_atualizacao_em: string;
      desatualizado: boolean;
      relatorio: Relatorio30MinMetricas;
    }
  | { status: "erro"; erro: string };

type RotaLogistics = {
  id?: unknown;
  routeId?: unknown;
  facilityId?: unknown;
  status?: unknown;
  isDeliveryRoute?: unknown;
  isPickupRoute?: unknown;
  isDeliveryPickupRoute?: unknown;
  counters?: {
    total?: unknown;
    totalBags?: unknown;
    pending?: unknown;
    notDelivered?: unknown;
    delivered?: unknown;
  } | null;
};

type PaginaStaging = {
  coletado_em?: unknown;
  payload?: { rotas?: unknown; routes?: unknown } | null;
};

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function percentual(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

function aliasesDaBase(codigo: string): Set<string> {
  if (codigo === "SSP06") return new Set(["SSP06", "SSP6"]);
  if (codigo === "SSP37/03") return new Set(["SSP37/03", "SSP37", "SSP3"]);
  return new Set([codigo]);
}

function dataEmSaoPaulo(valor: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(valor));
}

export function consolidarPaginasLogistics(
  paginas: PaginaStaging[],
  baseCodigo: string,
): Relatorio30MinMetricas {
  const aliases = aliasesDaBase(baseCodigo);
  const unicas = new Map<string, RotaLogistics>();

  for (const pagina of paginas) {
    // O worker persiste a resposta normalizada em `rotas` e mantém o ID
    // AdminML como `routeId`. Os aliases antigos seguem aceitos para snapshots
    // gravados por versões anteriores do coletor.
    const routes = pagina.payload?.rotas ?? pagina.payload?.routes;
    if (!Array.isArray(routes)) continue;
    for (const rota of routes as RotaLogistics[]) {
      const identificador = rota.routeId ?? rota.id;
      const id = typeof identificador === "string" || typeof identificador === "number" ? String(identificador) : "";
      const facility = typeof rota.facilityId === "string" ? rota.facilityId.trim().toUpperCase() : "";
      if (!id || (facility && !aliases.has(facility))) continue;
      unicas.set(id, rota);
    }
  }

  const rotas = [...unicas.values()];
  const somar = (campo: keyof NonNullable<RotaLogistics["counters"]>) =>
    rotas.reduce((total, rota) => total + numero(rota.counters?.[campo]), 0);
  const mistas = rotas.filter((rota) => rota.isDeliveryPickupRoute === true).length;
  const entrega = rotas.filter(
    (rota) => rota.isDeliveryPickupRoute !== true && rota.isDeliveryRoute === true,
  ).length;
  const coleta = rotas.filter(
    (rota) => rota.isDeliveryPickupRoute !== true && rota.isPickupRoute === true,
  ).length;
  const emAndamento = rotas.filter((rota) => {
    const status = typeof rota.status === "string" ? rota.status.trim().toLowerCase() : "";
    return !["close", "closed", "completed", "concluido"].includes(status);
  }).length;
  const pacotes = somar("total");
  const pendentes = somar("pending");
  const falhas = somar("notDelivered");
  const bemSucedidos = somar("delivered");

  return {
    rotas_totais: rotas.length,
    rotas_entrega: entrega,
    rotas_coleta: coleta,
    rotas_mistas: mistas,
    rotas_em_andamento: emAndamento,
    pacotes,
    sacas: somar("totalBags"),
    pendentes,
    com_falhas: falhas,
    bem_sucedidos: bemSucedidos,
    percentual_entrega: percentual(entrega, rotas.length),
    percentual_coleta: percentual(coleta, rotas.length),
    percentual_mistas: percentual(mistas, rotas.length),
    percentual_pendentes: percentual(pendentes, pacotes),
    percentual_falhas: percentual(falhas, pacotes),
    percentual_bem_sucedidos: percentual(bemSucedidos, pacotes),
  };
}

export const meliRelatorio30Min = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((dados: unknown) => entradaSchema.parse(dados ?? {}))
  .handler(async ({ data, context }): Promise<Relatorio30MinResult> => {
    const baseDefinida = BASES_RELATORIO_30MIN.find((base) => base.codigo === data.base_codigo);
    if (!baseDefinida) return { status: "erro", erro: "Base não permitida." };

    const { data: ciclo, error: cicloErro } = await context.supabase
      .from("meli_piloto_ciclos")
      .select("id,iniciado_em,finalizado_em")
      .eq("base_codigo", data.base_codigo)
      .in("status", ["concluido", "parcial"])
      .order("iniciado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cicloErro) {
      return { status: "erro", erro: `Não foi possível consultar o último ciclo de ${data.base_codigo}.` };
    }
    if (!ciclo?.id) {
      return { status: "erro", erro: `Ainda não há ciclo válido para ${data.base_codigo}.` };
    }

    const [{ data: paginas, error: paginasErro }, { data: rotaData }] = await Promise.all([
      context.supabase
        .from("meli_piloto_staging")
        .select("coletado_em,payload")
        .eq("ciclo_id", ciclo.id)
        .eq("recurso", "rotas")
        .order("pagina", { ascending: true }),
      context.supabase
        .from("meli_piloto_rotas")
        .select("data_rota")
        .eq("ultimo_ciclo_id", ciclo.id)
        .limit(1),
    ]);

    if (paginasErro) {
      return { status: "erro", erro: `Não foi possível ler as páginas do último ciclo de ${data.base_codigo}.` };
    }

    const paginasValidas = (paginas ?? []) as PaginaStaging[];
    if (!paginasValidas.length) {
      return { status: "erro", erro: `O último ciclo de ${data.base_codigo} não possui páginas de rotas.` };
    }

    const relatorio = consolidarPaginasLogistics(paginasValidas, data.base_codigo);
    const coletas = paginasValidas
      .map((pagina) => String(pagina.coletado_em ?? ""))
      .filter(Boolean)
      .sort();
    const atualizadoEm = String(coletas.at(-1) ?? ciclo.finalizado_em ?? ciclo.iniciado_em);
    const atualizadoMs = new Date(atualizadoEm).getTime();
    const proximaAtualizacaoMs = atualizadoMs + 30 * 60_000;
    const dataOperacional =
      rotaData?.[0]?.data_rota != null
        ? String(rotaData[0].data_rota)
        : dataEmSaoPaulo(String(ciclo.iniciado_em));

    return {
      status: "ok",
      base_codigo: data.base_codigo,
      base_nome: baseDefinida.nome,
      data_operacional: dataOperacional,
      atualizado_em: atualizadoEm,
      proxima_atualizacao_em: new Date(proximaAtualizacaoMs).toISOString(),
      desatualizado: !Number.isFinite(atualizadoMs) || Date.now() - atualizadoMs > 35 * 60_000,
      relatorio,
    };
  });
