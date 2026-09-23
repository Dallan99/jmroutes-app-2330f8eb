import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  avisoPmProgramadas,
  estadoOperacionalRota,
  pmExcluidaDosIndicadores,
  rotaEhPM,
} from "../../src/lib/meli-pm";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260923173000_xpt_somente_am.sql"),
  "utf8",
);
const migrationDashboard = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260814152906_eba18983-b1f1-4298-8d2b-ee351e75a8c8.sql"),
  "utf8",
);

const PM = { base_codigo: "ESP16", cluster: "F12_PM1", route_id: "424028844" };

describe("regra central AM das XPTs", () => {
  it("reconhece o marcador PM no nome operacional", () => {
    expect(rotaEhPM("F12_PM1")).toBe(true);
    expect(rotaEhPM("VH7_PM1")).toBe(true);
    expect(rotaEhPM("V1_AM1")).toBe(false);
    expect(rotaEhPM("J12_SD")).toBe(false);
  });

  it("PM não iniciada da ESP16 fica fora dos indicadores", () => {
    const rota = {
      ...PM,
      route_status: "planned",
      route_substatus: "on_way_destination_facility",
      total: 80,
      entregue: 0,
      em_rota: 0,
      insucesso: 0,
      cancelado: 0,
    };
    expect(estadoOperacionalRota(rota)).toBe("nao_iniciada");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
  });

  it("PM com pacote em rota continua fora da janela AM", () => {
    const rota = { ...PM, route_status: "planned", route_substatus: "planned", total: 80, em_rota: 1 };
    expect(estadoOperacionalRota(rota)).toBe("em_andamento");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
  });

  it("PM com pacote entregue continua fora da janela AM", () => {
    const rota = { ...PM, route_status: "planned", route_substatus: "planned", total: 80, entregue: 3 };
    expect(estadoOperacionalRota(rota)).toBe("em_andamento");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
  });

  it("PM com insucesso continua fora da janela AM", () => {
    const rota = { ...PM, route_status: "planned", route_substatus: "planned", total: 80, insucesso: 2 };
    expect(estadoOperacionalRota(rota)).toBe("em_andamento");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
  });

  it("PM em andamento pelo status Meli continua fora da janela AM", () => {
    const rota = { ...PM, route_status: "active", route_substatus: "started", total: 80 };
    expect(estadoOperacionalRota(rota)).toBe("em_andamento");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
  });

  it("PM finalizada continua fora da janela AM", () => {
    const todosTerminais = {
      ...PM,
      route_status: "close",
      route_substatus: "started",
      total: 10,
      entregue: 8,
      insucesso: 1,
      cancelado: 1,
    };
    expect(estadoOperacionalRota(todosTerminais)).toBe("finalizada");
    expect(pmExcluidaDosIndicadores(todosTerminais)).toBe(true);

    const porStatus = { ...PM, route_status: "finished", route_substatus: "started", total: 10 };
    expect(estadoOperacionalRota(porStatus)).toBe("finalizada");
    expect(pmExcluidaDosIndicadores(porStatus)).toBe(true);
  });

  it("PM das quatro XPTs é excluída e PM de outra base não", () => {
    const rota = {
      base_codigo: "ESP15",
      cluster: "F12_PM1",
      route_status: "planned",
      route_substatus: "on_way_destination_facility",
      total: 80,
    };
    expect(estadoOperacionalRota(rota)).toBe("nao_iniciada");
    expect(pmExcluidaDosIndicadores(rota)).toBe(true);
    expect(pmExcluidaDosIndicadores({ ...rota, base_codigo: "SSP20" })).toBe(false);
  });

  it("rota comum não iniciada da ESP16 continua nos indicadores", () => {
    const rota = {
      base_codigo: "ESP16",
      cluster: "J12_SD",
      route_status: "planned",
      route_substatus: "on_way_destination_facility",
      total: 40,
    };
    expect(pmExcluidaDosIndicadores(rota)).toBe(false);
  });

  it("aviso do cartão mostra somente PM não iniciadas", () => {
    expect(avisoPmProgramadas(0, 0)).toBeNull();
    expect(avisoPmProgramadas(8, 614)).toBe(
      "8 rotas PM não iniciadas · 614 pacotes fora dos indicadores de hoje",
    );
    expect(avisoPmProgramadas(1, 80)).toBe(
      "1 rota PM não iniciada · 80 pacotes fora dos indicadores de hoje",
    );
  });
});

describe("consistência entre banco e telas", () => {
  it("SQL centraliza a regra em meli_rota_pm_excluida", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.meli_rota_pm_excluida");
    expect(migration).toContain("b.codigo IN ('ESP15','ESP16','ESP17','ESP18')");
  });

  it("numerador e denominador usam o mesmo conjunto (mesma CTE pac)", () => {
    // A exclusão ocorre uma única vez, na origem dos pacotes agregados.
    expect(migrationDashboard).toContain("WHERE NOT r.pm_excluida");
    const ocorrencias = migrationDashboard.match(/FROM pac\b/g) ?? [];
    expect(ocorrencias.length).toBeGreaterThanOrEqual(4);
    // percentual e totais derivam da mesma CTE
    expect(migrationDashboard).toContain("'perc_entrega', CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0");
  });

  it("dashboard devolve PM programadas separadamente, sem entrar nos cards", () => {
    expect(migrationDashboard).toContain("'pm_programadas', (SELECT j FROM pm_json)");
    expect(migrationDashboard).toContain("'pm_nao_iniciadas', (SELECT rotas FROM pm_json)");
    expect(migrationDashboard).toContain("'pm_pacotes_fora',  (SELECT pacotes FROM pm_json)");
  });

  it("área de risco aplica a mesma regra central", () => {
    expect(migrationDashboard).toContain("AND NOT public.meli_rota_pm_excluida(r.id)");
  });

  it("cards, modal, Dashboard Operacional, Gerencial e Modo TV consomem a mesma fonte", () => {
    const arquivos = [
      "src/components/dashboard-geral.tsx",
      "src/components/meli-dashboard.tsx",
      "src/routes/tv.meli.tsx",
    ];
    for (const f of arquivos) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src).toContain("meliDashboardOperacional");
      // nenhuma tela reimplementa a regra PM
      expect(src).not.toMatch(/ESP16['"]?\s*&&/);
    }
  });

  it("modal separa rotas operacionais de hoje e PM programadas", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/dashboard-geral.tsx"), "utf8");
    expect(src).toContain("Rotas operacionais de hoje");
    expect(src).toContain("PM programadas para amanhã");
    expect(src).toContain("avisoPmProgramadas");
  });
});
