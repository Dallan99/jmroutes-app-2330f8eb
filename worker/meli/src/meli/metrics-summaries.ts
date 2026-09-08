// Consulta consolidada dos indicadores do Monitoramento Last Mile.
// Não persiste dados e utiliza exclusivamente a sessão AdminML já aberta.
import { ADMINML, obterServiceCentersDaBase } from "../config.js";
import { executarComRetry, sleep, type MeliTransport, type Resultado } from "./list.js";

export const NOMES_METRICAS_MONITORAMENTO = [
  "routes_summary",
  "routes_active_metric_summary",
  "packages_delivery_type_driver_metric_summary",
  "packages_delivered_metric_summary",
  "packages_not_delivered_metric_summary",
  "packages_pending_metric_summary",
] as const;

/** Meta diária de DS Final usada como referência operacional. */
export const META_DS_REFERENCIA = 98.2;

type ChaveMetricaMonitoramento = (typeof NOMES_METRICAS_MONITORAMENTO)[number];

export type DivergenciaPacotes = {
  esperado: number;
  recebido: number;
  diferenca: number;
};

/**
 * Resultado normalizado de uma única combinação base/estação. Os valores
 * recebidos do AdminML nunca são ajustados: uma eventual inconsistência é
 * exposta em `divergenciaPacotes` para tratamento posterior.
 */
export type ResumoMetricasServiceCenter = {
  baseCode: string;
  baseNome: string;
  serviceCenterId: string;
  siteId: string;
  rotasTotais: number;
  rotasEmAndamento: number;
  pacotes: number;
  pendentes: number;
  falhas: number;
  bemSucedidos: number;
  percentualPendentes: number;
  percentualFalhas: number;
  dsAtual: number;
  metaDsReferencia: number;
  divergenciaPacotes: DivergenciaPacotes | null;
  coletadoEm: string;
  /** Payload original, mantido apenas para rastreabilidade interna. */
  body: unknown;
};

export type ConsultarMetricasOpts = {
  baseCode?: string;
  baseNome?: string;
  serviceCenterId: string;
  serviceCenterIds?: readonly string[];
  siteId: string;
  names?: readonly string[];
  dormir?: (ms: number) => Promise<void>;
};

function numeroRecebido(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  if (typeof valor === "string" && valor.trim() !== "") {
    const numero = Number(valor.replace(",", "."));
    return Number.isFinite(numero) ? numero : null;
  }
  if (!valor || typeof valor !== "object") return null;

  const registro = valor as Record<string, unknown>;
  for (const chave of ["value", "total", "count", "quantity", "summary"]) {
    const numero = numeroRecebido(registro[chave]);
    if (numero !== null) return numero;
  }
  return null;
}

function localizarMetrica(body: unknown, chave: ChaveMetricaMonitoramento): number | null {
  const visitados = new WeakSet<object>();
  const visitar = (valor: unknown): number | null => {
    if (!valor || typeof valor !== "object") return null;
    if (visitados.has(valor)) return null;
    visitados.add(valor);

    if (Array.isArray(valor)) {
      for (const item of valor) {
        const numero = visitar(item);
        if (numero !== null) return numero;
      }
      return null;
    }

    const registro = valor as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(registro, chave)) {
      const numero = numeroRecebido(registro[chave]);
      if (numero !== null) return numero;
    }

    for (const item of Object.values(registro)) {
      const numero = visitar(item);
      if (numero !== null) return numero;
    }
    return null;
  };

  return visitar(body);
}

function percentual(parte: number, total: number) {
  return total > 0 ? (parte / total) * 100 : 0;
}

/** Normaliza uma resposta do endpoint sem alterar os valores recebidos. */
export function normalizarResumoMetricasRotas(
  body: unknown,
  contexto: Pick<ConsultarMetricasOpts, "baseCode" | "baseNome" | "serviceCenterId" | "siteId">,
  coletadoEm = new Date().toISOString(),
): ResumoMetricasServiceCenter {
  const rotasTotais = localizarMetrica(body, "routes_summary") ?? 0;
  const rotasEmAndamento = localizarMetrica(body, "routes_active_metric_summary") ?? 0;
  const pacotes = localizarMetrica(body, "packages_delivery_type_driver_metric_summary") ?? 0;
  const bemSucedidos = localizarMetrica(body, "packages_delivered_metric_summary") ?? 0;
  const falhas = localizarMetrica(body, "packages_not_delivered_metric_summary") ?? 0;
  const pendentes = localizarMetrica(body, "packages_pending_metric_summary") ?? 0;
  const recebido = pendentes + falhas + bemSucedidos;

  return {
    baseCode: contexto.baseCode ?? "",
    baseNome: contexto.baseNome ?? "",
    serviceCenterId: contexto.serviceCenterId,
    siteId: contexto.siteId,
    rotasTotais,
    rotasEmAndamento,
    pacotes,
    pendentes,
    falhas,
    bemSucedidos,
    percentualPendentes: percentual(pendentes, pacotes),
    percentualFalhas: percentual(falhas, pacotes),
    dsAtual: percentual(bemSucedidos, pacotes),
    metaDsReferencia: META_DS_REFERENCIA,
    divergenciaPacotes: recebido === pacotes ? null : {
      esperado: pacotes,
      recebido,
      diferenca: recebido - pacotes,
    },
    coletadoEm,
    body,
  };
}

/**
 * Consulta os cards agregados para todas as estações de uma base. O retorno é
 * uma lista, e não um mapa por base, para que uma estação nunca sobrescreva a
 * resposta da outra (especialmente ESP17: SSP34 e SSP56).
 */
export async function consultarResumosMetricasRotas(
  transport: MeliTransport,
  opts: ConsultarMetricasOpts,
): Promise<Resultado<ResumoMetricasServiceCenter[]>> {
  const serviceCenters = obterServiceCentersDaBase(opts);
  const resultados: ResumoMetricasServiceCenter[] = [];
  const dormir = opts.dormir ?? sleep;

  for (const serviceCenterId of serviceCenters) {
    const payload = {
      serviceCenterId,
      siteId: opts.siteId,
      order_by: "performance",
      names: [...(opts.names ?? NOMES_METRICAS_MONITORAMENTO)],
    };
    const resposta = await executarComRetry(
      () => transport.post(ADMINML.METRICS_SUMMARIES_URL, payload),
      { dormir },
    );
    if (!resposta.ok) return resposta;

    resultados.push(normalizarResumoMetricasRotas(resposta.valor.body, {
      baseCode: opts.baseCode,
      baseNome: opts.baseNome,
      serviceCenterId,
      siteId: opts.siteId,
    }));
  }

  return { ok: true, valor: resultados };
}
