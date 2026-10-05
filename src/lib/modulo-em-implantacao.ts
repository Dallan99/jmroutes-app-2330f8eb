import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Implantação por etapas no banco novo.
 *
 * Os tipos em src/integrations/supabase/types.ts refletem SOMENTE as tabelas
 * que existem de fato no banco. Módulos das partes seguintes usam tabelas e
 * RPCs ainda não criadas; eles acessam o banco por `clienteDeModulo`, que
 * bloqueia em tempo de execução qualquer consulta a tabela/RPC não implantada
 * (erro "módulo em implantação"), em vez de enviar a consulta ao banco.
 *
 * Ao aplicar uma nova parte, acrescente aqui as tabelas/RPCs criadas.
 */
export const TABELAS_IMPLANTADAS: ReadonlySet<string> = new Set([
  "audit_logs",
  "bases",
  "bases_operacionais",
  "contagens",
  "contagens_rotas_lock",
  "devolucoes",
  "escalas",
  "importacoes_escala",
  "motoristas",
  "motoristas_safe",
  "profiles",
  "recebimentos",
  "rotas",
  "shipments",
  "user_bases",
  "user_roles",
  "volumes",
]);

export const RPCS_IMPLANTADAS: ReadonlySet<string> = new Set([
  "has_role",
  "has_base_access",
  "get_allowed_bases",
]);

export const MENSAGEM_MODULO_EM_IMPLANTACAO =
  "Módulo em implantação: este recurso ainda não está disponível no banco novo.";

export class ModuloEmImplantacaoError extends Error {
  readonly recurso: string;
  constructor(recurso: string) {
    super(`${MENSAGEM_MODULO_EM_IMPLANTACAO} (${recurso})`);
    this.name = "ModuloEmImplantacaoError";
    this.recurso = recurso;
  }
}

export function tabelaImplantada(nome: string) {
  return TABELAS_IMPLANTADAS.has(nome);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ClienteDeModulo = SupabaseClient<any, "public", any>;

/**
 * Envolve um cliente Supabase para módulos em implantação.
 * `.from(tabela)` e `.rpc(nome)` lançam ModuloEmImplantacaoError quando o
 * recurso ainda não existe no banco; o restante passa direto.
 */
export function clienteDeModulo(cliente: unknown): ClienteDeModulo {
  const alvo = cliente as ClienteDeModulo;
  return new Proxy(alvo, {
    get(obj, prop, receiver) {
      if (prop === "from") {
        return (tabela: string) => {
          if (!TABELAS_IMPLANTADAS.has(tabela)) throw new ModuloEmImplantacaoError(`tabela ${tabela}`);
          return obj.from(tabela);
        };
      }
      if (prop === "rpc") {
        return (nome: string, ...args: unknown[]) => {
          if (!RPCS_IMPLANTADAS.has(nome)) throw new ModuloEmImplantacaoError(`rotina ${nome}`);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (obj.rpc as any)(nome, ...args);
        };
      }
      const valor = Reflect.get(obj, prop, receiver);
      return typeof valor === "function" ? valor.bind(obj) : valor;
    },
  });
}
