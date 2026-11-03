import { describe, expect, it } from "vitest";
import { fimSemanaSabado, inicioSemanaDomingo, pagamentoQuartaSeguinte, percentualEntregue, rotaPagavel, valorRota } from "./pagamentos-domain";

describe("pagamentos de motoristas", () => {
  it("fecha domingo a sábado e paga na quarta seguinte", () => {
    expect(inicioSemanaDomingo(new Date(2026, 9, 5))).toBe("2026-10-04");
    expect(fimSemanaSabado("2026-10-04")).toBe("2026-10-10");
    expect(pagamentoQuartaSeguinte("2026-10-04")).toBe("2026-10-14");
  });
  it("exige mais de 90%, não aceita exatamente 90%", () => {
    expect(percentualEntregue(90, 100)).toBe(90);
    expect(rotaPagavel(90, 100)).toBe(false);
    expect(rotaPagavel(91, 100)).toBe(true);
  });
  it("usa os valores iniciais por tipo", () => {
    expect(valorRota("passeio")).toBe(200);
    expect(valorRota("utilitario")).toBe(300);
    expect(valorRota("vuc")).toBe(500);
  });
});
