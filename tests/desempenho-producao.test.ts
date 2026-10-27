import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comTimeout, ConsultaDemoradaError, mensagemDeErroConsulta } from "@/lib/consulta-com-timeout";
import { lerRolesSalvas, limparRolesSalvas, salvarRoles } from "@/lib/roles-cache";
import { rotaDeColunasEnxutas } from "@/lib/meli-piloto-adapter";
import { contadorLogistics } from "@/lib/meli-piloto-adapter";

class MemoriaStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe("comTimeout", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("devolve o resultado quando a consulta responde a tempo", async () => {
    await expect(comTimeout(Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("falha com mensagem amigável quando passa do limite", async () => {
    const lenta = new Promise(() => undefined);
    const p = comTimeout(lenta, 30_000);
    vi.advanceTimersByTime(30_001);
    await expect(p).rejects.toBeInstanceOf(ConsultaDemoradaError);
    await expect(p).rejects.toThrow(/mais de 30 s/);
  });

  it("traduz erros de timeout do banco", () => {
    expect(mensagemDeErroConsulta(new Error("canceling statement due to statement timeout"))).toMatch(/demorando/);
    expect(mensagemDeErroConsulta(new Error("qualquer"))).toMatch(/Não foi possível/);
  });
});

describe("roles salvas do último login", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: new MemoriaStorage() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("guarda por usuário e devolve até a validade", () => {
    salvarRoles("u1", ["admin"], 1_000);
    expect(lerRolesSalvas("u1", 2_000)).toEqual(["admin"]);
    expect(lerRolesSalvas("u2", 2_000)).toBeNull();
    expect(lerRolesSalvas("u1", 1_000 + 31 * 24 * 3600_000)).toBeNull();
  });

  it("limpa tudo no logout e tolera armazenamento indisponível", () => {
    salvarRoles("u1", ["gerente"]);
    limparRolesSalvas();
    expect(lerRolesSalvas("u1")).toBeNull();
    vi.stubGlobal("window", { get localStorage() { throw new Error("bloqueado"); } });
    expect(() => salvarRoles("u1", ["admin"])).not.toThrow();
    expect(lerRolesSalvas("u1")).toBeNull();
  });
});

describe("leitura enxuta das rotas do piloto", () => {
  it("remonta o payload só com os campos usados pelo painel", () => {
    const r = rotaDeColunasEnxutas({
      id: "1", base_id: "b", route_id: "R1", data_rota: "2026-10-27", ultimo_ciclo_id: "c",
      motorista_nome: null, placa: null, total_pedidos: 10, total_entregue: 4, coletado_em: "x",
      p_route_name: "VR3_AM1", p_routeName: null, p_name: null, p_cluster: null,
      p_contadores: { notDelivered: 2, pending: 4 },
    });
    expect(r.payload?.route_name).toBe("VR3_AM1");
    expect(contadorLogistics(r, "notDelivered")).toBe(2);
    expect(r).not.toHaveProperty("p_contadores");
  });
});
