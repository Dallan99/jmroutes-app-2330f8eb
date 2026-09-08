import type { Page, Request, Response } from "playwright";
import { obterServiceCentersDaBase, type BaseJm } from "../config.js";
import { consultarResumosMetricasRotas, type ResumoMetricasServiceCenter } from "./metrics-summaries.js";
import { logger, mensagemSegura } from "../logger.js";
import type { MeliTransport } from "./list.js";

const MAX_LEAVES = 180;
const MAX_DEPTH = 8;
const SEGREDO = /authorization|cookie|token|secret|password|session|csrf|credential/i;
const PII = /name|address|email|phone|document|tracking|shipment|driver|receiver|recipient/i;

type DescobertaBase = {
  baseCode: string;
  serviceCenterId: string;
  siteId: string;
};

type ChamadaObservada = {
  endpoint: string;
  metodo: string;
  filtros: Record<string, unknown> | null;
  campos_numericos: Array<{ campo: string; valor: number }>;
  campos_booleanos: Array<{ campo: string; valor: boolean }>;
  status_http?: number;
};

function endpointSeguro(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "envios.adminml.com" || !parsed.pathname.startsWith("/logistics/")) return null;
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function sanitizarFiltros(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || value === undefined) return null;
  if (typeof value === "string") return value.length <= 100 ? value : `${value.slice(0, 100)}…`;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizarFiltros(item, depth + 1));
  if (typeof value !== "object") return null;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SEGREDO.test(key)) continue;
    output[key] = sanitizarFiltros(item, depth + 1);
  }
  return output;
}

function filtrosDoRequest(request: Request): Record<string, unknown> | null {
  const bruto = request.postData();
  if (!bruto) return null;
  try {
    const parsed = JSON.parse(bruto) as unknown;
    const seguro = sanitizarFiltros(parsed);
    return seguro && typeof seguro === "object" && !Array.isArray(seguro)
      ? seguro as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function extrairCamposAgregados(value: unknown) {
  const numeros: Array<{ campo: string; valor: number }> = [];
  const booleanos: Array<{ campo: string; valor: boolean }> = [];
  const pilha: Array<{ value: unknown; path: string; depth: number }> = [{ value, path: "$", depth: 0 }];

  while (pilha.length > 0 && numeros.length + booleanos.length < MAX_LEAVES) {
    const atual = pilha.pop();
    if (!atual || atual.depth > MAX_DEPTH) continue;
    const { path, depth } = atual;

    if (typeof atual.value === "number" && Number.isFinite(atual.value)) {
      numeros.push({ campo: path, valor: atual.value });
      continue;
    }
    if (typeof atual.value === "boolean") {
      booleanos.push({ campo: path, valor: atual.value });
      continue;
    }
    if (!atual.value || typeof atual.value !== "object") continue;

    if (Array.isArray(atual.value)) {
      atual.value.slice(0, 10).forEach((item, index) => {
        pilha.push({ value: item, path: `${path}[${index}]`, depth: depth + 1 });
      });
      continue;
    }

    for (const [key, item] of Object.entries(atual.value as Record<string, unknown>)) {
      // Não registra valores pessoais ou identificadores de pacotes; preserva apenas
      // a estrutura e os contadores numéricos necessários para a descoberta.
      if (PII.test(key) || SEGREDO.test(key)) continue;
      pilha.push({ value: item, path: `${path}.${key}`, depth: depth + 1 });
    }
  }

  return { numeros, booleanos };
}

async function registrarResposta(response: Response, chamadas: Map<string, ChamadaObservada>) {
  const endpoint = endpointSeguro(response.url());
  if (!endpoint) return;

  const chave = `${response.request().method()} ${endpoint}`;
  const chamada = chamadas.get(chave);
  if (!chamada) return;
  chamada.status_http = response.status();

  const contentType = (await response.allHeaders())["content-type"]?.toLowerCase() ?? "";
  if (!contentType.includes("json")) return;

  try {
    const corpo = await response.json() as unknown;
    const campos = extrairCamposAgregados(corpo);
    chamada.campos_numericos = campos.numeros;
    chamada.campos_booleanos = campos.booleanos;
  } catch (erro) {
    logger.warn("Não foi possível ler uma resposta JSON da descoberta.", {
      endpoint,
      erro: mensagemSegura(String((erro as Error)?.message ?? erro)),
    });
  }
}

/**
 * Observa somente as chamadas já feitas pela página oficial do AdminML.
 * Não manipula filtros, não consulta route-detail e não envia dados ao JMRoutes.
 */
export async function descobrirIndicadoresMonitoramento(page: Page, base: DescobertaBase): Promise<void> {
  const chamadas = new Map<string, ChamadaObservada>();

  const onRequest = (request: Request) => {
    const endpoint = endpointSeguro(request.url());
    if (!endpoint) return;
    const chave = `${request.method()} ${endpoint}`;
    chamadas.set(chave, {
      endpoint,
      metodo: request.method(),
      filtros: filtrosDoRequest(request),
      campos_numericos: [],
      campos_booleanos: [],
    });
  };
  const onResponse = (response: Response) => {
    void registrarResposta(response, chamadas);
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  try {
    // Recarrega a página já autenticada para capturar as chamadas oficiais de rede
    // geradas pelo próprio Monitoramento Last Mile.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8_000);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
  }

  // A observação é intencionalmente mantida apenas em memória: o modo de
  // descoberta não registra payloads, filtros, identificadores pessoais ou
  // evidências de rede. Os resultados consolidados são emitidos pelo chamador
  // exclusivamente no formato seguro por estação.
  void chamadas;
}

export type ResultadoDescobertaMonitoramento = {
  metricas: ResumoMetricasServiceCenter[];
  chamadasPorEstacao: number;
};

/**
 * Faz uma leitura estritamente de teste dos cards consolidados do Monitoramento
 * Last Mile. A chamada usa a sessão Playwright já autenticada, não percorre
 * route-detail, não autentica no JMRoutes e não persiste nenhuma informação.
 */
export async function coletarIndicadoresMonitoramento(
  page: Page,
  transport: MeliTransport,
  base: BaseJm,
): Promise<ResultadoDescobertaMonitoramento> {
  await descobrirIndicadoresMonitoramento(page, {
    baseCode: base.baseCode,
    serviceCenterId: base.serviceCenterId,
    siteId: base.siteId,
  });

  const serviceCenterIds = obterServiceCentersDaBase(base);
  const resposta = await consultarResumosMetricasRotas(transport, {
    baseCode: base.baseCode,
    baseNome: base.nome,
    serviceCenterId: base.serviceCenterId,
    serviceCenterIds,
    siteId: base.siteId,
  });

  if (!resposta.ok) {
    throw new Error(`Leitura consolidada não concluída: ${resposta.motivo}`);
  }

  return {
    metricas: resposta.valor,
    chamadasPorEstacao: 1,
  };
}
