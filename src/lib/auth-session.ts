import { supabase } from "@/integrations/supabase/client";

const ESPERA_REVALIDACAO_MS = 500;

/**
 * Valida a sessão no Supabase, tolerando oscilações breves do gateway.
 * A função nunca transforma uma sessão local em autorização: o usuário só é
 * devolvido quando uma chamada real a getUser() termina com sucesso.
 */
export async function obterUsuarioValidado(tentativas = 3) {
  let ultimoResultado: Awaited<ReturnType<typeof supabase.auth.getUser>> | null = null;

  for (let tentativa = 1; tentativa <= tentativas; tentativa += 1) {
    ultimoResultado = await supabase.auth.getUser();
    if (!ultimoResultado.error && ultimoResultado.data.user) return ultimoResultado;
    if (tentativa < tentativas) {
      await new Promise((resolve) => setTimeout(resolve, ESPERA_REVALIDACAO_MS * tentativa));
    }
  }

  return ultimoResultado!;
}
