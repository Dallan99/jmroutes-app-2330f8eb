/**
 * Limita o tempo de espera de uma consulta (server function) no navegador.
 *
 * Com o banco sobrecarregado, chamadas chegaram a levar mais de 2 minutos e a
 * tela ficava em "Atualizando..." sem explicação. Depois do limite, a consulta
 * falha com uma mensagem clara; o React Query mantém os últimos dados na tela
 * e tenta de novo no próximo intervalo.
 */
export const TIMEOUT_CONSULTA_MS = 30_000;

export class ConsultaDemoradaError extends Error {
  constructor(segundos: number) {
    super(`O servidor demorou mais de ${segundos} s para responder. Tentando novamente em instantes.`);
    this.name = "ConsultaDemoradaError";
  }
}

export function comTimeout<T>(consulta: Promise<T>, ms = TIMEOUT_CONSULTA_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => rejeitar(new ConsultaDemoradaError(Math.round(ms / 1000))), ms);
  });
  return Promise.race([consulta, limite]).finally(() => clearTimeout(timer));
}

/** Mensagem amigável para exibir quando uma consulta falha. */
export function mensagemDeErroConsulta(erro: unknown): string {
  if (erro instanceof ConsultaDemoradaError) return erro.message;
  const texto = erro instanceof Error ? erro.message : String(erro ?? "");
  if (/timeout|timed out|statement timeout|upstream/i.test(texto)) {
    return "O servidor está demorando para responder. Tentando novamente em instantes.";
  }
  if (/fetch failed|network|Failed to fetch/i.test(texto)) {
    return "Sem conexão com o servidor. Tentando novamente em instantes.";
  }
  return "Não foi possível carregar os dados agora. Tentando novamente em instantes.";
}
