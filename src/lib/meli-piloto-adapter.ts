/**
 * Adaptador de leitura: converte o painel do piloto Meli (tabelas meli_piloto_*,
 * último ciclo concluído) no formato que o layout do Dashboard já consome
 * (MeliDashboardResult). Somente leitura. Campos sem fonte confiável vão como
 * null para a tela exibir "não disponível".
 */
import type { MeliDashboardResult, MeliDashboardRota, MeliDashboardBase } from "@/lib/meli-dashboard.functions";
import { BASES_PILOTO, escolherDataEfetiva, montarPainel, type BaseInfo, type CicloRow, type PainelBase, type RotaRow } from "@/lib/meli-piloto-dashboard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;
const ND = null as unknown as number; // "não disponível" no layout

export type FiltrosPiloto = { data?: string | null; manual?: boolean | null; base_id?: string | null; motorista?: string | null; rota?: string | null };

const COLS_ROTA = "id, base_id, route_id, data_rota, ultimo_ciclo_id, motorista_nome, placa, total_pedidos, total_entregue, coletado_em";

export function painelParaResultado(painel: PainelBase[], data: string, f: FiltrosPiloto, ids: Map<string, string>): MeliDashboardResult {
  const mot = f.motorista?.toLowerCase();
  const rot = f.rota?.toLowerCase();
  const rotas: MeliDashboardRota[] = [];
  const bases: MeliDashboardBase[] = [];
  for (const b of painel) {
    const baseId = ids.get(b.base_codigo) ?? null;
    if (f.base_id && f.base_id !== baseId) continue;
    const lista = b.lista.filter((r) =>
      (!mot || (r.motorista_nome ?? "").toLowerCase().includes(mot)) && (!rot || r.route_id.toLowerCase().includes(rot)));
    for (const r of lista) {
      const total = r.total_pedidos ?? ND;
      const ent = r.total_entregue ?? ND;
      rotas.push({
        rota_id: r.id ?? r.route_id, route_id: r.route_id, nome_operacional: r.route_id, cluster: null,
        base_id: baseId, base_codigo: b.base_codigo, base_nome: b.base_nome, service_center: null,
        driver_name: r.motorista_nome, vehicle_license: r.placa, carrier: null, data_rota: r.data_rota,
        last_synced_at: r.coletado_em, rota_area_risco: false, area_risco_parcial: false,
        total, nao_iniciado: ND,
        em_rota: r.total_pedidos != null && r.total_entregue != null ? r.total_pedidos - r.total_entregue : ND,
        entregue: ent, insucesso: ND, cancelado: ND, pacotes_risco: ND,
        perc_entrega: r.total_pedidos && r.total_entregue != null ? Math.round((r.total_entregue / r.total_pedidos) * 1000) / 10 : ND,
      });
    }
    const ativa = b.situacao === "ativa";
    bases.push({
      base_id: baseId, base_codigo: b.base_codigo,
      base_nome: b.situacao === "desativada" ? `${b.base_nome} — desativada / não configurada` : b.base_nome,
      service_center: null, rotas: ativa ? b.rotas ?? ND : ND, rotas_risco: ND, rotas_risco_integral: ND, rotas_risco_parcial: ND,
      total: ativa ? b.pacotes ?? ND : ND, pacotes_risco: ND, entregue: ativa ? b.entregues ?? ND : ND,
      em_rota: ativa && b.pacotes != null && b.entregues != null ? b.pacotes - b.entregues : ND,
      insucesso: ND, perc_entrega: ativa ? b.perc_entregue ?? ND : ND,
      sem_informacao: !ativa, snapshot_data: ativa ? data : null,
    });
  }
  const ativas = bases.filter((b) => !b.sem_informacao);
  const soma = (k: "rotas" | "total" | "entregue") => {
    const v = ativas.map((b) => b[k]).filter((x) => typeof x === "number");
    return v.length ? v.reduce((a, c) => a + c, 0) : ND;
  };
  const total = soma("total"), entregue = soma("entregue");
  const perc = typeof total === "number" && total > 0 && typeof entregue === "number" ? Math.round((entregue / total) * 1000) / 10 : ND;
  const sync = painel.map((b) => ({ base_id: ids.get(b.base_codigo) ?? null, base_codigo: b.base_codigo, last_synced_at: b.ultima_sincronizacao }));
  const ultima = sync.map((s) => s.last_synced_at).filter(Boolean).sort().pop() ?? null;
  return {
    status: "ok", data_operacional: data, server_time: new Date().toISOString(),
    cards: {
      total, nao_iniciado: ND, entregue, insucesso: ND, cancelado: ND, desconhecido: ND,
      em_rota: typeof total === "number" && typeof entregue === "number" ? total - entregue : ND,
      area_risco_pacotes: ND, elegiveis: total, perc_entrega: perc, rotas: soma("rotas"), rotas_risco: ND,
    },
    motivos_insucesso: [], rotas, bases, pm_programadas: [],
    ultima_sincronizacao: ultima, sincronizacao_por_base: sync,
    snapshot_fallback: false, snapshot_at: ultima, sla_geral: null,
  };
}

/** Lê o piloto e devolve no formato do layout; null quando não há fonte do piloto. */
export async function carregarPilotoComoResultado(sb: Sb, f: FiltrosPiloto, hoje: string): Promise<(MeliDashboardResult & { data_pedida?: string; fallback_data?: boolean }) | null> {
  const pedida = f.data ?? hoje;
  const [bRes, eRes, cRes] = await Promise.all([
    sb.from("bases").select("id, codigo, nome").in("codigo", [...BASES_PILOTO]),
    sb.from("meli_piloto_estacoes").select("base_id, confirmada, ativa_no_piloto"),
    sb.from("meli_piloto_ciclos")
      .select("id, base_id, base_codigo, status, iniciado_em, finalizado_em, rotas_esperadas, rotas_recebidas, pacotes_esperados, pacotes_recebidos, paginas_esperadas, paginas_lidas")
      .order("iniciado_em", { ascending: false }).limit(500),
  ]);
  if (bRes.error) {
    console.error("[piloto-adapter] bases:", bRes.error.message);
    return null;
  }
  // Estações e ciclos são complementares: falha/vazio não pode zerar rotas visíveis.
  if (eRes.error) console.error("[piloto-adapter] estacoes:", eRes.error.message);
  if (cRes.error) console.error("[piloto-adapter] ciclos:", cRes.error.message);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const est = new Map<string, any>((eRes.data ?? []).map((e: any) => [e.base_id, e]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bases: BaseInfo[] = (bRes.data ?? []).sort((a: any, b: any) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => ({ id: b.id, codigo: b.codigo, nome: b.nome, ativa_no_piloto: !!est.get(b.id)?.ativa_no_piloto, estacao_confirmada: !!est.get(b.id)?.confirmada }));
  if (!bases.length) return null;
  const ids = new Map(bases.map((b) => [b.codigo, b.id]));
  const ciclos = (cRes.data ?? []) as CicloRow[];
  const lerRotas = async (d: string) => {
    const r = await sb.from("meli_piloto_rotas").select(COLS_ROTA).eq("data_rota", d).limit(1000);
    if (r.error) throw new Error("Não foi possível ler os dados do piloto.");
    return (r.data ?? []) as RotaRow[];
  };
  let painel = montarPainel(bases, ciclos, await lerRotas(pedida), pedida);
  const temDados = painel.some((b) => b.situacao === "ativa");
  let escolha = { data: pedida, fallback: false };
  if (!temDados && !f.manual) {
    const { data: ult } = await sb.from("meli_piloto_rotas").select("data_rota").order("data_rota", { ascending: false }).limit(1);
    escolha = escolherDataEfetiva(pedida, false, false, ult?.[0]?.data_rota ?? null);
    if (escolha.fallback) painel = montarPainel(bases, ciclos, await lerRotas(escolha.data), escolha.data);
  }
  return { ...painelParaResultado(painel, escolha.data, f, ids), data_pedida: pedida, fallback_data: escolha.fallback };
}
