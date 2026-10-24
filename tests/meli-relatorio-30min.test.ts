import { describe, expect, it } from "vitest";
import { montarRelatorio30Min } from "../src/lib/meli-relatorio-30min";

describe("relatório Meli de 30 minutos", () => {
  it("deduplica pacotes e separa pendentes de insucessos", () => {
    const resultado = montarRelatorio30Min(
      [
        { route_id: "R1", total_pedidos: 3, total_entregue: 1, coletado_em: "2026-10-22T20:00:00Z", payload: { status: "active" } },
        { route_id: "R2", total_pedidos: 2, total_entregue: 1, coletado_em: "2026-10-22T20:00:00Z", payload: { status: "close" } },
      ],
      [
        { shipment_id: "1", status: "pending", coletado_em: "2026-10-22T19:30:00Z", payload: { substatus: null } },
        { shipment_id: "1", status: "delivered", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: "delivered" } },
        { shipment_id: "2", status: "pending", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: "buyer_absent" } },
        { shipment_id: "3", status: "pending", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: null } },
        { shipment_id: "4", status: "delivered", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: "delivered" } },
        { shipment_id: "5", status: "pending", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: "unvisited_address" } },
      ],
    );

    expect(resultado).toMatchObject({
      rotas: 2,
      abertas: 1,
      encerradas: 1,
      total_pacotes: 5,
      entregues: 2,
      pendentes: 2,
      insucessos: 1,
      ds_percentual: 66.7,
      ultima_coleta: "2026-10-22T20:00:00Z",
    });
    expect(resultado.motivos.find((m) => m.codigo === "buyer_absent")?.total).toBe(1);
    expect(resultado.avisos_integridade.join(" ")).toContain("unvisited_address");
  });

  it("não inventa DS quando não há pacote finalizado", () => {
    const resultado = montarRelatorio30Min([], [
      { shipment_id: "1", status: "pending", coletado_em: "2026-10-22T20:00:00Z", payload: { substatus: null } },
    ]);
    expect(resultado.ds_percentual).toBeNull();
    expect(resultado.sacas).toBeNull();
    expect(resultado.pnr).toBeNull();
  });
});
