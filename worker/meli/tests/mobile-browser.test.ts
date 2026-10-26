import { describe, expect, it, vi } from "vitest";
import { chromium, type BrowserContext } from "playwright";
import { MobileBrowser } from "../src/mobile/browser";
import { loadConfig } from "../src/config";
import { carregarSessao, salvarSessao } from "../src/session/store";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("navegador do iniciador", () => {
  it("controla tela real e só salva após prova autenticada no endpoint de detalhe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mobile-browser-"));
    const key = Buffer.alloc(32, 1).toString("base64");
    const cfg = loadConfig({ DRY_RUN: "true", BASE_CODE: "ESP16", WORKER_SESSION_KEY: key,
      SESSION_FILE_PATH: join(dir, "session.enc"), SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "test", JMR_BASE_URL: "https://example.invalid" });
    const previous = { cookies: [{ name: "old-session", value: "old", domain: "envios.adminml.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] };
    await salvarSessao(cfg.sessionFilePath, previous, key);
    const original = chromium.launch.bind(chromium);
    let response = { status: 403 };
    let inputValue = "";
    let oldCookieSent = false;
    let loggedIn = false;
    let contextForTest!: BrowserContext;
    const launch = vi.spyOn(chromium, "launch").mockImplementation(async options => {
      const browser = await original(options);
      const originalContext = browser.newContext.bind(browser);
      vi.spyOn(browser, "newContext").mockImplementation(async opts => {
        const context = await originalContext(opts);
        contextForTest = context;
        vi.spyOn(context.request, "get").mockImplementation(async () => ({
          status: () => response.status,
        } as unknown as Awaited<ReturnType<typeof context.request.get>>));
        await context.route("**/*", async route => {
          oldCookieSent ||= (route.request().headers()["cookie"] ?? "").includes("old-session");
          const url = new URL(route.request().url());
          if (url.hostname === "envios.adminml.com" && url.pathname === "/logistics/monitoring" && !loggedIn) {
            await route.fulfill({ status: 302, headers: { location: "https://login.example.invalid/sso" } });
          } else if (route.request().url().includes("get-routes-list")) await route.fulfill(response);
          else await route.fulfill({ contentType: "text/html", body: '<html><input id="u" style="position:absolute;left:10px;top:10px;width:300px;height:60px"><script>document.querySelector("input").addEventListener("input",()=>fetch("/typed?value="+encodeURIComponent(document.querySelector("input").value)))</script></html>' });
          if (route.request().url().includes("/typed?")) inputValue = new URL(route.request().url()).searchParams.get("value") ?? "";
        });
        return context;
      });
      return browser;
    });
    const remote = new MobileBrowser(cfg);
    remote.probeIntervalMs = 0;
    try {
      await remote.exclusive(() => remote.start());
      const loginPage = contextForTest.pages()[0];
      expect(loginPage?.url()).toContain("/logistics/monitoring-distribution");
      expect((await remote.screen()).length).toBeGreaterThan(100);
      await remote.action({ type: "click", x: 0.05, y: 0.05 });
      await remote.action({ type: "text", text: "test-user" });
      await vi.waitFor(() => expect(inputValue).toBe("test-user"));
      await expect(remote.action({ type: "click", x: -1, y: 0 })).rejects.toThrow();
      await remote.tick(); expect(remote.state).toBe("login");
      expect(oldCookieSent).toBe(false);
      response = { status: 500 };
      await remote.tick(); expect(remote.state).toBe("login");
      response = { status: 302 };
      await remote.tick(); expect(remote.state).toBe("login");
      response = { status: 401 };
      await remote.tick(); expect(remote.state).toBe("login");
      response = { status: 400 };
      await remote.tick(); expect(remote.state).toBe("login");
      // A aba da prova não substitui a tela do operador.
      expect((await remote.screen()).length).toBeGreaterThan(100);
      expect(contextForTest.pages()).toHaveLength(1);
      const unchanged = await carregarSessao(cfg.sessionFilePath, key);
      expect(unchanged.status).toBe("ok");
      if (unchanged.status === "ok") expect(unchanged.storageState).toEqual(previous);
      // O SSO pode terminar numa página de erro do Mercado Livre. A sessão
      // deve ser reconhecida pela API operacional, não pela URL visível.
      await loginPage!.goto("https://www.mercadolivre.com.br/erro-pos-login");
      response = { status: 400 };
      loggedIn = true;
      await remote.tick(); expect(remote.state).toBe("saved");
      expect(remote.savedAt).toBeGreaterThan(0);
      expect((await carregarSessao(cfg.sessionFilePath, key)).status).toBe("ok");
      await expect(remote.screen()).rejects.toThrow();
    } finally { await remote.close(); launch.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});
