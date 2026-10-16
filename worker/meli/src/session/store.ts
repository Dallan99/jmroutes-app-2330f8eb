// Persistência cifrada do storageState do AdminML.
// A sessão é decifrada SOMENTE em memória e nunca sai do processo.
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { decryptJson, encryptJson } from "../crypto.js";

export type StorageState = {
  cookies?: unknown[];
  origins?: unknown[];
};

export type SessaoStatus = "ok" | "aguardando_autenticacao" | "sessao_expirada";

export type LeituraSessao =
  | { status: "ok"; storageState: StorageState }
  | { status: "aguardando_autenticacao"; motivo: string };

export async function salvarSessao(
  path: string,
  storageState: StorageState,
  keyBase64: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // A renovação remota não deve entregar ao coletor um arquivo pela metade.
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, encryptJson(storageState, keyBase64), { mode: 0o600 });
  await rename(temporary, path);
}

export async function carregarSessao(path: string, keyBase64: string): Promise<LeituraSessao> {
  let blob: Buffer;
  try {
    blob = await readFile(path);
  } catch {
    return { status: "aguardando_autenticacao", motivo: "arquivo_de_sessao_inexistente" };
  }
  try {
    const state = decryptJson<StorageState>(blob, keyBase64);
    if (!state || typeof state !== "object" || !Array.isArray(state.cookies)) {
      return { status: "aguardando_autenticacao", motivo: "storage_state_invalido" };
    }
    return { status: "ok", storageState: state };
  } catch {
    // Nunca expõe conteúdo nem chave.
    return { status: "aguardando_autenticacao", motivo: "sessao_ilegivel" };
  }
}

