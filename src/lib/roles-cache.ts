/**
 * Guarda os papéis (roles) do último perfil carregado com sucesso, por usuário,
 * para o menu lateral não "encolher" enquanto a consulta `meu-perfil` demora.
 *
 * Só afeta o que o menu mostra: as permissões continuam sendo verificadas no
 * servidor (RLS e server functions) em cada consulta.
 */
const PREFIXO = "jmr.roles.";
const VALIDADE_MS = 30 * 24 * 3600_000;

type Salvo = { roles: string[]; salvoEm: number };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function lerRolesSalvas(userId: string | null | undefined, agora = Date.now()): string[] | null {
  if (!userId) return null;
  try {
    const bruto = storage()?.getItem(PREFIXO + userId);
    if (!bruto) return null;
    const salvo = JSON.parse(bruto) as Partial<Salvo>;
    if (!Array.isArray(salvo.roles) || typeof salvo.salvoEm !== "number") return null;
    if (agora - salvo.salvoEm > VALIDADE_MS) return null;
    return salvo.roles.filter((r): r is string => typeof r === "string");
  } catch {
    return null;
  }
}

export function salvarRoles(userId: string | null | undefined, roles: string[], agora = Date.now()): void {
  if (!userId) return;
  try {
    storage()?.setItem(PREFIXO + userId, JSON.stringify({ roles, salvoEm: agora } satisfies Salvo));
  } catch {
    /* armazenamento indisponível (aba anônima, cota): segue sem cache */
  }
}

export function limparRolesSalvas(): void {
  try {
    const s = storage();
    if (!s) return;
    const chaves: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const chave = s.key(i);
      if (chave?.startsWith(PREFIXO)) chaves.push(chave);
    }
    for (const chave of chaves) s.removeItem(chave);
  } catch {
    /* ignora */
  }
}
