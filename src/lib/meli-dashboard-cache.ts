import type { MeliDashboardFiltros, MeliDashboardResult } from "@/lib/meli-dashboard.functions";

const PREFIXO = "jmroutes.meli.dashboard.v1";

type ResultadoCache = MeliDashboardResult & {
  cache_local?: boolean;
  cache_salvo_em?: string;
};

function chave(filtros: MeliDashboardFiltros) {
  const partes = Object.entries(filtros)
    .filter(([, valor]) => valor !== null && valor !== undefined && valor !== "")
    .sort(([a], [b]) => a.localeCompare(b));
  return `${PREFIXO}:${JSON.stringify(partes)}`;
}

function valido(resultado: MeliDashboardResult | null | undefined) {
  return resultado?.status === "ok" &&
    ((resultado.bases?.length ?? 0) > 0 || Number(resultado.cards?.total ?? 0) > 0);
}

function ler(filtros: MeliDashboardFiltros): ResultadoCache | null {
  if (typeof window === "undefined") return null;
  try {
    const salvo = JSON.parse(window.localStorage.getItem(chave(filtros)) ?? "null") as ResultadoCache | null;
    return valido(salvo) ? { ...salvo!, cache_local: true } : null;
  } catch {
    return null;
  }
}

function salvar(filtros: MeliDashboardFiltros, resultado: MeliDashboardResult): ResultadoCache {
  const salvo: ResultadoCache = { ...resultado, cache_local: false, cache_salvo_em: new Date().toISOString() };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(chave(filtros), JSON.stringify(salvo));
    } catch {
      // O banco continua sendo a fonte principal se o navegador bloquear storage.
    }
  }
  return salvo;
}

export async function buscarDashboardComContingencia(
  buscar: () => Promise<MeliDashboardResult>,
  filtros: MeliDashboardFiltros,
): Promise<ResultadoCache> {
  try {
    const atual = await buscar();
    if (valido(atual)) return salvar(filtros, atual);
    return ler(filtros) ?? atual;
  } catch (erro) {
    const anterior = ler(filtros);
    if (anterior) return anterior;
    throw erro;
  }
}

