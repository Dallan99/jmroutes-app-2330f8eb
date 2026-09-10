import { beforeEach, describe, expect, it } from "vitest";
import { buscarDashboardComContingencia } from "../src/lib/meli-dashboard-cache";
import type { MeliDashboardResult } from "../src/lib/meli-dashboard.functions";

const memoria = new Map<string, string>();

beforeEach(() => {
  memoria.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (chave: string) => memoria.get(chave) ?? null,
        setItem: (chave: string, valor: string) => memoria.set(chave, valor),
      },
    },
  });
});

describe("contingência do Dashboard Meli", () => {
  it("mantém o último resultado válido quando a consulta cai", async () => {
    const valido: MeliDashboardResult = {
      status: "ok",
      data_operacional: "2026-09-10",
      cards: { total: 100 } as MeliDashboardResult["cards"],
      bases: [{ base_id: null, base_codigo: "SSP38", base_nome: "Itupeva", service_center: null, rotas: 2, rotas_risco: 0, rotas_risco_integral: 0, rotas_risco_parcial: 0, total: 100, pacotes_risco: 0, entregue: 80, em_rota: 20, insucesso: 0, perc_entrega: 80 }],
    };
    const filtros = { data: "2026-09-10" };

    await buscarDashboardComContingencia(async () => valido, filtros);
    const recuperado = await buscarDashboardComContingencia(async () => { throw new Error("offline"); }, filtros);

    expect(recuperado.cache_local).toBe(true);
    expect(recuperado.bases?.[0]?.base_codigo).toBe("SSP38");
    expect(recuperado.cards?.total).toBe(100);
  });

  it("não substitui o cache válido por uma resposta vazia", async () => {
    const filtros = { data: "2026-09-10" };
    await buscarDashboardComContingencia(async () => ({
      status: "ok", bases: [{ base_id: null, base_codigo: "ESP17", base_nome: "Embu Guaçu", service_center: null, rotas: 1, rotas_risco: 0, rotas_risco_integral: 0, rotas_risco_parcial: 0, total: 50, pacotes_risco: 0, entregue: 40, em_rota: 10, insucesso: 0, perc_entrega: 80 }],
    }), filtros);

    const recuperado = await buscarDashboardComContingencia(async () => ({ status: "ok", bases: [] }), filtros);
    expect(recuperado.cache_local).toBe(true);
    expect(recuperado.bases?.[0]?.total).toBe(50);
  });
});
