import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Execucao } from "../telemetry/report.js";

export type Receipt = Pick<Execucao, "base_code" | "iniciado_em" | "finalizado_em" | "status" | "rotas_processadas" | "pacotes_enviados"> & { mode?: "operacional" | "piloto" };
export async function writeReceipt(prefix: string, execution: Receipt): Promise<void> {
  const path = `${prefix}.${encodeURIComponent(execution.base_code)}.json`;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const receipt: Receipt = {
    base_code: execution.base_code, iniciado_em: execution.iniciado_em,
    finalizado_em: execution.finalizado_em, status: execution.status,
    rotas_processadas: execution.rotas_processadas, pacotes_enviados: execution.pacotes_enviados,
    ...(execution.mode ? { mode: execution.mode } : {}),
  };
  await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
  await rename(temporary, path);
}
export async function readReceipt(prefix: string, base: string): Promise<Receipt | null> {
  try { return JSON.parse(await readFile(`${prefix}.${encodeURIComponent(base)}.json`, "utf8")); }
  catch { return null; }
}
export function collectionConfirmed(receipt: Receipt | null, savedAt: number, now = Date.now(), mode: "operacional" | "piloto" = "operacional"): boolean {
  return !!receipt && savedAt > 0 && receipt.status === "sucesso" && receipt.rotas_processadas > 0
    && (receipt.mode ?? "operacional") === mode
    && Date.parse(receipt.iniciado_em) >= savedAt
    && Date.parse(receipt.finalizado_em) <= now
    && now - Date.parse(receipt.finalizado_em) < 5 * 60_000;
}

/** Estado da sessão do Meli visto pelo coletor (para a página avisar quando expira). */
export type SessionStatus = { estado: "valida" | "expirada" | "ausente"; em: string; motivo?: string };
export function sessionStatusPath(prefix: string): string { return `${prefix}.sessao.json`; }
export async function writeSessionStatus(prefix: string, status: SessionStatus): Promise<void> {
  const path = sessionStatusPath(prefix);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(status), { mode: 0o600 });
  await rename(temporary, path);
}
export async function readSessionStatus(prefix: string): Promise<SessionStatus | null> {
  try { return JSON.parse(await readFile(sessionStatusPath(prefix), "utf8")); }
  catch { return null; }
}
