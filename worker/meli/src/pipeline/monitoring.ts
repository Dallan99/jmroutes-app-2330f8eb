import type { WorkerConfig } from "../config.js";
import type { MonitoramentoResumo } from "../meli/monitoring-summary.js";

export type EnvioMonitoramento = { status: "ok" } | { status: "sem_sessao" | "erro"; motivo: string };

export async function enviarMonitoramento(
  cfg: Pick<WorkerConfig, "jmrBaseUrl">,
  accessToken: string,
  resumo: MonitoramentoResumo,
  fetchImpl: typeof fetch = fetch,
): Promise<EnvioMonitoramento> {
  try {
    const resposta = await fetchImpl(`${cfg.jmrBaseUrl}/api/public/meli/importar-monitoramento`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(resumo),
    });
    if (resposta.status === 401) return { status: "sem_sessao", motivo: "sessao_expirada" };
    if (!resposta.ok) return { status: "erro", motivo: `http_${resposta.status}` };
    return { status: "ok" };
  } catch {
    return { status: "erro", motivo: "falha_rede" };
  }
}
