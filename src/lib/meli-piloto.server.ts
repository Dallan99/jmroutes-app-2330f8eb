// Piloto Meli isolado: autenticação HMAC do worker e validação de lotes.
// Grava SOMENTE nas tabelas meli_piloto_* via RPCs restritas a service_role.
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

export const MAX_PILOTO_BYTES = 4 * 1024 * 1024;
export const BASES_PILOTO = ["ESP15", "ESP16", "ESP17", "ESP18"] as const;
const JANELA_MS = 5 * 60_000;

export function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

/**
 * Assinatura: header `x-jm-timestamp` (ms) e `x-jm-signature` =
 * hex(HMAC-SHA256(segredo, `${timestamp}.${corpo}`)). Janela de 5 minutos.
 */
export function verificarAssinatura(segredo: string, ts: string | null, assinatura: string | null, corpo: string) {
  if (!ts || !assinatura || !/^\d{10,16}$/.test(ts) || !/^[0-9a-f]{64}$/.test(assinatura)) return false;
  if (Math.abs(Date.now() - Number(ts)) > JANELA_MS) return false;
  const esperado = createHmac("sha256", segredo).update(`${ts}.${corpo}`).digest();
  const recebido = Buffer.from(assinatura, "hex");
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function lerCorpoAssinado(request: Request) {
  const segredo = process.env["MELI_PILOTO_INGEST_SECRET"];
  if (!segredo || segredo.length < 32) return { erro: resposta(503, { erro: "piloto_nao_configurado" }) };
  const tamanho = Number(request.headers.get("content-length") ?? "0");
  if (tamanho > MAX_PILOTO_BYTES) return { erro: resposta(413, { erro: "lote_grande_demais" }) };
  const corpo = await request.text();
  if (corpo.length > MAX_PILOTO_BYTES) return { erro: resposta(413, { erro: "lote_grande_demais" }) };
  if (!verificarAssinatura(segredo, request.headers.get("x-jm-timestamp"), request.headers.get("x-jm-signature"), corpo)) {
    return { erro: resposta(401, { erro: "assinatura_invalida" }) };
  }
  try {
    return { json: JSON.parse(corpo) as unknown };
  } catch {
    return { erro: resposta(400, { erro: "json_invalido" }) };
  }
}

const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ts = z.string().datetime({ offset: true });
const txt = (max: number) => z.string().trim().min(1).max(max);
const payload = z.record(z.string(), z.unknown());

export const loteSchema = z.object({
  coletado_em: ts.optional(),
  ciclo: z.object({
    id: z.string().uuid(),
    base_codigo: z.enum(BASES_PILOTO),
    service_center: txt(20),
    instancia: txt(120),
    versao_worker: z.string().max(60).optional(),
    dry_run: z.literal(true),
    status: z.enum(["em_andamento", "concluido", "erro", "parcial"]).default("em_andamento"),
    iniciado_em: ts,
    finalizado_em: ts.optional(),
    paginas_esperadas: z.number().int().min(0).optional(),
    rotas_esperadas: z.number().int().min(0).optional(),
    pacotes_esperados: z.number().int().min(0).optional(),
    erro: z.string().max(2000).optional(),
  }),
  pagina: z.object({
    recurso: z.enum(["rotas", "pacotes"]).default("rotas"),
    numero: z.number().int().min(0),
    offset: z.number().int().min(0).optional(),
    total_informado: z.number().int().min(0).optional(),
    itens: z.number().int().min(0),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["ok", "erro"]).default("ok"),
    payload: z.unknown().optional(),
  }).optional(),
  rotas: z.array(z.object({
    route_id: txt(60),
    data_rota: data,
    driver_id: z.string().max(60).nullish(),
    motorista_nome: z.string().max(200).nullish(),
    placa: z.string().max(12).nullish(),
    total_pedidos: z.number().int().min(0).nullish(),
    total_entregue: z.number().int().min(0).nullish(),
    payload: payload.optional(),
  })).max(2000).default([]),
  pacotes: z.array(z.object({
    route_id: txt(60),
    shipment_id: txt(60),
    status: z.string().max(60).nullish(),
    payload: payload.optional(),
  })).max(20000).default([]),
  /** Detalhe bruto da rota (route-detail) + contadores da lista; normalizado no servidor. */
  detalhes: z.array(z.object({
    route_id: txt(60),
    data_rota: data.optional(),
    contadores: z.object({ total: z.number().int().min(0), delivered: z.number().int().min(0) }).partial().optional(),
    payload: payload,
  })).max(100).default([]),
  erros: z.array(z.object({
    etapa: txt(60),
    codigo: z.string().max(60).optional(),
    mensagem: txt(2000),
    detalhe: z.unknown().optional(),
  })).max(200).default([]),
});

export const heartbeatSchema = z.object({
  instancia: txt(120),
  bases: z.array(z.enum(BASES_PILOTO)).min(1).max(4),
  host: z.string().max(120).optional(),
  regiao: z.string().max(20).optional(),
  ambiente: z.string().max(40).optional(),
  versao_worker: z.string().max(60).optional(),
  dry_run: z.literal(true),
  sessao_adminml: z.enum(["valida", "expirada", "ausente", "desconhecida"]),
  sessao_verificada_em: ts.optional(),
  ultimo_ciclo_id: z.string().uuid().optional(),
  detalhe: z.record(z.string(), z.unknown()).optional(),
});

type Lote = z.infer<typeof loteSchema>;

const dataSp = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600_000).toISOString().slice(0, 10);

/** Converte detalhes brutos em rotas/pacotes usando o normalizador oficial do app. */
export async function expandirDetalhes(lote: Lote) {
  if (!lote.detalhes.length) return lote;
  const { normalizarPayloadMeli } = await import("@/lib/meli-normalize");
  const rotas = [...lote.rotas];
  const pacotes = [...lote.pacotes];
  const erros = [...lote.erros];
  const ref = lote.coletado_em ?? new Date().toISOString();
  for (const d of lote.detalhes) {
    try {
      const { payload: n, resumo } = normalizarPayloadMeli(d.payload as Record<string, unknown>);
      if (String(n.route_id) !== d.route_id) throw new Error(`route_id divergente (${n.route_id})`);
      const { pacotes: lista, ...rota } = n;
      rotas.push({
        route_id: d.route_id,
        data_rota: d.data_rota ?? (n.data_rota ? n.data_rota.slice(0, 10) : dataSp(ref)),
        driver_id: n.driver_id,
        motorista_nome: n.driver_name,
        placa: n.vehicle_license,
        total_pedidos: d.contadores?.total ?? resumo.total_informado ?? lista.length,
        total_entregue: d.contadores?.delivered ?? null,
        payload: { ...rota, resumo },
      });
      for (const k of lista) {
        const id = k.shipment_id ?? k.tracking_id;
        if (!id) continue;
        pacotes.push({ route_id: d.route_id, shipment_id: id, status: k.status, payload: k as unknown as Record<string, unknown> });
      }
    } catch (e) {
      erros.push({ etapa: "normalizacao", codigo: "detalhe_invalido", mensagem: `rota ${d.route_id}: ${(e as Error).message}`.slice(0, 2000) });
    }
  }
  // Dedup dentro do lote (ON CONFLICT não aceita a mesma chave duas vezes)
  const rotasUnicas = [...new Map(rotas.map((r) => [`${r.route_id}|${r.data_rota}`, r])).values()];
  const pacotesUnicos = [...new Map(pacotes.map((k) => [`${k.shipment_id}|${k.route_id}`, k])).values()];
  return { ...lote, detalhes: [], rotas: rotasUnicas, pacotes: pacotesUnicos, erros };
}
