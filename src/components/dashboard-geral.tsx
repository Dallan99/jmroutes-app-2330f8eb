import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { hojeOperacional } from "@/lib/dia-operacional";
import {
  meliDashboardOperacional,
  meliDashboardPacotesRota,
  meliDashboardQueryKey,
  type MeliDashboardRota,
  type MeliDashboardPmProgramada,
} from "@/lib/meli-dashboard.functions";
import { avisoPmProgramadas, BASES_SOMENTE_AM, rotaEhPM } from "@/lib/meli-pm";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  SeloSincronizando,
  SyncBaseIndicador,
  type SituacaoSync,
} from "@/components/meli-sync-monitor";
import { ChevronLeft, Search } from "lucide-react";
import { buscarDashboardComContingencia } from "@/lib/meli-dashboard-cache";

const CORES = ["var(--info)", "var(--success)", "var(--warning)", "var(--destructive)"] as const;

function nf(n: number | null | undefined) {
  if (n === null) return "não disponível";
  return typeof n === "number" && !Number.isNaN(n) ? n.toLocaleString("pt-BR") : "—";
}

function obterMelhorSync(
  codigo: string | null | undefined,
  syncPorCodigo?: Map<
    string,
    {
      situacao: SituacaoSync;
      minutos: number | null;
      status?: string | null;
      sincronizando?: boolean;
    }
  >,
  syncSnapshotPorCodigo?: Map<
    string,
    { situacao: SituacaoSync; minutos: number | null; status: string }
  >,
) {
  if (!codigo) return undefined;
  const s1 = syncPorCodigo?.get(codigo);
  const s2 = syncSnapshotPorCodigo?.get(codigo);
  if (!s1) return s2;
  if (!s2) return s1;

  if (s1.minutos !== null && s2.minutos !== null) {
    return s1.minutos <= s2.minutos ? s1 : s2;
  }
  return s1.minutos !== null ? s1 : s2;
}

/**
 * Visão direta e imediata da operação: progresso por base + indicadores de entrega.
 */
export function DashboardGeral({
  data: dataProp,
  manual,
  syncPorCodigo,
}: {
  data?: string;
  manual?: boolean;
  /** Situação real de sincronização por código de base (backend/worker). */
  syncPorCodigo?: Map<
    string,
    {
      situacao: SituacaoSync;
      minutos: number | null;
      status?: string | null;
      sincronizando?: boolean;
    }
  >;
}) {
  const { diaOperacional } = useBaseOperacional();
  const dataRef = dataProp || diaOperacional || hojeOperacional();

  const fetchDados = useServerFn(meliDashboardOperacional);

  const filtros = useMemo(() => ({ data: dataRef, manual: !!manual }), [dataRef, manual]);

  // Se o dataRef for vazio ou null, o componente renderizará vazio até o carregamento.
  // Mas como dataRef tem fallback para hojeOperacional(), ele sempre terá um valor.

  const q = useQuery({
    queryKey: meliDashboardQueryKey(filtros),
    queryFn: () => buscarDashboardComContingencia(() => fetchDados({ data: filtros }), filtros),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const d = q.data?.status === "ok" ? q.data : undefined;
  const bases = (d?.bases ?? [])
    .slice()
    .sort((a, b) => (a.base_codigo ?? "").localeCompare(b.base_codigo ?? ""));
  const c = d?.cards;
  const snapshotEm = d?.snapshot_at ? new Date(d.snapshot_at) : null;
  const snapshotAtrasado = snapshotEm ? Date.now() - snapshotEm.getTime() > 5 * 60_000 : false;
  const syncSnapshotPorCodigo = useMemo(() => {
    const mapa = new Map<
      string,
      { situacao: SituacaoSync; minutos: number | null; status: string }
    >();
    const referencia = d?.server_time ? new Date(d.server_time).getTime() : Date.now();
    for (const item of d?.sincronizacao_por_base ?? []) {
      if (!item.base_codigo || !item.last_synced_at) continue;
      const instante = new Date(item.last_synced_at).getTime();
      if (Number.isNaN(instante)) continue;
      const minutos = Math.max(0, Math.floor((referencia - instante) / 60_000));
      const situacao: SituacaoSync =
        minutos > 25 ? "desatualizado" : minutos > 15 ? "atencao" : "atualizado";
      mapa.set(item.base_codigo, { situacao, minutos, status: "sucesso" });
    }
    return mapa;
  }, [d?.server_time, d?.sincronizacao_por_base]);

  const pmProgramadas = d?.pm_programadas ?? [];
  const [baseAberta, setBaseAberta] = useState<{
    id: string | null;
    codigo: string;
    nome: string;
    /** Resumo oficial do cartão (snapshot agregado) — repetido no topo do modal. */
    rotasSnapshot: number;
    total: number;
    entregue: number;
    em_rota: number;
    insucesso: number;
  } | null>(null);
  const pmDaBase = useMemo(() => {
    if (!baseAberta) return [];
    return pmProgramadas.filter((r) =>
      baseAberta.id ? r.base_id === baseAberta.id : (r.base_codigo ?? "") === baseAberta.codigo,
    );
  }, [pmProgramadas, baseAberta]);
  const rotasDaBase = useMemo(() => {
    if (!baseAberta) return [];
    return (d?.rotas ?? [])
      .filter((r) =>
        baseAberta.id ? r.base_id === baseAberta.id : (r.base_codigo ?? "") === baseAberta.codigo,
      )
      .slice()
      .sort((a, b) => (a.nome_operacional ?? "").localeCompare(b.nome_operacional ?? ""));
  }, [d?.rotas, baseAberta]);

  return (
    <section className="space-y-4">
      {d?.sla_geral && (
        <Card className="overflow-hidden border-primary/25 bg-primary/[0.04] p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                SLA Geral da Operação no Dia
              </p>
              <p className="mt-1 font-display text-4xl font-bold tabular-nums text-primary">
                {d.sla_geral.percentual.toFixed(2)}%
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Progresso: {nf(d.sla_geral.entregues_total)} de {nf(d.sla_geral.pacotes_total)} pacotes entregues.
              </p>
            </div>
            <div className="grid min-w-[280px] flex-1 grid-cols-2 gap-3 sm:grid-cols-5 lg:max-w-3xl">
              <MiniStat label="Bases" value={nf(d.sla_geral.bases_total)} />
              <MiniStat label="Rotas" value={nf(d.sla_geral.rotas_total)} />
              <MiniStat label="Total Pacotes" value={nf(d.sla_geral.pacotes_total)} />
              <MiniStat label="Entregues" value={nf(d.sla_geral.entregues_total)} className="text-success" />
              <MiniStat label="Falta entregar" value={nf(d.sla_geral.pendentes_total)} className="text-warning" />
            </div>
          </div>
        </Card>
      )}

      <Card className="p-4 md:p-5">
        <h2 className="text-sm font-semibold">Indicadores de entrega</h2>
        {d?.data_operacional && (
          <p className="text-xs font-semibold">
            Dados operacionais de {d.data_operacional.split("-").reverse().join("/")}
            {(d as { fallback_data?: boolean }).fallback_data && (
              <span className="ml-1 font-normal text-warning">— última data disponível (sem dados em {dataRef.split("-").reverse().join("/")})</span>
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Posição atual das rotas ativas e falhas em tempo real.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <BigStat label="Carros em rota" value={nf(c?.rotas)} tone="info" />
          <BigStat label="Pacotes" value={nf(c?.total)} />
          <BigStat label="Entregues" value={nf(c?.entregue)} tone="success" />
          <BigStat label="Falhas" value={nf(c?.insucesso)} tone="destructive" />
          <BigStat label="Rotas em área de risco" value={nf(c?.rotas_risco)} tone="destructive" />
        </div>
      </Card>

      <Card className="p-4 md:p-5">
        <h2 className="font-display text-xl md:text-2xl font-bold tracking-tight">
          Painel Operacional
        </h2>

        {(snapshotEm || d?.cache_local) && (
          <div
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              snapshotAtrasado
                ? "border-warning/40 bg-warning/10 text-warning-foreground"
                : "border-border bg-muted/30 text-muted-foreground"
            }`}
          >
            {d?.cache_local
              ? "Conexão interrompida. Mantendo o último resultado salvo"
              : snapshotAtrasado
                ? "Coleta sem atualização. Mantendo o último registro válido"
                : "Último registro válido"}{" "}
            de{" "}
            {(
              snapshotEm ?? (d?.cache_salvo_em ? new Date(d.cache_salvo_em) : null)
            )?.toLocaleString("pt-BR") ?? "horário indisponível"}
            .
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {q.isLoading && (
            <div className="col-span-full text-sm text-muted-foreground py-6 text-center">
              Carregando dados da operação...
            </div>
          )}
          {!q.isLoading && bases.length === 0 && (
            <div className="col-span-full py-12 text-center border-2 border-dashed rounded-lg bg-muted/30">
              <div className="text-lg font-semibold text-foreground mb-1">
                Sem dados para {dataRef}
              </div>
              <p className="text-sm text-muted-foreground">
                Não foram encontradas rotas Meli ativas para esta data.
              </p>
            </div>
          )}

          {bases.map((b, i) => {
            const cor = CORES[i % CORES.length];
            const perc = Math.max(0, Math.min(100, Number(b.perc_entrega ?? 0)));
            return (
              <Card
                key={b.base_id ?? b.base_codigo ?? i}
                role="button"
                tabIndex={0}
                onClick={() =>
                  setBaseAberta({
                    id: b.base_id,
                    codigo: b.base_codigo ?? "—",
                    nome: b.base_nome ?? "—",
                    rotasSnapshot: b.rotas ?? 0,
                    total: b.total ?? 0,
                    entregue: b.entregue ?? 0,
                    em_rota: b.em_rota ?? 0,
                    insucesso: b.insucesso ?? 0,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setBaseAberta({
                      id: b.base_id,
                      codigo: b.base_codigo ?? "—",
                      nome: b.base_nome ?? "—",
                      rotasSnapshot: b.rotas ?? 0,
                      total: b.total ?? 0,
                      entregue: b.entregue ?? 0,
                      em_rota: b.em_rota ?? 0,
                      insucesso: b.insucesso ?? 0,
                    });
                  }
                }}
                className="relative overflow-hidden p-4 cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[3px]"
                  style={{ background: cor }}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-bold" style={{ color: cor }}>
                      {b.base_codigo ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {b.base_nome ?? "—"}
                    </div>
                    {b.sem_informacao ? (
                      <div className="mt-1 text-[10px] font-semibold text-warning">
                        Sem informação
                      </div>
                    ) : b.desatualizada ? (
                      <div className="mt-1 text-[10px] font-semibold text-warning">
                        Desatualizada · leitura de {b.snapshot_data ?? "dia anterior"}
                      </div>
                    ) : null}
                  </div>
                  <div className="font-display text-2xl font-bold tabular-nums">
                    {perc.toFixed(1)}%
                  </div>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${perc}%`, background: cor }}
                  />
                </div>
                <div className="mt-2">
                  {(() => {
                    const s = obterMelhorSync(
                      b.base_codigo,
                      syncPorCodigo,
                      syncSnapshotPorCodigo,
                    );
                    return (
                      <div className="flex flex-wrap items-center gap-2">
                        <SyncBaseIndicador
                          situacao={s?.situacao ?? "sem_info"}
                          minutos={s?.minutos ?? null}
                          status={s?.status}
                        />
                        <SeloSincronizando
                          ativo={
                            (s as { sincronizando?: boolean } | undefined)?.sincronizando === true
                          }
                        />
                      </div>
                    );
                  })()}
                </div>
                <div className="mt-2 grid grid-cols-4 text-center">
                  <MiniStat label="Rotas" value={nf(b.rotas)} />
                  <MiniStat label="Pacotes" value={nf(b.total)} />
                  <MiniStat label="Entregues" value={nf(b.entregue)} className="text-success" />
                  <MiniStat
                    label="Risco"
                    value={nf(b.rotas_risco)}
                    className={b.rotas_risco > 0 ? "text-destructive" : ""}
                  />
                </div>

                {(() => {
                  const aviso = avisoPmProgramadas(b.pm_nao_iniciadas ?? 0, b.pm_pacotes_fora ?? 0);
                  if (!aviso) return null;
                  return (
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{aviso}</p>
                  );
                })()}
              </Card>
            );
          })}
        </div>
      </Card>

      <BaseDetalheDialog
        base={baseAberta}
        data={dataRef}
        rotas={rotasDaBase}
        pmProgramadas={pmDaBase}
        onClose={() => setBaseAberta(null)}
      />
    </section>
  );
}

function pct(n: number | null | undefined) {
  return `${Math.max(0, Math.min(100, Number(n ?? 0))).toFixed(0)}%`;
}

function BaseDetalheDialog({
  base,
  data,
  rotas,
  pmProgramadas,
  onClose,
}: {
  base: {
    id: string | null;
    codigo: string;
    nome: string;
    rotasSnapshot: number;
    total: number;
    entregue: number;
    em_rota: number;
    insucesso: number;
  } | null;
  data: string;
  rotas: MeliDashboardRota[];
  pmProgramadas: MeliDashboardPmProgramada[];
  onClose: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [rotaSel, setRotaSel] = useState<MeliDashboardRota | null>(null);
  /** Situação escolhida nos cartões do detalhe da rota (Pacotes/Entregues/Em rota/Falhas). */
  const [situacaoSel, setSituacaoSel] = useState<"total" | "entregue" | "em_rota" | "insucesso">(
    "total",
  );
  /** Situação escolhida nos cartões da base (Rotas/Pacotes/Entregues/Em rota/Falhas). */
  const [situacaoBase, setSituacaoBase] = useState<
    "rotas" | "total" | "entregue" | "em_rota" | "insucesso"
  >("rotas");
  const fetchPacotes = useServerFn(meliDashboardPacotesRota);
  const fetchBase = useServerFn(meliDashboardOperacional);

  // O resumo multibase é propositalmente leve e não carrega todas as rotas.
  // Ao abrir um cartão, busca apenas o detalhe daquela base.
  const detalhesQuery = useQuery({
    queryKey: ["dashboard-detalhes-base", base?.id ?? base?.codigo, data],
    queryFn: () => fetchBase({ data: { data, base_id: base!.id } }),
    enabled: !!base?.id,
  });
  const rotasDetalhadasBrutas =
    detalhesQuery.data?.status === "ok" ? (detalhesQuery.data.rotas ?? []) : rotas;
  const rotasDetalhadas = useMemo(() => {
    const codigo = (base?.codigo ?? "").trim().toUpperCase();
    if (!BASES_SOMENTE_AM.has(codigo)) return rotasDetalhadasBrutas;
    return rotasDetalhadasBrutas.filter((rota) => !rotaEhPM(rota.cluster, rota.route_id));
  }, [base?.codigo, rotasDetalhadasBrutas]);

  const pacotesQuery = useQuery({
    queryKey: ["dashboard-geral-pacotes", rotaSel?.rota_id],
    queryFn: () => fetchPacotes({ data: { rota_id: rotaSel!.rota_id, limit: 1000 } }),
    enabled: !!rotaSel,
  });

  /** Motivos reais de insucesso da base — só busca quando o card Falhas é aberto. */
  const motivosQuery = useQuery({
    queryKey: ["dashboard-geral-motivos", base?.id ?? base?.codigo, data],
    queryFn: () => fetchBase({ data: { data, base_id: base!.id } }),
    enabled: !!base?.id && situacaoBase === "insucesso" && !rotaSel && !detalhesQuery.data,
  });
  const motivos =
    detalhesQuery.data?.status === "ok"
      ? (detalhesQuery.data.motivos_insucesso ?? [])
      : motivosQuery.data?.status === "ok"
        ? (motivosQuery.data.motivos_insucesso ?? [])
        : [];

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const porBusca = !t
      ? rotasDetalhadas
      : rotasDetalhadas.filter((r) =>
          [r.nome_operacional, r.route_id, r.driver_name, r.vehicle_license]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(t)),
        );
    if (situacaoBase === "rotas" || situacaoBase === "total") return porBusca;
    return porBusca
      .filter((r) => (r[situacaoBase] ?? 0) > 0)
      .slice()
      .sort((a, b) => (b[situacaoBase] ?? 0) - (a[situacaoBase] ?? 0));
  }, [rotasDetalhadas, busca, situacaoBase]);

  // Totais oficiais do cartão (snapshot agregado) — o modal não recalcula
  // pelas rotas detalhadas, que podem estar parciais.
  const resumo = base
    ? {
        rotas: base.rotasSnapshot,
        total: base.total,
        entregue: base.entregue,
        em_rota: base.em_rota,
        insucesso: base.insucesso,
      }
    : { rotas: 0, total: 0, entregue: 0, em_rota: 0, insucesso: 0 };

  const pacotes = pacotesQuery.data?.status === "ok" ? (pacotesQuery.data.pacotes ?? []) : [];
  const pacotesVisiveis = useMemo(() => {
    if (situacaoSel === "total") return pacotes;
    return pacotes.filter((p) => p.situacao === situacaoSel);
  }, [pacotes, situacaoSel]);

  return (
    <Dialog
      open={!!base}
      onOpenChange={(o) => {
        if (!o) {
          setRotaSel(null);
          setBusca("");
          setSituacaoBase("rotas");
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[94vh] w-[min(96vw,1120px)] max-w-none flex-col gap-3 overflow-hidden p-4">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            {rotaSel && (
              <Button variant="ghost" size="sm" onClick={() => setRotaSel(null)}>
                <ChevronLeft className="w-4 h-4 mr-1" /> Rotas
              </Button>
            )}
            {base?.codigo} — {base?.nome}
            {rotaSel && <span className="text-muted-foreground">/ {rotaSel.nome_operacional}</span>}
          </DialogTitle>
        </DialogHeader>

        {!rotaSel ? (
          <>
            <div className="grid grid-cols-2 gap-1.5 md:grid-cols-5">
              <MiniBox
                label="Rotas"
                value={nf(resumo.rotas)}
                ativo={situacaoBase === "rotas"}
                onClick={() => setSituacaoBase("rotas")}
              />
              <MiniBox
                label="Pacotes"
                value={nf(resumo.total)}
                ativo={situacaoBase === "total"}
                onClick={() => setSituacaoBase("total")}
              />
              <MiniBox
                label="Entregues"
                value={nf(resumo.entregue)}
                tone="text-success"
                ativo={situacaoBase === "entregue"}
                onClick={() => setSituacaoBase("entregue")}
              />
              <MiniBox
                label="Em rota"
                value={nf(resumo.em_rota)}
                tone="text-[var(--info)]"
                ativo={situacaoBase === "em_rota"}
                onClick={() => setSituacaoBase("em_rota")}
              />
              <MiniBox
                label="Falhas"
                value={nf(resumo.insucesso)}
                tone="text-destructive"
                ativo={situacaoBase === "insucesso"}
                onClick={() => setSituacaoBase("insucesso")}
              />
            </div>

            {base && rotasDetalhadas.length < base.rotasSnapshot && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {nf(rotasDetalhadas.length)} de {nf(base.rotasSnapshot)} rotas têm detalhes
                carregados — o detalhamento ainda está sendo completado.
              </p>
            )}

            {situacaoBase === "insucesso" && (
              <div className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Status dos insucessos — {base?.codigo}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {nf(resumo.insucesso)} pacote(s)
                  </span>
                </div>
                {motivosQuery.isLoading ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Carregando status dos insucessos...
                  </p>
                ) : motivos.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Nenhum insucesso registrado nesta base hoje.
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {motivos
                      .slice()
                      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0))
                      .map((m) => (
                        <li
                          key={m.codigo}
                          className="flex items-center justify-between gap-2 rounded border bg-card px-2 py-1.5 text-sm"
                        >
                          <span className="min-w-0 truncate">
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {m.codigo}
                            </span>{" "}
                            {m.descricao}
                            {!m.cadastrado && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                não cadastrado
                              </Badge>
                            )}
                          </span>
                          <span className="tabular-nums font-semibold text-destructive">
                            {nf(m.total)}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">
                {situacaoBase === "rotas" || situacaoBase === "total"
                  ? "Rotas operacionais de hoje"
                  : situacaoBase === "insucesso"
                    ? "Rotas com insucesso"
                    : situacaoBase === "entregue"
                      ? "Rotas com entregas"
                      : "Rotas em rota"}{" "}
                <span className="text-xs font-normal text-muted-foreground tabular-nums">
                  ({nf(filtradas.length)})
                </span>
              </h3>
              {situacaoBase !== "rotas" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setSituacaoBase("rotas")}
                >
                  Ver todas
                </Button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input
                className="h-8 pl-8 text-xs"
                placeholder="Filtrar por rota, motorista ou placa..."
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </div>

            <ScrollArea className="h-[48vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 pr-2">Rota</th>
                    <th className="py-2 pr-2">Motorista</th>
                    <th className="py-2 pr-2">Placa</th>
                    <th className="py-2 pr-2 text-right">Pacotes</th>
                    <th className="py-2 pr-2 text-right">Entregues</th>
                    <th className="py-2 pr-2 text-right">Em rota</th>
                    <th className="py-2 pr-2 text-right">Falhas</th>
                    <th className="py-2 pr-2">Progresso</th>
                    <th className="py-2">Sincronizado</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhesQuery.isLoading && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        Carregando detalhes das rotas...
                      </td>
                    </tr>
                  )}
                  {!detalhesQuery.isLoading && filtradas.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-6 text-center text-muted-foreground">
                        Nenhuma rota encontrada.
                      </td>
                    </tr>
                  )}
                  {filtradas.map((r) => (
                    <tr
                      key={r.rota_id}
                      className="border-t cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSituacaoSel(situacaoBase === "rotas" ? "total" : situacaoBase);
                        setRotaSel(r);
                      }}
                    >
                      <td className="py-1.5 pr-2 font-medium">
                        {r.nome_operacional}
                        {r.rota_area_risco && (
                          <Badge variant="destructive" className="ml-2 text-[10px]">
                            risco
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-muted-foreground">{r.driver_name || "—"}</td>
                      <td className="py-2 pr-2 text-muted-foreground">
                        {r.vehicle_license ?? "—"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{nf(r.total)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-success">
                        {nf(r.entregue)}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">{nf(r.em_rota)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-destructive">
                        {nf(r.insucesso)}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full bg-[var(--info)]"
                              style={{ width: pct(r.perc_entrega) }}
                            />
                          </div>
                          <span className="text-xs tabular-nums">{pct(r.perc_entrega)}</span>
                        </div>
                      </td>
                      <td className="py-2 text-xs text-muted-foreground">
                        {r.last_synced_at
                          ? new Date(r.last_synced_at).toLocaleString("pt-BR")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>

            {pmProgramadas.length > 0 && (
              <div className="rounded-md border border-dashed p-3">
                <h3 className="text-sm font-semibold">PM programadas para amanhã</h3>
                <p className="text-xs text-muted-foreground">
                  {avisoPmProgramadas(
                    pmProgramadas.length,
                    pmProgramadas.reduce((a, r) => a + (r.total ?? 0), 0),
                  )}
                </p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {pmProgramadas.map((r) => (
                    <li key={r.rota_id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{r.nome_operacional}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {nf(r.total)} pacotes
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MiniBox
                label="Pacotes"
                value={nf(rotaSel.total)}
                ativo={situacaoSel === "total"}
                onClick={() => setSituacaoSel("total")}
              />
              <MiniBox
                label="Entregues"
                value={nf(rotaSel.entregue)}
                tone="text-success"
                ativo={situacaoSel === "entregue"}
                onClick={() => setSituacaoSel("entregue")}
              />
              <MiniBox
                label="Em rota"
                value={nf(rotaSel.em_rota)}
                tone="text-[var(--info)]"
                ativo={situacaoSel === "em_rota"}
                onClick={() => setSituacaoSel("em_rota")}
              />
              <MiniBox
                label="Falhas"
                value={nf(rotaSel.insucesso)}
                tone="text-destructive"
                ativo={situacaoSel === "insucesso"}
                onClick={() => setSituacaoSel("insucesso")}
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {situacaoSel === "total"
                  ? "Todos os pedidos da rota"
                  : situacaoSel === "insucesso"
                    ? "Pedidos com ocorrência (falha de entrega)"
                    : situacaoSel === "entregue"
                      ? "Pedidos entregues"
                      : "Pedidos em rota"}
                {" · "}
                {nf(pacotesVisiveis.length)} pedido(s)
              </span>
              {situacaoSel !== "total" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setSituacaoSel("total")}
                >
                  Ver todos
                </Button>
              )}
            </div>
            <ScrollArea className="h-[48vh]">
              {pacotesQuery.isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Carregando pacotes...
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card">
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                      <th className="py-2 pr-2">#</th>
                      <th className="py-2 pr-2">Tracking</th>
                      <th className="py-2 pr-2">Status de entrega</th>
                      <th className="py-2 pr-2">Ocorrência</th>
                      <th className="py-2">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pacotesVisiveis.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-muted-foreground">
                          {situacaoSel === "total"
                            ? "Nenhum pacote nesta rota."
                            : "Nenhum pedido nesta situação."}
                        </td>
                      </tr>
                    )}
                    {pacotesVisiveis.map((p) => (
                      <tr key={p.tracking_id} className="border-t">
                        <td className="py-2 pr-2 text-muted-foreground tabular-nums">
                          {p.ordem ?? "—"}
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs">{p.tracking_id}</td>
                        <td className="py-2 pr-2">
                          <Badge variant="outline" className="text-[10px] uppercase">
                            {(p.situacao ?? "—").replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="py-2 pr-2 text-xs text-muted-foreground">
                          {p.descricao_ocorrencia ?? "—"}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {p.ultima_atualizacao_meli
                            ? new Date(p.ultima_atualizacao_meli).toLocaleString("pt-BR")
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MiniBox({
  label,
  value,
  tone,
  ativo,
  onClick,
}: {
  label: string;
  value: string;
  tone?: string;
  ativo?: boolean;
  onClick?: () => void;
}) {
  const conteudo = (
    <>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-bold tabular-nums ${tone ?? ""}`}>{value}</div>
    </>
  );
  if (!onClick) {
    return <div className="rounded-lg border bg-muted/30 p-3">{conteudo}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!ativo}
      className={`rounded-lg border p-3 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        ativo ? "border-primary bg-muted/60 ring-1 ring-primary/40" : "bg-muted/30"
      }`}
    >
      {conteudo}
    </button>
  );
}

function MiniStat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div>
      <div className={`text-sm font-bold tabular-nums ${className ?? ""}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "info" | "success" | "destructive";
}) {
  const cor =
    tone === "info"
      ? "var(--info)"
      : tone === "success"
        ? "var(--success)"
        : tone === "destructive"
          ? "var(--destructive)"
          : undefined;
  return (
    <div className="rounded-lg border bg-muted/30 p-4">
      <div
        className="text-[11px] uppercase tracking-wider font-semibold"
        style={cor ? { color: cor } : undefined}
      >
        {label}
      </div>
      <div
        className="font-display text-3xl md:text-4xl font-bold tabular-nums"
        style={cor ? { color: cor } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
