// Um ciclo de sincronização: lista -> seleção -> detalhe -> envio -> telemetria.
// Concorrência 1, jitter entre chamadas, sem sobreposição de ciclos.
import { randomUUID } from "node:crypto";
import { ADMINML, type WorkerConfig } from "../config.js";
import { logger, mensagemSegura } from "../logger.js";
import { jitter, listarRotas, sleep, type MeliTransport, type RotaLista } from "../meli/list.js";
import { obterDetalheRota } from "../meli/detail.js";
import {
  novoEstadoIncremental,
  registrarColeta,
  selecionarRotas,
  type EstadoIncremental,
} from "../meli/active-filter.js";
import type { CircuitBreaker } from "../state/breaker.js";
import { enviarRotaBruta } from "./send.js";
import type { CicloStatus, Execucao, SessaoStatusTelemetria } from "../telemetry/report.js";

export type CicloDeps = {
  cfg: WorkerConfig;
  transport: MeliTransport;
  accessToken: string;
  breaker: CircuitBreaker;
  estado?: EstadoIncremental;
  dormir?: (ms: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  maxRotasPorCiclo?: number;
  /** Sobrepõe cfg.dryRun (útil em teste). */
  dryRun?: boolean;
  /**
   * Protocolo de lotes: id do ciclo já aberto no backend. Quando definido, as
   * rotas são enviadas para o staging do lote. Ausente = fluxo legado.
   */
  syncBatchId?: string | null;
};

export function filtrarRotasDaUnidade(rotas: RotaLista[], baseCode: string): RotaLista[] {
  const codigo = baseCode.trim().toUpperCase();
  return rotas.filter((rota) => !rota.facilityId || rota.facilityId.trim().toUpperCase() === codigo);
}

/** Resumo de auditoria do ciclo — usado principalmente em DRY_RUN. */
export type CicloResumo = {
  rotas_encontradas: number;
  rotas_ativas: number;
  rotas_consultadas: number;
  pacotes_encontrados: number;
  duracao_ms: number;
  erros: number;
};

/** Conta pacotes no payload BRUTO sem transformá-lo nem persistir nada. */
export function contarPacotesBrutos(payload: Record<string, unknown>): number {
  const stops = payload["stops"];
  if (!Array.isArray(stops)) return 0;
  let total = 0;
  for (const stop of stops) {
    if (!stop || typeof stop !== "object") continue;
    const shipments = (stop as Record<string, unknown>)["shipments"];
    total += Array.isArray(shipments) ? shipments.length : 1;
  }
  return total;
}

export type CicloResultado = {
  execucao: Execucao;
  /** Sinaliza ao loop que a sessão AdminML precisa de reautenticação manual. */
  sessaoAdminMLExpirada: boolean;
  /** Sinaliza ao loop que a sessão JMRoutes precisa ser renovada. */
  jmroutesSemSessao: boolean;
  /** Resumo do ciclo (sempre preenchido; é a única saída em DRY_RUN). */
  resumo: CicloResumo;
  /** true quando nada foi enviado ao JMRoutes nem gravado no banco. */
  dryRun: boolean;
  /** Backend recusou o protocolo de lotes: o loop deve repetir no fluxo legado. */
  protocoloLotesIndisponivel: boolean;
};

function resumoDe(
  encontradas: number,
  ativas: number,
  consultadas: number,
  pacotes: number,
  inicio: number,
  erros: number,
): CicloResumo {
  return {
    rotas_encontradas: encontradas,
    rotas_ativas: ativas,
    rotas_consultadas: consultadas,
    pacotes_encontrados: pacotes,
    duracao_ms: Date.now() - inicio,
    erros,
  };
}

function montar(
  cfg: WorkerConfig,
  inicio: number,
  batchId: string,
  status: CicloStatus,
  sessao: SessaoStatusTelemetria,
  parciais: Partial<Execucao> = {},
): Execucao {
  const fim = Date.now();
  return {
    base_code: cfg.baseCode,
    sync_batch_id: batchId,
    iniciado_em: new Date(inicio).toISOString(),
    finalizado_em: new Date(fim).toISOString(),
    duracao_ms: fim - inicio,
    rotas_encontradas: 0,
    rotas_processadas: 0,
    pacotes_enviados: 0,
    erros: 0,
    status,
    sessao_status: sessao,
    mensagem_segura: null,
    ...parciais,
  };
}

export async function executarCiclo(deps: CicloDeps): Promise<CicloResultado> {
  const { cfg, transport, breaker } = deps;
  const dormir = deps.dormir ?? sleep;
  const estado = deps.estado ?? novoEstadoIncremental();
  const batchId = deps.syncBatchId ?? randomUUID();
  const inicio = Date.now();
  const dryRun = deps.dryRun ?? cfg.dryRun === true;

  if (!breaker.permite()) {
    return {
      execucao: montar(cfg, inicio, batchId, "circuito_pausado", "ok", {
        mensagem_segura: mensagemSegura(`circuito aberto: ${breaker.motivo ?? "desconhecido"}`),
      }),
      sessaoAdminMLExpirada: false,
      jmroutesSemSessao: false,
      resumo: resumoDe(0, 0, 0, 0, inicio, 0),
      dryRun,
      protocoloLotesIndisponivel: false,
    };
  }

  const lista = await listarRotas(transport, {
    serviceCenterId: cfg.serviceCenterId,
    siteId: cfg.siteId,
    dormir,
  });

  if (!lista.ok) {
    if (lista.motivo === "sessao_expirada") {
      breaker.abrir("sessao_expirada");
      return {
        execucao: montar(cfg, inicio, batchId, "sessao_expirada", "expirada", {
          mensagem_segura: "AdminML retornou 401/403 na lista; aguardando nova autenticação manual.",
        }),
        sessaoAdminMLExpirada: true,
        jmroutesSemSessao: false,
        resumo: resumoDe(0, 0, 0, 0, inicio, 0),
        dryRun,
        protocoloLotesIndisponivel: false,
      };
    }
    breaker.registrarFalha(lista.motivo);
    return {
      execucao: montar(
        cfg,
        inicio,
        batchId,
        lista.motivo === "rate_limit" ? "rate_limit" : "erro",
        "ok",
        { erros: 1, mensagem_segura: mensagemSegura(`falha na lista: ${lista.motivo}`) },
      ),
      sessaoAdminMLExpirada: false,
      jmroutesSemSessao: false,
      resumo: resumoDe(0, 0, 0, 0, inicio, 1),
      dryRun,
      protocoloLotesIndisponivel: false,
    };
  }

  // Um Service Center pai pode conter a operação direta e um ou mais XPTs.
  // facilityId identifica a unidade operacional real e impede duplicidade.
  const rotasDaUnidade = filtrarRotasDaUnidade(lista.valor.rotas, cfg.baseCode);
  const encontradas = rotasDaUnidade.length;
  const selecionadas = selecionarRotas(rotasDaUnidade, estado).slice(
    0,
    deps.maxRotasPorCiclo ?? 500,
  );

  const ativas = selecionadas.length;
  let consultadas = 0;
  let processadas = 0;
  let pacotesEncontrados = 0;
  let pacotes = 0;
  let erros = 0;
  let rateLimit = false;
  let sessaoExpirada = false;
  let semSessaoJmr = false;
  let protocoloIndisponivel = false;
  let ultimaMensagem: string | null = null;

  // Concorrência 1 — sequencial, com jitter entre chamadas.
  for (const rota of selecionadas) {
    if (sessaoExpirada || semSessaoJmr || protocoloIndisponivel) break;

    const detalhe = await obterDetalheRota(transport, rota.routeId, cfg.siteId, dormir);
    if (!detalhe.ok) {
      if (detalhe.motivo === "sessao_expirada") {
        sessaoExpirada = true;
        breaker.abrir("sessao_expirada");
        break;
      }
      erros += 1;
      if (detalhe.motivo === "rate_limit") rateLimit = true;
      ultimaMensagem = `detalhe ${rota.routeId}: ${detalhe.motivo}`;
      await dormir(jitter());
      continue;
    }

    consultadas += 1;
    pacotesEncontrados += contarPacotesBrutos(detalhe.valor);

    if (dryRun) {
      // Não chama o endpoint de ingestão, não altera banco, não grava payload.
      registrarColeta(estado, rota);
      await dormir(jitter(ADMINML.JITTER_MS));
      continue;
    }

    const envio = await enviarRotaBruta(cfg, detalhe.valor, {
      accessToken: deps.accessToken,
      fetchImpl: deps.fetchImpl,
      syncBatchId: deps.syncBatchId ?? null,
    });

    if (envio.status === "ok") {
      processadas += 1;
      pacotes += envio.pacotes;
      registrarColeta(estado, rota);
    } else if (envio.status === "protocolo_indisponivel") {
      protocoloIndisponivel = true;
      ultimaMensagem = "backend sem protocolo de lotes; reprocessando no fluxo legado.";
      break;
    } else if (envio.status === "sem_sessao") {
      semSessaoJmr = true;
      ultimaMensagem = "sessão JMRoutes expirada durante o envio.";
      break;
    } else if (envio.status === "rate_limit") {
      rateLimit = true;
      erros += 1;
      await dormir(60_000);
    } else {
      erros += 1;
      ultimaMensagem = envio.mensagem;
    }

    await dormir(jitter(ADMINML.JITTER_MS));
  }

  let status: CicloStatus;
  if (protocoloIndisponivel) status = "erro";
  else if (semSessaoJmr) status = "jmroutes_sem_sessao";
  else if (sessaoExpirada) status = "sessao_expirada";
  else if (rateLimit && processadas === 0 && consultadas === 0) status = "rate_limit";
  else if (erros > 0 && (processadas > 0 || (dryRun && consultadas > 0))) status = "sucesso_parcial";
  else if (erros > 0) status = "erro";
  else status = "sucesso";

  if (status === "sucesso" || status === "sucesso_parcial") breaker.registrarSucesso();
  else if (status === "erro" || status === "rate_limit") breaker.registrarFalha(status);

  logger.info("Ciclo processado.", {
    base: cfg.baseCode,
    dry_run: dryRun,
    encontradas,
    ativas,
    consultadas,
    pacotes_encontrados: pacotesEncontrados,
    processadas,
    erros,
  });

  return {
    execucao: montar(cfg, inicio, batchId, status, sessaoExpirada ? "expirada" : "ok", {
      rotas_encontradas: encontradas,
      rotas_processadas: processadas,
      pacotes_enviados: pacotes,
      erros,
      mensagem_segura: ultimaMensagem ? mensagemSegura(ultimaMensagem) : null,
    }),
    sessaoAdminMLExpirada: sessaoExpirada,
    jmroutesSemSessao: semSessaoJmr,
    resumo: resumoDe(encontradas, ativas, consultadas, pacotesEncontrados, inicio, erros),
    dryRun,
    protocoloLotesIndisponivel: protocoloIndisponivel,
  };
}
