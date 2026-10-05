// JM Routes Importador — popup v0.2.2
// - Rota aberta: mantém fluxo v0.1 (endpoint route-detail, mesmo comportamento).
// - Sincronização multi-base: apenas UI; a lógica roda no background.js.

const JMROUTES_ORIGIN = "https://jmroutes.app";
const IMPORT_ENDPOINT = JMROUTES_ORIGIN + "/api/public/meli/importar-rota-bruta";
const SUPABASE_PROJECT_REF = "zfmwojloamwggahjxlyt";
const STORAGE_KEY = "sb-" + SUPABASE_PROJECT_REF + "-auth-token";

const MELI_DETAIL_PATH = /^\/logistics\/monitoring-distribution\/detail\/(\d+)\/?$/;
const MELI_HOST = "envios.adminml.com";

const $ = (id) => document.getElementById(id);
const els = {
  routeId: $("routeId"),
  status: $("status"),
  btnImportar: $("btnImportar"),
  btnConfirmar: $("btnConfirmar"),
  divergencia: $("divergencia"),
  divMeli: $("divMeli"),
  divExtr: $("divExtr"),
  divDif: $("divDif"),
  result: $("result"),
  // sync
  selBase: $("selBase"),
  syncFase: $("syncFase"),
  syncBaseAtual: $("syncBaseAtual"),
  syncPagina: $("syncPagina"),
  syncMensagem: $("syncMensagem"),
  syncProgressBar: $("syncProgressBar"),
  syncProgressFill: $("syncProgressFill"),
  syncEncontradas: $("syncEncontradas"),
  syncAtivas: $("syncAtivas"),
  syncProcessadas: $("syncProcessadas"),
  syncSucesso: $("syncSucesso"),
  syncDiv: $("syncDiv"),
  syncErros: $("syncErros"),
  syncIns: $("syncIns"),
  syncAtu: $("syncAtu"),
  syncInal: $("syncInal"),
  syncUltima: $("syncUltima"),
  syncProxima: $("syncProxima"),
  chkContinuo: $("chkContinuo"),
  selConcorrencia: $("selConcorrencia"),
  btnSincronizar: $("btnSincronizar"),
  btnCancelar: $("btnCancelar"),
  resumoPorBase: $("resumoPorBase"),
  resumoPorBaseList: $("resumoPorBaseList"),
  syncProblemas: $("syncProblemas"),
  syncProblemasList: $("syncProblemasList"),
};

let detectedRouteId = null;
let activeTabId = null;
let capturedPayload = null;

function setStatus(text, kind) {
  els.status.className = "status status-" + (kind || "idle");
  els.status.textContent = text;
}
function setStatusLoading(text) {
  els.status.className = "status status-info";
  els.status.innerHTML = '<span class="spinner"></span>' + escapeHtml(text);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function showResult(text) { els.result.textContent = text; els.result.classList.remove("hidden"); }
function hideDiv() { els.divergencia.classList.add("hidden"); els.btnConfirmar.classList.add("hidden"); }
function reset() { els.result.classList.add("hidden"); hideDiv(); }

// ============================================================
// Rota aberta (mantido)
// ============================================================
async function detectRoute() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) { setStatus("Abra uma rota no Mercado Livre.", "warn"); return; }
  activeTabId = tab.id;
  let u; try { u = new URL(tab.url); } catch { u = null; }
  if (!u || u.hostname !== MELI_HOST) {
    els.routeId.textContent = "—";
    setStatus("Abra os detalhes de uma rota no Mercado Livre.", "warn");
    return;
  }
  const m = u.pathname.match(MELI_DETAIL_PATH);
  if (!m) {
    els.routeId.textContent = "—";
    setStatus("Abra os detalhes de uma rota válida no Mercado Livre.", "warn");
    return;
  }
  detectedRouteId = m[1];
  els.routeId.textContent = detectedRouteId;
  els.btnImportar.disabled = false;
  setStatus("Pronto para importar.", "idle");
}

function fetchRouteDetailInPage(routeId) {
  return new Promise((resolve) => {
    const routeIdText = String(routeId);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const url = "https://envios.adminml.com/logistics/api/monitoring-route/route-detail?routeId=" +
      encodeURIComponent(routeIdText) + "&siteId=MLB";
    fetch(url, { method: "GET", credentials: "include", headers: { Accept: "application/json, text/plain, */*" }, signal: ctrl.signal })
      .then(async (r) => {
        clearTimeout(timer);
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (!r.ok) {
          const reason = r.status === 401 || r.status === 403 ? "sessao_expirada"
            : r.status === 404 ? "not_found" : "http";
          resolve({ ok: false, status: r.status, reason });
          return;
        }
        if (!ct.includes("json")) { resolve({ ok: false, reason: "content_type" }); return; }
        try {
          const parsed = await r.json();
          if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.stops) || String(parsed.id ?? "") !== routeIdText) {
            resolve({ ok: false, reason: "payload_shape" });
            return;
          }
          resolve({ ok: true, payload: parsed });
        } catch { resolve({ ok: false, reason: "parse" }); }
      })
      .catch((e) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: e && e.name === "AbortError" ? "timeout" : "network" });
      });
  });
}

async function captureFromMeli() {
  if (!detectedRouteId || !activeTabId) return null;
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: activeTabId },
    world: "MAIN",
    func: fetchRouteDetailInPage,
    args: [detectedRouteId],
  });
  return res && res.result ? res.result : { ok: false, reason: "script" };
}

async function getJmroutesAccessToken() {
  const tabs = await chrome.tabs.query({ url: [JMROUTES_ORIGIN + "/*", "https://www.jmroutes.app/*"] });
  let tab = tabs[0];
  if (!tab) {
    tab = await chrome.tabs.create({ url: JMROUTES_ORIGIN + "/", active: false });
    await new Promise((r) => setTimeout(r, 1500));
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
      args: [STORAGE_KEY],
    });
    return res && res.result ? res.result : null;
  } catch { return null; }
}

async function sendToJmroutes(payload, confirmar) {
  const token = await getJmroutesAccessToken();
  if (!token) return { httpOk: false, body: { ok: false, codigo: "nao_autenticado", mensagem: "Faça login no JMRoutes e tente novamente." } };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const r = await fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ payload, confirmar_divergencia: !!confirmar }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    let body = null; try { body = await r.json(); } catch { /* ignore */ }
    return { httpOk: r.ok, status: r.status, body };
  } catch (e) {
    clearTimeout(timer);
    return { httpOk: false, body: { ok: false, codigo: e && e.name === "AbortError" ? "timeout" : "rede", mensagem: "Não foi possível enviar a rota." } };
  }
}

function renderResultado(body) {
  showResult([
    "Rota importada com sucesso",
    "Rota: " + (body.route_id ?? detectedRouteId ?? "—"),
    "Inseridos: " + (body.inseridos ?? 0),
    "Atualizados: " + (body.atualizados ?? 0),
    "Inalterados: " + (body.inalterados ?? 0),
    "Inválidos: " + (body.invalidos ?? 0),
  ].join("\n"));
  setStatus("Importação concluída.", "success");
}
function renderDivergencia(body) {
  els.divMeli.textContent = body.total_meli ?? "—";
  els.divExtr.textContent = body.total_extraido ?? "—";
  els.divDif.textContent = body.diferenca ?? "—";
  els.divergencia.classList.remove("hidden");
  els.btnConfirmar.classList.remove("hidden");
  setStatus("Aguardando confirmação de divergência.", "warn");
}

async function importar(confirmar) {
  reset();
  els.btnImportar.disabled = true;
  els.btnConfirmar.disabled = true;
  try {
    let payload = capturedPayload;
    if (!payload) {
      setStatusLoading("Capturando dados do Meli…");
      const capt = await captureFromMeli();
      if (!capt || !capt.ok) {
        if (capt?.status === 401 || capt?.status === 403 || capt?.reason === "sessao_expirada") setStatus("Sua sessão do Mercado Livre expirou.", "error");
        else if (capt?.status === 404 || capt?.reason === "not_found") setStatus("Rota não encontrada no Meli.", "error");
        else if (capt?.reason === "timeout") setStatus("Tempo esgotado ao consultar o Meli.", "error");
        else if (capt?.reason === "content_type") setStatus("O Meli respondeu HTML em vez de JSON.", "error");
        else setStatus("Não foi possível capturar a rota. Tente novamente.", "error");
        return;
      }
      payload = capt.payload;
      capturedPayload = payload;
    }
    setStatusLoading("Enviando ao JMRoutes…");
    const { status, body } = await sendToJmroutes(payload, confirmar);
    if (!body) { setStatus("Não foi possível importar a rota.", "error"); return; }
    if (body.requer_confirmacao) { renderDivergencia(body); return; }
    if (body.ok) { renderResultado(body); capturedPayload = null; return; }
    if (status === 401 || body.codigo === "nao_autenticado") { setStatus(body.mensagem || "Faça login no JMRoutes.", "error"); return; }
    if (status === 403 || body.codigo === "sem_permissao") { setStatus(body.mensagem || "Sem permissão.", "error"); return; }
    setStatus(body.mensagem || "Não foi possível importar a rota.", "error");
  } finally {
    els.btnImportar.disabled = !detectedRouteId;
    els.btnConfirmar.disabled = false;
  }
}

// ============================================================
// Sincronização multi-base (UI)
// ============================================================
function fmtHora(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleTimeString("pt-BR"); } catch { return "—"; }
}
let proximaTimer = null;
function atualizarProxima(proximaEm) {
  if (proximaTimer) { clearInterval(proximaTimer); proximaTimer = null; }
  if (!proximaEm) { els.syncProxima.textContent = "—"; return; }
  const tick = () => {
    const s = Math.max(0, Math.round((proximaEm - Date.now()) / 1000));
    els.syncProxima.textContent = s + "s";
    if (s <= 0 && proximaTimer) { clearInterval(proximaTimer); proximaTimer = null; }
  };
  tick();
  proximaTimer = setInterval(tick, 1000);
}

function renderResumoPorBase(porBase) {
  if (!Array.isArray(porBase) || porBase.length === 0) {
    els.resumoPorBase.classList.add("hidden");
    els.resumoPorBaseList.innerHTML = "";
    return;
  }
  const teveAtividade = porBase.some((b) => b.encontradas > 0 || b.processadas > 0 || b.erros > 0);
  if (!teveAtividade) {
    els.resumoPorBase.classList.add("hidden");
    return;
  }
  els.resumoPorBase.classList.remove("hidden");
  els.resumoPorBaseList.innerHTML = porBase.map((b) => `
    <div class="base-item">
      <div class="base-title">${escapeHtml(b.facilityId)} — ${escapeHtml(b.nome)} <span class="mono base-sc">(${escapeHtml(b.serviceCenterId)})</span></div>
      <div class="base-stats mono">
        Enc: <b>${b.encontradas}</b> · Ativ: <b>${b.ativas}</b> · Suc: <b>${b.sucesso}</b> · Div: <b>${b.divergencias}</b> · Err: <b>${b.erros}</b><br/>
        Pág: <b>${b.paginas}</b> · Ins: <b>${b.pacotes_inseridos}</b> · Atu: <b>${b.pacotes_atualizados}</b> · Inal: <b>${b.pacotes_inalterados}</b>
      </div>
      ${b.mensagem ? `<div class="base-msg">${escapeHtml(b.mensagem)}</div>` : ""}
    </div>
  `).join("");
}

function renderState(s) {
  if (!s) return;
  els.chkContinuo.checked = !!s.continuous;
  els.selConcorrencia.value = String(s.concurrency || 1);
  if (s.baseSelecionada && els.selBase.value !== s.baseSelecionada) {
    els.selBase.value = s.baseSelecionada;
  }
  const p = s.progress || {};
  els.syncFase.textContent = p.fase || "parado";

  if (p.baseAtual) {
    const total = p.baseAtualTotal || 1;
    els.syncBaseAtual.textContent =
      `${p.baseAtualIdx || 1}/${total} — ${p.baseAtual.facilityId} · ${p.baseAtual.nome} (${p.baseAtual.serviceCenterId})`;
  } else {
    els.syncBaseAtual.textContent = "—";
  }
  els.syncPagina.textContent = p.paginaAtual ? String(p.paginaAtual) : "—";

  els.syncEncontradas.textContent = p.encontradas ?? 0;
  els.syncAtivas.textContent = p.ativas ?? 0;
  els.syncProcessadas.textContent = p.processadas ?? 0;
  els.syncSucesso.textContent = p.sucesso ?? 0;
  els.syncDiv.textContent = p.divergencias ?? 0;
  els.syncErros.textContent = p.erros ?? 0;
  els.syncIns.textContent = p.pacotes_inseridos ?? 0;
  els.syncAtu.textContent = p.pacotes_atualizados ?? 0;
  els.syncInal.textContent = p.pacotes_inalterados ?? 0;
  els.syncUltima.textContent = fmtHora(p.ultimaSync);
  atualizarProxima(p.proximaEm);

  const rowRate = document.getElementById("rowRateLimit");
  if (rowRate) {
    const pausadas = Object.entries(s.basesPausadas || {})
      .filter(([, n]) => Number(n) > 0)
      .map(([b, n]) => `${b} (${n})`);
    const partes = [`Ciclos pulados: ${s.ciclosPulados ?? p.ciclosPulados ?? 0}`];
    if (pausadas.length) partes.push(`Bases pausadas: ${pausadas.join(", ")}`);
    rowRate.textContent = partes.join(" · ");
  }

  const rodando = s.running || ["listando", "sincronizando", "iniciando"].includes(p.fase);
  els.btnSincronizar.disabled = rodando;
  if (rodando) {
    els.btnSincronizar.textContent = p.fase === "listando" ? "Listando…" : (p.fase === "sincronizando" ? "Sincronizando…" : "Iniciando…");
  } else {
    els.btnSincronizar.textContent = els.btnSincronizar.dataset.textoOriginal || "Sincronizar";
  }
  els.selBase.disabled = rodando;
  els.btnCancelar.classList.toggle("hidden", !rodando);
  els.syncProgressBar.classList.toggle("hidden", !rodando);
  const pct = p.total > 0 ? Math.round((p.processadas / p.total) * 100) : 0;
  els.syncProgressFill.style.width = pct + "%";

  if (p.mensagem) {
    els.syncMensagem.classList.remove("hidden");
    els.syncMensagem.className = "status " + (p.fase === "pausado" ? "status-error" : (p.fase === "cancelado" ? "status-warn" : "status-info"));
    els.syncMensagem.textContent = p.mensagem;
  } else {
    els.syncMensagem.classList.add("hidden");
  }

  renderResumoPorBase(p.porBase);

  const probs = Array.isArray(p.problemas) ? p.problemas : [];
  if (probs.length === 0) {
    els.syncProblemas.classList.add("hidden");
    els.syncProblemasList.innerHTML = "";
  } else {
    els.syncProblemas.classList.remove("hidden");
    els.syncProblemasList.innerHTML = probs.slice(-20).map((x) =>
      `<li>${escapeHtml(x.base || "")} · ${escapeHtml(String(x.routeId))} — ${escapeHtml(String(x.motivo))}</li>`
    ).join("");
  }
}

async function fetchState() {
  try {
    const r = await chrome.runtime.sendMessage({ type: "jm/getState" });
    if (r && r.state) renderState(r.state);
  } catch { /* ignore */ }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "jm/state") renderState(msg.state);
});

document.addEventListener("DOMContentLoaded", () => {
  detectRoute();
  els.btnImportar.addEventListener("click", () => importar(false));
  els.btnConfirmar.addEventListener("click", () => importar(true));

  els.btnSincronizar.addEventListener("click", async () => {
    // Feedback visual imediato (antes de qualquer resposta do background).
    els.btnSincronizar.disabled = true;
    els.btnSincronizar.dataset.textoOriginal = els.btnSincronizar.textContent || "Sincronizar";
    els.btnSincronizar.textContent = "Iniciando…";
    els.syncFase.textContent = "iniciando";
    els.syncMensagem.classList.remove("hidden");
    els.syncMensagem.className = "status status-info";
    els.syncMensagem.innerHTML = '<span class="spinner"></span>Iniciando sincronização…';
    try {
      const resp = await chrome.runtime.sendMessage({ type: "jm/syncOnce" });
      if (!resp) throw new Error("O background da extensão não respondeu.");
      if (resp.ok === false) throw new Error(resp.error || resp.mensagem || "Não foi possível iniciar a sincronização.");
      // A partir daqui, os broadcasts jm/state assumem a UI.
    } catch (e) {
      const msg = (e && e.message) ? String(e.message) : "Erro interno da extensão.";
      els.syncMensagem.className = "status status-error";
      els.syncMensagem.textContent = msg;
      els.syncFase.textContent = "erro";
      els.btnSincronizar.disabled = false;
      els.btnSincronizar.textContent = els.btnSincronizar.dataset.textoOriginal || "Sincronizar";
    }
  });
  els.btnCancelar.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "jm/cancel" }).catch(() => {});
  });
  els.chkContinuo.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({ type: "jm/setContinuous", value: e.target.checked }).catch(() => {});
  });
  els.selConcorrencia.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({ type: "jm/setConcurrency", value: Number(e.target.value) }).catch(() => {});
  });
  els.selBase.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({ type: "jm/setBase", value: e.target.value }).catch(() => {});
  });

  fetchState();
  setInterval(fetchState, 2000);
});

window.addEventListener("unload", () => { capturedPayload = null; });
