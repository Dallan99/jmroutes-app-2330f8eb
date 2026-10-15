import type { SupabaseClient } from "@supabase/supabase-js";

const TABELAS_IMPLANTADAS = new Set([
  "audit_logs", "bases", "bases_operacionais", "contagens", "contagens_rotas_lock",
  "devolucoes", "escalas", "importacoes_escala", "meli_piloto_ciclos", "meli_piloto_erros",
  "meli_piloto_estacoes", "meli_piloto_heartbeat", "meli_piloto_pacotes", "meli_piloto_paginas",
  "meli_piloto_rotas", "meli_piloto_staging", "motoristas", "motoristas_safe", "profiles",
  "recebimentos", "rotas", "shipments", "user_bases", "user_roles", "volumes",
]);
const RPCS_IMPLANTADAS = new Set([
  "get_allowed_bases", "has_base_access", "has_role", "meli_piloto_ingerir_lote",
  "meli_piloto_publicar_recebimento", "meli_piloto_registrar_heartbeat", "meli_piloto_validar_estacao",
]);

export function tabelaImplantada(tabela: string): boolean {
  return TABELAS_IMPLANTADAS.has(tabela);
}

/** Compatibility for retained legacy modules, not an extension of the real schema.
 * Keeps the original client/session and refuses undeployed resources before any request.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clienteDeModulo(cliente: unknown): SupabaseClient<any> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const original = cliente as SupabaseClient<any>;
  return new Proxy(original, {
    get(target, prop) {
      if (prop === "from" || prop === "rpc") {
        return (nome: string, ...args: unknown[]) => {
          const permitidas = prop === "from" ? TABELAS_IMPLANTADAS : RPCS_IMPLANTADAS;
          if (!permitidas.has(nome)) throw new Error("Módulo em implantação");
          return Reflect.apply(Reflect.get(target, prop), target, [nome, ...args]);
        };
      }
      return Reflect.get(target, prop);
    },
  });
}