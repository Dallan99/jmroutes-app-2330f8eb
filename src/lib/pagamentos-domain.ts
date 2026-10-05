/**
 * Regras puras da Prévia de Pagamento de Motoristas.
 * Sem acesso a banco: tudo aqui é determinístico e testável.
 */

export const LIMITE_PAGAVEL_PERCENTUAL = 90; // pagável somente se > 90

export type TipoVeiculo = "carro" | "utilitario" | "vuc";
export const TIPO_VEICULO_LABEL: Record<TipoVeiculo, string> = {
  carro: "Carro de passeio",
  utilitario: "Utilitário",
  vuc: "VUC",
};

export type Tarifa = {
  tipo_veiculo: TipoVeiculo;
  base_id: string | null;
  regiao: string | null;
  valor: number;
  vigencia_inicio: string; // yyyy-mm-dd
  vigencia_fim: string | null;
};

export type RotaEntrada = {
  route_id: string;
  data_rota: string | null;
  base_id: string | null;
  base_codigo: string | null;
  regiao: string | null;
  motorista_id: string | null;
  motorista_nome: string | null;
  placa: string | null;
  total_pedidos: number | null;
  entregues: number | null;
};

export type Pendencia =
  | "motorista_sem_identificacao"
  | "placa_ausente"
  | "placa_sem_tipo"
  | "rota_sem_base"
  | "rota_sem_pedidos"
  | "percentual_impossivel"
  | "rota_duplicada"
  | "rota_multiplos_motoristas"
  | "sem_tarifa";

export const PENDENCIA_LABEL: Record<Pendencia, string> = {
  motorista_sem_identificacao: "Motorista sem identificação",
  placa_ausente: "Rota sem placa",
  placa_sem_tipo: "Placa sem tipo de veículo",
  rota_sem_base: "Rota sem base",
  rota_sem_pedidos: "Rota sem total de pedidos",
  percentual_impossivel: "Percentual impossível",
  rota_duplicada: "Rota duplicada",
  rota_multiplos_motoristas: "Rota atribuída a mais de um motorista",
  sem_tarifa: "Sem tarifa configurada",
};

export type RotaCalculada = RotaEntrada & {
  tipo_veiculo: TipoVeiculo | null;
  percentual: number | null;
  pagavel: boolean;
  tarifa: number | null;
  valor: number;
  motivo: string | null;
  pendencias: Pendencia[];
};

export type Adicional = { motorista_chave: string; valor: number; motivo: string; observacao: string | null; data_relacionada: string | null };

export type MotoristaResumo = {
  chave: string;
  motorista_nome: string;
  base_codigo: string;
  placas: string[];
  tipos: TipoVeiculo[];
  rotas: RotaCalculada[];
  pagaveis: number;
  nao_pagaveis: number;
  pedidos: number;
  entregues: number;
  media_ponderada: number | null;
  valor_rotas: number;
  adicionais: number;
  total: number;
  pendencias: Pendencia[];
};

const centavos = (v: number) => Math.round(v * 100) / 100;

export function normalizarPlaca(p: string | null | undefined): string | null {
  const v = (p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return v.length ? v : null;
}

/** Semana de domingo a sábado e pagamento na quarta seguinte. */
export function semanaPagamento(dataIso: string) {
  const [y, m, d] = dataIso.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const inicio = new Date(base);
  inicio.setUTCDate(base.getUTCDate() - base.getUTCDay());
  const fim = new Date(inicio);
  fim.setUTCDate(inicio.getUTCDate() + 6);
  const pagamento = new Date(fim);
  pagamento.setUTCDate(fim.getUTCDate() + 4);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { inicio: iso(inicio), fim: iso(fim), pagamento: iso(pagamento) };
}

/** Semana anterior à data informada (padrão sugerido). */
export function semanaAnterior(hojeIso: string) {
  const atual = semanaPagamento(hojeIso);
  const [y, m, d] = atual.inicio.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - 7));
  return semanaPagamento(dt.toISOString().slice(0, 10));
}

export function escolherTarifa(tarifas: Tarifa[], tipo: TipoVeiculo, baseId: string | null, regiao: string | null, data: string | null): Tarifa | null {
  const dia = data ?? "9999-12-31";
  const vigentes = tarifas.filter(
    (t) => t.tipo_veiculo === tipo && t.vigencia_inicio <= dia && (!t.vigencia_fim || t.vigencia_fim >= dia),
  );
  const pontuar = (t: Tarifa) => {
    if (t.base_id && t.base_id !== baseId) return -1;
    if (t.regiao && t.regiao !== regiao) return -1;
    return (t.base_id ? 2 : 0) + (t.regiao ? 1 : 0);
  };
  return (
    vigentes
      .map((t) => ({ t, p: pontuar(t) }))
      .filter((x) => x.p >= 0)
      .sort((a, b) => b.p - a.p || b.t.vigencia_inicio.localeCompare(a.t.vigencia_inicio))[0]?.t ?? null
  );
}

export function calcularRotas(rotas: RotaEntrada[], tiposPorPlaca: Map<string, TipoVeiculo>, tarifas: Tarifa[]): RotaCalculada[] {
  const contagem = new Map<string, number>();
  const motoristasPorRota = new Map<string, Set<string>>();
  for (const r of rotas) {
    contagem.set(r.route_id, (contagem.get(r.route_id) ?? 0) + 1);
    const s = motoristasPorRota.get(r.route_id) ?? new Set<string>();
    s.add(r.motorista_id ?? r.motorista_nome ?? "?");
    motoristasPorRota.set(r.route_id, s);
  }
  return rotas.map((r) => {
    const pend: Pendencia[] = [];
    if (!r.motorista_id && !r.motorista_nome) pend.push("motorista_sem_identificacao");
    if (!r.base_id) pend.push("rota_sem_base");
    const placa = normalizarPlaca(r.placa);
    const tipo = placa ? tiposPorPlaca.get(placa) ?? null : null;
    if (!placa) pend.push("placa_ausente");
    else if (!tipo) pend.push("placa_sem_tipo");
    if ((contagem.get(r.route_id) ?? 0) > 1) pend.push("rota_duplicada");
    if ((motoristasPorRota.get(r.route_id)?.size ?? 0) > 1) pend.push("rota_multiplos_motoristas");

    const total = r.total_pedidos ?? 0;
    const entregues = r.entregues ?? 0;
    let percentual: number | null = null;
    if (!total || total <= 0) pend.push("rota_sem_pedidos");
    else {
      percentual = (entregues / total) * 100;
      if (percentual < 0 || percentual > 100 || entregues < 0) pend.push("percentual_impossivel");
    }
    const atingiu = percentual !== null && percentual > LIMITE_PAGAVEL_PERCENTUAL && !pend.includes("percentual_impossivel");
    const tarifaObj = tipo ? escolherTarifa(tarifas, tipo, r.base_id, r.regiao, r.data_rota) : null;
    if (tipo && !tarifaObj) pend.push("sem_tarifa");
    const pagavel = atingiu;
    const valor = pagavel && tarifaObj ? centavos(tarifaObj.valor) : 0;
    let motivo: string | null = null;
    if (!atingiu) {
      motivo = percentual === null
        ? "Sem total de pedidos"
        : `Entregue ${percentual.toFixed(1).replace(".", ",")}% (precisa ser maior que 90%)`;
    } else if (!tarifaObj) motivo = "Pagável, mas sem tarifa definida";
    return { ...r, placa, tipo_veiculo: tipo, percentual, pagavel, tarifa: tarifaObj?.valor ?? null, valor, motivo, pendencias: pend };
  });
}

export function chaveMotorista(r: Pick<RotaEntrada, "motorista_id" | "motorista_nome" | "base_codigo">) {
  return `${r.base_codigo ?? "?"}::${r.motorista_id ?? r.motorista_nome ?? "sem-identificacao"}`;
}

export function resumirMotoristas(rotas: RotaCalculada[], adicionais: Adicional[]): MotoristaResumo[] {
  const mapa = new Map<string, MotoristaResumo>();
  for (const r of rotas) {
    const chave = chaveMotorista(r);
    const m = mapa.get(chave) ?? {
      chave,
      motorista_nome: r.motorista_nome ?? "Sem identificação",
      base_codigo: r.base_codigo ?? "—",
      placas: [], tipos: [], rotas: [], pagaveis: 0, nao_pagaveis: 0, pedidos: 0, entregues: 0,
      media_ponderada: null, valor_rotas: 0, adicionais: 0, total: 0, pendencias: [],
    };
    m.rotas.push(r);
    if (r.placa && !m.placas.includes(r.placa)) m.placas.push(r.placa);
    if (r.tipo_veiculo && !m.tipos.includes(r.tipo_veiculo)) m.tipos.push(r.tipo_veiculo);
    if (r.pagavel) m.pagaveis++; else m.nao_pagaveis++;
    m.pedidos += r.total_pedidos ?? 0;
    m.entregues += r.entregues ?? 0;
    m.valor_rotas = centavos(m.valor_rotas + r.valor);
    for (const p of r.pendencias) if (!m.pendencias.includes(p)) m.pendencias.push(p);
    mapa.set(chave, m);
  }
  for (const a of adicionais) {
    const m = mapa.get(a.motorista_chave);
    if (m) m.adicionais = centavos(m.adicionais + a.valor);
  }
  return [...mapa.values()]
    .map((m) => ({
      ...m,
      media_ponderada: m.pedidos > 0 ? (m.entregues / m.pedidos) * 100 : null,
      total: centavos(m.valor_rotas + m.adicionais),
    }))
    .sort((a, b) => a.base_codigo.localeCompare(b.base_codigo) || a.motorista_nome.localeCompare(b.motorista_nome));
}
