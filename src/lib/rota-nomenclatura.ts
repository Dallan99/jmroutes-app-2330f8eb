/** Identificação de exibição; nunca substitui a chave de identidade da rota. */
export function nomenclaturaRota(rota: {
  cluster?: string | null;
  nome_operacional?: string | null;
  route_id: string;
}): string {
  const cluster = rota.cluster?.trim();
  if (cluster) return cluster;
  const nome = rota.nome_operacional?.trim();
  return nome && nome !== rota.route_id.trim() ? nome : "Nomenclatura não informada";
}