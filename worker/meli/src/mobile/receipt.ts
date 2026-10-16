import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { Execucao } from "../telemetry/report.js";

export type Receipt = Pick<Execucao, "base_code" | "iniciado_em" | "finalizado_em" | "status" | "rotas_processadas" | "pacotes_enviados">;
export async function writeReceipt(prefix: string, execution: Execucao): Promise<void> {
  const path = `${prefix}.${execution.base_code}.json`;
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  const receipt: Receipt = {
    base_code: execution.base_code, iniciado_em: execution.iniciado_em,
    finalizado_em: execution.finalizado_em, status: execution.status,
    rotas_processadas: execution.rotas_processadas, pacotes_enviados: execution.pacotes_enviados,
  };
  await writeFile(temporary, JSON.stringify(receipt), { mode: 0o600 });
  await rename(temporary, path);
}
export async function readReceipt(prefix: string, base: string): Promise<Receipt | null> {
  try { return JSON.parse(await readFile(`${prefix}.${base}.json`, "utf8")); }
  catch { return null; }
}
export function collectionConfirmed(receipt: Receipt | null, savedAt: number, now = Date.now()): boolean {
  return !!receipt && savedAt > 0 && receipt.status === "sucesso" && receipt.rotas_processadas > 0
    && Date.parse(receipt.iniciado_em) >= savedAt
    && Date.parse(receipt.finalizado_em) <= now
    && now - Date.parse(receipt.finalizado_em) < 5 * 60_000;
}
