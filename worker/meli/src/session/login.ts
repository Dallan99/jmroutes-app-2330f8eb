// Login MANUAL (headful) no AdminML. O operador digita usuário, senha e MFA.
// O worker nunca armazena senha: apenas o storageState resultante, cifrado.
import { ADMINML } from "../config.js";
import { logger } from "../logger.js";
import { mkdir, rm, stat } from "node:fs/promises";
import type { Page } from "playwright";
import { carregarSessao, salvarSessao, type StorageState } from "./store.js";

export type LoginOpts = {
  sessionFilePath: string;
  sessionKeyBase64: string;
  /** Tempo máximo aguardando o operador concluir login + MFA. */
  timeoutMs?: number;
};

type CredenciaisAssistidas = { usuario: string; senha: string };
type EstadoLoginAssistido = {
  usuarioEnviado: boolean;
  senhaEnviada: boolean;
  metodoOktaSelecionado: boolean;
  pushSolicitado: boolean;
};

function credenciaisAssistidas(): CredenciaisAssistidas | null {
  const usuario = (process.env["ADMINML_USERNAME"] ?? "").trim();
  const senhaBase64 = (process.env["ADMINML_PASSWORD_BASE64"] ?? "").trim();
  if (!usuario || !senhaBase64) return null;
  const senha = Buffer.from(senhaBase64, "base64").toString("utf8");
  return senha ? { usuario, senha } : null;
}

async function clicarPrimeiroVisivel(page: Page, nomes: RegExp[]): Promise<boolean> {
  for (const nome of nomes) {
    const botao = page.getByRole("button", { name: nome }).first();
    if (await botao.isVisible().catch(() => false)) {
      await botao.click();
      return true;
    }
  }
  return false;
}

/**
 * Automatiza somente o preenchimento e o avanço das telas oficiais. A
 * aprovação do Okta Verify permanece obrigatoriamente com o operador.
 */
async function avancarLoginAssistido(
  page: Page,
  credenciais: CredenciaisAssistidas,
  estado: EstadoLoginAssistido,
): Promise<void> {
  const usuario = page
    .locator('input[name="identifier"], input[name="username"], input#okta-signin-username, input[type="email"], input[autocomplete="username"]')
    .first();
  if (!estado.usuarioEnviado && await usuario.isVisible().catch(() => false)) {
    await usuario.fill(credenciais.usuario);
    estado.usuarioEnviado = await clicarPrimeiroVisivel(page, [/^Próximo$/i, /^Next$/i, /^Continuar$/i]);
    return;
  }

  const senha = page.locator('input[type="password"], input[name="password"]').first();
  if (!estado.senhaEnviada && await senha.isVisible().catch(() => false)) {
    await senha.fill(credenciais.senha);
    await senha.press("Enter");
    estado.senhaEnviada = true;
    return;
  }

  if (!estado.metodoOktaSelecionado) {
    estado.metodoOktaSelecionado = await clicarPrimeiroVisivel(page, [/^Okta Verify$/i]);
    if (estado.metodoOktaSelecionado) return;
  }

  // Solicita o push oficial, mas nunca aprova o MFA.
  if (!estado.pushSolicitado) {
    estado.pushSolicitado = await clicarPrimeiroVisivel(page, [
      /Enviar.*push/i,
      /Get a push notification/i,
      /Push notification/i,
    ]);
  }
}

/**
 * Abre um navegador visível, aguarda o operador autenticar manualmente e
 * grava o storageState cifrado. Requer ambiente com display (uso local).
 */
export async function autenticarManualmente(opts: LoginOpts): Promise<void> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: false });
  // Reaproveita cookies do Okta/AdminML para reduzir o fluxo, quando possível,
  // à confirmação humana do MFA. A sessão continua somente em memória.
  const anterior = await carregarSessao(opts.sessionFilePath, opts.sessionKeyBase64);
  const context = await browser.newContext({
    storageState: anterior.status === "ok" ? (anterior.storageState as never) : undefined,
  });
  const page = await context.newPage();

  logger.info("Abrindo AdminML para autenticação manual (login e MFA pelo operador).", {
    host: ADMINML.HOST,
  });
  await page.goto(`https://${ADMINML.HOST}/logistics/monitoring`, { waitUntil: "domcontentloaded" });

  const limite = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  const credenciais = credenciaisAssistidas();
  const estadoAssistido: EstadoLoginAssistido = {
    usuarioEnviado: false,
    senhaEnviada: false,
    metodoOktaSelecionado: false,
    pushSolicitado: false,
  };
  if (credenciais) {
    logger.info("Login assistido ativo; aguardando somente a aprovação humana no Okta Verify.");
  }
  let autenticado = false;
  while (Date.now() < limite) {
    if (credenciais) {
      await avancarLoginAssistido(page, credenciais, estadoAssistido).catch(() => undefined);
    }
    const res = await context.request
      .get(`${ADMINML.DETAIL_URL}?routeId=0&siteId=MLB`, { timeout: 15_000 })
      .catch(() => null);
    const status = res?.status();
    if (status && status !== 401 && status !== 403) {
      autenticado = true;
      break;
    }
    await page.waitForTimeout(3000);
  }

  if (!autenticado) {
    await browser.close();
    throw new Error("Tempo esgotado: sessão AdminML não foi autenticada.");
  }

  const state = (await context.storageState()) as StorageState;
  await salvarSessao(opts.sessionFilePath, state, opts.sessionKeyBase64);
  await browser.close();
  logger.info("Sessão AdminML salva cifrada.", { arquivo: opts.sessionFilePath });
}

/** Garante que somente um worker abra a recuperação visível do AdminML. */
export async function autenticarManualmenteCoordenado(opts: LoginOpts): Promise<void> {
  const lockPath = `${opts.sessionFilePath}.login.lock`;
  const inicio = (await stat(opts.sessionFilePath).catch(() => null))?.mtimeMs ?? 0;
  try {
    await mkdir(lockPath);
  } catch {
    logger.info("Outro worker abriu o login do AdminML; aguardando conclusão.");
    const limite = Date.now() + (opts.timeoutMs ?? 10 * 60_000) + 30_000;
    while (Date.now() < limite) {
      const [sessao, trava] = await Promise.all([
        stat(opts.sessionFilePath).catch(() => null),
        stat(lockPath).catch(() => null),
      ]);
      if (!trava && sessao && sessao.mtimeMs > inicio) return;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Tempo esgotado aguardando a autenticação do AdminML.");
  }

  try {
    await autenticarManualmente(opts);
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
