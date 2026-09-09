import { describe, expect, it } from "vitest";
import { aplicarMonitoramentoPreservado, aplicarRotasRiscoPersistidas, type MeliDashboardResult } from "../src/lib/meli-dashboard.functions";

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
    expect(resultado.motivos_insucesso).toEqual([{
      codigo: "sem_detalhamento_adminml",
      descricao: "Aguardando detalhamento do motivo pelo AdminML",
      cadastrado: true,
      total: 1,
    }]);
  });

  it("preserva os motivos reais e sinaliza somente a diferença sem detalhamento", () => {
    const atual: MeliDashboardResult = {
      status: "ok",
      cards: { insucesso: 5 },
      bases: [{ base_id: "base-1", base_codigo: "ESP17", base_nome: "Embu Guaçu", rotas: 1, total: 10, entregue: 5, em_rota: 0, insucesso: 5, perc_entrega: 50 }],
      motivos_insucesso: [{ codigo: "endereco", descricao: "Endereço incorreto", cadastrado: true, total: 3 }],
    };

    const resultado = aplicarMonitoramentoPreservado(atual, [{
      base_codigo: "ESP17", rotas_totais: 1, pacotes: 10, pendentes: 0,
      com_falhas: 5, bem_sucedidos: 5, performance_logistics_max: 50,
    }]);

    expect(resultado.motivos_insucesso).toEqual([
      { codigo: "endereco", descricao: "Endereço incorreto", cadastrado: true, total: 3 },
      {
        codigo: "sem_detalhamento_adminml",
        descricao: "Aguardando detalhamento do motivo pelo AdminML",
        cadastrado: true,
        total: 2,
      },
    ]);
  });

  it("não adiciona ao Dashboard bases que não pertencem ao resultado operacional", () => {
    const atual: MeliDashboardResult = { status: "ok", bases: [] };
    const resultado = aplicarMonitoramentoPreservado(atual, [{
      base_codigo: "SSP38", rotas_totais: 12, pacotes: 100, pendentes: 0,
      com_falhas: 0, bem_sucedidos: 97, performance_logistics_max: 97,
    }]);
    expect(resultado.bases).toEqual([]);
  });

  it("inclui rota com selo de risco mesmo sem pacotes detalhados", () => {
    const atual: MeliDashboardResult = {
      status: "ok",
      cards: { total: 100, nao_iniciado: 100, em_rota: 0, entregue: 0, insucesso: 0, cancelado: 0, desconhecido: 0, area_risco_pacotes: 0, elegiveis: 100, perc_entrega: 0, rotas: 1, rotas_risco: 0 },
      bases: [{ base_id: "base-1", base_codigo: "SSP45", base_nome: "Itaquera", service_center: "SSP45", rotas: 1, rotas_risco: 0, rotas_risco_integral: 0, rotas_risco_parcial: 0, total: 100, pacotes_risco: 0, entregue: 0, em_rota: 0, insucesso: 0, perc_entrega: 0 }],
      rotas: [],
    };
    const resultado = aplicarRotasRiscoPersistidas(atual, [{ id: "rota-1", route_id: "H2_AM1", base_id: "base-1", rota_area_risco: true, total_pacotes: 18 }]);

    expect(resultado.cards).toMatchObject({ rotas_risco: 1, area_risco_pacotes: 18 });
    expect(resultado.bases?.[0]).toMatchObject({ rotas_risco: 1, rotas_risco_integral: 1 });
    expect(resultado.rotas?.[0]).toMatchObject({ nome_operacional: "H2_AM1", rota_area_risco: true, total: 18 });
    expect(resultado.area_risco).toMatchObject({ rotas: 1, integrais: 1, pacotes: 18 });
  });
});
