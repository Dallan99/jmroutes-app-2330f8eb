import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const ESPERA_REVALIDACAO_MS = 500;
const CACHE_VALIDACAO_MS = 15_000;
let usuarioValidado: { user: User; ate: number } | null = null;

export function registrarUsuarioValidado(user: User) {
  usuarioValidado = { user, ate: Date.now() + CACHE_VALIDACAO_MS };
}

/**
 * Valida a sessão no Supabase, tolerando oscilações breves do gateway.
 * A função nunca transforma uma sessão local em autorização: o usuário só é
 * devolvido quando uma chamada real a getUser() termina com sucesso.
 */
export async function obterUsuarioValidado(tentativas = 3) {
  if (usuarioValidado && usuarioValidado.ate > Date.now()) {
    return { data: { user: usuarioValidado.user }, error: null };
  }
  usuarioValidado = null;

  let ultimoResultado: Awaited<ReturnType<typeof supabase.auth.getUser>> | null = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    ultimoResultado = await supabase.auth.getUser();
    if (!ultimoResultado.error && ultimoResultado.data.user) {
      registrarUsuarioValidado(ultimoResultado.data.user);
      return ultimoResultado;
    }
    if (tentativa < tentativas) {
      await new Promise((resolve) => setTimeout(resolve, ESPERA_REVALIDACAO_MS * tentativa));
    }
  }

  return ultimoResultado!;
}
