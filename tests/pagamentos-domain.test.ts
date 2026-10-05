import { describe, expect, it } from "vitest";
import { calcularRotas, resumirMotoristas, semanaAnterior, semanaPagamento, type Tarifa, type RotaEntrada } from "../src/lib/pagamentos-domain";

const tarifas: Tarifa[] = [
  { tipo_veiculo: "carro", base_id: null, regiao: null, valor: 200, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  { tipo_veiculo: "utilitario", base_id: null, regiao: null, valor: 300, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  { tipo_veiculo: "vuc", base_id: null, regiao: null, valor: 500, vigencia_inicio: "2026-01-01", vigencia_fim: null },
  { tipo_veiculo: "carro", base_id: "b2", regiao: null, valor: 220, vigencia_inicio: "2026-01-01", vigencia_fim: null },
];
const placas = new Map([["ABC1D23", "carro" as const], ["VUC0001", "vuc" as const]]);
const rota = (o: Partial<RotaEntrada>): RotaEntrada => ({
  route_id: "1", data_rota: "2026-10-05", base_id: "b1", base_codigo: "ESP15", regiao: null,
  motorista_id: "m1", motorista_nome: "João", placa: "ABC-1D23", total_pedidos: 100, entregues: 95, ...o,
});

describe("semana", () => {
  it("domingo a sábado, paga na quarta", () => {
    expect(semanaPagamento("2026-10-07")).toEqual({ inicio: "2026-10-04", fim: "2026-10-10", pagamento: "2026-10-14" });
    expect(semanaAnterior("2026-10-05").inicio).toBe("2026-09-27");
  });
});

describe("elegibilidade", () => {
  it("90% exato não paga; acima paga", () => {
    const [a, b] = calcularRotas([rota({ route_id: "1", entregues: 90 }), rota({ route_id: "2", entregues: 91 })], placas, tarifas);
    expect(a.pagavel).toBe(false);
    expect(a.valor).toBe(0);
    expect(b.pagavel).toBe(true);
    expect(b.valor).toBe(200);
  });
  it("tarifa da base tem prioridade", () => {
    expect(calcularRotas([rota({ base_id: "b2" })], placas, tarifas)[0].valor).toBe(220);
  });
  it("sinaliza pendências", () => {
    const [r] = calcularRotas([rota({ placa: "ZZZ9999", total_pedidos: 0 })], placas, tarifas);
    expect(r.pendencias).toEqual(expect.arrayContaining(["placa_sem_tipo", "rota_sem_pedidos"]));
  });
  it("média ponderada e adicionais", () => {
    const rs = calcularRotas([rota({ route_id: "1", total_pedidos: 100, entregues: 95 }), rota({ route_id: "2", total_pedidos: 10, entregues: 5 })], placas, tarifas);
    const [m] = resumirMotoristas(rs, [{ motorista_chave: "ESP15::m1", valor: 30, motivo: "domingo", observacao: null, data_relacionada: null }]);
    expect(m.media_ponderada).toBeCloseTo(90.909, 2);
    expect(m.total).toBe(230);
  });
});
