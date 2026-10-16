import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { MobileAccess, mobileOrigin } from "./security.js";
import { MobileBrowser } from "./browser.js";
import { mobilePage } from "./page.js";
import { collectionConfirmed, readReceipt } from "./receipt.js";
import type { WorkerConfig } from "../config.js";

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new Error("Envie JSON.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new Error("Pedido muito grande.");
    chunks.push(chunk);
  }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Pedido inválido.");
  return body;
}
export function createMobileServer(cfg: WorkerConfig, env = process.env, remote = new MobileBrowser(cfg)) {
  const origin = mobileOrigin(env["MOBILE_PUBLIC_ORIGIN"] ?? "");
  const access = new MobileAccess(env["MOBILE_ACCESS_KEY"] ?? "");
  const receiptPrefix = env["MOBILE_RECEIPT_PATH"] ?? "/data/mobile-receipt";
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    try {
      // Nunca confia em Host/X-Forwarded-Host enviados pelo cliente.
      if (req.method === "POST" && req.headers.origin !== origin) { reply(res, 403, { error: "Origem não autorizada." }); return; }
      if (req.method === "GET" && req.url === "/health") { reply(res, 200, { ok: true }); return; }
      if (req.method === "GET" && req.url === "/") {
        const nonce = randomBytes(24).toString("base64");
        res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(mobilePage(nonce)); return;
      }
      if (req.method === "POST" && req.url === "/login") {
        const body = await jsonBody(req);
        const session = access.login(typeof body.secret === "string" ? body.secret : "");
        if (!session) { reply(res, 401, { error: "Chave inválida ou limite de tentativas. Aguarde um minuto." }); return; }
        res.setHeader("Set-Cookie", `jmr_mobile=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800${secure}`);
        reply(res, 200, { csrf: session.csrf }); return;
      }
      if (!access.authorize(req.headers.cookie)) { reply(res, 401, { error: "Entre com a chave de acesso." }); return; }
      if (req.method === "POST" && !access.verifyCsrf(String(req.headers["x-csrf-token"] ?? ""))) {
        reply(res, 403, { error: "Sessão inválida. Entre novamente." }); return;
      }
      if (req.method === "GET" && req.url === "/status") {
        const bases = await Promise.all(cfg.bases.map(async base => {
          const last = await readReceipt(receiptPrefix, base.baseCode);
          const mode = cfg.pilotWrite ? "piloto" : "operacional";
          return { base: base.baseCode, last, confirmed: (cfg.pilotWrite || (!cfg.dryRun && cfg.writeBaseCodes.includes(base.baseCode)))
            && collectionConfirmed(last, remote.savedAt, Date.now(), mode) };
        }));
        const messages = {
          idle: "Abra o login para renovar a sessão.", login: "Conclua o login na tela e aprove no Okta Verify.",
          saved: "Sessão renovada. Aguardando confirmação da coleta por base.",
          expired: "Tempo de login esgotado. Abra o login novamente.", error: "Não foi possível abrir o login. Tente novamente.",
        };
        const message = cfg.pilotWrite ? `Piloto isolado: atualiza apenas dados do piloto. ${messages[remote.state]}`
          : cfg.dryRun ? `Modo de teste: não publica dados no JM Routes. ${messages[remote.state]}` : messages[remote.state];
        reply(res, 200, { state: remote.state, mode: cfg.pilotWrite ? "piloto" : "operacional", message, bases }); return;
      }
      if (req.method === "GET" && req.url === "/screen") {
        const screen = await remote.exclusive(() => remote.screen());
        res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(screen); return;
      }
      if (req.method === "POST" && req.url === "/start") {
        await jsonBody(req);
        await remote.exclusive(() => remote.start());
        reply(res, 200, { ok: true }); return;
      }
      if (req.method === "POST" && req.url === "/action") {
        const body = await jsonBody(req);
        await remote.exclusive(() => remote.action(body));
        reply(res, 200, { ok: true }); return;
      }
      if (req.method === "POST" && req.url === "/logout") {
        access.revoke(); await remote.exclusive(() => remote.close());
        res.setHeader("Set-Cookie", `jmr_mobile=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
        reply(res, 200, { ok: true }); return;
      }
      reply(res, 404, { error: "Caminho indisponível." });
    } catch { reply(res, 409, { error: "Não foi possível concluir. Aguarde e tente novamente." }); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 30;
  const tick = setInterval(() => { void remote.exclusive(() => remote.tick()).catch(() => undefined); }, 5000);
  tick.unref();
  server.on("close", () => { clearInterval(tick); void remote.close(); });
  return server;
}
