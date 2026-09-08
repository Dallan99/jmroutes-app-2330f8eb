import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "./dashboard";

/**
 * Endereço estável para o dashboard geral compartilhado externamente.
 * Reutiliza a mesma tela de /dashboard para evitar divergência de dados e layout.
 */
export const Route = createFileRoute("/_authenticated/dashboard-geral")({
  head: () => ({ meta: [{ title: "Dashboard Geral — JM Transportes" }] }),
  component: DashboardPage,
});
