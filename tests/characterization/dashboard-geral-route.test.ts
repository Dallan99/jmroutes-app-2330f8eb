import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("rota do dashboard geral", () => {
  it("mantém /dashboard-geral ligado à tela principal do dashboard", () => {
    const rota = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/dashboard-geral.tsx"),
      "utf8",
    );

    expect(rota).toContain('createFileRoute("/_authenticated/dashboard-geral")');
    expect(rota).toContain('import { DashboardPage } from "./dashboard"');
    expect(rota).toContain("component: DashboardPage");
  });

  it("preserva a rota solicitada quando o usuário precisa fazer login", () => {
    const rotaAutenticada = readFileSync(
      resolve(process.cwd(), "src/routes/_authenticated/route.tsx"),
      "utf8",
    );

    expect(rotaAutenticada).toContain("beforeLoad: async ({ location })");
    expect(rotaAutenticada).toContain("search: { next: location.href }");
  });
});
