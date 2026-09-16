import { BASES_JM, loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { listarRotas, sleep } from "./meli/list.js";
import { resumirMonitoramento } from "./meli/monitoring-summary.js";
import { abrirSessaoAdminML, garantirSessaoJmroutes, type JmrSessao } from "./pipeline/auth.js";
import { enviarMonitoramento } from "./pipeline/monitoring.js";

let encerrando = false;
for (const sinal of ["SIGINT", "SIGTERM"] as const) process.on(sinal, () => { encerrando = true; });

async function main() {
  const cfg = loadConfig();
  let jmr: JmrSessao | null = null;
  const intervaloMs = Math.max(60, cfg.syncIntervalSeconds) * 1000;
  logger.info("Worker leve do Dashboard Geral iniciado.", {
    bases: BASES_JM.map((b) => b.baseCode),
    intervalo_s: intervaloMs / 1000,
  });
  while (!encerrando) {
    const auth = await garantirSessaoJmroutes(cfg, jmr);
    if (auth.status !== "ok") { jmr = null; await sleep(60_000); continue; }
    jmr = auth.sessao;
    const accessToken = auth.sessao.accessToken;
    const sessao = await abrirSessaoAdminML(cfg);
    if (sessao.status !== "ok") { logger.warn("Dashboard Geral aguardando sessão AdminML.", { motivo: sessao.motivo }); await sleep(300_000); continue; }
    try {
      const porService = new Map<string, typeof BASES_JM[number][]>();
      for (const base of BASES_JM) porService.set(base.serviceCenterId, [...(porService.get(base.serviceCenterId) ?? []), base]);
      for (const [serviceCenterId, bases] of porService) {
        if (encerrando) break;
        const lista = await listarRotas(sessao.transport, { serviceCenterId, siteId: "MLB" });
        if (!lista.ok) { logger.warn("Leitura agregada não concluída.", { serviceCenterId, motivo: lista.motivo }); await sleep(5_000); continue; }
        for (const base of bases) {
          const resumo = resumirMonitoramento(lista.valor.rotas, base.baseCode, serviceCenterId);
          if (resumo.rotas_totais === 0 && resumo.pacotes === 0) {
            logger.info("Snapshot vazio ignorado.", { base: base.baseCode });
            continue;
          }
          const resultado = await enviarMonitoramento(cfg, accessToken, resumo);
          if (resultado.status === "sem_sessao") jmr = null;
          logger.info("Snapshot do Dashboard Geral processado.", { base: base.baseCode, status: resultado.status });
        }
        await sleep(2_000);
      }
    } finally { await sessao.fechar(); }
    if (!encerrando) await sleep(intervaloMs);
  }
}

main().catch((err) => { logger.error("Falha fatal no Dashboard Geral.", { erro: String((err as Error)?.message ?? err) }); process.exit(1); });
