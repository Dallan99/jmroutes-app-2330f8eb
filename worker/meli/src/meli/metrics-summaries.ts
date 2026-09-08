// Consulta consolidada dos indicadores do Monitoramento Last Mile.
// Não persiste dados e utiliza exclusivamente a sessão AdminML já aberta.
import { ADMINML, obterServiceCentersDaBase } from "../config.js";
import { executarComRetry, sleep, type MeliTransport, type Resultado } from "./list.js";

export const NOMES_METRICAS_MONITORAMENTO = [
  "routes_active_metric",
  "packages_delivered_metric",
  "packages_not_delivered_metric",
  "packages_pending_metric",
  "routes_dedicated_delivery_metric",
  "routes_dedicated_pickup_metric",
  "routes_mixed_metric",
  "routes_total_metric",
  "packages_total_metric",
  "packages_in_progress_metric",
  "packages_failure_metric",
  "packages_successful_metric",
] as const;

export type ResumoMetricasServiceCenter = {
  serviceCenterId: string;
  body: unknown;
};

export type ConsultarMetricasOpts = {
  serviceCenterId: string;
  serviceCenterIds?: readonly string[];
  siteId: string;
  names?: readonly string[];
  dormir?: (ms: number) => Promise<void>;
};

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

    resultados.push({ serviceCenterId, body: resposta.valor.body });
  }

  return { ok: true, valor: resultados };
}
