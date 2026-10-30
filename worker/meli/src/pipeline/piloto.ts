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
import { writeReceipt } from "../mobile/receipt.js";

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

/** Tempo máximo de cada envio ao JM Routes (ms). */
const ENVIO_TIMEOUT_MS = 90_000;

async function enviar(cfg: WorkerConfig, caminho: "ingest" | "heartbeat", corpo: unknown, f: FetchLike) {
  const json = JSON.stringify(corpo);
  const ts = String(Date.now());
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      const res = await f(`${cfg.jmrBaseUrl}/api/public/meli/piloto/${caminho}`, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": `jmroutes-meli-worker/${WORKER_VERSAO}`, "x-jm-timestamp": ts, "x-jm-signature": assinar(cfg.pilotSecret, ts, json) },
        body: json,
        // Sem limite, um servidor travado prendia o coletor por muito tempo.
        signal: AbortSignal.timeout(ENVIO_TIMEOUT_MS),
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

  // 1) Lê todas as estações configuradas para a base e combina suas páginas.
  const rotas: RotaLista[] = [];
  const vistos = new Set<string>();
  const serviceCenters = cfg.serviceCenterIds.length ? cfg.serviceCenterIds : [cfg.serviceCenterId];
  let fimNatural = true;
  for (const serviceCenterId of serviceCenters) {
    let fimNaturalDaEstacao = false;
    let assinaturaAnterior = "";
    for (let page = 1; page <= ADMINML.MAX_PAGINAS; page += 1) {
      const res = await executarComRetry(() => transport.post(ADMINML.LIST_URL, {
        serviceCenterId, page, pageSize: ADMINML.PAGE_SIZE, siteId: cfg.siteId, order_by: "performance",
      }), { dormir });
      if (!res.ok) {
        resumo.sessao_expirada = res.motivo === "sessao_expirada";
        resumo.status = "erro";
        await enviar(cfg, "ingest", { ciclo: { ...ciclo, status: "erro", finalizado_em: new Date().toISOString(), erro: `lista ${serviceCenterId} página ${page}: ${res.motivo}` },
          erros: [{ etapa: "lista", codigo: res.motivo, mensagem: `falha na estação ${serviceCenterId}, página ${page}` }] }, f);
        return resumo;
      }
      const pagina = extrairRotasDaLista(res.valor.body);
      const numeroPagina = resumo.paginas_lidas + 1;
      const r = await enviar(cfg, "ingest", {
        ciclo: { ...ciclo, status: "em_andamento" },
        pagina: { recurso: "rotas", numero: numeroPagina, offset: (page - 1) * ADMINML.PAGE_SIZE, total_informado: totalInformado(res.valor.body),
          itens: pagina.length, hash: hashPayload(res.valor.body), payload: { service_center_id: serviceCenterId, rotas: pagina } },
      }, f);
      if (!r.ok) erroEnvio(r.mensagem);
      resumo.paginas_lidas = numeroPagina;
      const assinatura = pagina.slice(0, 10).map((x) => x.routeId).join(",");
      if (pagina.length === 0 || (assinatura && assinatura === assinaturaAnterior)) { fimNaturalDaEstacao = true; break; }
      assinaturaAnterior = assinatura;
      for (const x of pagina) if (!vistos.has(x.routeId)) { vistos.add(x.routeId); rotas.push(x); }
      if (pagina.length < ADMINML.PAGE_SIZE) { fimNaturalDaEstacao = true; break; }
      await dormir(jitter());
    }
    if (!fimNaturalDaEstacao) fimNatural = false;
  }

  const daUnidade = filtrarRotasDaUnidade(rotas, cfg.baseCode, cfg.serviceCenterIds);
  resumo.rotas_listadas = daUnidade.length;
  resumo.pacotes_esperados = daUnidade.reduce((s, x) => s + (x.counters?.total ?? 0), 0);

  // 2) Detalhe de cada rota, enviado em lotes
  let lote: Array<Record<string, unknown>> = [];
  const descarregar = async () => {
    if (!lote.length) return;
    const itens = lote;
    lote = [];
    const enviarDetalhes = async (grupo: Array<Record<string, unknown>>): Promise<void> => {
      const r = await enviar(cfg, "ingest", { ciclo: { ...ciclo, status: "em_andamento" }, coletado_em: new Date().toISOString(), detalhes: grupo }, f);
      if (r.ok) {
        resumo.detalhes_enviados += grupo.length;
        return;
      }
      const loteGrande = r.mensagem.startsWith("HTTP 413:") || (r.mensagem.startsWith("HTTP 422:") && r.mensagem.includes("statement timeout"));
      if (loteGrande && grupo.length > 1) {
        const meio = Math.ceil(grupo.length / 2);
        await enviarDetalhes(grupo.slice(0, meio));
        await enviarDetalhes(grupo.slice(meio));
        return;
      }
      erroEnvio(r.mensagem);
    };
    await enviarDetalhes(itens);
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
    lote.push({ route_id: rota.routeId, route_name: rota.routeName?.trim() || undefined, contadores: rota.counters ? { total: rota.counters.total, delivered: rota.counters.delivered, notDelivered: rota.counters.notDelivered, pending: rota.counters.pending } : undefined, payload: d.valor });
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
  if (!fim.ok) { erroEnvio(fim.mensagem); resumo.status = "parcial"; }
  const receiptPath = process.env["MOBILE_RECEIPT_PATH"];
  if (fim.ok && receiptPath) await writeReceipt(receiptPath, {
    mode: "piloto", base_code: cfg.baseCode, iniciado_em: iniciado,
    finalizado_em: new Date().toISOString(), status: resumo.status === "concluido" ? "sucesso" : "sucesso_parcial",
    rotas_processadas: resumo.detalhes_enviados, pacotes_enviados: 0,
  }).catch(() => undefined);
  return resumo;
}

