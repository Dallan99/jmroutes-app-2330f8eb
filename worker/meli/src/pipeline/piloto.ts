// Piloto Meli isolado (PILOT_WRITE=true, exige DRY_RUN=true).
// Envia páginas, detalhes brutos e heartbeat SOMENTE para
// /api/public/meli/piloto/* — que grava apenas em meli_piloto_*.
// Nunca chama ingestão operacional, telemetria legada ou sincronizações.
import { createHash, createHmac, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { ADMINML, WORKER_VERSAO, type WorkerConfig } from "../config.js";
import { logger, mensagemSegura } from "../logger.js";
import { obterDetalheRota } from "../meli/detail.js";
import { executarComRetry, extrairRotasDaLista, jitter, sleep, type MeliTransport, type RotaLista } from "../meli/list.js";
import { filtrarRotasDaUnidade } from "./cycle.js";

type FetchLike = typeof fetch;
export type PilotoDeps = {
  cfg: WorkerConfig;
  transport: MeliTransport;
  instancia: string;
  fetchImpl?: FetchLike;
  dormir?: (ms: number) => Promise<void>;
  tamanhoLote?: number;
};

export type PilotoResumo = {
  ciclo_id: string;
  base: string;
  status: "concluido" | "parcial" | "erro";
  paginas_lidas: number;
  rotas_listadas: number;
  detalhes_enviados: number;
  pacotes_esperados: number;
  erros: number;
  sessao_expirada: boolean;
};

export function assinar(segredo: string, ts: string, corpo: string): string {
  return createHmac("sha256", segredo).update(`${ts}.${corpo}`).digest("hex");
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

export function instanciaPadrao(env: Record<string, string | undefined> = process.env): string {
  return env["FLY_MACHINE_ID"] ? `fly:${env["FLY_APP_NAME"] ?? "app"}:${env["FLY_MACHINE_ID"]}` : `local:${hostname()}`;
}

async function enviar(cfg: WorkerConfig, caminho: "ingest" | "heartbeat", corpo: unknown, f: FetchLike) {
  const json = JSON.stringify(corpo);
  const ts = String(Date.now());
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      const res = await f(`${cfg.jmrBaseUrl}/api/public/meli/piloto/${caminho}`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": `jmroutes-meli-worker/${WORKER_VERSAO}`, "x-jm-timestamp": ts, "x-jm-signature": assinar(cfg.pilotSecret, ts, json) },
        body: json,
      });
      if (res.ok) return { ok: true as const };
      const texto = mensagemSegura(await res.text().catch(() => ""));
      if (res.status < 500) return { ok: false as const, mensagem: `HTTP ${res.status}: ${texto}` };
    } catch (err) {
      if (tentativa === 3) return { ok: false as const, mensagem: mensagemSegura(String((err as Error)?.message ?? err)) };
    }
    await sleep(2000 * tentativa);
  }
  return { ok: false as const, mensagem: "falha após 3 tentativas" };
}

export async function enviarHeartbeat(
  cfg: WorkerConfig,
  dados: { instancia: string; sessao: "valida" | "expirada" | "ausente" | "desconhecida"; ultimoCicloId?: string; detalhe?: Record<string, unknown> },
  f: FetchLike = fetch,
) {
  const r = await enviar(cfg, "heartbeat", {
    instancia: dados.instancia,
    bases: cfg.bases.map((b) => b.baseCode),
    host: process.env["FLY_MACHINE_ID"] ? `fly-${process.env["FLY_MACHINE_ID"]}` : hostname(),
    regiao: process.env["FLY_REGION"] ?? undefined,
    ambiente: process.env["FLY_APP_NAME"] ? "fly" : "local",
    versao_worker: WORKER_VERSAO,
    dry_run: true,
    sessao_adminml: dados.sessao,
    sessao_verificada_em: dados.sessao === "valida" ? new Date().toISOString() : undefined,
    ultimo_ciclo_id: dados.ultimoCicloId,
    detalhe: dados.detalhe,
  }, f);
  if (!r.ok) logger.warn("Heartbeat do piloto não registrado.", { motivo: r.mensagem });
  return r;
}

function totalInformado(body: unknown): number | undefined {
  if (!body || typeof body !== "object") return undefined;
  const o = body as Record<string, unknown>;
  const paging = (o["paging"] ?? o["pagination"]) as Record<string, unknown> | undefined;
  for (const v of [paging?.["total"], o["total"], o["totalElements"], o["total_count"]]) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return undefined;
}

export async function executarCicloPiloto(deps: PilotoDeps): Promise<PilotoResumo> {
  const { cfg, transport, instancia } = deps;
  const f = deps.fetchImpl ?? fetch;
  const dormir = deps.dormir ?? sleep;
  const tamanhoLote = deps.tamanhoLote ?? 10;
  const cicloId = randomUUID();
  const iniciado = new Date().toISOString();
  const ciclo = {
    id: cicloId, base_codigo: cfg.baseCode, service_center: cfg.serviceCenterId, instancia,
    versao_worker: WORKER_VERSAO, dry_run: true as const, iniciado_em: iniciado,
  };
  const resumo: PilotoResumo = {
    ciclo_id: cicloId, base: cfg.baseCode, status: "concluido", paginas_lidas: 0, rotas_listadas: 0,
    detalhes_enviados: 0, pacotes_esperados: 0, erros: 0, sessao_expirada: false,
  };
  const erroEnvio = (m: string) => { resumo.erros += 1; logger.warn("Envio ao piloto falhou.", { base: cfg.baseCode, motivo: m }); };

  // 1) Paginação completa da lista, enviando cada página bruta
  const rotas: RotaLista[] = [];
  const vistos = new Set<string>();
  let fimNatural = false;
  let assinaturaAnterior = "";
  for (let page = 1; page <= ADMINML.MAX_PAGINAS; page += 1) {
    const res = await executarComRetry(() => transport.post(ADMINML.LIST_URL, {
      serviceCenterId: cfg.serviceCenterId, page, pageSize: ADMINML.PAGE_SIZE, siteId: cfg.siteId, order_by: "performance",
    }), { dormir });
    if (!res.ok) {
      resumo.sessao_expirada = res.motivo === "sessao_expirada";
      resumo.status = "erro";
      await enviar(cfg, "ingest", { ciclo: { ...ciclo, status: "erro", finalizado_em: new Date().toISOString(), erro: `lista página ${page}: ${res.motivo}` },
        erros: [{ etapa: "lista", codigo: res.motivo, mensagem: `falha na página ${page}` }] }, f);
      return resumo;
    }
    const pagina = extrairRotasDaLista(res.valor.body);
    const r = await enviar(cfg, "ingest", {
      ciclo: { ...ciclo, status: "em_andamento" },
      pagina: { recurso: "rotas", numero: page, offset: (page - 1) * ADMINML.PAGE_SIZE, total_informado: totalInformado(res.valor.body),
        itens: pagina.length, hash: hashPayload(res.valor.body), payload: res.valor.body },
    }, f);
    if (!r.ok) erroEnvio(r.mensagem);
    resumo.paginas_lidas = page;
    const assinatura = pagina.slice(0, 10).map((x) => x.routeId).join(",");
    if (pagina.length === 0 || (assinatura && assinatura === assinaturaAnterior)) { fimNatural = true; break; }
    assinaturaAnterior = assinatura;
    for (const x of pagina) if (!vistos.has(x.routeId)) { vistos.add(x.routeId); rotas.push(x); }
    if (pagina.length < ADMINML.PAGE_SIZE) { fimNatural = true; break; }
    await dormir(jitter());
  }

  const daUnidade = filtrarRotasDaUnidade(rotas, cfg.baseCode);
  resumo.rotas_listadas = daUnidade.length;
  resumo.pacotes_esperados = daUnidade.reduce((s, x) => s + (x.counters?.total ?? 0), 0);

  // 2) Detalhe de cada rota, enviado em lotes
  let lote: Array<Record<string, unknown>> = [];
  const descarregar = async () => {
    if (!lote.length) return;
    const r = await enviar(cfg, "ingest", { ciclo: { ...ciclo, status: "em_andamento" }, coletado_em: new Date().toISOString(), detalhes: lote }, f);
    if (r.ok) resumo.detalhes_enviados += lote.length; else erroEnvio(r.mensagem);
    lote = [];
  };
  const errosDetalhe: Array<Record<string, unknown>> = [];
  for (const rota of daUnidade) {
    const d = await obterDetalheRota(transport, rota.routeId, cfg.siteId, dormir);
    if (!d.ok) {
      if (d.motivo === "sessao_expirada") { resumo.sessao_expirada = true; break; }
      resumo.erros += 1;
      errosDetalhe.push({ etapa: "detalhe", codigo: d.motivo, mensagem: `rota ${rota.routeId}` });
      await dormir(jitter());
      continue;
    }
    lote.push({ route_id: rota.routeId, contadores: rota.counters ? { total: rota.counters.total, delivered: rota.counters.delivered } : undefined, payload: d.valor });
    if (lote.length >= tamanhoLote) await descarregar();
    await dormir(jitter(ADMINML.JITTER_MS));
  }
  await descarregar();

  // 3) Fechamento do ciclo com totais esperados
  resumo.status = resumo.sessao_expirada ? "erro" : resumo.erros > 0 || !fimNatural ? "parcial" : "concluido";
  const fim = await enviar(cfg, "ingest", {
    ciclo: { ...ciclo, status: resumo.status, finalizado_em: new Date().toISOString(),
      paginas_esperadas: fimNatural ? resumo.paginas_lidas : undefined,
      rotas_esperadas: resumo.rotas_listadas, pacotes_esperados: resumo.pacotes_esperados,
      erro: resumo.sessao_expirada ? "sessão AdminML expirada" : !fimNatural ? "limite de páginas atingido" : undefined },
    erros: errosDetalhe.slice(0, 200),
  }, f);
  if (!fim.ok) erroEnvio(fim.mensagem);
  return resumo;
}
