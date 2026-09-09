// ─────────────────────────────────────────────────────────────────────────────
// Feature flags do Modo TV.
//
// As visões "Operacional" e "Gerencial" continuam implementadas
// (src/routes/tv.dashboard.tsx e src/routes/tv.gerencial.tsx), porém estão
// ocultas da navegação porque hoje exibem indicadores zerados — não há
// integração em tempo real confiável para elas.
//
// Para reativar, basta ligar as flags abaixo. Nenhum código foi removido.
// ─────────────────────────────────────────────────────────────────────────────

export const TV_FLAGS = {
  /** Visão "Operacional" (/tv/dashboard) — exibe a bipagem por base. */
  visaoOperacional: false,
  /** Visão "Gerencial" (/tv/gerencial) visível na navegação do Modo TV. */
  visaoGerencial: false,
  /** Visão "Meli" (/tv/meli) — única fonte com dados reais no momento. */
  visaoMeli: true,
} as const;

/** Rota inicial do Modo TV. */
export const TV_ROTA_INICIAL = "/tv/meli" as const;

/** Bases hoje integradas ao worker Meli (usado para rótulo informativo). */
export const TV_BASES_INTEGRADAS = [
  "SSP3", "SSP38", "ESP15", "SSP5", "SSP20", "ESP17", "ESP16", "SSP17",
  "ESP18", "SSP6", "SSP45", "SSP15", "SSP37", "SSP23", "SSC2", "SSP4", "SSP7",
] as const;
