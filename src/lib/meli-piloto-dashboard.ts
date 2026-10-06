/** Regras puras do Dashboard do piloto Meli (somente leitura, testáveis). */

export const BASES_PILOTO = ["ESP15", "ESP16", "ESP17", "ESP18"] as const;

export type CicloRow = {
  id: string; base_id: string; base_codigo: string; status: string;
  iniciado_em: string; finalizado_em: string | null;
  rotas_esperadas: number | null; rotas_recebidas: number;
  pacotes_esperados: number | null; pacotes_recebidos: number;
  paginas_esperadas: number | null; paginas_lidas: number;
};
export type RotaRow = {
  id?: string;
  base_id: string; route_id: string; data_rota: string; ultimo_ciclo_id: string;
  motorista_nome: string | null; placa: string | null;
  total_pedidos: number | null; total_entregue: number | null; coletado_em: string;
};
export type BaseInfo = { id: string; codigo: string; nome: string; ativa_no_piloto: boolean; estacao_confirmada: boolean };

export type PainelBase = {
  base_codigo: string; base_nome: string;
  situacao: "ativa" | "desativada" | "sem_dados";
  ultimo_ciclo: CicloRow | null;
  rotas: number | null; pacotes: number | null; entregues: number | null;
  falhas: null; perc_entregue: number | null; ultima_sincronizacao: string | null;
  integridade: string[];
  lista: RotaRow[];
};

/** Último ciclo concluído de cada base (ciclos repetidos/parciais nunca são somados). */
export function ultimoCicloValidoPorBase(ciclos: CicloRow[]): Map<string, CicloRow> {
  const m = new Map<string, CicloRow>();
  for (const c of ciclos) {
    if (c.status !== "concluido") continue;
    const atual = m.get(c.base_id);
    if (!atual || c.iniciado_em > atual.iniciado_em) m.set(c.base_id, c);
  }
  return m;
}

/** Soma que devolve null (não disponível) quando nenhum valor existe. */
export function somaOuNull(v: (number | null | undefined)[]): number | null {
  const ok = v.filter((x): x is number => typeof x === "number");
  return ok.length ? ok.reduce((a, b) => a + b, 0) : null;
}

export function montarPainel(
  bases: BaseInfo[], ciclos: CicloRow[], rotas: RotaRow[], data: string,
): PainelBase[] {
  const ultimos = ultimoCicloValidoPorBase(ciclos);
  const inicioCiclo = new Map(ciclos.map((c) => [c.id, c.iniciado_em]));
  return bases.map((b) => {
    const vazio = { rotas: null, pacotes: null, entregues: null, falhas: null, perc_entregue: null, lista: [] as RotaRow[], integridade: [] as string[] };
    if (!b.ativa_no_piloto || !b.estacao_confirmada) {
      return { base_codigo: b.codigo, base_nome: b.nome, situacao: "desativada", ultimo_ciclo: null, ultima_sincronizacao: null, ...vazio };
    }
    const ciclo = ultimos.get(b.id) ?? null;
    if (!ciclo) return { base_codigo: b.codigo, base_nome: b.nome, situacao: "sem_dados", ultimo_ciclo: null, ultima_sincronizacao: null, ...vazio };
    // Uma linha por rota/dia (chave única); só rotas vistas no último ciclo válido ou depois.
    const unicas = new Map<string, RotaRow>();
    for (const r of rotas) {
      if (r.base_id !== b.id || r.data_rota !== data) continue;
      const ini = inicioCiclo.get(r.ultimo_ciclo_id);
      if (!ini || ini < ciclo.iniciado_em) continue;
      unicas.set(r.route_id, r);
    }
    const lista = [...unicas.values()].sort((x, y) => x.route_id.localeCompare(y.route_id));
    if (!lista.length) return { base_codigo: b.codigo, base_nome: b.nome, situacao: "sem_dados", ultimo_ciclo: ciclo, ultima_sincronizacao: ciclo.finalizado_em, ...vazio };
    const pacotes = somaOuNull(lista.map((r) => r.total_pedidos));
    const entregues = somaOuNull(lista.map((r) => r.total_entregue));
    const integridade: string[] = [];
    if (ciclo.rotas_esperadas != null && ciclo.rotas_esperadas !== ciclo.rotas_recebidas) integridade.push(`rotas esperadas ${ciclo.rotas_esperadas} × recebidas ${ciclo.rotas_recebidas}`);
    if (ciclo.pacotes_esperados != null && ciclo.pacotes_esperados !== ciclo.pacotes_recebidos) integridade.push(`pacotes esperados ${ciclo.pacotes_esperados} × recebidos ${ciclo.pacotes_recebidos}`);
    if (ciclo.paginas_esperadas != null && ciclo.paginas_esperadas !== ciclo.paginas_lidas) integridade.push(`páginas esperadas ${ciclo.paginas_esperadas} × lidas ${ciclo.paginas_lidas}`);
    const semEntregue = lista.filter((r) => r.total_entregue == null).length;
    if (semEntregue) integridade.push(`${semEntregue} rota(s) sem total entregue informado`);
    return {
      base_codigo: b.codigo, base_nome: b.nome, situacao: "ativa", ultimo_ciclo: ciclo,
      rotas: lista.length, pacotes, entregues, falhas: null,
      perc_entregue: pacotes && entregues != null ? Math.round((entregues / pacotes) * 1000) / 10 : null,
      ultima_sincronizacao: ciclo.finalizado_em, integridade, lista,
    };
  });
}

/** Data a exibir: a escolhida, ou — se não foi escolha manual e está vazia — a mais recente com dados. Nunca mistura datas. */
export function escolherDataEfetiva(pedida: string, manual: boolean, temDados: boolean, maisRecente: string | null) {
  if (manual || temDados || !maisRecente || maisRecente === pedida) return { data: pedida, fallback: false };
  return { data: maisRecente, fallback: true };
}
