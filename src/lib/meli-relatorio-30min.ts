/** Regras puras do relatório operacional de 30 minutos do Meli. */

export const MOTIVOS_INSUCESSO = [
  { codigo: "buyer_absent", descricao: "Não havia ninguém no endereço" },
  { codigo: "business_closed", descricao: "Negócio fechado" },
  { codigo: "blocked_by_keyword", descricao: "Palavra-chave" },
  { codigo: "buyer_moved", descricao: "O comprador mudou de endereço" },
  { codigo: "missing", descricao: "Faltante" },
  { codigo: "bad_address", descricao: "O endereço está incorreto" },
  { codigo: "buyer_rejected", descricao: "Recusado pelo comprador" },
  { codigo: "inaccessible_address", descricao: "Área inacessível" },
  { codigo: "missrouted", descricao: "Pacote de outra área" },
  { codigo: "damaged", descricao: "Pacote avariado" },
  { codigo: "blocked", descricao: "Envio suspenso" },
] as const;

const CODIGOS_INSUCESSO = new Set<string>(MOTIVOS_INSUCESSO.map((m) => m.codigo));
const STATUS_ROTA_ENCERRADA = new Set(["close", "closed", "completed", "finished"]);

export type RotaRelatorioRow = {
  route_id: string;
  total_pedidos: number | null;
  total_entregue: number | null;
  coletado_em: string;
  payload?: { status?: unknown } | null;
};

export type PacoteRelatorioRow = {
  shipment_id: string | null;
  status: string | null;
  coletado_em: string;
  payload?: { substatus?: unknown; occurrence_code?: unknown } | null;
};

export type Relatorio30Min = {
  rotas: number;
  abertas: number;
  encerradas: number;
  total_pacotes: number;
  entregues: number;
  pendentes: number;
  insucessos: number;
  sacas: null;
  pnr: null;
  ds_percentual: number | null;
  motivos: Array<{ codigo: string; descricao: string; total: number }>;
  ultima_coleta: string | null;
  avisos_integridade: string[];
};

function textoNormalizado(valor: unknown): string {
  return typeof valor === "string" ? valor.trim().toLowerCase() : "";
}

/** Mantém somente o estado mais recente de cada shipment antes de totalizar. */
export function deduplicarPacotes(pacotes: PacoteRelatorioRow[]): PacoteRelatorioRow[] {
  const porShipment = new Map<string, PacoteRelatorioRow>();
  for (const pacote of pacotes) {
    const chave = pacote.shipment_id?.trim();
    if (!chave) continue;
    const atual = porShipment.get(chave);
    if (!atual || pacote.coletado_em > atual.coletado_em) porShipment.set(chave, pacote);
  }
  return [...porShipment.values()];
}

export function montarRelatorio30Min(
  rotasEntrada: RotaRelatorioRow[],
  pacotesEntrada: PacoteRelatorioRow[],
): Relatorio30Min {
  const rotas = new Map<string, RotaRelatorioRow>();
  for (const rota of rotasEntrada) {
    const atual = rotas.get(rota.route_id);
    if (!atual || rota.coletado_em > atual.coletado_em) rotas.set(rota.route_id, rota);
  }
  const listaRotas = [...rotas.values()];
  const pacotes = deduplicarPacotes(pacotesEntrada);
  const encerradas = listaRotas.filter((r) =>
    STATUS_ROTA_ENCERRADA.has(textoNormalizado(r.payload?.status)),
  ).length;
  const motivos = MOTIVOS_INSUCESSO.map((motivo) => ({
    ...motivo,
    total: pacotes.filter((p) => textoNormalizado(p.payload?.substatus) === motivo.codigo).length,
  }));
  const insucessos = motivos.reduce((soma, motivo) => soma + motivo.total, 0);
  const entregues = pacotes.filter((p) => textoNormalizado(p.status) === "delivered").length;
  const totalRotas = listaRotas.reduce((soma, r) => soma + Math.max(0, r.total_pedidos ?? 0), 0);
  const totalPacotes = pacotes.length || totalRotas;
  const pendentes = Math.max(0, totalPacotes - entregues - insucessos);
  const finalizados = entregues + insucessos;
  const avisos: string[] = [];

  if (pacotes.some((p) => !p.shipment_id?.trim())) avisos.push("Há pacote sem shipment_id; ele não entrou nos totais.");
  if (pacotes.length && totalRotas && pacotes.length !== totalRotas) {
    avisos.push(`Pacotes detalhados ${pacotes.length} × total informado nas rotas ${totalRotas}.`);
  }
  const substatusNaoMapeados = new Set(
    pacotes
      .map((p) => textoNormalizado(p.payload?.substatus))
      .filter((s) => s && s !== "delivered" && !CODIGOS_INSUCESSO.has(s)),
  );
  if (substatusNaoMapeados.size) {
    avisos.push(`Substatus mantidos como pendentes: ${[...substatusNaoMapeados].join(", ")}.`);
  }

  const ultimaColeta = [...listaRotas.map((r) => r.coletado_em), ...pacotes.map((p) => p.coletado_em)]
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  return {
    rotas: listaRotas.length,
    abertas: Math.max(0, listaRotas.length - encerradas),
    encerradas,
    total_pacotes: totalPacotes,
    entregues,
    pendentes,
    insucessos,
    sacas: null,
    pnr: null,
    ds_percentual: finalizados > 0 ? Math.round((entregues / finalizados) * 1000) / 10 : null,
    motivos,
    ultima_coleta: ultimaColeta,
    avisos_integridade: avisos,
  };
}
