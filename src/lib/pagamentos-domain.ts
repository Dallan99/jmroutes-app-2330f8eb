export const TIPOS_VEICULO = ["passeio", "utilitario", "vuc"] as const;
export type TipoVeiculo = (typeof TIPOS_VEICULO)[number];

export function inicioSemanaDomingo(data: Date): string {
  const local = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  local.setDate(local.getDate() - local.getDay());
  return local.toISOString().slice(0, 10);
}

export function fimSemanaSabado(inicio: string): string {
  const data = new Date(`${inicio}T12:00:00`);
  data.setDate(data.getDate() + 6);
  return data.toISOString().slice(0, 10);
}

export function pagamentoQuartaSeguinte(inicio: string): string {
  const data = new Date(`${inicio}T12:00:00`);
  data.setDate(data.getDate() + 10);
  return data.toISOString().slice(0, 10);
}

export function percentualEntregue(entregues: number, total: number): number {
  return total > 0 ? (entregues / total) * 100 : 0;
}

export function rotaPagavel(entregues: number, total: number, minimo = 90): boolean {
  return total > 0 && percentualEntregue(entregues, total) > minimo;
}

export function valorRota(tipo: TipoVeiculo): number {
  return tipo === "passeio" ? 200 : tipo === "utilitario" ? 300 : 500;
}

