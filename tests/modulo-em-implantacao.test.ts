import { describe, expect, it } from "vitest";
import {
  clienteDeModulo,
  ModuloEmImplantacaoError,
  tabelaImplantada,
} from "@/lib/modulo-em-implantacao";

function clienteFalso() {
  const chamadas: string[] = [];
  return {
    chamadas,
    from: (t: string) => {
      chamadas.push(`from:${t}`);
      return { select: () => ({ ok: true }) };
    },
    rpc: (n: string) => {
      chamadas.push(`rpc:${n}`);
      return Promise.resolve({ data: true, error: null });
    },
  };
}

describe("bloqueio de módulos em implantação", () => {
  it("permite tabelas que existem no banco novo", () => {
    const falso = clienteFalso();
    clienteDeModulo(falso).from("bases");
    expect(falso.chamadas).toEqual(["from:bases"]);
  });

  it("bloqueia tabela ainda não implantada sem consultar o banco", () => {
    const falso = clienteFalso();
    expect(() => clienteDeModulo(falso).from("meli_rotas")).toThrow(ModuloEmImplantacaoError);
    expect(falso.chamadas).toEqual([]);
  });

  it("bloqueia rotina ainda não implantada", () => {
    const falso = clienteFalso();
    expect(() => clienteDeModulo(falso).rpc("meli_listar_rotas")).toThrow(/Módulo em implantação/);
    expect(falso.chamadas).toEqual([]);
  });

  it("transferências e expedição ainda não estão implantadas", () => {
    expect(tabelaImplantada("transferencias")).toBe(false);
    expect(tabelaImplantada("expedicoes")).toBe(false);
    expect(tabelaImplantada("recebimentos")).toBe(true);
  });
});
