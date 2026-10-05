// Worker local multibase. Executa sequencialmente para preservar a sessão do
// AdminML e nunca sobrepor ciclos.
import { randomUUID } from "node:crypto";
import { ConfigError, configParaBase, loadConfig, WORKER_VERSAO, type WorkerConfig } from "./config.js";
import { logger } from "./logger.js";
import { novoEstadoIncremental } from "./meli/active-filter.js";
import { sleep } from "./meli/list.js";
import { abrirSessaoAdminML, garantirSessaoJmroutes, type JmrSessao } from "./pipeline/auth.js";
import { autenticarManualmenteCoordenado } from "./session/login.js";
import { executarCiclo } from "./pipeline/cycle.js";
import { sincronizarDevolucoes } from "./pipeline/devolucoes.js";
import { listarTodosMotoristas } from "./meli/drivers.js";
import { enviarCatalogoMotoristas } from "./pipeline/drivers.js";
import { listarRiscoSemanal, semanaAtual } from "./meli/risk.js";
import { enviarRiscoRostering } from "./pipeline/risk.js";
import { CircuitBreaker } from "./state/breaker.js";
import { registrarExecucao, type Execucao } from "./telemetry/report.js";
import { enviarHeartbeat, executarCicloPiloto, instanciaPadrao } from "./pipeline/piloto.js";
import { descobrirIndicadoresMonitoramento } from "./meli/monitoring-discovery.js";

let encerrando = false;

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    encerrando = true;
    logger.info("Encerramento solicitado; finalizando após o ciclo atual.", { sinal });
  });
}

function execucaoVazia(cfg: WorkerConfig, status: Execucao["status"], msg: string): Execucao {
  const agora = new Date().toISOString();
  return {
    base_code: cfg.baseCode,
    sync_batch_id: randomUUID(),
    iniciado_em: agora,
    finalizado_em: agora,
    duracao_ms: 0,
    rotas_encontradas: 0,
    rotas_processadas: 0,
    pacotes_enviados: 0,
    erros: 0,
    status,
    sessao_status: status === "aguardando_autenticacao" ? "ausente" : "ok",
    mensagem_segura: msg,
  };
}

async function main() {
  let cfg: WorkerConfig;
  try {
    cfg = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      logger.error("Configuração inválida — worker não iniciado.", { erro: err.message });
      process.exit(2);
    }
    throw err;
  }

  logger.info("Worker Meli local iniciado.", {
    versao: WORKER_VERSAO,
    bases: cfg.bases.map((b) => b.baseCode),
    bases_com_escrita: cfg.writeBaseCodes,
    intervalo_s: cfg.syncIntervalSeconds,
    dry_run: cfg.dryRun,
  });

  if (cfg.discoveryOnly) {
    const base = cfg.bases.find((item) => item.baseCode === cfg.discoveryBaseCode) ?? null;

    if (!base) {
      throw new ConfigError(`A base de descoberta ${cfg.discoveryBaseCode ?? "—"} não está disponível na configuração atual.`);
    }

    const sessao = await abrirSessaoAdminML(configParaBase(cfg, base));
    if (sessao.status !== "ok") {
      logger.warn("Descoberta não executada: sessão AdminML indisponível.", {
        base: base.baseCode,
        motivo: sessao.motivo,
      });
      return;
    }

    try {
      await descobrirIndicadoresMonitoramento(sessao.page, {
        baseCode: base.baseCode,
        serviceCenterId: base.serviceCenterId,
        siteId: base.siteId,
      });
    } finally {
      await sessao.fechar();
    }

    logger.info("Descoberta do Monitoramento Last Mile concluída; worker encerrado sem persistência.", {
      base: base.baseCode,
      dry_run: true,
    });
    return;
  }

  if (cfg.pilotWrite) {
    await loopPiloto(cfg);
    return;
  }

  const breakers = new Map(cfg.bases.map((b) => [b.baseCode, new CircuitBreaker()]));
  const estados = new Map(cfg.bases.map((b) => [b.baseCode, novoEstadoIncremental()]));
  const liderGlobal = cfg.bases.some((base) => base.baseCode === "ESP15");
  let jmr: JmrSessao | null = null;
  let proximaSincronizacaoRiscoEm = 0;

  while (!encerrando) {
    if (!cfg.dryRun) {
      const auth = await garantirSessaoJmroutes(cfg, jmr);
      if (auth.status !== "ok") {
        jmr = null;
        logger.warn("Sem sessão JMRoutes; ciclo não executado.", { motivo: auth.motivo });
        await registrarExecucao(cfg, execucaoVazia(cfg, "jmroutes_sem_sessao", `sem sessão JMRoutes: ${auth.motivo}`), { accessToken: null });
        await sleep(cfg.syncIntervalSeconds * 1000);
        continue;
      }
      jmr = auth.sessao;
    }

    let sessao;
    let precisaReautenticarAdminML = false;
    try {
      sessao = await abrirSessaoAdminML(cfg);
    } catch (err) {
      logger.warn("Não foi possível abrir o AdminML; nova tentativa será feita.", { erro: String((err as Error)?.message ?? err) });
      await sleep(Math.max(cfg.syncIntervalSeconds, 60) * 1000);
      continue;
    }

    if (sessao.status !== "ok") {
      logger.warn("Aguardando autenticação manual do AdminML.", { motivo: sessao.motivo });
      if (!cfg.dryRun && jmr) {
        await registrarExecucao(cfg, execucaoVazia(cfg, "aguardando_autenticacao", `sessão AdminML indisponível: ${sessao.motivo}`), { accessToken: jmr.accessToken });
      }
      try {
        await autenticarManualmenteCoordenado({
          sessionFilePath: cfg.sessionFilePath,
          sessionKeyBase64: cfg.sessionKeyBase64,
          timeoutMs: 10 * 60_000,
        });
        logger.info("Sessão AdminML recuperada; retomando os ciclos.");
      } catch (err) {
        logger.warn("Recuperação assistida do AdminML não foi concluída.", {
          erro: String((err as Error)?.message ?? err),
        });
        await sleep(Math.max(cfg.syncIntervalSeconds, 300) * 1000);
      }
      continue;
    }

    try {
      if (!cfg.dryRun && jmr && liderGlobal) {
        const catalogo = await listarTodosMotoristas(sessao.transport);
        if (catalogo.ok) {
          const envio = await enviarCatalogoMotoristas(cfg, jmr.accessToken, catalogo.valor);
          if (envio.status === "ok") logger.info("Catálogo de motoristas sincronizado.", { total: envio.total });
          else logger.warn("Catálogo de motoristas será repetido.", { motivo: envio.motivo });
        } else {
          logger.warn("Não foi possível consultar o catálogo de motoristas.", { motivo: catalogo.motivo });
          if (catalogo.motivo === "sessao_expirada") precisaReautenticarAdminML = true;
        }
      }
      for (const base of cfg.bases) {
        if (encerrando) break;
        const cfgBase = configParaBase(cfg, base);
        const somenteValidacao = cfg.dryRun || !cfg.writeBaseCodes.includes(base.baseCode);
        const resultado = await executarCiclo({
          cfg: cfgBase,
          transport: sessao.transport,
          accessToken: jmr?.accessToken ?? "",
          breaker: breakers.get(base.baseCode)!,
          estado: estados.get(base.baseCode)!,
          dryRun: somenteValidacao,
        });

        logger.info(somenteValidacao ? "Validação da base concluída." : "Ciclo da base concluído.", {
          base: base.baseCode,
          status: resultado.execucao.status,
          motivo: resultado.execucao.mensagem_segura,
          ...resultado.resumo,
        });

        if (!somenteValidacao && jmr) {
          await registrarExecucao(cfgBase, resultado.execucao, { accessToken: jmr.accessToken });
          if (resultado.execucao.status === "sucesso" || resultado.execucao.status === "sucesso_parcial") {
            const devolucoes = await sincronizarDevolucoes(cfgBase, jmr.accessToken);
            if (devolucoes.status !== "ok") {
              logger.warn("Sincronização de devoluções será repetida.", {
                base: base.baseCode,
                motivo: devolucoes.status === "erro" ? devolucoes.motivo : "sem_sessao",
              });
            }
          }
        }

        if (resultado.jmroutesSemSessao) jmr = null;
        if (resultado.sessaoAdminMLExpirada) {
          precisaReautenticarAdminML = true;
          break;
        }
        if (resultado.jmroutesSemSessao) break;
      }

      // A classificação depende das rotas já gravadas no JMRoutes. Executá-la
      // depois das bases evita o painel zerado após reinício ou novo login.
      if (!cfg.dryRun && jmr && liderGlobal && !precisaReautenticarAdminML && Date.now() >= proximaSincronizacaoRiscoEm) {
        // O Rostering é semanal; 15 minutos mantém o painel atualizado sem
        // repetir uma exportação pesada em cada ciclo de 60 segundos.
        proximaSincronizacaoRiscoEm = Date.now() + 15 * 60_000;
        const semana = semanaAtual();
        const risco = await listarRiscoSemanal(sessao.transport, semana.inicio, semana.fim);
        if (risco.ok) {
          const envio = await enviarRiscoRostering(cfg, jmr.accessToken, risco.valor);
          if (envio.status === "ok") {
            logger.info("Classificação semanal de risco sincronizada.", {
              periodo: `${semana.inicio}/${semana.fim}`,
              recebidas: risco.valor.length,
              encontradas: envio.encontradas,
              amostra: risco.valor[0]
                ? {
                    data: risco.valor[0].data,
                    facility: risco.valor[0].facility,
                    cluster: risco.valor[0].cluster,
                    transportadora: risco.valor[0].transportadora,
                  }
                : null,
            });
          } else logger.warn("Classificação de risco será repetida.", { motivo: envio.motivo });
        } else {
          logger.warn("Não foi possível consultar a classificação semanal de risco.", {
            motivo: risco.motivo,
            status: risco.status ?? null,
          });
          if (risco.motivo === "sessao_expirada") precisaReautenticarAdminML = true;
        }
      }
    } finally {
      await sessao.fechar();
    }

    if (precisaReautenticarAdminML && !encerrando) {
      try {
        await autenticarManualmenteCoordenado({
          sessionFilePath: cfg.sessionFilePath,
          sessionKeyBase64: cfg.sessionKeyBase64,
          timeoutMs: 10 * 60_000,
        });
        logger.info("Sessão AdminML recuperada; retomando os ciclos.");
      } catch (err) {
        logger.warn("Recuperação assistida do AdminML não foi concluída.", {
          erro: String((err as Error)?.message ?? err),
        });
      }
    }

    if (!encerrando) await sleep(cfg.syncIntervalSeconds * 1000);
  }

  logger.info("Worker Meli local encerrado.");
}

/** Loop do piloto isolado: só AdminML -> /api/public/meli/piloto/*. */
async function loopPiloto(cfg: WorkerConfig) {
  const instancia = instanciaPadrao();
  logger.info("Modo piloto ativo (DRY_RUN + PILOT_WRITE).", { instancia, bases: cfg.bases.map((b) => b.baseCode) });
  while (!encerrando) {
    let sessao;
    try {
      sessao = await abrirSessaoAdminML(cfg);
    } catch (err) {
      await enviarHeartbeat(cfg, { instancia, sessao: "desconhecida", detalhe: { erro: String((err as Error)?.message ?? err).slice(0, 300) } });
      await sleep(Math.max(cfg.syncIntervalSeconds, 60) * 1000);
      continue;
    }
    if (sessao.status !== "ok") {
      await enviarHeartbeat(cfg, { instancia, sessao: "ausente", detalhe: { motivo: sessao.motivo } });
      logger.warn("Piloto aguardando sessão AdminML válida em SESSION_FILE_PATH.", { motivo: sessao.motivo, arquivo: cfg.sessionFilePath });
      await sleep(Math.max(cfg.syncIntervalSeconds, 300) * 1000);
      continue;
    }
    await enviarHeartbeat(cfg, { instancia, sessao: "valida" });
    let expirou = false;
    try {
      for (const base of cfg.bases) {
        if (encerrando) break;
        const r = await executarCicloPiloto({ cfg: configParaBase(cfg, base), transport: sessao.transport, instancia });
        logger.info("Ciclo do piloto concluído.", { ...r });
        await enviarHeartbeat(cfg, { instancia, sessao: r.sessao_expirada ? "expirada" : "valida", ultimoCicloId: r.ciclo_id });
        if (r.sessao_expirada) { expirou = true; break; }
      }
    } finally {
      await sessao.fechar();
    }
    await sleep((expirou ? Math.max(cfg.syncIntervalSeconds, 300) : cfg.syncIntervalSeconds) * 1000);
  }
}

main().catch((err) => {
  logger.error("Falha fatal no worker.", { erro: String((err as Error)?.message ?? err) });
  process.exit(1);
});
