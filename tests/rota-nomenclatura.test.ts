import { describe, expect, it } from "vitest";
import { nomenclaturaRota } from "../src/lib/rota-nomenclatura";

describe("nomenclatura operacional da rota", () => {
  it("prioriza cluster preenchido", () => {
    expect(nomenclaturaRota({ cluster: " VT12 - VT5 ", nome_operacional: "Outra rota", route_id: "123456" })).toBe("VT12 - VT5");
  });
  it("usa nome operacional diferente do ID quando cluster está vazio", () => {
    expect(nomenclaturaRota({ cluster: " ", nome_operacional: " VT12 - VT5 ", route_id: "123456" })).toBe("VT12 - VT5");
  });
  it.each([null, undefined, "", " ", "123456", " 123456 "])("não transforma ID ou nome ausente em título (%s)", (nome_operacional) => {
    expect(nomenclaturaRota({ nome_operacional, route_id: "123456" })).toBe("Nomenclatura não informada");
  });
});