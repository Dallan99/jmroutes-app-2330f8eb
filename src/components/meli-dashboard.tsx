import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { hojeOperacional } from "@/lib/dia-operacional";
import {
  meliDashboardOperacional,
  meliDashboardPacotesRota,
  meliDashboardQueryKey,
  type MeliDashboardFiltros,
  type MeliDashboardRota,
} from "@/lib/meli-dashboard.functions";
import { LABEL_SITUACAO, descreverMotivo, type SituacaoMeli } from "@/lib/meli-status";
import { RankingMotoristasSection } from "@/components/meli-ranking-motoristas";


import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip as RTooltip, XAxis, YAxis, Legend,
} from "recharts";
import {
  AlertTriangle, ArrowUpDown, CheckCircle2, Download, Package, PackageX, RefreshCcw,
  ShieldAlert, SlidersHorizontal, Timer, Truck, XCircle,
} from "lucide-react";
import { buscarDashboardComContingencia } from "@/lib/meli-dashboard-cache";



const NONE = "__all";
const REFETCH_MS = 30_000;
const SEM_SYNC_ALERTA_MS = 2 * 60_000;

type Ordenacao = { coluna: keyof MeliDashboardRota | "nome_operacional"; dir: "asc" | "desc" } | null;

function hhmmss(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function MeliDashboardSection({
  data: dataProp,
  manual,
  bases,
  baseId: baseIdFiltro,
}: {
  data?: string;
  manual?: boolean;
  bases: { id: string; codigo: string; nome: string }[];
  /** Base selecionada nos filtros do Dashboard (fonte única de verdade). */
  baseId?: string | null;
}) {
  const data = dataProp || hojeOperacional();

  const fetchDados = useServerFn(meliDashboardOperacional);
  const fetchPacotes = useServerFn(meliDashboardPacotesRota);

  const baseId = baseIdFiltro ?? NONE;
  const [motorista, setMotorista] = useState("");
  const [rota, setRota] = useState("");
  const [status, setStatus] = useState<string>(NONE);
  const [transportadora, setTransportadora] = useState("");
  const [risco, setRisco] = useState<string>(NONE);
  const [rotaAberta, setRotaAberta] = useState<string | null>(null);
  const [drill, setDrill] = useState<SituacaoMeli | "total" | null>(null);
  const [drillBase, setDrillBase] = useState<string>(NONE);
  const [drillBusca, setDrillBusca] = useState("");
  const [pedidoStatus, setPedidoStatus] = useState<SituacaoMeli | "total">("total");
  const [buscaPedido, setBuscaPedido] = useState("");
  const [verRisco, setVerRisco] = useState(false);
  const [verFiltros, setVerFiltros] = useState(false);
  const [segundos, setSegundos] = useState(REFETCH_MS / 1000);



  const filtros = useMemo<MeliDashboardFiltros>(
    () => ({
      data,
      manual: !!manual,
      base_id: baseId === NONE ? null : baseId,
      motorista: motorista.trim() || null,
      rota: rota.trim() || null,
      status: status === NONE ? null : (status as SituacaoMeli),
      transportadora: transportadora.trim() || null,
      risco: risco === NONE ? null : (risco as "qualquer" | "integral" | "parcial"),
    }),
    [data, manual, baseId, motorista, rota, status, transportadora, risco],
  );

  const q = useQuery({
    queryKey: meliDashboardQueryKey(filtros),
    queryFn: () => buscarDashboardComContingencia(() => fetchDados({ data: filtros }), filtros),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev, // mantém os dados anteriores durante o refetch
    staleTime: REFETCH_MS,
  });

  // Contador da próxima atualização
  useEffect(() => {
    setSegundos(REFETCH_MS / 1000);
    const t = setInterval(() => setSegundos((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [q.dataUpdatedAt]);

  const pacotesQuery = useQuery({
    queryKey: ["meli-dashboard-pacotes", rotaAberta],
    queryFn: () => fetchPacotes({ data: { rota_id: rotaAberta! } }),
    enabled: !!rotaAberta,
    refetchInterval: rotaAberta ? REFETCH_MS : false,
    placeholderData: (prev) => prev,
  });

  const d = q.data?.status === "ok" ? q.data : undefined;
  const cards = d?.cards;
  const rotas = d?.rotas ?? [];
  const areaRisco = d?.area_risco;

  // Alerta de sincronização atrasada — sem duplicar a cada refetch.
  const ultimaSync = d?.ultima_sincronizacao ?? null;
  const serverTime = d?.server_time ?? null;
  const atrasoSync = useMemo(() => {
    if (!serverTime) return null;
    const base = ultimaSync ? new Date(ultimaSync).getTime() : 0;
    if (!base) return Infinity;
    return new Date(serverTime).getTime() - base;
  }, [ultimaSync, serverTime]);
  const syncAtrasada = atrasoSync !== null && atrasoSync > SEM_SYNC_ALERTA_MS;

  const basesSemSync = (d?.sincronizacao_por_base ?? []).filter(
    (b) => !b.last_synced_at || (serverTime && new Date(serverTime).getTime() - new Date(b.last_synced_at).getTime() > SEM_SYNC_ALERTA_MS),
  );

  const rotasRisco = useMemo(
    () => rotas.filter((r) => r.rota_area_risco || r.area_risco_parcial)
      .sort((a, b) => b.pacotes_risco - a.pacotes_risco || b.insucesso - a.insucesso || a.perc_entrega - b.perc_entrega),
    [rotas],
  );

  const distribuicao = cards
    ? [
        { nome: "Não iniciados", total: cards.nao_iniciado },
        { nome: "Em rota", total: cards.em_rota },
        { nome: "Entregues", total: cards.entregue },
        { nome: "Insucessos", total: cards.insucesso },
        { nome: "Cancelados", total: cards.cancelado },
      ]
    : [];

  const alertasOperacionais = useMemo(() => {
    const out: string[] = [];
    const agora = serverTime ? new Date(serverTime).getTime() : Date.now();
    for (const r of rotas) {
      const nome = r.nome_operacional;
      if (r.last_synced_at && agora - new Date(r.last_synced_at).getTime() > 15 * 60_000) {
        out.push(`${nome}: sem atualização há mais de 15 minutos.`);
      }
      if (r.total > 0 && r.insucesso / r.total > 0.2) {
        out.push(`${nome}: alto percentual de insucesso (${Math.round((r.insucesso / r.total) * 100)}%).`);
      }
      if (r.total > 0 && r.nao_iniciado / r.total > 0.8) {
        out.push(`${nome}: maioria dos pacotes ainda não iniciada.`);
      }
      if ((r.rota_area_risco || r.area_risco_parcial) && r.perc_entrega < 50) {
        out.push(`${nome}: rota de área de risco com baixa evolução (${r.perc_entrega}%).`);
      }
    }
    for (const b of d?.bases ?? []) {
      if (b.rotas_risco >= 5) out.push(`${b.base_codigo ?? "—"}: ${b.rotas_risco} rotas de risco ativas.`);
    }
    return Array.from(new Set(out)).slice(0, 12);
  }, [rotas, d?.bases, serverTime]);

  const contarStatus = (r: MeliDashboardRota, s: SituacaoMeli | "total") =>
    s === "total" ? r.total
    : s === "nao_iniciado" ? r.nao_iniciado
    : s === "em_rota" ? r.em_rota
    : s === "entregue" ? r.entregue
    : s === "insucesso" ? r.insucesso
    : s === "cancelado" ? r.cancelado
    : 0;

  const basesDoDrill = useMemo(() => {
    const set = new Set<string>();
    for (const r of rotas) if (r.base_codigo) set.add(r.base_codigo);
    return Array.from(set).sort();
  }, [rotas]);

  const rotasDoDrill = useMemo(() => {
    if (!drill) return [];
    const termo = drillBusca.trim().toLowerCase();
    return rotas
      .filter((r) => contarStatus(r, drill) > 0)
      .filter((r) => drillBase === NONE || (r.base_codigo ?? "") === drillBase)
      .filter((r) => {
        if (!termo) return true;
        return [
          r.nome_operacional, r.route_id, r.base_codigo, r.base_nome,
          r.driver_name, r.vehicle_license,
        ].some((v) => String(v ?? "").toLowerCase().includes(termo));
      })
      .sort((a, b) => contarStatus(b, drill) - contarStatus(a, drill));
  }, [rotas, drill, drillBase, drillBusca]);

  const baixarCsvDrill = () => {
    const cab = [
      "Rota", "ID", "Base", "Base nome", "Motorista", "Placa", "Total",
      "Nao iniciados", "Em rota", "Entregues", "Insucessos", "Cancelados",
      "Pacotes risco", "% Entrega", "Ultima sync",
    ];
    const linhas = rotasDoDrill.map((r) => [
      r.nome_operacional, r.route_id, r.base_codigo ?? "", r.base_nome ?? "",
      r.driver_name ?? "", r.vehicle_license ?? "", r.total, r.nao_iniciado,
      r.em_rota, r.entregue, r.insucesso, r.cancelado, r.pacotes_risco,
      `${r.perc_entrega}%`, hhmmss(r.last_synced_at),
    ]);
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = "\uFEFF" + [cab, ...linhas].map((l) => l.map(esc).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `meli-operacoes-${drill ?? "total"}-${data}${drillBase === NONE ? "" : `-${drillBase}`}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const abrirDrill = (s: SituacaoMeli | "total") => {
    setDrillBase(baseId === NONE ? NONE : (bases.find((b) => b.id === baseId)?.codigo ?? NONE));
    setDrillBusca("");
    setDrill(s);
  };

  const abrirPedidos = (rotaId: string, s: SituacaoMeli | "total") => {
    setDrill(null);
    setVerRisco(false);
    setPedidoStatus(s);
    setBuscaPedido("");
    setRotaAberta(rotaId);
  };

  const pacotesFiltrados = useMemo(() => {
    const lista = pacotesQuery.data?.pacotes ?? [];
    const termo = buscaPedido.trim().toLowerCase();
    return lista.filter((p) => {
      if (pedidoStatus !== "total" && p.situacao !== pedidoStatus) return false;
      if (!termo) return true;
      return (
        p.tracking_id.toLowerCase().includes(termo) ||
        (p.shipment_id ?? "").toLowerCase().includes(termo)
      );
    });
  }, [pacotesQuery.data?.pacotes, pedidoStatus, buscaPedido]);

  const limparFiltros = () => {
    setMotorista(""); setRota(""); setStatus(NONE);
    setTransportadora(""); setRisco(NONE);
  };


  return (
    <TooltipProvider>
      <section className="space-y-4">
        {q.data?.status === "erro" && (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Falha ao consultar o painel: {q.data.erro}. Mostrando os últimos dados válidos.
          </div>
        )}
        {d?.cache_local && (
          <div role="status" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            Conexão interrompida. Exibindo o último resultado salvo em {d.cache_salvo_em ? new Date(d.cache_salvo_em).toLocaleString("pt-BR") : "horário indisponível"}.
          </div>
        )}

        {/* Cards principais */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Kpi label="Total de pacotes" valor={cards?.total} icon={Package} onClick={() => abrirDrill("total")} />
          <Kpi label="Não iniciados" valor={cards?.nao_iniciado} icon={Timer} onClick={() => abrirDrill("nao_iniciado")} />
          <Kpi label="Em rota" valor={cards?.em_rota} icon={Truck} tom="info" onClick={() => abrirDrill("em_rota")} />
          <Kpi label="Entregues" valor={cards?.entregue} icon={CheckCircle2} tom="success" onClick={() => abrirDrill("entregue")} />
          <Kpi label="Insucessos" valor={cards?.insucesso} icon={PackageX} tom="warning" onClick={() => abrirDrill("insucesso")} />
          <Kpi label="Cancelados" valor={cards?.cancelado} icon={XCircle} onClick={() => abrirDrill("cancelado")} />
          <Kpi label="% Entrega" valor={cards ? `${cards.perc_entrega}%` : undefined} icon={CheckCircle2} tom="success" />
        </div>

        {/* Filtros — compactos e recolhidos (data e base vêm do topo) */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setVerFiltros((v) => !v)}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            {verFiltros ? "Ocultar filtros da operação" : "Filtros da operação"}
          </Button>
          {q.isFetching && <span className="text-xs text-muted-foreground">Atualizando…</span>}
        </div>

        {verFiltros && (
        <Card className="p-3">
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-5">
            <div>
              <Label htmlFor="meli-motorista" className="text-[11px] text-muted-foreground">Motorista</Label>
              <Input id="meli-motorista" value={motorista} onChange={(e) => setMotorista(e.target.value)} placeholder="Nome" />
            </div>
            <div>
              <Label htmlFor="meli-rota" className="text-[11px] text-muted-foreground">Rota</Label>
              <Input id="meli-rota" value={rota} onChange={(e) => setRota(e.target.value)} placeholder="Cluster ou ID" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Todos</SelectItem>
                  {(Object.keys(LABEL_SITUACAO) as SituacaoMeli[]).map((s) => (
                    <SelectItem key={s} value={s}>{LABEL_SITUACAO[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="meli-transp" className="text-[11px] text-muted-foreground">Transportadora</Label>
              <Input id="meli-transp" value={transportadora} onChange={(e) => setTransportadora(e.target.value)} placeholder="Ex.: JM" />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Área de risco</Label>
              <Select value={risco} onValueChange={setRisco}>
                <SelectTrigger><SelectValue placeholder="Todas" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Todas as rotas</SelectItem>
                  <SelectItem value="qualquer">Somente com área de risco</SelectItem>
                  <SelectItem value="integral">Rota integralmente de risco</SelectItem>
                  <SelectItem value="parcial">Rota parcialmente de risco</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={limparFiltros}>Limpar filtros</Button>
          </div>
        </Card>
        )}



        {/* Card de área de risco */}
        <Card
          className="cursor-pointer p-4 transition hover:shadow-md"
          role="button"
          tabIndex={0}
          onClick={() => setVerRisco(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setVerRisco(true); }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden />
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Rotas em área de risco hoje
                </p>
                <p className="font-display text-3xl font-black tabular-nums">
                  {areaRisco?.rotas ?? 0} rotas
                </p>
                <p className="text-sm text-muted-foreground">
                  {areaRisco?.pacotes ?? 0} pacotes · {areaRisco?.perc_conclusao ?? 0}% entregues
                  {" · "}{areaRisco?.integrais ?? 0} integrais / {areaRisco?.parciais ?? 0} parciais
                </p>
              </div>
            </div>
            <div className="flex gap-6 text-sm">
              <Mini label="Entregues" valor={areaRisco?.entregue ?? 0} />
              <Mini label="Em rota" valor={areaRisco?.em_rota ?? 0} />
              <Mini label="Insucessos" valor={areaRisco?.insucesso ?? 0} />
            </div>
          </div>
        </Card>

        {/* Gráficos */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Distribuição dos status atuais
            </h3>
            <div className="h-64">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={distribuicao} dataKey="total" nameKey="nome" outerRadius={90} label>
                    {distribuicao.map((_, i) => (
                      <Cell key={i} fill={["var(--brand-navy)", "var(--info)", "var(--success, #16a34a)", "var(--warning)", "var(--muted-foreground)"][i]} />
                    ))}
                  </Pie>
                  <RTooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Motivos de insucesso
            </h3>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={(d?.motivos_insucesso ?? []).slice(0, 10).map((m) => ({
                  motivo: descreverMotivo(m.codigo, m.descricao), total: m.total,
                }))} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="motivo" width={150} tick={{ fontSize: 11 }} />
                  <RTooltip />
                  <Bar dataKey="total" fill="var(--brand-yellow)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card className="p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Comparação entre bases (rotas de risco e entregas)
            </h3>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={(d?.bases ?? []).map((b) => ({
                  base: b.base_codigo ?? "—",
                  entregues: b.entregue,
                  insucessos: b.insucesso,
                  rotas_risco: b.rotas_risco,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="base" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <RTooltip />
                  <Legend />
                  <Bar dataKey="entregues" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="insucessos" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="rotas_risco" name="Rotas de risco" fill="var(--destructive)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {alertasOperacionais.length > 0 && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Alertas operacionais
            </h3>
            <ul className="space-y-1 text-sm">
              {alertasOperacionais.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warning)]" aria-hidden />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <RankingMotoristasSection data={data} baseId={baseId === NONE ? null : baseId} />

        {/* Detalhe por base — rotas de risco */}
        <Dialog open={verRisco} onOpenChange={setVerRisco}>
          <DialogContent className="max-w-5xl">
            <DialogHeader>
              <DialogTitle>Rotas em área de risco — {data}</DialogTitle>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh] pr-3">
              <div className="space-y-4">
                {(d?.bases ?? []).filter((b) => b.rotas_risco > 0).map((b) => (
                  <Card key={b.base_id ?? b.base_codigo ?? "sem"} className="p-4">
                    <p className="font-semibold">
                      {b.base_codigo ?? "—"} — {b.base_nome ?? "Base não mapeada"}
                      {b.service_center && <span className="ml-2 text-xs text-muted-foreground">SSP {b.service_center}</span>}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm md:grid-cols-6">
                      <Mini label="Rotas de risco" valor={b.rotas_risco} />
                      <Mini label="Integrais" valor={b.rotas_risco_integral} />
                      <Mini label="Parciais" valor={b.rotas_risco_parcial} />
                      <Mini label="Pacotes de risco" valor={b.pacotes_risco} />
                      <Mini label="Entregues" valor={b.entregue} />
                      <Mini label="% Entrega" valor={`${b.perc_entrega}%`} />
                    </div>
                  </Card>
                ))}
                {(d?.bases ?? []).every((b) => b.rotas_risco === 0) && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma rota classificada como área de risco neste dia operacional.
                  </p>
                )}
                {rotasRisco.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                      Tabela de rotas em área de risco
                    </h4>
                    <TabelaRotas rotas={rotasRisco} ordem={null} setOrdem={() => {}} onAbrir={(id) => abrirPedidos(id, "total")} />
                  </div>
                )}
              </div>
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Operações que compõem o indicador clicado */}
        <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>
                {drill === "total"
                  ? "Operações — total de pacotes"
                  : `Operações — ${LABEL_SITUACAO[(drill ?? "desconhecido") as SituacaoMeli]}`}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{data}</span>
              </DialogTitle>
            </DialogHeader>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <Label>Base</Label>
                <Select value={drillBase} onValueChange={setDrillBase}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Todas as bases</SelectItem>
                    {basesDoDrill.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-56 flex-1">
                <Label htmlFor="meli-drill-busca">Filtrar em todos os campos</Label>
                <Input
                  id="meli-drill-busca"
                  value={drillBusca}
                  onChange={(e) => setDrillBusca(e.target.value)}
                  placeholder="Rota, ID, base, motorista ou placa"
                />
              </div>
              <Button type="button" variant="outline" onClick={baixarCsvDrill} disabled={rotasDoDrill.length === 0}>
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Baixar CSV
              </Button>
              <p className="text-xs text-muted-foreground">{rotasDoDrill.length} operação(ões)</p>
            </div>
            <ScrollArea className="max-h-[70vh] pr-3">

              {q.isPending && !d
                ? <p className="p-4 text-sm text-muted-foreground">Carregando operações…</p>
                : (
                  <TabelaRotas
                    rotas={rotasDoDrill}
                    ordem={null}
                    setOrdem={() => {}}
                    onAbrir={(id) => abrirPedidos(id, drill ?? "total")}
                  />
                )}
            </ScrollArea>
          </DialogContent>
        </Dialog>

        {/* Drill-down dos pacotes */}
        <Dialog open={!!rotaAberta} onOpenChange={(o) => !o && setRotaAberta(null)}>
          <DialogContent className="max-w-6xl">
            <DialogHeader>
              <DialogTitle>
                {pacotesQuery.data?.rota
                  ? <>
                      {pacotesQuery.data.rota.nome_operacional}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ID: {pacotesQuery.data.rota.route_id}
                      </span>
                    </>
                  : "Pacotes da rota"}
              </DialogTitle>
            </DialogHeader>
            {pacotesQuery.data?.rota?.dia_anterior && (
              <p className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-2 text-sm">
                Rota de dia anterior — atualizada hoje. Não entra nos indicadores do dia atual.
              </p>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-56 flex-1">
                <Label htmlFor="meli-busca-pedido">Buscar tracking ou shipment</Label>
                <Input
                  id="meli-busca-pedido"
                  value={buscaPedido}
                  onChange={(e) => setBuscaPedido(e.target.value)}
                  placeholder="Ex.: 4400..."
                />
              </div>
              <div className="w-52">
                <Label>Situação</Label>
                <Select
                  value={pedidoStatus}
                  onValueChange={(v) => setPedidoStatus(v as SituacaoMeli | "total")}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="total">Todas as situações</SelectItem>
                    {(Object.keys(LABEL_SITUACAO) as SituacaoMeli[]).map((s) => (
                      <SelectItem key={s} value={s}>{LABEL_SITUACAO[s]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground">
                {pacotesFiltrados.length} pedido(s) exibido(s)
              </p>
            </div>
            {pacotesQuery.data?.status === "erro" && (
              <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 p-2 text-sm">
                Falha ao carregar os pedidos: {pacotesQuery.data.erro}
              </p>
            )}
            <ScrollArea className="max-h-[60vh]">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left">
                    <th className="p-2">Tracking</th>
                    <th className="p-2">Shipment</th>
                    <th className="p-2">Parada</th>
                    <th className="p-2">Situação</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Substatus</th>
                    <th className="p-2">Ocorrência</th>
                    <th className="p-2">Área de risco</th>
                    <th className="p-2">Atualização</th>
                    <th className="p-2">Físico JM</th>
                    <th className="p-2">Triagem JM</th>
                  </tr>
                </thead>
                <tbody>
                  {pacotesFiltrados.map((p) => (
                    <tr key={p.tracking_id} className="border-b">
                      <td className="p-2 font-mono">{p.tracking_id}</td>
                      <td className="p-2 font-mono">{p.shipment_id ?? "—"}</td>
                      <td className="p-2">{p.stop_id ?? "—"}</td>
                      <td className="p-2">{LABEL_SITUACAO[p.situacao as SituacaoMeli] ?? p.situacao}</td>
                      <td className="p-2">{p.status ?? "—"}</td>
                      <td className="p-2">{p.substatus ?? "—"}</td>
                      <td className="p-2">
                        {p.occurrence_code
                          ? `${descreverMotivo(p.occurrence_code, p.descricao_ocorrencia)} (${p.occurrence_code})`
                          : "—"}
                      </td>
                      <td className="p-2">
                        {p.pacote_area_risco ? (
                          <>
                            <SeloRisco motivo={p.motivo_area_risco} origem={p.origem_area_risco} />
                            <div className="text-[10px] text-muted-foreground">
                              {p.motivo_area_risco ?? "—"}
                              {p.origem_area_risco ? ` · origem: ${p.origem_area_risco}` : ""}
                            </div>
                          </>
                        ) : "—"}
                      </td>
                      <td className="p-2">{hhmmss(p.ultima_atualizacao_meli)}</td>
                      <td className="p-2">
                        {p.jm_recebido ? "Recebido" : "Não recebido"}
                        <div className="text-[10px] text-muted-foreground">{hhmmss(p.jm_recebido_em)}</div>
                      </td>
                      <td className="p-2">
                        {p.jm_triado ? "Triado" : "Não triado"}
                        <div className="text-[10px] text-muted-foreground">{hhmmss(p.jm_triado_em)}</div>
                      </td>
                    </tr>
                  ))}
                  {pacotesQuery.isPending && (
                    <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">Carregando pedidos…</td></tr>
                  )}
                  {!pacotesQuery.isPending && pacotesFiltrados.length === 0 && (
                    <tr><td colSpan={11} className="p-4 text-center text-muted-foreground">
                      Nenhum pedido para a busca/situação selecionada.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </ScrollArea>
          </DialogContent>
        </Dialog>

      </section>
    </TooltipProvider>
  );
}

function TabelaRotas({
  rotas, ordem, setOrdem, onAbrir,
}: {
  rotas: MeliDashboardRota[];
  ordem: Ordenacao;
  setOrdem: (o: Ordenacao) => void;
  onAbrir: (rotaId: string) => void;
}) {
  const th = (label: string, coluna: Ordenacao extends null ? never : keyof MeliDashboardRota) => (
    <th className="p-2">
      <button
        type="button"
        className="inline-flex items-center gap-1 font-semibold hover:underline"
        onClick={() =>
          setOrdem(
            ordem?.coluna === coluna
              ? { coluna, dir: ordem.dir === "asc" ? "desc" : "asc" }
              : { coluna, dir: "desc" },
          )
        }
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden />
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left">
            {th("Rota", "nome_operacional")}
            <th className="p-2">Base</th>
            {th("Motorista", "driver_name")}
            <th className="p-2">Placa</th>
            {th("Total", "total")}
            {th("Não iniciados", "nao_iniciado")}
            {th("Em rota", "em_rota")}
            {th("Entregues", "entregue")}
            {th("Insucessos", "insucesso")}
            {th("Cancelados", "cancelado")}
            {th("Pac. risco", "pacotes_risco")}
            {th("% Entrega", "perc_entrega")}
            {th("Últ. sync", "last_synced_at")}
          </tr>
        </thead>
        <tbody>
          {rotas.map((r) => (
            <tr
              key={r.rota_id}
              className="cursor-pointer border-b hover:bg-muted/50"
              onClick={() => onAbrir(r.rota_id)}
            >
              <td className="p-2">
                <div className="font-semibold">{r.nome_operacional}</div>
                <div className="text-[10px] text-muted-foreground">ID: {r.route_id}</div>
                {(r.rota_area_risco || r.area_risco_parcial) && (
                  <SeloRisco
                    motivo={r.rota_area_risco ? "Rota integralmente de risco" : "Rota parcialmente de risco"}
                    origem={r.rota_area_risco ? "rota" : "parada/pacote"}
                  />
                )}
              </td>
              <td className="p-2">{r.base_codigo ?? "—"}</td>
              <td className="p-2">{r.driver_name ?? "—"}</td>
              <td className="p-2">{r.vehicle_license ?? "—"}</td>
              <td className="p-2 tabular-nums">{r.total}</td>
              <td className="p-2 tabular-nums">{r.nao_iniciado}</td>
              <td className="p-2 tabular-nums">{r.em_rota}</td>
              <td className="p-2 tabular-nums">{r.entregue}</td>
              <td className="p-2 tabular-nums">{r.insucesso}</td>
              <td className="p-2 tabular-nums">{r.cancelado}</td>
              <td className="p-2 tabular-nums">{r.pacotes_risco}</td>
              <td className="p-2 tabular-nums">{r.perc_entrega}%</td>
              <td className="p-2">{hhmmss(r.last_synced_at)}</td>
            </tr>
          ))}
          {rotas.length === 0 && (
            <tr><td colSpan={13} className="p-4 text-center text-muted-foreground">
              Nenhuma rota Meli para os filtros selecionados.
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function SeloRisco({ motivo, origem }: { motivo?: string | null; origem?: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="destructive" className="mt-1 gap-1">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          Área de risco
        </Badge>
      </TooltipTrigger>
      <TooltipContent>
        {motivo ?? "Área de risco"}
        {origem ? ` · origem: ${origem}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function Kpi({
  label, valor, icon: Icon, tom, onClick,
}: {
  label: string;
  valor: number | string | undefined;
  icon: typeof Package;
  tom?: "success" | "warning" | "info";
  onClick?: () => void;
}) {
  const cor =
    tom === "success" ? "text-[var(--success,#16a34a)]"
    : tom === "warning" ? "text-[var(--warning)]"
    : tom === "info" ? "text-[var(--info)]"
    : "text-foreground";
  const clicavel = !!onClick;
  return (
    <Card
      className={`p-4 ${clicavel ? "cursor-pointer transition hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" : ""}`}
      role={clicavel ? "button" : undefined}
      tabIndex={clicavel ? 0 : undefined}
      aria-label={clicavel ? `${label} — clique para detalhar` : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!onClick) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${cor}`} aria-hidden />
      </div>
      <div className={`font-display text-2xl font-black tabular-nums ${cor}`}>{valor ?? "—"}</div>
      {clicavel && <p className="mt-1 text-[10px] text-muted-foreground">Clique para detalhar</p>}
    </Card>
  );
}


function Mini({ label, valor }: { label: string; valor: number | string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{valor}</p>
    </div>
  );
}
