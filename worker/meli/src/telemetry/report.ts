// Telemetria do ciclo. Enviada via RPC dedicada (SECURITY DEFINER) com o
// Bearer do usuário técnico. Nunca envia cookies, tokens, senhas ou payloads.
import { WORKER_VERSAO, type WorkerConfig } from "../config.js";
import { logger, mensagemSegura } from "../logger.js";
import { writeReceipt } from "../mobile/receipt.js";

export type CicloStatus =
  | "sucesso"
  | "sucesso_parcial"
  | "erro"
  | "rate_limit"
  | "circuito_pausado"
  | "sessao_expirada"
  | "aguardando_autenticacao"
  | "jmroutes_sem_sessao";

export const CICLO_STATUS: CicloStatus[] = [
  "sucesso",
  "sucesso_parcial",
  "erro",
  "rate_limit",
  "circuito_pausado",
  "sessao_expirada",
  "aguardando_autenticacao",
  "jmroutes_sem_sessao",
];

export type SessaoStatusTelemetria = "ok" | "expirada" | "ausente";

export type Execucao = {
  base_code: string;
  sync_batch_id: string;
  iniciado_em: string;
  finalizado_em: string;
  duracao_ms: number;
  rotas_encontradas: number;
  rotas_processadas: number;
  pacotes_enviados: number;
  erros: number;
  status: CicloStatus;
  sessao_status: SessaoStatusTelemetria;
  mensagem_segura: string | null;
};

export type ReportOpts = {
  accessToken: string | null;
  fetchImpl?: typeof fetch;
};

export async function registrarExecucao(
  cfg: WorkerConfig,
  execucao: Execucao,
  opts: ReportOpts,
): Promise<{ ok: boolean; motivo?: string }> {
  logger.info("Ciclo concluído.", {
    status: execucao.status,
    rotas_encontradas: execucao.rotas_encontradas,
    rotas_processadas: execucao.rotas_processadas,
    pacotes_enviados: execucao.pacotes_enviados,
    erros: execucao.erros,
    duracao_ms: execucao.duracao_ms,
  });

  if (!opts.accessToken) return { ok: false, motivo: "sem_token" };
  if (!CICLO_STATUS.includes(execucao.status)) return { ok: false, motivo: "status_invalido" };

  const f = opts.fetchImpl ?? fetch;
  try {
    const res = await f(`${cfg.supabaseUrl}/rest/v1/rpc/meli_worker_registrar_execucao`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseAnonKey,
        Authorization: `Bearer ${opts.accessToken}`,
      },
      body: JSON.stringify({
        p_base_code: execucao.base_code,
        p_worker_versao: WORKER_VERSAO,
        p_sync_batch_id: execucao.sync_batch_id,
        p_iniciado_em: execucao.iniciado_em,
        p_finalizado_em: execucao.finalizado_em,
        p_rotas_encontradas: execucao.rotas_encontradas,
        p_rotas_processadas: execucao.rotas_processadas,
        p_pacotes_enviados: execucao.pacotes_enviados,
        p_erros: execucao.erros,
        p_status: execucao.status,
        p_sessao_status: execucao.sessao_status,
        p_mensagem_segura: execucao.mensagem_segura
          ? mensagemSegura(execucao.mensagem_segura)
          : null,
      }),
    });
    if (!res.ok) return { ok: false, motivo: `http_${res.status}` };
    // Confirmação local apenas depois de a telemetria ter sido aceita. Não
    // contém credenciais nem payloads; falha desse painel não interrompe coleta.
    const receiptPath = process.env["MOBILE_RECEIPT_PATH"];
    if (receiptPath) await writeReceipt(receiptPath, execucao).catch(() => undefined);
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: mensagemSegura(String((err as Error)?.message ?? err)) };
  }
}

