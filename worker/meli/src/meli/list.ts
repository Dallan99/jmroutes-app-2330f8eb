// Coleta da LISTA de rotas no AdminML (endpoint já comprovado pela extensão).
// Transporte abstraído em `MeliTransport` para permitir, no futuro, substituir
// Playwright por um endpoint corporativo autorizado (ex.: XPT) sem tocar no
// pipeline de ingestão do JMRoutes.
import { ADMINML } from "../config.js";
import { logger } from "../logger.js";

export type MeliResposta = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
  ok: boolean;
};

export interface MeliTransport {
  post(url: string, body: unknown): Promise<MeliResposta>;
  get(url: string, headers?: Record<string, string>): Promise<MeliResposta>;
}

export type FalhaMotivo =
  | "sessao_expirada"
  | "rate_limit"
  | "http"
  | "timeout"
  | "network"
  | "content_type"
  | "parse"
  | "payload_shape"
  | "not_found";

export type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: FalhaMotivo; status?: number };

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function jitter(base = ADMINML.JITTER_MS): number {
  return base + Math.floor(Math.random() * base);
}

export function classificarStatus(status: number): FalhaMotivo {
  if (status === 401 || status === 403) return "sessao_expirada";
  if (status === 429) return "rate_limit";
  if (status === 404) return "not_found";
  return "http";
}

/** Status que justificam backoff. 401/403 NUNCA são retentados. */
export const STATUS_RETENTAVEIS = [429, 500, 502, 503, 504];

export function parseRetryAfter(headers: Record<string, string>): number | null {
  const raw = headers["retry-after"] ?? headers["Retry-After"];
  if (!raw) return null;
  const segundos = Number(raw);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.min(segundos * 1000, 300_000);
  const data = Date.parse(raw);
  if (!Number.isNaN(data)) return Math.max(0, Math.min(data - Date.now(), 300_000));
  return null;
}

export type RetryOpts = {
  tentativas?: number;
  baseDelayMs?: number;
  dormir?: (ms: number) => Promise<void>;
};

/**
 * Executa uma chamada com backoff progressivo. Respeita Retry-After.
 * 401/403 encerram imediatamente (sem retry, sem repetição contínua).
 */
export async function executarComRetry(
  fn: () => Promise<MeliResposta>,
  opts: RetryOpts = {},
): Promise<Resultado<MeliResposta>> {
  const tentativas = opts.tentativas ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;
  const dormir = opts.dormir ?? sleep;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    let res: MeliResposta;
    try {
      res = await fn();
    } catch (err) {
      const nome = (err as Error)?.name;
      const motivo: FalhaMotivo = nome === "AbortError" || nome === "TimeoutError" ? "timeout" : "network";
      if (tentativa === tentativas) return { ok: false, motivo };
      await dormir(baseDelay * 2 ** (tentativa - 1) + jitter());
      continue;
    }

    if (res.status === 401 || res.status === 403) {
      return { ok: false, motivo: "sessao_expirada", status: res.status };
    }
    if (res.ok) return { ok: true, valor: res };

    if (!STATUS_RETENTAVEIS.includes(res.status) || tentativa === tentativas) {
      return { ok: false, motivo: classificarStatus(res.status), status: res.status };
    }

    const retryAfter = parseRetryAfter(res.headers);
    const espera = retryAfter ?? baseDelay * 2 ** (tentativa - 1) + jitter();
    logger.warn("Backoff AdminML.", { status: res.status, tentativa, esperaMs: espera });
    await dormir(espera);
  }
  return { ok: false, motivo: "http" };
}

export type RotaLista = {
  routeId: string;
  /** Nome operacional exibido pelo AdminML (ex.: VR3_AM1). */
  routeName?: string | null;
  status?: string | null;
  substatus?: string | null;
  facilityId?: string | null;
  serviceCenterId?: string | null;
  type?: string | null;
  isDeliveryRoute?: boolean;
  isPickupRoute?: boolean;
  isDeliveryPickupRoute?: boolean;
  counters?: {
    total: number;
    delivered: number;
    notDelivered: number;
    pending: number;
    totalBags: number;
  };
};

function numeroSeguro(valor: unknown): number {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
}

const BUCKET_KEYS = ["documents", "content", "results", "routes", "data", "elements"];

/** Extrai routeIds da resposta da lista, tolerando variações de envelope. */
export function extrairRotasDaLista(body: unknown): RotaLista[] {
  const encontrados: RotaLista[] = [];
  const vistos = new Set<string>();
  const pilha: unknown[] = [body];
  let guarda = 0;

  while (pilha.length > 0 && guarda < 5000) {
    guarda += 1;
    const atual = pilha.pop();
    if (!atual || typeof atual !== "object") continue;

    if (Array.isArray(atual)) {
      for (const item of atual) pilha.push(item);
      continue;
    }

    const obj = atual as Record<string, unknown>;
    const id = obj["routeId"] ?? obj["route_id"] ?? obj["id"];
    if ((typeof id === "string" || typeof id === "number") && String(id).trim() !== "") {
      const key = String(id);
      if (/^\d+$/.test(key) && !vistos.has(key)) {
        vistos.add(key);
        encontrados.push({
          routeId: key,
          routeName:
            typeof obj["routeName"] === "string"
              ? obj["routeName"]
              : typeof obj["route_name"] === "string"
                ? obj["route_name"]
                : typeof obj["name"] === "string"
                  ? obj["name"]
                  : typeof obj["cluster"] === "string"
                    ? obj["cluster"]
                    : null,
          status: typeof obj["status"] === "string" ? (obj["status"] as string) : null,
          substatus: typeof obj["substatus"] === "string" ? (obj["substatus"] as string) : null,
          facilityId:
            typeof obj["facilityId"] === "string"
              ? obj["facilityId"]
              : typeof obj["facility_id"] === "string"
                ? obj["facility_id"]
                : null,
          serviceCenterId:
            typeof obj["serviceCenterId"] === "string"
              ? obj["serviceCenterId"]
              : typeof obj["service_center_id"] === "string"
                ? obj["service_center_id"]
                : null,
          type: typeof obj["type"] === "string" ? obj["type"] : null,
          isDeliveryRoute: obj["isDeliveryRoute"] === true,
          isPickupRoute: obj["isPickupRoute"] === true,
          isDeliveryPickupRoute: obj["isDeliveryPickupRoute"] === true,
          counters: obj["counters"] && typeof obj["counters"] === "object"
            ? {
                total: numeroSeguro((obj["counters"] as Record<string, unknown>)["total"]),
                delivered: numeroSeguro((obj["counters"] as Record<string, unknown>)["delivered"]),
                notDelivered: numeroSeguro((obj["counters"] as Record<string, unknown>)["notDelivered"]),
                pending: numeroSeguro((obj["counters"] as Record<string, unknown>)["pending"]),
                totalBags: numeroSeguro((obj["counters"] as Record<string, unknown>)["totalBags"]),
              }
            : undefined,
        });
      }
    }

    for (const k of BUCKET_KEYS) if (obj[k]) pilha.push(obj[k]);
    for (const v of Object.values(obj)) if (v && typeof v === "object") pilha.push(v);
  }
  return encontrados;
}

export type ListarOpts = {
  serviceCenterId: string;
  siteId: string;
  pageSize?: number;
  maxPaginas?: number;
  dormir?: (ms: number) => Promise<void>;
};

/** Coleta paginada da lista de rotas de uma base. */
export async function listarRotas(
  transport: MeliTransport,
  opts: ListarOpts,
): Promise<Resultado<{ rotas: RotaLista[]; paginas: number }>> {
  const pageSize = opts.pageSize ?? ADMINML.PAGE_SIZE;
  const maxPaginas = opts.maxPaginas ?? ADMINML.MAX_PAGINAS;
  const dormir = opts.dormir ?? sleep;

  const rotas: RotaLista[] = [];
  const vistos = new Set<string>();
  let assinaturaAnterior = "";
  let paginas = 0;

  for (let page = 1; page <= maxPaginas; page += 1) {
    const payload = {
      serviceCenterId: opts.serviceCenterId,
      page,
      pageSize,
      siteId: opts.siteId,
      order_by: "performance",
    };
    const res = await executarComRetry(() => transport.post(ADMINML.LIST_URL, payload), { dormir });
    if (!res.ok) return res;
    paginas = page;

    const pagina = extrairRotasDaLista(res.valor.body);
    if (pagina.length === 0) break;

    const assinatura = pagina
      .slice(0, 10)
      .map((r) => r.routeId)
      .join(",");
    if (assinatura && assinatura === assinaturaAnterior) break;
    assinaturaAnterior = assinatura;

    let novos = 0;
    for (const r of pagina) {
      if (vistos.has(r.routeId)) continue;
      vistos.add(r.routeId);
      rotas.push(r);
      novos += 1;
    }
    if (novos === 0) break;
    if (pagina.length < pageSize) break;
    await dormir(jitter());
  }

  return { ok: true, valor: { rotas, paginas } };
}
