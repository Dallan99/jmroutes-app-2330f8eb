import type { RotaLista } from "./list.js";

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
};

export function resumirMonitoramento(
  rotas: RotaLista[],
  baseCode: string,
  serviceCenterId: string,
  coletadoEm = new Date().toISOString(),
): MonitoramentoResumo {
  const codigo = baseCode.trim().toUpperCase();
  const filtradas = rotas.filter((rota) => rota.facilityId?.trim().toUpperCase() === codigo);
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
  }
  return resumo;
}
