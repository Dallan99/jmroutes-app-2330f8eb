import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config";
import { assinar, executarCicloPiloto } from "../src/pipeline/piloto";
import type { MeliResposta, MeliTransport } from "../src/meli/list";

const SEGREDO = "s".repeat(40);
const ENV = {
  BASE_CODES: "ESP16",
  JMR_BASE_URL: "https://exemplo.invalid",
  SUPABASE_URL: "https://exemplo.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  WORKER_SESSION_KEY: Buffer.alloc(32, 1).toString("base64"),
  DRY_RUN: "true",
  PILOT_WRITE: "true",
  MELI_PILOTO_INGEST_SECRET: SEGREDO,
};

const resp = (body: unknown): MeliResposta => ({ status: 200, headers: {}, body, ok: true });

function transporte(totalRotas: number): MeliTransport {
  const rotas = Array.from({ length: totalRotas }, (_, i) => ({ routeId: String(1000 + i), counters: { total: 3, delivered: 2 } }));
  return {
    post: async (_u: string, b: unknown) => {
      const page = (b as { page: number }).page;
      return resp({ results: rotas.slice((page - 1) * 50, page * 50) });
    },
    get: async (url: string) => {
      const id = new URL(url).searchParams.get("routeId");
      return resp({ id: Number(id), stops: [] });
    },
  } as MeliTransport;
}

describe("piloto Meli", () => {
  it("recusa PILOT_WRITE sem DRY_RUN", () => {
    expect(() => loadConfig({ ...ENV, DRY_RUN: "false", WORKER_EMAIL: "x@y.z" })).toThrow(ConfigError);
  });

  it("recusa PILOT_WRITE sem segredo", () => {
    expect(() => loadConfig({ ...ENV, MELI_PILOTO_INGEST_SECRET: "" })).toThrow(ConfigError);
  });

  it("lê todas as páginas, envia só ao piloto e assina cada envio", async () => {
    const cfg = loadConfig(ENV);
    const chamadas: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const corpo = String(init.body);
      const h = init.headers as Record<string, string>;
      expect(h["x-jm-signature"]).toBe(assinar(SEGREDO, h["x-jm-timestamp"], corpo));
      chamadas.push({ url, body: JSON.parse(corpo) });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const r = await executarCicloPiloto({ cfg, transport: transporte(120), instancia: "teste", fetchImpl, dormir: async () => {} });

    expect(chamadas.every((c) => c.url === "https://exemplo.invalid/api/public/meli/piloto/ingest")).toBe(true);
    expect(r.paginas_lidas).toBe(3);
    expect(r.rotas_listadas).toBe(120);
    expect(r.detalhes_enviados).toBe(120);
    expect(r.pacotes_esperados).toBe(360);
    expect(r.status).toBe("concluido");
    expect(chamadas.every((c) => (c.body.ciclo as { dry_run: boolean }).dry_run === true)).toBe(true);
    const final = chamadas.at(-1)!.body.ciclo as Record<string, unknown>;
    expect(final).toMatchObject({ status: "concluido", paginas_esperadas: 3, rotas_esperadas: 120, pacotes_esperados: 360 });
    const ids = chamadas.flatMap((c) => ((c.body.detalhes as Array<{ route_id: string }>) ?? []).map((d) => d.route_id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("ESP18 sem estação confirmada", () => {
  it("recusa ESP18 em BASE_CODES", () => {
    expect(() => loadConfig({ ...ENV, BASE_CODES: "ESP16,ESP18" })).toThrow(/ESP18/);
  });
});
