import { describe, expect, it } from "vitest";
import { encryptJson, decryptJson, generateKeyBase64, CryptoError, NONCE_BYTES, TAG_BYTES } from "../src/crypto";
import { carregarSessao } from "../src/session/store";
import { formatLog, redact } from "../src/logger";

describe("AES-256-GCM da sessão AdminML", () => {
  const key = generateKeyBase64();

  it("cifra e decifra o storageState", () => {
    const state = { cookies: [{ name: "x", value: "y" }], origins: [] };
    const blob = encryptJson(state, key);
    expect(blob.length).toBeGreaterThan(NONCE_BYTES + TAG_BYTES);
    expect(decryptJson(blob, key)).toEqual(state);
  });

  it("recusa chave inválida (tamanho)", () => {
    expect(() => encryptJson({}, Buffer.from("curta").toString("base64"))).toThrow(CryptoError);
  });

  it("recusa chave incorreta (falha de autenticação)", () => {
    const blob = encryptJson({ cookies: [] }, key);
    expect(() => decryptJson(blob, generateKeyBase64())).toThrow(CryptoError);
  });

  it("recusa ciphertext alterado", () => {
    const blob = encryptJson({ cookies: [] }, key);
    blob[NONCE_BYTES + 1] ^= 0xff;
    expect(() => decryptJson(blob, key)).toThrow(CryptoError);
  });
});

describe("arquivo de sessão inexistente", () => {
  it("retorna aguardando_autenticacao sem lançar", async () => {
    const r = await carregarSessao("/tmp/nao-existe-jmr-worker.enc", generateKeyBase64());
    expect(r.status).toBe("aguardando_autenticacao");
  });
});

describe("redação de logs", () => {
  it("oculta cookies, tokens e senhas", () => {
    const linha = formatLog("info", "ciclo", {
      cookies: [{ name: "session", value: "abc" }],
      password: "senha-ficticia-de-teste-123",
      authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc.def",
      payload: { stops: [1, 2, 3] },
      base: "ESP16",
    });
    expect(linha).not.toContain("senha-ficticia-de-teste-123");
    expect(linha).not.toContain("abc.def");
    expect(linha).toContain("REDACTED");
    expect(linha).toContain("ESP16");
  });

  it("redige bearer em strings livres", () => {
    const out = redact("falhou com Bearer eyJabcdefghijklmnopqrstuvwx") as string;
    expect(out).toContain("[REDACTED]");
  });
});
