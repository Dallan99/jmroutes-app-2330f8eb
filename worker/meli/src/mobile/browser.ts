import type { Browser, Page } from "playwright";
import { ADMINML, type WorkerConfig } from "../config.js";
import { salvarSessao } from "../session/store.js";

// Uma única tela oficial remota; senhas/cookies não são retornados pela API.
export class MobileBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private busy = false;
  private deadline = 0;
  savedAt = 0;
  state: "idle" | "login" | "saved" | "expired" | "error" = "idle";
  constructor(private cfg: WorkerConfig) {}
  async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Aguarde a operação atual.");
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  async start(): Promise<void> {
    await this.close();
    this.savedAt = 0;
    this.state = "login";
    this.deadline = Date.now() + 10 * 60_000;
    try {
      const { chromium } = await import("playwright");
      this.browser = await chromium.launch({ headless: true });
      // O novo login começa limpo. A sessão usada pelo coletor só é
      // substituída depois que a API operacional responder com JSON válido.
      const context = await this.browser.newContext({
        viewport: { width: 1024, height: 768 }, acceptDownloads: false,
      });
      // O fluxo é de uma aba. Se o IdP abrir popup, ela passa a ser a tela ativa.
      context.on("page", page => { this.page = page; });
      this.page = await context.newPage();
      await this.page.goto(`https://${ADMINML.HOST}/logistics/monitoring-distribution`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch {
      this.state = "error";
      await this.close();
      throw new Error("Não foi possível abrir o login. Tente novamente.");
    }
  }
  async close(): Promise<void> {
    this.page = null;
    const browser = this.browser;
    this.browser = null;
    await browser?.close().catch(() => undefined);
  }
  async tick(): Promise<void> {
    if (!this.page || this.state !== "login") return;
    if (Date.now() > this.deadline) { this.state = "expired"; await this.close(); return; }
    // O SSO pode concluir em uma página MON01 ou até em outro host. A URL
    // visível não comprova a sessão; a API operacional abaixo é a autoridade.

    // Usa o APIRequestContext do próprio BrowserContext. Ele compartilha os
    // cookies oficiais do login, mas não fica sujeito a CORS/CSP da página.
    // A sessão só é salva quando o endpoint real da coleta responde em JSON.
    const valid = await (async () => {
      try {
        const response = await this.page!.context().request.post(ADMINML.LIST_URL, {
          data: {
            serviceCenterId: this.cfg.serviceCenterId,
            siteId: "MLB",
            page: 1,
            pageSize: 1,
            order_by: "performance",
          },
          headers: { "Content-Type": "application/json" },
          failOnStatusCode: false,
          maxRedirects: 0,
          timeout: 10_000,
        });
        if (!response.ok() || !response.headers()["content-type"]?.includes("json")) return false;
        const body = await response.json().catch(() => null) as Record<string, unknown> | unknown[] | null;
        return Array.isArray(body) || (!!body && typeof body === "object"
          && ["documents", "content", "results", "routes", "data", "elements"]
            .some(key => Array.isArray((body as Record<string, unknown>)[key])));
      } catch { return false; }
    })();
    if (!valid) return;

    await salvarSessao(this.cfg.sessionFilePath, await this.page.context().storageState(), this.cfg.sessionKeyBase64);
    this.savedAt = Date.now();
    this.state = "saved";
    await this.close();
  }
  private current(): Page {
    if (!this.page || this.state !== "login" || Date.now() > this.deadline) throw new Error("Abra o login novamente.");
    return this.page;
  }
  async screen(): Promise<Buffer> { return this.current().screenshot({ type: "jpeg", quality: 65, timeout: 5000 }); }
  async action(body: Record<string, unknown>): Promise<void> {
    const page = this.current();
    if (body.type === "click" && typeof body.x === "number" && typeof body.y === "number"
      && body.x >= 0 && body.x <= 1 && body.y >= 0 && body.y <= 1) {
      await page.mouse.click(body.x * 1024, body.y * 768);
    } else if (body.type === "text" && typeof body.text === "string" && body.text.length <= 2048) {
      await page.keyboard.insertText(body.text);
    } else if (body.type === "key" && ["Enter", "Tab", "Backspace", "Control+A"].includes(String(body.key))) {
      await page.keyboard.press(String(body.key));
    } else if (body.type === "scroll" && (body.direction === 1 || body.direction === -1)) {
      await page.mouse.wheel(0, body.direction * 400);
    } else throw new Error("Comando inválido.");
  }
}
