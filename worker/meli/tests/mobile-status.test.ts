import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readSessionStatus, writeSessionStatus } from "../src/mobile/receipt";
import { mobilePage } from "../src/mobile/page";

describe("aviso de sessão do iniciador", () => {
  it("grava e lê o estado da sessão visto pelo coletor", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sessao-status-"));
    try {
      const prefixo = join(dir, "mobile-receipt");
      expect(await readSessionStatus(prefixo)).toBeNull();
      await writeSessionStatus(prefixo, { estado: "expirada", em: "2026-10-29T12:00:00.000Z", motivo: "sessao_expirada" });
      expect(await readSessionStatus(prefixo)).toEqual({ estado: "expirada", em: "2026-10-29T12:00:00.000Z", motivo: "sessao_expirada" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("a página tem o aviso de login confirmado e de sessão expirada", () => {
    const html = mobilePage("n");
    expect(html).toContain('id="banner"');
    expect(html).toContain("Login confirmado às");
    expect(html).toContain("A sessão do Meli expirou às");
    expect(html).toContain("bases já atualizaram depois do login");
  });
});
