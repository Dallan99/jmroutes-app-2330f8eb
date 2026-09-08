import { createFileRoute } from "@tanstack/react-router";
import { DashboardGeralOperacional } from "@/components/dashboard-geral-operacional";

export const Route = createFileRoute("/_authenticated/dashboard-geral")({
  head: () => ({ meta: [{ title: "Dashboard Geral — JM Transportes" }] }),
  component: DashboardGeralOperacional,
});
