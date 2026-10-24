import { describe, expect, it, vi } from "vitest";
import { chromium } from "playwright";
import { MobileBrowser } from "../src/mobile/browser";
import { loadConfig } from "../src/config";
import { carregarSessao, salvarSessao } from "../src/session/store";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("navegador do iniciador", () => {
  it("controla tela real e só salva após JSON operacional válido; rejeita erro/HTML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mobile-browser-"));
    const key = Buffer.alloc(32, 1).toString("base64");
    const cfg = loadConfig({ DRY_RUN: "true", BASE_CODE: "ESP16", WORKER_SESSION_KEY: key,
      SESSION_FILE_PATH: join(dir, "session.enc"), SUPABASE_URL: "https://example.invalid", SUPABASE_ANON_KEY: "test", JMR_BASE_URL: "https://example.invalid" });
    const previous = { cookies: [{ name: "old-session", value: "old", domain: "envios.adminml.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const }], origins: [] };
    await salvarSessao(cfg.sessionFilePath, previous, key);
    const original = chromium.launch.bind(chromium);
    let response = { status: 403, contentType: "application/json", body: '{"error":"denied"}' };
    let inputValue = "";
    let oldCookieSent = false;
    const launch = vi.spyOn(chromium, "launch").mockImplementation(async options => {
      const browser = await original(options);
      const originalContext = browser.newContext.bind(browser);
      vi.spyOn(browser, "newContext").mockImplementation(async opts => {
        const context = await originalContext(opts);
        vi.spyOn(context.request, "post").mockImplementation(async () => ({
          ok: () => response.status >= 200 && response.status < 300,
          headers: () => ({ "content-type": response.contentType }),
          json: async () => JSON.parse(response.body),
        } as unknown as Awaited<ReturnType<typeof context.request.post>>));
        await context.route("**/*", async route => {
          oldCookieSent ||= (route.request().headers()["cookie"] ?? "").includes("old-session");
          if (route.request().url().includes("get-routes-list")) await route.fulfill(response);
          else await route.fulfill({ contentType: "text/html", body: '<html><input id="u" style="position:absolute;left:10px;top:10px;width:300px;height:60px"><script>document.querySelector("input").addEventListener("input",()=>fetch("/typed?value="+encodeURIComponent(document.querySelector("input").value)))</script></html>' });
          if (route.request().url().includes("/typed?")) inputValue = new URL(route.request().url()).searchParams.get("value") ?? "";
        });
        return context;
      });
      return browser;
    });
    const remote = new MobileBrowser(cfg);
    try {
      await remote.exclusive(() => remote.start());
      expect((await remote.screen()).length).toBeGreaterThan(100);
      await remote.action({ type: "click", x: 0.05, y: 0.05 });
      await remote.action({ type: "text", text: "test-user" });
      await vi.waitFor(() => expect(inputValue).toBe("test-user"));
      await expect(remote.action({ type: "click", x: -1, y: 0 })).rejects.toThrow();
      await remote.tick(); expect(remote.state).toBe("login");
      expect(oldCookieSent).toBe(false);
      response = { status: 500, contentType: "application/json", body: '{"results":[]}' };
      await remote.tick(); expect(remote.state).toBe("login");
      response = { status: 200, contentType: "text/html", body: "<html>login</html>" };
      await remote.tick(); expect(remote.state).toBe("login");
      response = { status: 200, contentType: "application/json", body: '{"error":"login_required"}' };
      await remote.tick(); expect(remote.state).toBe("login");
      const unchanged = await carregarSessao(cfg.sessionFilePath, key);
      expect(unchanged.status).toBe("ok");
      if (unchanged.status === "ok") expect(unchanged.storageState).toEqual(previous);
      response = { status: 200, contentType: "application/json", body: '{"results":[]}' };
      await remote.tick(); expect(remote.state).toBe("saved");
      expect(remote.savedAt).toBeGreaterThan(0);
      expect((await carregarSessao(cfg.sessionFilePath, key)).status).toBe("ok");
      await expect(remote.screen()).rejects.toThrow();
    } finally { await remote.close(); launch.mockRestore(); await rm(dir, { recursive: true, force: true }); }
  }, 30_000);
});
