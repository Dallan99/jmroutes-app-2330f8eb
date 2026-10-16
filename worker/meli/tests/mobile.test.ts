import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileAccess, mobileOrigin } from "../src/mobile/security";
import { collectionConfirmed, readReceipt, writeReceipt } from "../src/mobile/receipt";
import { createMobileServer } from "../src/mobile/server";
import { loadConfig } from "../src/config";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { MobileBrowser } from "../src/mobile/browser";
import type { Execucao } from "../src/telemetry/report";

const secret = "mobile-test-only-key-32-characters-long";
const origin = "https://mobile.example.invalid";
const cfg = loadConfig({ BASE_CODE: "ESP16", DRY_RUN: "true", WORKER_SESSION_KEY: Buffer.alloc(32, 7).toString("base64"),
  JMR_BASE_URL: "https://jmr.example.invalid", SUPABASE_URL: "https://db.example.invalid", SUPABASE_ANON_KEY: "test" });
const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });

describe("iniciador móvel", () => {
  it("exige HTTPS e chave forte, expira sessão, revoga e limita tentativas", () => {
    expect(() => mobileOrigin("http://public.example")).toThrow();
    expect(() => mobileOrigin("https://mobile.example/path")).toThrow();
    expect(() => new MobileAccess("short")).toThrow();
    const access = new MobileAccess(secret);
    expect(access.authorize(undefined)).toBe(false);
    const session = access.login(secret, 100)!;
    expect(access.authorize(`jmr_mobile=${session.token}`, 101)).toBe(true);
    expect(access.verifyCsrf(session.csrf)).toBe(true);
    expect(access.verifyCsrf("wrong")).toBe(false);
    expect(access.authorize(`jmr_mobile=${session.token}`, 1_800_100)).toBe(false);
    access.revoke();
    expect(access.authorize(`jmr_mobile=${session.token}`, 101)).toBe(false);
    for (let i = 0; i < 4; i++) access.login("wrong", 102);
    expect(access.login(secret, 103)).toBeNull();
  });
  it("não confunde sessão salva, ciclo antigo/parcial/vazio e coleta nova", async () => {
    const now = Date.now();
    const execution = { base_code: "ESP16", iniciado_em: new Date(now - 1000).toISOString(),
      finalizado_em: new Date(now).toISOString(), status: "sucesso", rotas_processadas: 1, pacotes_enviados: 12 } as Execucao;
    expect(collectionConfirmed(null, now)).toBe(false);
    expect(collectionConfirmed(execution, now)).toBe(false);
    expect(collectionConfirmed(execution, now - 2000)).toBe(true);
    expect(collectionConfirmed({ ...execution, status: "sucesso_parcial" }, now - 2000)).toBe(false);
    expect(collectionConfirmed({ ...execution, rotas_processadas: 0 }, now - 2000)).toBe(false);
    expect(collectionConfirmed({ ...execution, mode: "piloto" }, now - 2000)).toBe(false);
    expect(collectionConfirmed({ ...execution, mode: "piloto" }, now - 2000, now, "piloto")).toBe(true);
    expect(collectionConfirmed(execution, now - 2000, now + 300_000)).toBe(false);
    const dir = await mkdtemp(join(tmpdir(), "jmr-mobile-")); dirs.push(dir);
    await writeReceipt(join(dir, "receipt"), execution);
    expect(await readReceipt(join(dir, "receipt"), "ESP16")).toEqual(execution);
    expect(await readReceipt(join(dir, "receipt"), "ESP17")).toBeNull();
    await writeReceipt(join(dir, "receipt"), { ...execution, base_code: "SSP37/03", mode: "piloto" });
    expect((await readReceipt(join(dir, "receipt"), "SSP37/03"))?.mode).toBe("piloto");
  });
  it("protege tela e comandos, origem/CSRF e cookies; mantém dry-run explícito", async () => {
    const remote = { state: "idle", savedAt: 0, start: vi.fn(), close: vi.fn(), tick: vi.fn(),
      screen: vi.fn().mockResolvedValue(Buffer.from("test")), action: vi.fn(),
      exclusive: async (fn: () => unknown) => fn() } as unknown as MobileBrowser;
    const server = createMobileServer(cfg, { MOBILE_PUBLIC_ORIGIN: origin, MOBILE_ACCESS_KEY: secret }, remote);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}`;
    try {
      expect((await fetch(url + "/screen")).status).toBe(401);
      expect((await fetch(url + "/start", { method: "POST" })).status).toBe(403);
      const login = await fetch(url + "/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ secret }) });
      const cookie = login.headers.get("set-cookie")!;
      expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("Secure"); expect(cookie).toContain("SameSite=Strict");
      const { csrf } = await login.json() as { csrf: string };
      const headers = { Cookie: cookie.split(";")[0], Origin: origin, "Content-Type": "application/json" };
      expect((await fetch(url + "/start", { method: "POST", headers, body: "{}" })).status).toBe(403);
      expect((await fetch(url + "/start", { method: "POST", headers: { ...headers, "X-CSRF-Token": csrf }, body: "{}" })).status).toBe(200);
      expect(remote.start).toHaveBeenCalledTimes(1);
      const status = await fetch(url + "/status", { headers });
      expect((await status.json() as { message: string }).message).toContain("Modo de teste");
      const page = await fetch(url);
      expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(page.headers.get("cache-control")).toBe("no-store");
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
