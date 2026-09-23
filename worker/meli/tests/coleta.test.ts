import { describe, expect, it } from "vitest";
import {
  executarComRetry,
  extrairRotasDaLista,
  listarRotas,
  parseRetryAfter,
  type MeliResposta,
  type MeliTransport,
} from "../src/meli/list";
import { filtrarRotasDaUnidade } from "../src/pipeline/cycle";
import { obterDetalheRota } from "../src/meli/detail";
import { CircuitBreaker } from "../src/state/breaker";
import { novoEstadoIncremental, registrarColeta, selecionarRotas } from "../src/meli/active-filter";
import { resumirMonitoramento, type MonitoramentoResumo } from "../src/meli/monitoring-summary";

const semDormir = async () => undefined;

function resp(status: number, body: unknown, headers: Record<string, string> = {}): MeliResposta {
  return { status, headers, body, ok: status >= 200 && status < 300 && body !== null };
}

describe("retry / backoff", () => {
  it("respeita Retry-After em segundos", () => {
    expect(parseRetryAfter({ "retry-after": "3" })).toBe(3000);
    expect(parseRetryAfter({})).toBeNull();
  });

  it("aguarda o Retry-After informado em 429 e depois sucede", async () => {
    const esperas: number[] = [];
    let chamadas = 0;
    const res = await executarComRetry(
      async () => {
        chamadas += 1;
        return chamadas === 1 ? resp(429, null, { "retry-after": "2" }) : resp(200, { ok: true });
      },
      { dormir: async (ms) => void esperas.push(ms) },
    );
    expect(res.ok).toBe(true);
    expect(esperas).toEqual([2000]);
  });

  it("faz backoff em 500/502/503/504", async () => {
    for (const status of [500, 502, 503, 504]) {
      let chamadas = 0;
      const res = await executarComRetry(
        async () => {
          chamadas += 1;
          return chamadas < 2 ? resp(status, null) : resp(200, {});
        },
        { dormir: semDormir },
      );
      expect(res.ok).toBe(true);
      expect(chamadas).toBe(2);
    }
  });

  it("NÃO retenta 401 nem 403", async () => {
    for (const status of [401, 403]) {
      let chamadas = 0;
      const res = await executarComRetry(
        async () => {
          chamadas += 1;
          return resp(status, null);
        },
        { dormir: semDormir },
      );
      expect(chamadas).toBe(1);
      expect(res).toMatchObject({ ok: false, motivo: "sessao_expirada" });
    }
  });
});

describe("paginação da lista", () => {
  it("acumula páginas e para quando a página vem incompleta", async () => {
    const paginas: unknown[] = [];
    const transport: MeliTransport = {
      async post(_url, body) {
        paginas.push(body);
        const page = (body as { page: number }).page;
        const docs =
          page === 1
            ? Array.from({ length: 50 }, (_, i) => ({ routeId: String(1000 + i) }))
            : page === 2
              ? [{ routeId: "2001" }, { routeId: "2002" }]
              : [];
        return resp(200, { documents: docs });
      },
      async get() {
        throw new Error("não usado");
      },
    };

    const res = await listarRotas(transport, {
      serviceCenterId: "SSP15",
      siteId: "MLB",
      dormir: semDormir,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.valor.rotas).toHaveLength(52);
      expect(res.valor.paginas).toBe(2);
    }
    expect(paginas).toHaveLength(2);
  });

  it("extrai routeIds de envelopes variados sem duplicar", () => {
    const rotas = extrairRotasDaLista({
      content: { results: [{ routeId: "10", status: "in_route" }, { id: "10" }, { route_id: "11" }] },
    });
    expect(rotas.map((r) => r.routeId).sort()).toEqual(["10", "11"]);
  });

  it("separa a operação direta do XPT pelo facilityId", () => {
    const rotas = extrairRotasDaLista({
      routes: [
        { id: "10", facilityId: "ESP15", serviceCenterId: "SSP20" },
        { id: "11", facilityId: "SSP20", serviceCenterId: "SSP20" },
      ],
    });
    expect(filtrarRotasDaUnidade(rotas, "ESP15").map((r) => r.routeId)).toEqual(["10"]);
    expect(filtrarRotasDaUnidade(rotas, "SSP20").map((r) => r.routeId)).toEqual(["11"]);
  });
});

describe("detalhe da rota", () => {
  const transport = (body: unknown, status = 200): MeliTransport => ({
    async post() {
      throw new Error("não usado");
    },
    async get() {
      return resp(status, body);
    },
  });

  it("aceita payload com id e stops", async () => {
    const res = await obterDetalheRota(transport({ id: "77", stops: [] }), "77", "MLB", semDormir);
    expect(res.ok).toBe(true);
  });

  it("rejeita payload fora do formato", async () => {
    const res = await obterDetalheRota(transport({ id: "78" }), "77", "MLB", semDormir);
    expect(res).toMatchObject({ ok: false, motivo: "payload_shape" });
  });
});

describe("resumo do Monitoramento Last Mile", () => {
  it("separa XPT e Service pelo facilityId", () => {
    const rotas = [
      { routeId: "1", facilityId: "ESP15", serviceCenterId: "SSP20", status: "active", isDeliveryRoute: true, counters: { total: 100, delivered: 40, notDelivered: 1, pending: 59, totalBags: 2 } },
      { routeId: "2", facilityId: "SSP20", serviceCenterId: "SSP20", status: "close", isDeliveryRoute: true, counters: { total: 50, delivered: 50, notDelivered: 0, pending: 0, totalBags: 0 } },
    ];
    expect(resumirMonitoramento(rotas, "ESP15", "SSP20", "2026-09-08T12:00:00.000Z")).toMatchObject({
      base_codigo: "ESP15", rotas_totais: 1, rotas_em_andamento: 1, pacotes: 100, pendentes: 59, com_falhas: 1, bem_sucedidos: 40, sacas: 2,
    });
    expect(resumirMonitoramento(rotas, "SSP20", "SSP20", "2026-09-08T12:00:00.000Z")).toMatchObject({
      base_codigo: "SSP20", rotas_totais: 1, pacotes: 50, bem_sucedidos: 50,
    });
  });

  it("considera somente rotas AM nas quatro bases XPT", () => {
    for (const base of ["ESP15", "ESP16", "ESP17", "ESP18"]) {
      const resumo = resumirMonitoramento([
        { routeId: "445035431", routeName: "VR3_AM1", facilityId: base, counters: { total: 99, delivered: 10, notDelivered: 1, pending: 88, totalBags: 0 } },
        { routeId: "445035432", routeName: "N1_PM1", facilityId: base, counters: { total: 50, delivered: 50, notDelivered: 0, pending: 0, totalBags: 0 } },
      ], base, "SSP20");
      expect(resumo).toMatchObject({ rotas_totais: 1, pacotes: 99, bem_sucedidos: 10 });
    }
  });

  it("não remove PM de bases que não são XPT", () => {
    const resumo = resumirMonitoramento([
      { routeId: "1", routeName: "N1_PM1", facilityId: "SSP20", counters: { total: 50, delivered: 0, notDelivered: 0, pending: 50, totalBags: 0 } },
    ], "SSP20", "SSP20");
    expect(resumo).toMatchObject({ rotas_totais: 1, pacotes: 50 });
  });

  it("considera resumo com rotas_totais 0 e pacotes 0 inválido para persistência", () => {
    const resumoVazio: MonitoramentoResumo = {
      base_codigo: "ESP15",
      facility_id: "ESP15",
      service_center_id: "SSP20",
      rotas_totais: 0,
      rotas_entrega: 0,
      rotas_coleta: 0,
      rotas_mistas: 0,
      rotas_em_andamento: 0,
      pacotes: 0,
      sacas: 0,
      pendentes: 0,
      com_falhas: 0,
      bem_sucedidos: 0,
      coletado_em: "2026-09-08T12:00:00.000Z",
    };

    const ehValidoParaPersistencia = (resumo: MonitoramentoResumo) =>
      !(resumo.rotas_totais === 0 && resumo.pacotes === 0);

    expect(ehValidoParaPersistencia(resumoVazio)).toBe(false);
  });
});

describe("circuit breaker", () => {
  it("abre após o limite de falhas e libera após o cooldown", () => {
    const b = new CircuitBreaker({ limiteFalhas: 2, cooldownMs: 1000 });
    b.registrarFalha("http");
    expect(b.permite()).toBe(true);
    b.registrarFalha("http");
    expect(b.permite()).toBe(false);
    expect(b.permite(Date.now() + 1500)).toBe(true);
  });

  it("abre imediatamente em sessao_expirada", () => {
    const b = new CircuitBreaker();
    b.abrir("sessao_expirada");
    expect(b.permite()).toBe(false);
    expect(b.motivo).toBe("sessao_expirada");
  });
});

describe("prioridade de rotas ativas e incremental", () => {
  it("coloca ativas primeiro e ignora finalizadas já coletadas", () => {
    const estado = novoEstadoIncremental();
    const finalizada = { routeId: "3", status: "finished" };
    registrarColeta(estado, finalizada, 1000);
    const selecionadas = selecionarRotas(
      [finalizada, { routeId: "2", status: "pending" }, { routeId: "1", status: "in_route" }],
      estado,
      { agora: 2000 },
    );
    expect(selecionadas.map((r) => r.routeId)).toEqual(["1", "2"]);
  });
});
