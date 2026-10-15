import { describe, expect, it, vi } from "vitest";
import { clienteDeModulo } from "../src/lib/modulo-client";

describe("compatibilidade de módulos", () => {
  it("bloqueia tabelas e RPCs ausentes antes de enviar consultas", () => {
    const original = { from: vi.fn(), rpc: vi.fn() };
    const cliente = clienteDeModulo(original);
    expect(() => cliente.from("expedicoes")).toThrow("Módulo em implantação");
    expect(() => cliente.rpc("meli_dashboard_operacional")).toThrow("Módulo em implantação");
    expect(original.from).not.toHaveBeenCalled();
    expect(original.rpc).not.toHaveBeenCalled();
  });
  it("preserva cliente, sessão e argumentos nas consultas implantadas", () => {
    const original = { auth: {}, from: vi.fn(function(this: unknown) { return this; }), rpc: vi.fn() };
    const cliente = clienteDeModulo(original);
    expect(cliente.auth).toBe(original.auth);
    expect(cliente.from("meli_piloto_rotas")).toBe(original);
    cliente.rpc("has_role", { _user_id: "u", _role: "admin" });
    expect(original.rpc).toHaveBeenCalledWith("has_role", { _user_id: "u", _role: "admin" });
  });
});