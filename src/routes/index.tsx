import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "JM Transportes — Prévia de pagamentos" },
      { name: "description", content: "Prévia temporária do módulo de pagamentos de motoristas." },
    ],
  }),
  component: () => <Navigate to="/preview-pagamentos" replace />,
});
