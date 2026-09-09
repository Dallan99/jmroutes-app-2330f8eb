import { describe, expect, it } from "vitest";
import { aplicarMonitoramentoPreservado, type MeliDashboardResult } from "../src/lib/meli-dashboard.functions";

describe("Dashboard Meli — maior leitura do dia", () => {
  it("não deixa uma base nem os cartões consolidados regredirem", () => {
    const atual: MeliDashboardResult = {
      status: "ok",
      data_operacional: "2026-09-09",
      cards: {
        total: 90, nao_iniciado: 0, em_rota: 10, entregue: 80, insucesso: 0,
        cancelado: 0, desconhecido: 0, area_risco_pacotes: 0, elegiveis: 90,
        perc_entrega: 88.9, rotas: 8, rotas_risco: 0,
      },
      bases: [{
        base_id: "base-1", base_codigo: "ESP17", base_nome: "Embu Guaçu",
        service_center: "SSP56", rotas: 8, rotas_risco: 0, rotas_risco_integral: 0,
        rotas_risco_parcial: 0, total: 90, pacotes_risco: 0, entregue: 80,
        em_rota: 10, insucesso: 0, perc_entrega: 88.9,
      }],
    };

    const resultado = aplicarMonitoramentoPreservado(atual, [{
      base_codigo: "ESP17", rotas_totais: 10, pacotes: 100, pendentes: 3,
      com_falhas: 1, bem_sucedidos: 97, performance_logistics_max: 97,
    }]);

    expect(resultado.bases?.[0]).toMatchObject({
      rotas: 10, total: 100, entregue: 97, insucesso: 1, perc_entrega: 97,
    });
    expect(resultado.cards).toMatchObject({
      rotas: 10, total: 100, entregue: 97, insucesso: 1, perc_entrega: 97,
    });
  });

  it("não adiciona ao Dashboard bases que não pertencem ao resultado operacional", () => {
    const atual: MeliDashboardResult = { status: "ok", bases: [] };
    const resultado = aplicarMonitoramentoPreservado(atual, [{
      base_codigo: "SSP38", rotas_totais: 12, pacotes: 100, pendentes: 0,
      com_falhas: 0, bem_sucedidos: 97, performance_logistics_max: 97,
    }]);
    expect(resultado.bases).toEqual([]);
  });
});
