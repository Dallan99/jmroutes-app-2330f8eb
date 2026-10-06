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
    // Allowlist confirmada do piloto: ESP15/16/17. ESP18 sempre desativada.
    // Não depende de meli_piloto_estacoes (pode vir vazia para a sessão).
    if (!BASES_ATIVAS_PILOTO.includes(b.codigo as (typeof BASES_ATIVAS_PILOTO)[number])) {
      return { base_codigo: b.codigo, base_nome: b.nome, situacao: "desativada", ultimo_ciclo: null, ultima_sincronizacao: null, ...vazio };
    }
    const ciclo = ultimos.get(b.id) ?? null;
    const daBase = rotas.filter((r) => r.base_id === b.id && r.data_rota === data);
    const integridade: string[] = [];
    // Uma linha por rota/dia (chave única); só rotas vistas no último ciclo válido ou depois.
    const unicas = new Map<string, RotaRow>();
    if (ciclo) {
      for (const r of daBase) {
        const ini = inicioCiclo.get(r.ultimo_ciclo_id);
        if (!ini || ini < ciclo.iniciado_em) continue;
        unicas.set(r.route_id, r);
      }
    }
    if (!unicas.size && daBase.length) {
      // Rotas visíveis sem ciclo correspondente: mostra por rota, sem inventar status de ciclo.
      for (const r of daBase) unicas.set(r.route_id, r);
      integridade.push(ciclo ? "rotas fora do último ciclo concluído — exibidas por rota" : "ciclo de coleta não visível — dados exibidos por rota, sem status de ciclo");
    }
    const lista = [...unicas.values()].sort((x, y) => x.route_id.localeCompare(y.route_id));
    if (!lista.length) return { base_codigo: b.codigo, base_nome: b.nome, situacao: "sem_dados", ultimo_ciclo: ciclo, ultima_sincronizacao: ciclo?.finalizado_em ?? null, ...vazio };
    const pacotes = somaOuNull(lista.map((r) => r.total_pedidos));
    const entregues = somaOuNull(lista.map((r) => r.total_entregue));
    const cicloUsado = integridade.length ? null : ciclo;
    if (cicloUsado) {
      if (cicloUsado.rotas_esperadas != null && cicloUsado.rotas_esperadas !== cicloUsado.rotas_recebidas) integridade.push(`rotas esperadas ${cicloUsado.rotas_esperadas} × recebidas ${cicloUsado.rotas_recebidas}`);
      if (cicloUsado.pacotes_esperados != null && cicloUsado.pacotes_esperados !== cicloUsado.pacotes_recebidos) integridade.push(`pacotes esperados ${cicloUsado.pacotes_esperados} × recebidos ${cicloUsado.pacotes_recebidos}`);
      if (cicloUsado.paginas_esperadas != null && cicloUsado.paginas_esperadas !== cicloUsado.paginas_lidas) integridade.push(`páginas esperadas ${cicloUsado.paginas_esperadas} × lidas ${cicloUsado.paginas_lidas}`);
    }
    const semEntregue = lista.filter((r) => r.total_entregue == null).length;
    if (semEntregue) integridade.push(`${semEntregue} rota(s) sem total entregue informado`);
    const ultimaColeta = lista.map((r) => r.coletado_em).filter(Boolean).sort().pop() ?? null;
    return {
      base_codigo: b.codigo, base_nome: b.nome, situacao: "ativa", ultimo_ciclo: cicloUsado,
      rotas: lista.length, pacotes, entregues, falhas: null,
      perc_entregue: pacotes && entregues != null ? Math.round((entregues / pacotes) * 1000) / 10 : null,
      ultima_sincronizacao: cicloUsado?.finalizado_em ?? ultimaColeta, integridade, lista,
    };
  });
}

export const BASES_ATIVAS_PILOTO = ["ESP15", "ESP16", "ESP17"] as const;


/** Data a exibir: a escolhida, ou — se não foi escolha manual e está vazia — a mais recente com dados. Nunca mistura datas. */
export function escolherDataEfetiva(pedida: string, manual: boolean, temDados: boolean, maisRecente: string | null) {
  if (manual || temDados || !maisRecente || maisRecente === pedida) return { data: pedida, fallback: false };
  return { data: maisRecente, fallback: true };
}
