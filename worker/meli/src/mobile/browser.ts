import type { Browser, Page } from "playwright";
import { ADMINML, type WorkerConfig } from "../config.js";
import { salvarSessao } from "../session/store.js";

// Uma única tela oficial remota; senhas/cookies não são retornados pela API.
export class MobileBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private busy = false;
  private deadline = 0;
  private probing = false;
  private lastProbe = 0;
  /** Intervalo mínimo entre provas por navegação (ms). */
  probeIntervalMs = 15_000;
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
      // A aba da prova de sessão não substitui a tela do operador.
      context.on("page", page => { if (!this.probing) this.page = page; });
      this.lastProbe = 0;
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

    // Usa o mesmo critério do login manual do worker. O endpoint de
    // listagem mudou com o Monitoramento Distribution e pode responder com
    // uma estrutura diferente mesmo após o login. O detalhe com routeId=0
    // é usado somente como prova de autenticação: sucesso ou 404 de rota
    // inexistente confirmam que o AdminML reconheceu a sessão. Redirecionamentos,
    // 401/403 e falhas 5xx não são aceitos.
    const valid = await (async () => {
      try {
        const response = await this.page!.context().request.get(
          `${ADMINML.DETAIL_URL}?routeId=0&siteId=${encodeURIComponent(this.cfg.siteId)}`,
          {
            failOnStatusCode: false,
            maxRedirects: 0,
            timeout: 10_000,
          },
        );
        const status = response.status();
        return (status >= 200 && status < 300) || status === 404;
      } catch { return false; }
    })();
    // O endpoint de detalhe pode responder 400/5xx mesmo com sessão válida.
    // Nesse caso usa a mesma prova do coletor (abrirSessaoAdminML): abrir o
    // Monitoramento e permanecer no host do AdminML, sem ir para o login.
    // A prova navega numa aba separada, então é espaçada para não bloquear a tela.
    if (!valid) {
      if (Date.now() - this.lastProbe < this.probeIntervalMs) return;
      this.lastProbe = Date.now();
      if (!await this.navigationProof()) return;
      if (!this.page || this.state !== "login") return;
    }

    await salvarSessao(this.cfg.sessionFilePath, await this.page.context().storageState(), this.cfg.sessionKeyBase64);
    this.savedAt = Date.now();
    this.state = "saved";
    await this.close();
  }
  private async navigationProof(): Promise<boolean> {
    const context = this.page?.context();
    if (!context) return false;
    let probe: Page | null = null;
    this.probing = true;
    try {
      probe = await context.newPage();
      await probe.goto(`https://${ADMINML.HOST}/logistics/monitoring`, { waitUntil: "domcontentloaded", timeout: 15_000 });
      // Redirecionamentos feitos por script após o carregamento também contam.
      await probe.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
      const url = new URL(probe.url());
      return url.hostname.toLowerCase() === ADMINML.HOST && url.pathname.startsWith("/logistics/");
    } catch { return false; }
    finally {
      this.probing = false;
      await probe?.close().catch(() => undefined);
    }
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
