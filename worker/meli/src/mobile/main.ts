import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { createMobileServer } from "./server.js";

// O mesmo processo de implantação possui o navegador e o volume dos workers.
// Não há upload de cookie pelo celular nem chave de sessão no frontend.
process.env["ADMINML_LOGIN_MODE"] = "mobile";
process.env["MOBILE_RECEIPT_PATH"] ??= "/data/mobile-receipt";
const cfg = loadConfig();
const server = createMobileServer(cfg);
const port = Number(process.env["PORT"] ?? "8080");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT inválida.");
// O coletor de Dashboard legado não respeita DRY_RUN: só o inicie em produção.
const entrypoints = cfg.dryRun ? ["../index.js"] : ["../index.js", "../monitoring-worker.js"];
const children = entrypoints.map(path => spawn(
  process.execPath, [fileURLToPath(new URL(path, import.meta.url))], { stdio: "inherit", env: process.env },
));
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  server.close();
  for (const child of children) child.kill("SIGTERM");
  const force = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 25_000);
  force.unref();
  void Promise.all(children.map(child => new Promise<void>(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  }))).then(() => process.exit(code));
}
for (const child of children) {
  child.on("error", () => stop(1));
  child.on("exit", () => { if (!stopping) stop(1); });
}
server.on("error", () => stop(1));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(0));
server.listen(port, "0.0.0.0", () => console.log("Iniciador móvel disponível; aguardando autenticação do operador."));
