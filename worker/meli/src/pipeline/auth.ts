// Camada de autenticação do worker.
// A) AdminML: transporte HTTP a partir do storageState cifrado (Playwright).
//    Modular: qualquer implementação de MeliTransport (ex.: endpoint corporativo
//    XPT autorizado) pode substituir o Playwright sem alterar o pipeline.
// B) JMRoutes: sessão Supabase do usuário técnico (Bearer). NUNCA service_role.
import type { Browser, Page } from "playwright";
import { ADMINML, type WorkerConfig } from "../config.js";
import { logger, mensagemSegura } from "../logger.js";
import { carregarSessao } from "../session/store.js";
import { carregarRefreshToken, comTravaSessao, salvarRefreshToken } from "../session/jmr.js";
import type { MeliResposta, MeliTransport } from "../meli/list.js";

// ------------------------------------------------------------------
// A) AdminML
// ------------------------------------------------------------------
export type AdminMLSessao =
  | { status: "ok"; transport: MeliTransport; page: Page; fechar: () => Promise<void> }
  | { status: "aguardando_autenticacao"; motivo: string };

function toHeaders(res: { headers(): Record<string, string> }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers())) out[k.toLowerCase()] = v;
  return out;
}

async function respostaDe(res: {
  status(): number;
  headers(): Record<string, string>;
  text(): Promise<string>;
}): Promise<MeliResposta> {
  const headers = toHeaders(res);
  const status = res.status();
  let body: unknown = null;
  const ct = (headers["content-type"] ?? "").toLowerCase();
  if (ct.includes("json")) {
    const raw = await res.text();
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }
  const ok = status >= 200 && status < 300 && body !== null;
  return { status, headers, body, ok };
}

export function transportDePagina(page: Page): MeliTransport {
  const chamar = async (url: string, method: "GET" | "POST", body?: unknown, extraHeaders?: Record<string, string>) =>
    page.evaluate(async ({ url, method, body, timeoutMs, extraHeaders }) => {
      const ctrl = new AbortController();
      const timer = globalThis.setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          credentials: "include",
          headers: { Accept: "application/json, text/plain, */*", ...(method === "POST" ? { "Content-Type": "application/json" } : {}), ...extraHeaders },
          body: method === "POST" ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
        let responseBody: unknown = null;
        if ((headers["content-type"] ?? "").toLowerCase().includes("json")) {
          try { responseBody = await res.json(); } catch { responseBody = null; }
        }
        return { status: res.status, headers, body: responseBody, ok: res.ok && responseBody !== null };
      } finally { globalThis.clearTimeout(timer); }
    }, { url, method, body, timeoutMs: ADMINML.TIMEOUT_MS, extraHeaders });
  return {
    post: (url, body) => chamar(url, "POST", body),
    get: (url, headers) => chamar(url, "GET", undefined, headers),
  };
}

/** Abre um contexto AdminML autenticado usando a sessão cifrada em disco. */
export async function abrirSessaoAdminML(cfg: WorkerConfig): Promise<AdminMLSessao> {
  const leitura = await carregarSessao(cfg.sessionFilePath, cfg.sessionKeyBase64);
  if (leitura.status !== "ok") {
    return { status: "aguardando_autenticacao", motivo: leitura.motivo };
  }

  const { chromium } = await import("playwright");
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // storageState é passado em memória — nunca é escrito em claro no disco.
    storageState: leitura.storageState as never,
  });
  const page = await context.newPage();
  await page.goto(`https://${ADMINML.HOST}/logistics/monitoring`, { waitUntil: "domcontentloaded", timeout: ADMINML.TIMEOUT_MS });

  // Sessões vencidas podem redirecionar para o login em outro domínio. Nesse
  // caso, chamadas fetch feitas dentro da página falham como erro de rede/CORS
  // em vez de retornarem 401. Detectamos o redirecionamento aqui para acionar
  // corretamente a recuperação assistida.
  let hostAtual = "";
  try {
    hostAtual = new URL(page.url()).hostname.toLowerCase();
  } catch {
    hostAtual = "";
  }
  if (hostAtual !== ADMINML.HOST) {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
    return { status: "aguardando_autenticacao", motivo: "sessao_expirada_redirecionada" };
  }

  return {
    status: "ok",
    transport: transportDePagina(page),
    page,
    fechar: async () => {
      await context.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    },
  };
}

// ------------------------------------------------------------------
// B) JMRoutes / Supabase
// ------------------------------------------------------------------
export type JmrSessao = {
  accessToken: string;
  refreshToken: string | null;
  expiraEm: number;
};

export type JmrAuthResultado =
  | { status: "ok"; sessao: JmrSessao }
  | { status: "jmroutes_sem_sessao"; motivo: string };

type TokenResposta = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

async function chamarToken(
  cfg: WorkerConfig,
  grant: "password" | "refresh_token",
  corpo: Record<string, string>,
): Promise<JmrAuthResultado> {
  try {
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=${grant}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: cfg.supabaseAnonKey,
      },
      body: JSON.stringify(corpo),
    });
    if (!res.ok) {
      let codigo = "desconhecido";
      try {
        const erro = (await res.json()) as Record<string, unknown>;
        const bruto = String(erro["error_code"] ?? erro["code"] ?? erro["error"] ?? "desconhecido");
        codigo = bruto.toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 80);
      } catch {
        // A resposta pode não ser JSON; nunca registramos o corpo bruto.
      }
      return { status: "jmroutes_sem_sessao", motivo: `token_http_${res.status}_${codigo}` };
    }
    const data = (await res.json()) as TokenResposta;
    if (!data.access_token) return { status: "jmroutes_sem_sessao", motivo: "token_ausente" };
    return {
      status: "ok",
      sessao: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiraEm: Date.now() + (data.expires_in ?? 3600) * 1000,
      },
    };
  } catch (err) {
    // Nunca registra senha nem token.
    logger.warn("Falha ao autenticar no JMRoutes.", {
      erro: mensagemSegura(String((err as Error)?.message ?? err)),
    });
    return { status: "jmroutes_sem_sessao", motivo: "network" };
  }
}

export function autenticarJmroutes(cfg: WorkerConfig): Promise<JmrAuthResultado> {
  if (!cfg.workerEmail || !cfg.workerPassword) {
    return Promise.resolve({ status: "jmroutes_sem_sessao", motivo: "credencial_por_senha_ausente" });
  }
  return chamarToken(cfg, "password", { email: cfg.workerEmail, password: cfg.workerPassword });
}

export function renovarJmroutes(cfg: WorkerConfig, refreshToken: string): Promise<JmrAuthResultado> {
  return chamarToken(cfg, "refresh_token", { refresh_token: refreshToken });
}

export function sessaoValida(sessao: JmrSessao | null, agora = Date.now()): boolean {
  return !!sessao && sessao.expiraEm - agora > 60_000;
}

/** Garante sessão JMRoutes válida: renova quando possível, senão reautentica. */
export async function garantirSessaoJmroutes(
  cfg: WorkerConfig,
  atual: JmrSessao | null,
): Promise<JmrAuthResultado> {
  if (sessaoValida(atual)) return { status: "ok", sessao: atual as JmrSessao };
  return comTravaSessao(cfg.jmrSessionFilePath, async () => {
    // Sempre relê depois de obter a trava: outro worker pode ter rotacionado o token.
    const refreshToken =
      (await carregarRefreshToken(cfg.jmrSessionFilePath, cfg.sessionKeyBase64)) ??
      atual?.refreshToken ??
      null;
    if (refreshToken) {
      const renovada = await renovarJmroutes(cfg, refreshToken);
      if (renovada.status === "ok") {
        if (renovada.sessao.refreshToken) {
          await salvarRefreshToken(cfg.jmrSessionFilePath, cfg.sessionKeyBase64, renovada.sessao.refreshToken);
        }
        return renovada;
      }
    }
    const autenticada = await autenticarJmroutes(cfg);
    if (autenticada.status === "ok" && autenticada.sessao.refreshToken) {
      await salvarRefreshToken(cfg.jmrSessionFilePath, cfg.sessionKeyBase64, autenticada.sessao.refreshToken);
    }
    return autenticada;
  });
}
