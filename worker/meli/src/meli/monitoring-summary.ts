import type { RotaLista } from "./list.js";

const BASES_SOMENTE_AM = new Set(["ESP15", "ESP16", "ESP17", "ESP18"]);

function rotaEhPM(rota: RotaLista): boolean {
  const alvo = `${rota.routeName ?? ""} ${rota.routeId}`.toUpperCase();
  return /(^|[^A-Z0-9])PM[0-9]*([^A-Z0-9]|$)/.test(alvo);
}

export type MonitoramentoResumo = {
  base_codigo: string;
  facility_id: string;
  service_center_id: string;
  rotas_totais: number;
  rotas_entrega: number;
  rotas_coleta: number;
  rotas_mistas: number;
  rotas_em_andamento: number;
  pacotes: number;
  sacas: number;
  pendentes: number;
  com_falhas: number;
  bem_sucedidos: number;
  coletado_em: string;
  /** Versão semântica usada para substituir snapshots antigos que incluíam PM. */
  escopo_rotas?: "AM";
  rotas: MonitoramentoRotaResumo[];
};

export type MonitoramentoRotaResumo = {
  route_id: string; nome_rota: string | null; motorista: string | null; placa: string | null;
  status: string | null; substatus: string | null; total: number; entregues: number;
  falhas: number; pendentes: number; sacas: number; saida_xpt_em: string | null;
  primeira_entrega_em: string | null;
};

export function resumirMonitoramento(
  rotas: RotaLista[],
  baseCode: string,
  serviceCenterId: string,
  coletadoEm = new Date().toISOString(),
): MonitoramentoResumo {
  const codigo = baseCode.trim().toUpperCase();
  const filtradas = rotas.filter(
    (rota) =>
      rota.facilityId?.trim().toUpperCase() === codigo &&
      !(BASES_SOMENTE_AM.has(codigo) && rotaEhPM(rota)),
  );
  const resumo: MonitoramentoResumo = {
    base_codigo: codigo,
    facility_id: codigo,
    service_center_id: serviceCenterId.trim().toUpperCase(),
    rotas_totais: filtradas.length,
    rotas_entrega: 0,
    rotas_coleta: 0,
    rotas_mistas: 0,
    rotas_em_andamento: 0,
    pacotes: 0,
    sacas: 0,
    pendentes: 0,
    com_falhas: 0,
    bem_sucedidos: 0,
    coletado_em: coletadoEm,
    ...(BASES_SOMENTE_AM.has(codigo) ? { escopo_rotas: "AM" as const } : {}),
    rotas: [],
  };
  for (const rota of filtradas) {
    if (rota.isDeliveryPickupRoute) resumo.rotas_mistas += 1;
    else if (rota.isPickupRoute) resumo.rotas_coleta += 1;
    else if (rota.isDeliveryRoute) resumo.rotas_entrega += 1;
    if (rota.status?.toLowerCase() === "active") resumo.rotas_em_andamento += 1;
    resumo.pacotes += rota.counters?.total ?? 0;
    resumo.sacas += rota.counters?.totalBags ?? 0;
    resumo.pendentes += rota.counters?.pending ?? 0;
    resumo.com_falhas += rota.counters?.notDelivered ?? 0;
    resumo.bem_sucedidos += rota.counters?.delivered ?? 0;
    resumo.rotas.push({
      route_id: rota.routeId, nome_rota: rota.routeName ?? null, motorista: rota.driverName ?? null,
      placa: rota.vehicleLicense ?? null, status: rota.status ?? null, substatus: rota.substatus ?? null,
      total: rota.counters?.total ?? 0, entregues: rota.counters?.delivered ?? 0,
      falhas: rota.counters?.notDelivered ?? 0, pendentes: rota.counters?.pending ?? 0,
      sacas: rota.counters?.totalBags ?? 0, saida_xpt_em: rota.departedAt ?? null,
      primeira_entrega_em: rota.firstDeliveryAt ?? null,
    });
  }
  return resumo;
}
