import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard-geral")({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard" });
  },
});
