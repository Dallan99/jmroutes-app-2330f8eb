import { describe, expect, it } from "vitest";
import { escolherDataEfetiva, montarPainel, ultimoCicloValidoPorBase, type CicloRow, type RotaRow, type BaseInfo } from "../src/lib/meli-piloto-dashboard";

const ciclo = (id: string, ini: string, status = "concluido", extra: Partial<CicloRow> = {}): CicloRow => ({
  id, base_id: "b15", base_codigo: "ESP15", status, iniciado_em: ini, finalizado_em: ini,
  rotas_esperadas: 2, rotas_recebidas: 2, pacotes_esperados: 30, pacotes_recebidos: 30,
  paginas_esperadas: 1, paginas_lidas: 1, ...extra,
});
const rota = (route_id: string, ciclo_id: string, extra: Partial<RotaRow> = {}): RotaRow => ({
  base_id: "b15", route_id, data_rota: "2026-10-06", ultimo_ciclo_id: ciclo_id,
  motorista_nome: "Ana", placa: "ABC1D23", total_pedidos: 10, total_entregue: 5, coletado_em: "", ...extra,
});
const bases: BaseInfo[] = [
  { id: "b15", codigo: "ESP15", nome: "A", ativa_no_piloto: true, estacao_confirmada: true },
  { id: "b18", codigo: "ESP18", nome: "Franco da Rocha", ativa_no_piloto: false, estacao_confirmada: false },
];

describe("Dashboard piloto Meli", () => {
  it("seleciona o ciclo concluído mais recente e ignora ciclo em andamento", () => {
    const m = ultimoCicloValidoPorBase([ciclo("c1", "2026-10-06T10:00"), ciclo("c2", "2026-10-06T11:00"), ciclo("c3", "2026-10-06T12:00", "em_andamento")]);
    expect(m.get("b15")?.id).toBe("c2");
  });

  it("não soma ciclos repetidos nem rotas antigas", () => {
    const ciclos = [ciclo("c1", "2026-10-06T10:00"), ciclo("c2", "2026-10-06T11:00")];
    const p = montarPainel(bases, ciclos, [rota("R1", "c2"), rota("R1", "c2"), rota("R2", "c2"), rota("OLD", "c1")], "2026-10-06");
    expect(p[0]).toMatchObject({ situacao: "ativa", rotas: 2, pacotes: 20, entregues: 10, perc_entregue: 50 });
  });

  it("ESP18 pertence à allowlist atual e mostra dados disponíveis", () => {
    const p = montarPainel(bases, [], [rota("X", "c9", { base_id: "b18" })], "2026-10-06");
    expect(p[1]).toMatchObject({ situacao: "ativa", rotas: 1, pacotes: 10 });
  });
  it("base fora da allowlist não mostra dados", () => {
    const p = montarPainel([{...bases[1],codigo:'SSC2'}],[],[rota('X','c9',{base_id:'b18'})],'2026-10-06');
    expect(p[0]).toMatchObject({situacao:'desativada',rotas:null,pacotes:null});
  });

  it("campo ausente vira não disponível (null), sem estimar", () => {
    const p = montarPainel(bases, [ciclo("c1", "2026-10-06T10:00")], [rota("R1", "c1", { total_entregue: null })], "2026-10-06");
    expect(p[0]).toMatchObject({ entregues: null, perc_entregue: null, falhas: null });
    expect(p[0].integridade.join()).toContain("sem total entregue");
  });

  it("aponta divergência entre esperado e recebido", () => {
    const p = montarPainel(bases, [ciclo("c1", "2026-10-06T10:00", "concluido", { pacotes_recebidos: 31 })], [rota("R1", "c1")], "2026-10-06");
    expect(p[0].integridade.join()).toContain("pacotes esperados 30 × recebidos 31");
  });

  it("cai para a última data disponível só quando a data não foi escolhida manualmente", () => {
    expect(escolherDataEfetiva("2026-10-07", false, false, "2026-10-06")).toEqual({ data: "2026-10-06", fallback: true });
    expect(escolherDataEfetiva("2026-10-07", true, false, "2026-10-06")).toEqual({ data: "2026-10-07", fallback: false });
    expect(escolherDataEfetiva("2026-10-06", false, true, "2026-10-06")).toEqual({ data: "2026-10-06", fallback: false });
    expect(escolherDataEfetiva("2026-10-07", false, false, null)).toEqual({ data: "2026-10-07", fallback: false });
  });
});

import { painelParaResultado } from "../src/lib/meli-piloto-adapter";
import { contadorLogistics, somarContadoresCompletos } from "../src/lib/meli-piloto-adapter";
describe("contadores reais de insucesso do Logistics", () => {
  it("separa entregues, falhas e pendentes sem calcular falhas por diferença", () => {
    const painel = montarPainel(bases, [ciclo("c1", "2026-10-06T10:00")], [rota("R1", "c1", {
      total_pedidos: 10, total_entregue: 5,
      payload: { contadores_logistics: { notDelivered: 2, pending: 3 } },
    })], "2026-10-06");
    const r = painelParaResultado(painel, "2026-10-06", {}, new Map([["ESP15", "b15"]]));
    expect(r.cards).toMatchObject({ entregue: 5, insucesso: 2, em_rota: 3 });
    expect(r.bases?.[0]).toMatchObject({ insucesso: 2, em_rota: 3 });
    expect(r.rotas?.[0]).toMatchObject({ insucesso: 2, em_rota: 3 });
  });
  it("distingue zero informado de ausência e não soma informação parcial como total", () => {
    expect(contadorLogistics(rota("R1", "c1"), "notDelivered")).toBeNull();
    expect(contadorLogistics(rota("R1", "c1", { payload: { contadores_logistics: { notDelivered: 0 } } }), "notDelivered")).toBe(0);
    expect(somarContadoresCompletos([2, null])).toBeNull();
    expect(somarContadoresCompletos([2, 0])).toBe(2);
  });
});
describe("Adaptador piloto → layout do Dashboard", () => {
  it("preenche o formato antigo, ESP18 desativada e falhas como não disponível (null)", () => {
    const painel = montarPainel(bases, [ciclo("c1", "2026-10-06T10:00")], [rota("R1", "c1", { id: "u1" })], "2026-10-06");
    const r = painelParaResultado(painel, "2026-10-06", {}, new Map([["ESP15", "b15"], ["ESP18", "b18"]]));
    expect(r.cards).toMatchObject({ rotas: 1, total: 10, entregue: 5, em_rota: null, perc_entrega: 50, insucesso: null });
    expect(r.bases?.[1]).toMatchObject({ base_codigo: "ESP18", sem_informacao: true, total: null });
    expect(r.rotas?.[0]).toMatchObject({ rota_id: "u1", driver_name: "Ana", vehicle_license: "ABC1D23" });
  });
});

describe("estação invisível/vazia com rotas visíveis", () => {
  it("bases da allowlist atual aparecem com rotas visíveis, mesmo sem ciclo visível", () => {
    const semEst: BaseInfo[] = [
      { id: "b15", codigo: "ESP15", nome: "A", ativa_no_piloto: false, estacao_confirmada: false },
      { id: "b18", codigo: "ESP18", nome: "Franco da Rocha", ativa_no_piloto: false, estacao_confirmada: false },
    ];
    const p = montarPainel(semEst, [], [rota("R1", "cX"), rota("R2", "cX"), rota("Z", "cX", { base_id: "b18" })], "2026-10-06");
    expect(p[0]).toMatchObject({ situacao: "ativa", rotas: 2, pacotes: 20, ultimo_ciclo: null });
    expect(p[0].integridade.join(" ")).toMatch(/ciclo de coleta não visível/);
    expect(p[1]).toMatchObject({ situacao: "ativa", rotas: 1 });
  });
});
