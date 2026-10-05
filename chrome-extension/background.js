// JM Routes Importador — service worker v0.3.2
// - Sincronização multi-base JM (ESP15..ESP18) via POST get-routes-list.
// - Consulta cada base separadamente (o Meli mostra no máximo 3 estações na tela;
//   respeitamos o limite operacional e nunca enviamos 4 SSPs juntos).
// - Modo contínuo com chrome.alarms — sem sobreposição de ciclos (ciclo_pulado).
// - Rate limit client-side: concorrência 1, espaçamento 500ms + jitter,
//   retry com Retry-After / backoff 3s-6s-12s, circuit breaker por base (>30%).
// - Sem cookies/tokens/payloads/dados pessoais em storage. Apenas configs e stats agregadas.


self.addEventListener("install", () => { self.skipWaiting?.(); });
self.addEventListener("activate", () => { self.clients?.claim?.(); });

// ============================================================
// Config das 4 bases JM (fonte única de verdade)
// ============================================================
const BASES_JM = [
  { facilityId: "ESP15", nome: "Ibiúna",          serviceCenterId: "SSP20" },
  { facilityId: "ESP16", nome: "Guarujá",         serviceCenterId: "SSP15" },
  { facilityId: "ESP17", nome: "Embu-Guaçu",      serviceCenterId: "SSP56" },
  { facilityId: "ESP18", nome: "Franco da Rocha", serviceCenterId: "SSP25" },
];
const BASE_TODAS = "TODAS";

// ============================================================
// Endpoints / limites
// ============================================================
const JMROUTES_ORIGIN = "https://jmroutes.app";
const IMPORT_ENDPOINT = JMROUTES_ORIGIN + "/api/public/meli/importar-rota-bruta";
const RISK_IMPORT_ENDPOINT = JMROUTES_ORIGIN + "/api/public/meli/importar-risco";
const SUPABASE_PROJECT_REF = "zfmwojloamwggahjxlyt";
const SB_STORAGE_KEY = "sb-" + SUPABASE_PROJECT_REF + "-auth-token";
const MELI_HOST = "envios.adminml.com";
const LIST_URL = "https://envios.adminml.com/logistics/api/monitoring/get-routes-list";
const DETAIL_URL_BASE = "https://envios.adminml.com/logistics/api/monitoring-route/route-detail";

const CYCLE_INTERVAL_MS = 30_000;
const MAX_ROTAS_POR_BASE = 500;
const MAX_PAGINAS = 20;
const PAGE_SIZE = 50;
// Fase 1 — rate limit client-side (sem backend).
const WORKERS_DEFAULT = 1;
const DEFAULT_CONCURRENCY = WORKERS_DEFAULT;
const ITEM_SPACING_MS = 500;
const ITEM_JITTER_MS = 250;
const SEND_TIMEOUT_MS = 60_000;
const RETRY_BACKOFF_MS = [3_000, 6_000, 12_000];
const MAX_RETRIES = RETRY_BACKOFF_MS.length;
const RETRY_AFTER_MAX_MS = 60_000;
const CIRCUIT_FAIL_RATIO = 0.3;
const CIRCUIT_PAUSE_CICLOS = 2;
const RISK_SYNC_INTERVAL_MS = 15 * 60_000;

function randomInt(max) {
  return Math.floor(Math.random() * (max + 1));
}
function espacamento() {
  return ITEM_SPACING_MS + randomInt(ITEM_JITTER_MS);
}


// ============================================================
// Estado em memória (não persistido)
// ============================================================
function novoResumoBase(b) {
  return {
    facilityId: b.facilityId,
    nome: b.nome,
    serviceCenterId: b.serviceCenterId,
    paginas: 0,
    encontradas: 0,
    ativas: 0,
    processadas: 0,
    sucesso: 0,
    divergencias: 0,
    erros: 0,
    pacotes_inseridos: 0,
    pacotes_atualizados: 0,
    pacotes_inalterados: 0,
    pacotes_invalidos: 0,
    problemas: [],
    mensagem: "",
  };
}
function novoProgresso() {
  return {
    fase: "parado", // parado|listando|sincronizando|aguardando|pausado|cancelado
    baseSelecionada: BASE_TODAS,
    baseAtualIdx: 0,
    baseAtualTotal: 0,
    baseAtual: null,      // {facilityId,nome,serviceCenterId}
    paginaAtual: 0,
    encontradasBase: 0,
    processadasBase: 0,
    totalBase: 0,
    // totais consolidados
    encontradas: 0, ativas: 0, processadas: 0, sucesso: 0, divergencias: 0, erros: 0,
    pacotes_inseridos: 0, pacotes_atualizados: 0, pacotes_inalterados: 0, pacotes_invalidos: 0,
    total: 0,
    problemas: [], // [{routeId, motivo, base}]
    porBase: BASES_JM.map(novoResumoBase),
    ultimaSync: null,
    proximaEm: null,
    duracaoMs: null,
    ciclosPulados: 0,
    syncBatchId: null,
    mensagem: "",
  };
}

const state = {
  running: false,
  continuous: false,
  concurrency: DEFAULT_CONCURRENCY,
  baseSelecionada: BASE_TODAS,
  cancelToken: 0,
  meliTabId: null,
  ciclosPulados: 0,
  // circuit breaker: facilityId -> ciclos restantes de pausa
  basesPausadas: {},
  progress: novoProgresso(),
};

function novoSyncBatchId() {
  try {
    if (self.crypto && self.crypto.randomUUID) return self.crypto.randomUUID();
  } catch { /* ignore */ }
  return "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ============================================================
// Persistência (apenas config e stats agregadas)
// ============================================================
async function loadConfig() {
  try {
    const c = await chrome.storage.local.get(["continuous", "concurrency", "baseSelecionada", "ultimaSync", "ultimaSyncRisco"]);
    if (typeof c.continuous === "boolean") state.continuous = c.continuous;
    if ([1, 2, 4, 6].includes(c.concurrency)) state.concurrency = c.concurrency;
    if (typeof c.baseSelecionada === "string") state.baseSelecionada = c.baseSelecionada;
    if (typeof c.ultimaSync === "number") state.progress.ultimaSync = c.ultimaSync;
    if (typeof c.ultimaSyncRisco === "number") state.ultimaSyncRisco = c.ultimaSyncRisco;
  } catch { /* ignore */ }
}
async function saveConfig() {
  try {
    await chrome.storage.local.set({
      continuous: state.continuous,
      concurrency: state.concurrency,
      baseSelecionada: state.baseSelecionada,
      ultimaSync: state.progress.ultimaSync,
      ultimaSyncRisco: state.ultimaSyncRisco || null,
    });
  } catch { /* ignore */ }
}

// Progresso volátil, para o popup reabrir sem perder estado.
async function salvarProgressoSessao() {
  try {
    if (!chrome.storage.session) return;
    await chrome.storage.session.set({ progress: state.progress });
  } catch { /* ignore */ }
}


// ============================================================
// Broadcast
// ============================================================
function snapshot() {
  return {
    running: state.running,
    continuous: state.continuous,
    concurrency: state.concurrency,
    baseSelecionada: state.baseSelecionada,
    bases: BASES_JM,
    ciclosPulados: state.ciclosPulados,
    basesPausadas: { ...state.basesPausadas },
    progress: {
      ...state.progress,
      ciclosPulados: state.ciclosPulados,
      problemas: state.progress.problemas.slice(-40),
      porBase: state.progress.porBase.map((r) => ({ ...r, problemas: r.problemas.slice(-20) })),
    },
  };
}
function broadcast() {
  chrome.runtime.sendMessage({ type: "jm/state", state: snapshot() }).catch(() => {});
  salvarProgressoSessao();
}

// ============================================================
// Utilitários
// ============================================================
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function chromeAsync(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

async function findMeliTab() {
  const tabs = await chrome.tabs.query({ url: `https://${MELI_HOST}/*` });
  return tabs[0] || null;
}

async function runInMeliTab(tabId, func, args) {
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func,
    args: args || [],
  });
  return res && res.result;
}

// ============================================================
// Fetch da lista (executado dentro da aba do Meli)
// ============================================================
function fetchListInPage(payload) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    fetch("https://envios.adminml.com/logistics/api/monitoring/get-routes-list", {
      method: "POST",
      credentials: "include",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).then(async (r) => {
      clearTimeout(t);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) {
        const reason = (r.status === 401 || r.status === 403) ? "sessao_expirada"
          : r.status === 429 ? "rate_limit"
          : "http";
        resolve({ ok: false, status: r.status, reason });
        return;
      }
      if (!ct.includes("json")) { resolve({ ok: false, reason: "content_type" }); return; }
      try {
        const body = await r.json();
        resolve({ ok: true, body });
      } catch { resolve({ ok: false, reason: "parse" }); }
    }).catch((e) => {
      clearTimeout(t);
      resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
    });
  });
}

// ============================================================
// Fetch detalhe (executado dentro da aba do Meli)
// ============================================================
function fetchRouteDetailInPage(routeId) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const url = "https://envios.adminml.com/logistics/api/monitoring-route/route-detail?routeId=" +
      encodeURIComponent(String(routeId)) + "&siteId=MLB";
    fetch(url, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*" },
      signal: ctrl.signal,
    }).then(async (r) => {
      clearTimeout(t);
      const ct = (r.headers.get("content-type") || "").toLowerCase();
      if (!r.ok) {
        const reason = (r.status === 401 || r.status === 403) ? "sessao_expirada"
          : r.status === 404 ? "not_found"
          : r.status === 429 ? "rate_limit"
          : "http";
        resolve({ ok: false, status: r.status, reason });
        return;
      }
      if (!ct.includes("json")) { resolve({ ok: false, reason: "content_type" }); return; }
      try {
        const payload = await r.json();
        if (!payload || typeof payload !== "object" || !Array.isArray(payload.stops) || String(payload.id ?? "") !== String(routeId)) {
          resolve({ ok: false, reason: "payload_shape" });
          return;
        }
        resolve({ ok: true, payload });
      } catch { resolve({ ok: false, reason: "parse" }); }
    }).catch((e) => {
      clearTimeout(t);
      resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
    });
  });
}

// ============================================================
// Classificação semanal de risco do Rostering
// Executada na página autenticada e devolve somente os campos necessários;
// nomes de motoristas e demais dados da exportação não saem do AdminML.
// ============================================================
function fetchRiskInPage(inicio, fim) {
  return new Promise((resolve) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const params = new URLSearchParams({
      startDate: inicio,
      endDate: fim,
      stepType: "last_mile",
      channel: "logistics",
    });
    fetch("https://envios.adminml.com/logistics/rostering/api/services/details?" + params.toString(), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json, text/plain, */*", loadType: "export" },
      signal: ctrl.signal,
    }).then(async (r) => {
      clearTimeout(t);
      if (!r.ok) {
        resolve({ ok: false, status: r.status, reason: (r.status === 401 || r.status === 403) ? "sessao_expirada" : "http" });
        return;
      }
      let body;
      try { body = await r.json(); }
      catch { resolve({ ok: false, reason: "parse" }); return; }

      const fila = [body];
      let servicos = [];
      let guarda = 0;
      while (fila.length && guarda < 100) {
        guarda += 1;
        const atual = fila.shift();
        if (Array.isArray(atual)) {
          if (atual.some((v) => v && typeof v === "object" && Array.isArray(v.assignments) && v.startDate)) {
            servicos = atual;
            break;
          }
          fila.push(...atual);
        } else if (atual && typeof atual === "object") fila.push(...Object.values(atual));
      }

      const bool = (v) => {
        if (typeof v === "boolean") return v;
        const s = String(v ?? "").trim().toLowerCase();
        if (["true", "1", "yes", "sim", "sí"].includes(s)) return true;
        if (["false", "0", "no", "não", "nao"].includes(s)) return false;
        return null;
      };
      const unicas = new Map();
      for (const servico of servicos) {
        const data = String(servico.startDate || "").slice(0, 10);
        const facility = String(servico.facility || "").trim();
        const transportadora = String(servico.carrierName || "").trim();
        for (const assignment of (Array.isArray(servico.assignments) ? servico.assignments : [])) {
          const metadata = assignment?.planning_route?.metadata;
          const cluster = String(metadata?.name || metadata?.original_route_name || "").trim();
          const altoRisco = bool(metadata?.is_risky);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || !facility || !transportadora || !cluster || altoRisco === null) continue;
          const linha = {
            data,
            facility,
            cluster,
            transportadora,
            altoRisco,
            regiao: String(metadata?.region || "").trim() || null,
            idServico: String(assignment?.ID || "").trim() || null,
          };
          unicas.set([data, facility.toLowerCase(), cluster.toLowerCase(), transportadora.toLowerCase()].join("|"), linha);
        }
      }
      const linhas = Array.from(unicas.values());
      resolve(linhas.length ? { ok: true, linhas } : { ok: false, reason: "payload_shape" });
    }).catch((e) => {
      clearTimeout(t);
      resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
    });
  });
}

function semanaAtual() {
  const agora = new Date();
  const inicio = new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
  inicio.setUTCDate(inicio.getUTCDate() - ((inicio.getUTCDay() + 6) % 7));
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 6);
  return { inicio: inicio.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

async function sincronizarRiscoAutomatico(tabId, token) {
  if (state.ultimaSyncRisco && Date.now() - state.ultimaSyncRisco < RISK_SYNC_INTERVAL_MS) return { ok: true, pulado: true };
  const semana = semanaAtual();
  const coleta = await runInMeliTab(tabId, fetchRiskInPage, [semana.inicio, semana.fim]);
  if (!coleta || !coleta.ok) return { ok: false, origem: "meli", reason: coleta?.reason || "risco_indisponivel" };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const resposta = await fetch(RISK_IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ linhas: coleta.linhas }),
      signal: ctrl.signal,
    });
    let body = null;
    try { body = await resposta.json(); } catch { /* ignore */ }
    if (!resposta.ok || !body?.ok) return { ok: false, origem: "jmroutes", status: resposta.status, reason: body?.codigo || "falha_importacao_risco" };
    state.ultimaSyncRisco = Date.now();
    await saveConfig();
    return { ok: true, processadas: body.processadas || coleta.linhas.length, encontradas: body.encontradas || 0 };
  } catch (e) {
    return { ok: false, origem: "jmroutes", reason: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally { clearTimeout(timer); }
}

// ============================================================
// Extração dos routeIds a partir da resposta da lista
// ============================================================
function extractRouteIdsFromListBody(body) {
  const bucketKeys = ["documents", "content", "results", "routes", "data", "elements"];
  const buckets = [];
  const stack = [body];
  let visited = 0;
  while (stack.length && visited < 5000) {
    const cur = stack.pop();
    visited += 1;
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      let looks = 0;
      for (const it of cur.slice(0, 5)) {
        if (it && typeof it === "object" && (("id" in it) || ("routeId" in it) || ("route_id" in it))) looks += 1;
      }
      if (looks >= Math.min(cur.length, 3)) buckets.push(cur);
      for (const it of cur) stack.push(it);
      continue;
    }
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === "object") {
        if (bucketKeys.includes(k) && Array.isArray(v)) buckets.unshift(v);
        stack.push(v);
      }
    }
  }
  const ids = [];
  const items = [];
  const seen = new Set();
  for (const b of buckets) {
    for (const it of b) {
      const raw = it && (it.id ?? it.routeId ?? it.route_id);
      if (raw === undefined || raw === null) continue;
      const s = String(raw);
      if (!/^\d+$/.test(s)) continue;
      if (seen.has(s)) continue;
      seen.add(s);
      ids.push(s);
      items.push(it);
    }
  }
  return { ids, items };
}

function readTotals(body) {
  const out = { totalDocuments: null, hasNext: null, last: null };
  const stack = [body];
  let visited = 0;
  while (stack.length && visited < 2000) {
    const cur = stack.pop();
    visited += 1;
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) continue;
    if (out.totalDocuments === null && typeof cur.totalDocuments === "number") out.totalDocuments = cur.totalDocuments;
    if (out.hasNext === null && typeof cur.hasNext === "boolean") out.hasNext = cur.hasNext;
    if (out.last === null && typeof cur.last === "boolean") out.last = cur.last;
    for (const k of Object.keys(cur)) {
      const v = cur[k];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return out;
}

function isRotaAtiva(item) {
  if (!item || typeof item !== "object") return true;
  const finishDate = Number(item.finishDate ?? item.finish_date ?? 0);
  const executedFinishDate = Number(item.executedFinishDate ?? item.executed_finish_date ?? 0);
  if (finishDate > 0) return false;
  if (executedFinishDate > 0) return false;
  const status = String(item.status || item.substatus || "").toLowerCase();
  const finalizados = ["finished", "finalizada", "finalizado", "completed", "cancelled", "canceled", "cancelada"];
  if (finalizados.some((s) => status.includes(s))) {
    const pending = Number(item?.counters?.pending ?? item?.counters?.pendingDelivery ?? -1);
    if (pending === 0) return false;
  }
  return true;
}

// ============================================================
// Coleta paginada de uma base
// ============================================================
async function coletarListaBase(tabId, base, resumoBase, isCancelled) {
  const seen = new Set();
  const ids = [];
  const items = [];
  let totalDocs = null;
  let assinaturaAnterior = "";

  for (let page = 1; page <= MAX_PAGINAS; page += 1) {
    if (isCancelled()) return { ok: false, reason: "cancelado" };
    const payload = {
      serviceCenterId: base.serviceCenterId,
      page,
      pageSize: PAGE_SIZE,
      siteId: "MLB",
      order_by: "performance",
    };
    state.progress.paginaAtual = page;
    broadcast();

    const res = await runInMeliTab(tabId, fetchListInPage, [payload]);
    if (!res || !res.ok) {
      if (res && res.reason === "rate_limit") {
        await sleep(60_000);
        page -= 1; // repete a mesma página
        continue;
      }
      return { ok: false, reason: res?.reason || "list_http", status: res?.status };
    }
    resumoBase.paginas = page;

    const body = res.body;
    const { ids: pIds, items: pItems } = extractRouteIdsFromListBody(body);
    const totals = readTotals(body);
    if (totalDocs === null && totals.totalDocuments !== null) totalDocs = totals.totalDocuments;

    const assinaturaAtual = pIds.slice(0, 10).join(",");
    if (pIds.length === 0) break;
    if (assinaturaAtual && assinaturaAtual === assinaturaAnterior) break;
    assinaturaAnterior = assinaturaAtual;

    let novos = 0;
    for (let k = 0; k < pIds.length; k += 1) {
      if (seen.has(pIds[k])) continue;
      seen.add(pIds[k]);
      ids.push(pIds[k]);
      items.push(pItems[k]);
      novos += 1;
      if (ids.length >= MAX_ROTAS_POR_BASE) break;
    }
    if (ids.length >= MAX_ROTAS_POR_BASE) break;
    if (novos === 0) break;
    if (totals.hasNext === false) break;
    if (totals.last === true) break;
    if (totalDocs !== null && ids.length >= totalDocs) break;
  }

  return { ok: true, ids, items, totalDocs };
}

// ============================================================
// Token JMRoutes
// ============================================================
async function getJmroutesAccessToken() {
  const tabs = await chrome.tabs.query({ url: [JMROUTES_ORIGIN + "/*", "https://www.jmroutes.app/*"] });
  let tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: JMROUTES_ORIGIN + "/", active: false });
    await sleep(1500);
  }
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (key) => {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) return null;
          const parsed = JSON.parse(raw);
          return parsed && parsed.access_token ? parsed.access_token : null;
        } catch { return null; }
      },
      args: [SB_STORAGE_KEY],
    });
    return res && res.result ? res.result : null;
  } catch { return null; }
}

function retryAfterMs(resp) {
  try {
    const h = resp && resp.headers ? resp.headers.get("retry-after") : null;
    if (!h) return null;
    const secs = Number(String(h).trim());
    if (Number.isFinite(secs) && secs >= 0) {
      return Math.min(secs * 1000, RETRY_AFTER_MAX_MS);
    }
    const when = Date.parse(String(h));
    if (Number.isFinite(when)) {
      return Math.min(Math.max(when - Date.now(), 0), RETRY_AFTER_MAX_MS);
    }
  } catch { /* ignore */ }
  return null;
}

async function enviarJmroutesUmaVez(payload, token, extras) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const r = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({
        payload,
        confirmar_divergencia: false,
        base_codigo: extras && extras.base_codigo ? extras.base_codigo : null,
        sync_batch_id: extras && extras.sync_batch_id ? extras.sync_batch_id : null,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let body = null;
    try { body = await r.json(); } catch { body = null; }
    return { httpOk: r.ok, status: r.status, body, retryAfterMs: retryAfterMs(r) };
  } catch (e) {
    clearTimeout(timer);
    return {
      httpOk: false,
      status: 0,
      body: { ok: false, codigo: e && e.name === "AbortError" ? "timeout" : "rede" },
      retryAfterMs: null,
    };
  }
}

// Retry com Retry-After (429/503) ou backoff 3s -> 6s -> 12s (máx. 3 tentativas).
// 401/403 nunca é retentado — indica sessão expirada.
async function enviarJmroutes(payload, token, extras, isCancelled) {
  let tentativa = 0;
  let ultima = null;
  while (tentativa <= MAX_RETRIES) {
    ultima = await enviarJmroutesUmaVez(payload, token, extras);
    if (isCancelled && isCancelled()) return ultima;
    const s = ultima.status;
    if (s === 401 || s === 403) return ultima;
    const deveRetentar =
      s === 429 || s === 503 || (s >= 500 && s < 600) || s === 0;
    if (!deveRetentar) return ultima;
    if (tentativa === MAX_RETRIES) return ultima;
    const espera = ultima.retryAfterMs != null ? ultima.retryAfterMs : RETRY_BACKOFF_MS[tentativa];
    await sleep(espera);
    tentativa += 1;
  }
  return ultima;
}

// ============================================================
// Sincronização de uma base
// ============================================================
async function sincronizarBase(tabId, base, token, isCancelled) {
  const prog = state.progress;
  const resumo = prog.porBase.find((r) => r.facilityId === base.facilityId);
  resumo.mensagem = "";
  resumo.problemas = [];
  prog.baseAtual = { facilityId: base.facilityId, nome: base.nome, serviceCenterId: base.serviceCenterId };
  prog.paginaAtual = 0;
  prog.encontradasBase = 0;
  prog.processadasBase = 0;
  prog.totalBase = 0;
  broadcast();

  // Listagem paginada
  const lista = await coletarListaBase(tabId, base, resumo, isCancelled);
  if (isCancelled()) return { cancelled: true };
  if (!lista.ok) {
    resumo.mensagem = "Falha na lista (" + (lista.reason || "erro") + ")";
    if (lista.reason === "sessao_expirada") return { sessaoMeliCaida: true };
    return { erroBase: true };
  }
  resumo.encontradas = lista.ids.length;
  prog.encontradasBase = lista.ids.length;
  prog.encontradas += lista.ids.length;

  // Filtro de ativas
  const ativos = [];
  for (let i = 0; i < lista.ids.length; i += 1) {
    if (isRotaAtiva(lista.items[i])) ativos.push(lista.ids[i]);
  }
  resumo.ativas = ativos.length;
  prog.ativas += ativos.length;
  prog.totalBase = ativos.length;
  prog.total += ativos.length;
  broadcast();

  // Fila com concorrência (apenas dentro da base atual)
  let idx = 0;
  let sessaoMeliCaida = false;
  let sessaoJmroutesCaida = false;

  async function worker() {
    while (!isCancelled()) {
      const myIdx = idx++;
      if (myIdx >= ativos.length) return;
      const routeId = ativos[myIdx];

      const detalhe = await runInMeliTab(tabId, fetchRouteDetailInPage, [routeId]);
      if (isCancelled()) return;
      if (!detalhe || !detalhe.ok) {
        resumo.erros += 1;
        prog.erros += 1;
        resumo.processadas += 1;
        prog.processadas += 1;
        prog.processadasBase += 1;
        const motivo = detalhe?.reason === "sessao_expirada" ? "sessão Meli expirada"
          : detalhe?.reason === "not_found" ? "HTTP 404"
          : detalhe?.reason === "timeout" ? "timeout"
          : detalhe?.reason === "rate_limit" ? "rate limit"
          : detalhe?.reason === "content_type" ? "HTML no lugar do JSON"
          : detalhe?.reason || "erro";
        resumo.problemas.push({ routeId, motivo });
        prog.problemas.push({ routeId, motivo, base: base.facilityId });
        if (detalhe?.reason === "sessao_expirada") { sessaoMeliCaida = true; broadcast(); return; }
        broadcast();
        await sleep(espacamento());
        continue;
      }

      const env = await enviarJmroutes(
        detalhe.payload,
        token,
        { base_codigo: base.facilityId, sync_batch_id: prog.syncBatchId },
        isCancelled,
      );
      if (isCancelled()) return;
      resumo.processadas += 1;
      prog.processadas += 1;
      prog.processadasBase += 1;

      if (!env.body) {
        resumo.erros += 1; prog.erros += 1;
        resumo.problemas.push({ routeId, motivo: "sem resposta do JMRoutes" });
        prog.problemas.push({ routeId, motivo: "sem resposta do JMRoutes", base: base.facilityId });
      } else if (env.status === 401 || env.status === 403 || env.body.codigo === "nao_autenticado") {
        sessaoJmroutesCaida = true;
        resumo.erros += 1; prog.erros += 1;
        resumo.problemas.push({ routeId, motivo: "sessão JMRoutes expirada" });
        prog.problemas.push({ routeId, motivo: "sessão JMRoutes expirada", base: base.facilityId });
        broadcast();
        return;
      } else if (env.body.requer_confirmacao) {
        resumo.divergencias += 1; prog.divergencias += 1;
        resumo.problemas.push({ routeId, motivo: "divergência" });
        prog.problemas.push({ routeId, motivo: "divergência", base: base.facilityId });
      } else if (env.body.ok) {
        resumo.sucesso += 1; prog.sucesso += 1;
        resumo.pacotes_inseridos += Number(env.body.inseridos || 0);
        resumo.pacotes_atualizados += Number(env.body.atualizados || 0);
        resumo.pacotes_inalterados += Number(env.body.inalterados || 0);
        resumo.pacotes_invalidos += Number(env.body.invalidos || 0);
        prog.pacotes_inseridos += Number(env.body.inseridos || 0);
        prog.pacotes_atualizados += Number(env.body.atualizados || 0);
        prog.pacotes_inalterados += Number(env.body.inalterados || 0);
        prog.pacotes_invalidos += Number(env.body.invalidos || 0);
      } else {
        resumo.erros += 1; prog.erros += 1;
        const motivo = env.body.mensagem || env.body.codigo || "erro";
        resumo.problemas.push({ routeId, motivo });
        prog.problemas.push({ routeId, motivo, base: base.facilityId });
      }
      broadcast();
      await sleep(espacamento());
    }
  }

  const workers = [];
  for (let i = 0; i < state.concurrency; i += 1) workers.push(worker());
  await Promise.all(workers);

  // Circuit breaker: >30% de falhas nesta base pausa a base por 2 ciclos.
  if (resumo.processadas > 0 && resumo.erros / resumo.processadas > CIRCUIT_FAIL_RATIO) {
    state.basesPausadas[base.facilityId] = CIRCUIT_PAUSE_CICLOS;
    resumo.mensagem = "Base pausada por " + CIRCUIT_PAUSE_CICLOS + " ciclos (mais de 30% de falhas).";
    broadcast();
  }

  return { sessaoMeliCaida, sessaoJmroutesCaida };
}

// ============================================================
// Ciclo principal (multi-base)
// ============================================================
function basesParaExecutar() {
  if (state.baseSelecionada === BASE_TODAS) return BASES_JM.slice();
  const b = BASES_JM.find((x) => x.facilityId === state.baseSelecionada);
  return b ? [b] : BASES_JM.slice();
}

async function executarCiclo() {
  if (state.running) return { ok: false, reason: "ja_em_execucao" };
  state.running = true;
  state.cancelToken += 1;
  const myToken = state.cancelToken;
  const isCancelled = () => myToken !== state.cancelToken;

  const t0 = Date.now();
  state.progress = novoProgresso();
  state.progress.baseSelecionada = state.baseSelecionada;
  state.progress.syncBatchId = novoSyncBatchId();
  state.progress.ciclosPulados = state.ciclosPulados;
  const prog = state.progress;
  prog.fase = "listando";
  broadcast();


  try {
    const tab = await findMeliTab();
    if (!tab) {
      prog.fase = "pausado";
      prog.mensagem = "Abra uma aba autenticada em envios.adminml.com.";
      broadcast();
      return { ok: false };
    }
    state.meliTabId = tab.id;

    const token = await getJmroutesAccessToken();
    if (!token) {
      prog.fase = "pausado";
      prog.mensagem = "Faça login no JMRoutes e tente novamente.";
      state.continuous = false;
      await saveConfig();
      broadcast();
      return { ok: false };
    }

    const bases = basesParaExecutar();
    prog.baseAtualTotal = bases.length;
    // reset porBase p/ mostrar somente as escolhidas destacadas (mantém todas visíveis)
    prog.fase = "sincronizando";
    broadcast();

    let sessaoMeliCaida = false;
    let sessaoJmroutesCaida = false;

    for (let i = 0; i < bases.length; i += 1) {
      if (isCancelled()) { prog.fase = "cancelado"; broadcast(); return { ok: false }; }
      prog.baseAtualIdx = i + 1;
      const baseAtual = bases[i];
      // Circuit breaker: base em pausa por excesso de falhas.
      const pausaRestante = state.basesPausadas[baseAtual.facilityId] || 0;
      if (pausaRestante > 0) {
        state.basesPausadas[baseAtual.facilityId] = pausaRestante - 1;
        const resumoPausado = prog.porBase.find((r) => r.facilityId === baseAtual.facilityId);
        if (resumoPausado) {
          resumoPausado.mensagem =
            "Base em pausa por excesso de falhas (" + (pausaRestante - 1) + " ciclo(s) restante(s)).";
        }
        broadcast();
        continue;
      }
      const r = await sincronizarBase(tab.id, baseAtual, token, isCancelled);
      if (r.cancelled) { prog.fase = "cancelado"; broadcast(); return { ok: false }; }
      if (r.sessaoMeliCaida) { sessaoMeliCaida = true; break; }
      if (r.sessaoJmroutesCaida) { sessaoJmroutesCaida = true; break; }
      // r.erroBase: registrado no resumo da base, continua para as próximas
    }

    // Executa depois das rotas: assim até rotas novas deste mesmo ciclo já
    // existem no JMRoutes quando a classificação é conciliada.
    if (!isCancelled() && !sessaoMeliCaida && !sessaoJmroutesCaida) {
      const risco = await sincronizarRiscoAutomatico(tab.id, token);
      if (!risco.ok) {
        prog.mensagem = "Rotas atualizadas, mas a classificação de risco será tentada novamente: " + (risco.reason || "erro");
      }
    }


    // Backoff automático
    if (prog.total > 0 && prog.erros / prog.total > 0.3) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Sincronização contínua pausada: mais de 30% das rotas falharam.";
    }
    if (sessaoMeliCaida) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Sua sessão do Mercado Livre expirou. Faça login novamente.";
    }
    if (sessaoJmroutesCaida) {
      state.continuous = false;
      await saveConfig();
      prog.mensagem = "Faça login no JMRoutes e tente novamente.";
    }

    prog.duracaoMs = Date.now() - t0;
    prog.ultimaSync = Date.now();
    await saveConfig();
    prog.fase = state.continuous ? "aguardando" : "parado";
    prog.baseAtual = null;
    prog.proximaEm = state.continuous ? Date.now() + CYCLE_INTERVAL_MS : null;
    broadcast();
    return { ok: true };
  } catch (e) {
    prog.fase = "pausado";
    prog.mensagem = "Erro inesperado: " + (e && e.message ? e.message : "desconhecido");
    broadcast();
    return { ok: false };
  } finally {
    state.running = false;
    if (state.continuous) {
      chrome.alarms.create("jm-sync-cycle", { delayInMinutes: CYCLE_INTERVAL_MS / 60000 });
    }
  }
}

function cancelarCiclo() {
  state.cancelToken += 1;
  state.running = false;
  state.progress.fase = "cancelado";
  state.progress.mensagem = "Cancelado pelo usuário.";
  broadcast();
}

// ============================================================
// Alarms para modo contínuo
// ============================================================
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "jm-sync-cycle") return;
  if (!state.continuous) return;
  if (state.running) {
    // Nunca sobrepor ciclos: registra e aguarda o próximo alarme.
    state.ciclosPulados += 1;
    state.progress.ciclosPulados = state.ciclosPulados;
    broadcast();
    chrome.alarms.create("jm-sync-cycle", { delayInMinutes: CYCLE_INTERVAL_MS / 60000 });
    return;
  }
  executarCiclo();
});


async function ativarContinuo() {
  state.continuous = true;
  await saveConfig();
  if (!state.running) executarCiclo();
}
async function desativarContinuo() {
  state.continuous = false;
  await saveConfig();
  chrome.alarms.clear("jm-sync-cycle").catch(() => {});
  if (state.progress.fase === "aguardando") {
    state.progress.fase = "parado";
    state.progress.proximaEm = null;
    broadcast();
  }
}

// ============================================================
// Mensageria
// ============================================================
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;
  (async () => {
    switch (message.type) {
      case "jm/getState":
        sendResponse({ state: snapshot() });
        break;
      case "JM_START_SYNC":
      case "jm/syncOnce":
        if (state.running) {
          sendResponse({ ok: false, error: "Já existe uma sincronização em andamento." });
        } else {
          // Dispara assíncrono; o próprio ciclo publica o estado por broadcast.
          Promise.resolve().then(() => { executarCiclo().catch(() => {}); });
          sendResponse({ ok: true });
        }
        break;
      case "jm/cancel":
        cancelarCiclo();
        sendResponse({ ok: true });
        break;
      case "jm/setContinuous":
        if (message.value) await ativarContinuo();
        else await desativarContinuo();
        sendResponse({ ok: true, state: snapshot() });
        break;
      case "jm/setConcurrency":
        if ([1, 2, 4, 6].includes(message.value)) {
          state.concurrency = message.value;
          await saveConfig();
        }
        sendResponse({ ok: true, state: snapshot() });
        break;
      case "jm/setBase": {
        const v = String(message.value || BASE_TODAS);
        if (v === BASE_TODAS || BASES_JM.some((b) => b.facilityId === v)) {
          state.baseSelecionada = v;
          await saveConfig();
        }
        sendResponse({ ok: true, state: snapshot() });
        break;
      }
      default:
        return;
    }
  })().catch((e) => { try { sendResponse({ ok: false, error: String(e && e.message || e) }); } catch { /* ignore */ } });
  return true;
});

// Bootstrap — sincronização automática, sem depender de clique.
// Se o usuário nunca configurou nada, o modo contínuo já vem ligado.
async function bootstrap() {
  await loadConfig();
  const cfg = await chrome.storage.local.get(["continuous"]);
  if (typeof cfg.continuous !== "boolean") {
    state.continuous = true;
    await saveConfig();
  }
  if (state.continuous) {
    chrome.alarms.create("jm-sync-cycle", { delayInMinutes: CYCLE_INTERVAL_MS / 60000 });
    if (!state.running) executarCiclo();
  }
}

bootstrap();
chrome.runtime.onStartup.addListener(() => { bootstrap(); });
chrome.runtime.onInstalled.addListener(() => { bootstrap(); });
