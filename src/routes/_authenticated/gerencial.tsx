import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  gerencialData,
  meliSlaHistorico,
  rotasPorBase,
  transferenciasGerencial,
  resumoOperacionalPorBase,
  detalhesResumoPorBase,
  type OperadorProd,
  type RotaBaseRow,
  type TransferenciasGerencialData,
  type MetricaResumo,
} from "@/lib/gerencial.functions";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { abrirRelatorio, baixarCSV } from "@/lib/relatorio";
import { Printer, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Line,
  LineChart,
  Legend,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  Award,
  CheckCircle2,
  ClipboardList,
  Clock,
  MapPin,
  Package,
  PackageCheck,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  Truck,
  Tv,
  Users,
  XCircle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/gerencial")({
  head: () => ({ meta: [{ title: "Dashboard Gerencial — JM Transportes" }] }),
  component: GerencialPage,
});

type Periodo = "hoje" | "7d" | "30d";

function GerencialPage() {
  const [periodo, setPeriodo] = useState<Periodo>("7d");
  const fn = useServerFn(gerencialData);
  const transferenciasFn = useServerFn(transferenciasGerencial);
  const slaFn = useServerFn(meliSlaHistorico);
  const q = useQuery({
    queryKey: ["gerencial", periodo],
    queryFn: () => fn({ data: { periodo } }),
    refetchInterval: 30_000,
  });
  const d = q.data;
  const transferenciasQuery = useQuery({
    queryKey: ["gerencial-transferencias", periodo],
    queryFn: () => transferenciasFn({ data: { periodo } }),
    refetchInterval: 30_000,
  });
  const slaQuery = useQuery({
    queryKey: ["gerencial-sla-meli", periodo],
    queryFn: () => slaFn({ data: { periodo } }),
    refetchInterval: 30_000,
  });

  const fmtTempo = (ms: number | null) => (ms ? `${(ms / 1000).toFixed(1)}s` : "—");
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard Gerencial</h1>
          <p className="text-sm text-muted-foreground">
            Produtividade por operador, comparativos e ranking de desempenho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/tv/gerencial">
            <Button size="sm">
              <Tv className="w-4 h-4 mr-2" /> Modo TV
            </Button>
          </Link>
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            {(["hoje", "7d", "30d"] as Periodo[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriodo(p)}
                className={`px-3 py-1.5 text-sm rounded ${
                  periodo === p
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === "hoje" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ResumoPorBasePanel periodo={periodo} />

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Histórico do SLA geral Meli</h2>
            <p className="text-xs text-muted-foreground">
              Nota diária consolidada e gravada no banco.
            </p>
          </div>
          {slaQuery.data?.[0] && (
            <div className="font-display text-2xl font-bold text-primary tabular-nums">
              {slaQuery.data[0].sla_geral.toFixed(2)}%
            </div>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3">Data</th>
                <th className="py-2 pr-3 text-right">Bases</th>
                <th className="py-2 pr-3 text-right">Rotas</th>
                <th className="py-2 pr-3 text-right">Pacotes</th>
                <th className="py-2 pr-3 text-right">Entregues</th>
                <th className="py-2 pr-3 text-right">Insucessos</th>
                <th className="py-2 text-right">SLA geral</th>
              </tr>
            </thead>
            <tbody>
              {(slaQuery.data ?? []).map((linha) => (
                <tr key={linha.data_operacional} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    {new Date(`${linha.data_operacional}T12:00:00`).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {linha.bases_total.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {linha.rotas_total.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {linha.pacotes_total.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 text-right text-success">
                    {linha.entregues_total.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 pr-3 text-right text-destructive">
                    {linha.insucessos_total.toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 text-right font-bold tabular-nums">
                    {linha.sla_geral.toFixed(2)}%
                  </td>
                </tr>
              ))}
              {!slaQuery.isLoading && !slaQuery.data?.length && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    Sem histórico Meli no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 md:gap-4">
        <Kpi label="Total leituras" value={d?.totais.total_leituras ?? "—"} icon={Activity} />
        <Kpi label="Sucesso" value={d?.totais.ok ?? "—"} icon={PackageCheck} accent="success" />
        <Kpi
          label="Erros/Divergências"
          value={d?.totais.erros ?? "—"}
          icon={AlertTriangle}
          accent="destructive"
        />
        <Kpi
          label="Operadores ativos"
          value={d?.totais.operadores_ativos ?? "—"}
          icon={Users}
          accent="info"
        />
        <Kpi
          label="Tempo médio/leitura"
          value={fmtTempo(d?.totais.tempo_medio_ms ?? null)}
          icon={Clock}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Award className="w-4 h-4 text-success" />
            <h2 className="text-sm font-semibold">Top 3 — mais produtivos</h2>
          </div>
          <RankingLista rows={d?.top3 ?? []} tipo="top" />
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="w-4 h-4 text-warning" />
            <h2 className="text-sm font-semibold">Bottom 3 — atenção necessária</h2>
          </div>
          <RankingLista rows={d?.bottom3 ?? []} tipo="bottom" />
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">Evolução diária</h2>
        <div className="h-64">
          <ResponsiveContainer>
            <LineChart data={d?.porDia ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="ok"
                name="Sucesso"
                stroke="var(--success)"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="erros"
                name="Erros"
                stroke="var(--destructive)"
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="var(--brand-navy)"
                strokeWidth={2}
                strokeDasharray="4 4"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold">Comparativo Hoje × 7 dias × 30 dias (Top 10)</h2>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={d?.comparativo ?? []}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="operador"
                tick={{ fontSize: 10 }}
                interval={0}
                angle={-20}
                textAnchor="end"
                height={70}
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="hoje" name="Hoje" fill="var(--brand-yellow)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="semana" name="7 dias" fill="var(--brand-navy)" radius={[4, 4, 0, 0]} />
              <Bar
                dataKey="mes"
                name="30 dias"
                fill="var(--muted-foreground)"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">
          Produtividade por operador —{" "}
          {periodo === "hoje" ? "hoje" : periodo === "7d" ? "últimos 7 dias" : "últimos 30 dias"}
        </h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Operador</th>
                <th className="py-2 pr-3 text-right">Leituras</th>
                <th className="py-2 pr-3 text-right">Sucesso</th>
                <th className="py-2 pr-3 text-right">Erros</th>
                <th className="py-2 pr-3 text-right">Rotas</th>
                <th className="py-2 pr-3 text-right">Taxa acerto</th>
                <th className="py-2 pr-3 text-right">Tempo médio</th>
              </tr>
            </thead>
            <tbody>
              {(d?.porOperador ?? []).map((op, i) => (
                <tr key={op.operador_id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 pr-3 font-medium">{op.nome}</td>
                  <td className="py-2 pr-3 text-right font-mono">{op.total_leituras}</td>
                  <td className="py-2 pr-3 text-right font-mono text-success">{op.ok}</td>
                  <td className="py-2 pr-3 text-right font-mono text-destructive">{op.erros}</td>
                  <td className="py-2 pr-3 text-right font-mono">{op.rotas_atendidas}</td>
                  <td className="py-2 pr-3 text-right">
                    <Badge
                      variant={
                        op.taxa_acerto >= 95
                          ? "default"
                          : op.taxa_acerto >= 85
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {fmtPct(op.taxa_acerto)}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{fmtTempo(op.tempo_medio_ms)}</td>
                </tr>
              ))}
              {!q.isLoading && (d?.porOperador?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    Sem leituras no período selecionado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {q.isLoading && <p className="text-center text-sm text-muted-foreground">Carregando…</p>}
      {q.error && (
        <Card className="p-4 border-destructive">
          <p className="text-sm text-destructive">
            Erro ao carregar dados: {(q.error as Error).message}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => q.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}

      <TransferenciasSection
        data={transferenciasQuery.data}
        loading={transferenciasQuery.isLoading}
        error={transferenciasQuery.error}
        onRetry={() => transferenciasQuery.refetch()}
      />

      <RotasPorBaseSection />
    </div>
  );
}
function todayYMD() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function RotasPorBaseSection() {
  const [dia, setDia] = useState<string>(todayYMD());
  const [diaTocado, setDiaTocado] = useState(false);
  const [baseId, setBaseId] = useState<string>("todas");
  const fn = useServerFn(rotasPorBase);
  const q = useQuery({
    queryKey: ["rotas-por-base", dia, baseId],
    queryFn: () =>
      fn({
        data: {
          data: diaTocado ? dia : undefined,
          baseId: baseId === "todas" ? undefined : baseId,
        },
      }),
    refetchInterval: 30_000,
  });
  const d = q.data;

  // Sincroniza o input de data com o dia efetivo retornado pelo backend
  // (quando o usuário ainda não escolheu manualmente).
  useEffect(() => {
    if (d?.data && !diaTocado && d.data !== dia) setDia(d.data);
  }, [d?.data, dia, diaTocado]);

  const rotasFiltradas: RotaBaseRow[] = d?.rotas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" /> Rotas por Base
          </h2>
          <p className="text-sm text-muted-foreground">
            Rotas criadas no dia, com % de conclusão e pacotes faltando.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={dia}
            onChange={(e) => {
              setDiaTocado(true);
              setDia(e.target.value || todayYMD());
            }}
            className="w-[160px]"
          />
          <Select value={baseId} onValueChange={setBaseId}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Todas as bases" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas as bases</SelectItem>
              {(d?.bases ?? []).map((b) => (
                <SelectItem key={b.base_id} value={b.base_id}>
                  {b.nome} ({b.codigo})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {(d?.bases ?? [])
          .filter((b) => baseId === "todas" || b.base_id === baseId)
          .map((b) => (
            <Card key={b.base_id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-display font-bold">{b.nome}</div>
                  <div className="text-xs text-muted-foreground font-mono">{b.codigo}</div>
                </div>
                <Badge
                  variant={b.pct >= 100 ? "default" : b.pct >= 80 ? "secondary" : "destructive"}
                >
                  {b.pct.toFixed(0)}%
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <div className="font-display text-lg font-bold">{b.total_rotas}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Rotas</div>
                </div>
                <div>
                  <div className="font-display text-lg font-bold text-success">
                    {b.rotas_completas}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase">100%</div>
                </div>
                <div>
                  <div className="font-display text-lg font-bold text-warning">{b.faltando}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">Faltando</div>
                </div>
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground flex justify-between">
                <span>
                  Recebidos: <b className="text-success">{b.recebidos}</b>/{b.total_pacotes}
                </span>
                <span>
                  Devolvidos: <b className="text-warning">{b.devolvidos}</b>
                </span>
              </div>
            </Card>
          ))}
        {!q.isLoading && (d?.bases?.length ?? 0) === 0 && (
          <Card className="p-6 text-center text-sm text-muted-foreground md:col-span-3">
            Nenhuma base com escala ativa nessa data.
          </Card>
        )}
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">
          Detalhe por rota — {new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")}
        </h3>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                <th className="py-2 pr-3">Base</th>
                <th className="py-2 pr-3">Rota</th>
                <th className="py-2 pr-3">Motorista</th>
                <th className="py-2 pr-3 text-right">Previsto</th>
                <th className="py-2 pr-3 text-right">Recebido</th>
                <th className="py-2 pr-3 text-right">Devolvido</th>
                <th className="py-2 pr-3 text-right">Faltando</th>
                <th className="py-2 pr-3 text-right">% Conclusão</th>
                <th className="py-2 pr-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {rotasFiltradas.map((r) => (
                <tr
                  key={`${r.base_id}-${r.nro_rota}`}
                  className="border-b border-border/50 hover:bg-muted/30"
                >
                  <td className="py-2 pr-3">
                    <div className="font-medium">{r.base_nome}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {r.base_codigo}
                    </div>
                  </td>
                  <td className="py-2 pr-3 font-mono">{r.nro_rota}</td>
                  <td className="py-2 pr-3">
                    <div className="text-xs">{r.motorista ?? "—"}</div>
                    {r.placa && (
                      <div className="text-[10px] text-muted-foreground font-mono">{r.placa}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-mono">{r.total}</td>
                  <td className="py-2 pr-3 text-right font-mono text-success">{r.recebido}</td>
                  <td className="py-2 pr-3 text-right font-mono text-warning">{r.devolvido}</td>
                  <td className="py-2 pr-3 text-right font-mono text-destructive">{r.faltando}</td>
                  <td className="py-2 pr-3 text-right">
                    <Badge
                      variant={r.pct >= 100 ? "default" : r.pct >= 80 ? "secondary" : "destructive"}
                    >
                      {r.pct.toFixed(0)}%
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-center">
                    {r.status === "completa" ? (
                      <span className="inline-flex items-center gap-1 text-success text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completa
                      </span>
                    ) : r.status === "parcial" ? (
                      <span className="inline-flex items-center gap-1 text-warning text-xs">
                        <AlertTriangle className="w-3.5 h-3.5" /> Parcial
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                        <XCircle className="w-3.5 h-3.5" /> Sem leitura
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {!q.isLoading && rotasFiltradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    Sem rotas para essa data/base.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {q.error && (
          <p className="text-sm text-destructive mt-2">Erro: {(q.error as Error).message}</p>
        )}
      </Card>
    </div>
  );
}

function TransferenciasSection({
  data,
  loading,
  error,
  onRetry,
}: {
  data?: TransferenciasGerencialData;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const minutos = (valor: number | null) => (valor === null ? "—" : `${valor} min`);
  const responsabilidade = (valor: string) =>
    ({
      JM_FROTA: "JM / Frota",
      MELI: "Mercado Livre",
      EXTERNO: "Fator externo",
      EM_ANALISE: "Em análise",
    })[valor] ?? valor;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
          <Truck className="w-5 h-5 text-primary" /> Transferências Service → XPT
        </h2>
        <p className="text-sm text-muted-foreground">
          Evidências de disponibilização da frota JM e do tempo aguardando carregamento/liberação no
          Service.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Veículos" value={data?.totais.total ?? "—"} icon={Truck} />
        <Kpi
          label="Disponíveis até 07h"
          value={data?.totais.disponibilizados_ate_7 ?? "—"}
          icon={CheckCircle2}
          accent="success"
        />
        <Kpi
          label="Aguardando carga"
          value={data?.totais.aguardando_carga ?? "—"}
          icon={Clock}
          accent="warning"
        />
        <Kpi
          label="Saídas após 09h (MELI)"
          value={data?.totais.saidas_apos_9 ?? "—"}
          icon={AlertTriangle}
          accent="destructive"
        />
        <Kpi
          label="Média aguardando carga"
          value={minutos(data?.totais.media_service_min ?? null)}
          icon={Clock}
          accent="warning"
        />
        <Kpi
          label="Maior espera por carga"
          value={minutos(data?.totais.maior_service_min ?? null)}
          icon={AlertTriangle}
          accent="destructive"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-semibold">Desempenho por base</h3>
            <div className="text-xs text-muted-foreground">
              Deslocamento (complementar):{" "}
              <b>{minutos(data?.totais.media_deslocamento_min ?? null)}</b>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-2 pr-3">Base</th>
                  <th className="py-2 pr-3 text-right">Veículos</th>
                  <th className="py-2 pr-3 text-right">Até 07h</th>
                  <th className="py-2 pr-3 text-right">Aguardando carga</th>
                  <th className="py-2 pr-3 text-right">Saídas após 09h</th>
                  <th className="py-2 pr-3 text-right">Média espera</th>
                  <th className="py-2 text-right">Média trajeto</th>
                </tr>
              </thead>
              <tbody>
                {(data?.porBase ?? []).map((base) => (
                  <tr key={base.base_id} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <b>{base.base_nome}</b>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {base.base_codigo}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">{base.total}</td>
                    <td className="py-2 pr-3 text-right font-mono text-success">
                      {base.disponibilizados_ate_7}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-warning">
                      {base.aguardando_carga}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-destructive">
                      {base.saidas_apos_9}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono">
                      {minutos(base.media_service_min)}
                    </td>
                    <td className="py-2 text-right font-mono">
                      {minutos(base.media_deslocamento_min)}
                    </td>
                  </tr>
                ))}
                {!loading && (data?.porBase.length ?? 0) === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-muted-foreground">
                      Sem transferências no período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3">Maiores esperas por carregamento</h3>
          <ol className="space-y-2">
            {(data?.rankingMotoristas ?? []).slice(0, 5).map((item, index) => (
              <li
                key={item.motorista}
                className="flex items-center justify-between gap-3 rounded bg-muted/30 p-2"
              >
                <div className="min-w-0">
                  <b className="truncate block">
                    {index + 1}. {item.motorista}
                  </b>
                  <span className="text-xs text-muted-foreground">
                    {item.viagens_atrasadas} espera(s) registrada(s)
                  </span>
                </div>
                <span className="font-mono text-sm text-destructive">
                  {item.minutos_atraso} min
                </span>
              </li>
            ))}
            {!loading && (data?.rankingMotoristas.length ?? 0) === 0 && (
              <li className="text-sm text-muted-foreground">
                Nenhum tempo de espera completo registrado.
              </li>
            )}
          </ol>
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Principais motivos e responsabilidades</h3>
        <div className="grid md:grid-cols-2 gap-2">
          {(data?.motivos ?? []).map((item) => (
            <div
              key={`${item.responsabilidade}-${item.motivo}`}
              className="flex items-center justify-between gap-3 rounded border border-border p-3"
            >
              <div>
                <b className="text-sm">{item.motivo}</b>
                <div className="text-xs text-muted-foreground">
                  {responsabilidade(item.responsabilidade)} · {item.ocorrencias} ocorrência(s)
                </div>
              </div>
              <span className="font-mono text-sm text-destructive">{item.minutos_atraso} min</span>
            </div>
          ))}
          {!loading && (data?.motivos.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma ocorrência de atraso registrada.
            </p>
          )}
        </div>
      </Card>

      {loading && (
        <p className="text-center text-sm text-muted-foreground">
          Carregando indicadores de transferências…
        </p>
      )}
      {error && (
        <Card className="p-4 border-destructive">
          <p className="text-sm text-destructive">
            Erro ao carregar transferências: {error.message}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            Tentar novamente
          </Button>
        </Card>
      )}
    </section>
  );
}

function RankingLista({ rows, tipo }: { rows: OperadorProd[]; tipo: "top" | "bottom" }) {
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  return (
    <ol className="space-y-2">
      {rows.map((op, i) => (
        <li
          key={op.operador_id}
          className="flex items-center justify-between gap-3 p-2 rounded bg-muted/30"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-sm ${
                tipo === "top"
                  ? i === 0
                    ? "bg-[var(--brand-yellow)] text-[var(--brand-navy)]"
                    : "bg-muted text-foreground"
                  : "bg-warning/20 text-warning"
              }`}
            >
              {i + 1}
            </div>
            <div className="min-w-0">
              <div className="font-medium truncate">{op.nome}</div>
              <div className="text-xs text-muted-foreground">
                {op.rotas_atendidas} rota(s) · {op.taxa_acerto.toFixed(0)}% acerto
              </div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-bold text-lg">{op.total_leituras}</div>
            <div className="text-[10px] text-muted-foreground uppercase">leituras</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
  accent?: "success" | "warning" | "destructive" | "info";
}) {
  const ring =
    accent === "success"
      ? "text-success"
      : accent === "warning"
        ? "text-warning"
        : accent === "destructive"
          ? "text-destructive"
          : accent === "info"
            ? "text-[var(--info)]"
            : "text-primary";
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </span>
        <Icon className={`w-4 h-4 ${ring}`} />
      </div>
      <div className="font-display text-2xl md:text-3xl font-bold">{value}</div>
    </Card>
  );
}

// ============================================================
// Painel: Resumo Operacional por Base
// Filtro por dia + botões de base + tiles com atividades.
// ============================================================
function ResumoPorBasePanel({ periodo }: { periodo: Periodo }) {
  const [baseSel, setBaseSel] = useState<string>("todas");
  const [drill, setDrill] = useState<{
    metrica: MetricaResumo;
    baseId: string | null;
    label: string;
  } | null>(null);
  const fn = useServerFn(resumoOperacionalPorBase);
  const q = useQuery({
    queryKey: ["resumo-por-base", periodo],
    queryFn: () => fn({ data: { periodo } }),
    refetchInterval: 30_000,
  });

  const bases = q.data?.bases ?? [];
  const totais = q.data?.totais;
  const baseAtiva = baseSel === "todas" ? null : bases.find((b) => b.base_id === baseSel);
  const view = baseAtiva ?? {
    codigo: "TODAS",
    nome: "Todas as bases",
    ...(totais ?? {
      triados: 0,
      recebimentos: 0,
      devolucoes: 0,
      inventario: 0,
      transferencias: 0,
      contagens: 0,
    }),
  };

  const rangeTxt =
    q.data?.inicio && q.data?.fim
      ? q.data.inicio === q.data.fim
        ? new Date(q.data.inicio + "T00:00:00").toLocaleDateString("pt-BR")
        : `${new Date(q.data.inicio + "T00:00:00").toLocaleDateString("pt-BR")} → ${new Date(q.data.fim + "T00:00:00").toLocaleDateString("pt-BR")}`
      : "—";

  const basesOrdenadas = [...bases].sort((a, b) => a.codigo.localeCompare(b.codigo));

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" /> Resumo operacional por base
          </h2>
          <p className="text-xs text-muted-foreground">
            Atividades no período <b>{rangeTxt}</b>. Clique em uma base para detalhar.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant={baseSel === "todas" ? "default" : "outline"}
          size="sm"
          onClick={() => setBaseSel("todas")}
        >
          Todas
        </Button>
        {basesOrdenadas.map((b) => {
          const isActive = baseSel === b.base_id;
          return (
            <Button
              key={b.base_id}
              variant={isActive ? "default" : "outline"}
              size="sm"
              onClick={() => setBaseSel(b.base_id)}
              title={b.nome}
            >
              {b.codigo}
            </Button>
          );
        })}
      </div>

      <div>
        <div className="text-xs text-muted-foreground mb-2">
          Exibindo: <span className="font-medium text-foreground">{view.codigo}</span>
          {view.nome && view.codigo !== "TODAS" ? ` — ${view.nome}` : ""}
          <span className="ml-2 text-muted-foreground/80">
            · clique em um card para ver os registros
          </span>
        </div>
        {(() => {
          const baseIdSel = baseAtiva?.base_id ?? null;
          const baseTag = baseAtiva ? ` (${baseAtiva.codigo})` : "";
          const open = (m: MetricaResumo, label: string) =>
            setDrill({ metrica: m, baseId: baseIdSel, label: label + baseTag });
          return (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              <button
                type="button"
                onClick={() => open("triados", "Volumes triados")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi
                  label="Volumes triados"
                  value={view.triados}
                  icon={PackageCheck}
                  accent="success"
                />
              </button>
              <button
                type="button"
                onClick={() => open("recebimentos", "Recebimentos")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi label="Recebimentos" value={view.recebimentos} icon={Activity} />
              </button>
              <button
                type="button"
                onClick={() => open("devolucoes", "Devoluções")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi
                  label="Devoluções"
                  value={view.devolucoes}
                  icon={RotateCcw}
                  accent="destructive"
                />
              </button>
              <button
                type="button"
                onClick={() => open("inventario", "Inventário")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi label="Inventário" value={view.inventario} icon={Package} accent="info" />
              </button>
              <button
                type="button"
                onClick={() => open("transferencias", "Transferências")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi label="Transferências" value={view.transferencias} icon={Truck} />
              </button>
              <button
                type="button"
                onClick={() => open("contagens", "Contagens")}
                className="text-left focus:outline-none focus:ring-2 focus:ring-primary rounded-lg"
              >
                <Kpi label="Contagens" value={view.contagens} icon={ClipboardList} />
              </button>
            </div>
          );
        })()}
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
              <th className="py-2 pr-3">Base</th>
              <th className="py-2 pr-3 text-right">Recebimentos</th>
              <th className="py-2 pr-3 text-right">Triados</th>
              <th className="py-2 pr-3 text-right">Devoluções</th>
              <th className="py-2 pr-3 text-right">Transferências</th>
              <th className="py-2 pr-3 text-right">Inventário</th>
              <th className="py-2 pr-3 text-right">Contagens</th>
            </tr>
          </thead>
          <tbody>
            {basesOrdenadas.map((b) => {
              const cell = (m: MetricaResumo, val: number, extra = "") => (
                <td
                  className={`py-2 pr-3 text-right font-mono ${val > 0 ? "cursor-pointer hover:underline" : "text-muted-foreground"} ${extra}`}
                  onClick={
                    val > 0
                      ? () =>
                          setDrill({
                            metrica: m,
                            baseId: b.base_id,
                            label: `${labelMetrica(m)} (${b.codigo})`,
                          })
                      : undefined
                  }
                >
                  {val.toLocaleString("pt-BR")}
                </td>
              );
              return (
                <tr key={b.base_id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 pr-3">
                    <b>{b.nome}</b>
                    <div className="text-[10px] text-muted-foreground font-mono">{b.codigo}</div>
                  </td>
                  {cell("recebimentos", b.recebimentos)}
                  {cell("triados", b.triados, "text-success")}
                  {cell("devolucoes", b.devolucoes, "text-warning")}
                  {cell("transferencias", b.transferencias)}
                  {cell("inventario", b.inventario)}
                  {cell("contagens", b.contagens)}
                </tr>
              );
            })}
            {totais && basesOrdenadas.length > 0 && (
              <tr className="border-t-2 border-border font-semibold bg-muted/40">
                <td className="py-2 pr-3">TOTAL</td>
                <td className="py-2 pr-3 text-right font-mono">
                  {totais.recebimentos.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-success">
                  {totais.triados.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono text-warning">
                  {totais.devolucoes.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {totais.transferencias.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {totais.inventario.toLocaleString("pt-BR")}
                </td>
                <td className="py-2 pr-3 text-right font-mono">
                  {totais.contagens.toLocaleString("pt-BR")}
                </td>
              </tr>
            )}
            {!q.isLoading && basesOrdenadas.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-muted-foreground">
                  Sem atividades registradas nesse período.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {q.isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
      {q.error && (
        <p className="text-xs text-destructive">Erro ao carregar: {(q.error as Error).message}</p>
      )}

      <DrillDialog
        open={!!drill}
        onClose={() => setDrill(null)}
        metrica={drill?.metrica ?? null}
        baseId={drill?.baseId ?? null}
        periodo={periodo}
        title={drill?.label ?? ""}
      />
    </Card>
  );
}

function labelMetrica(m: MetricaResumo): string {
  switch (m) {
    case "recebimentos":
      return "Recebimentos";
    case "triados":
      return "Volumes triados";
    case "devolucoes":
      return "Devoluções";
    case "inventario":
      return "Inventário";
    case "transferencias":
      return "Transferências";
    case "contagens":
      return "Contagens";
  }
}

function DrillDialog({
  open,
  onClose,
  metrica,
  baseId,
  periodo,
  title,
}: {
  open: boolean;
  onClose: () => void;
  metrica: MetricaResumo | null;
  baseId: string | null;
  periodo: Periodo;
  title: string;
}) {
  const [dia, setDia] = useState<string>("");
  useEffect(() => {
    if (!open) setDia("");
  }, [open, metrica, baseId, periodo]);

  const fn = useServerFn(detalhesResumoPorBase);
  const q = useQuery({
    queryKey: ["drill", metrica, baseId, periodo, dia],
    queryFn: () =>
      fn({
        data: {
          metrica: metrica!,
          base_id: baseId ?? undefined,
          periodo,
          dia: dia || undefined,
          limit: 300,
        },
      }),
    enabled: open && !!metrica,
  });

  const itens = q.data?.itens ?? [];
  const periodoLabel = dia
    ? `Dia ${new Date(dia + "T00:00:00").toLocaleDateString("pt-BR")}`
    : periodo === "hoje"
      ? "Hoje"
      : periodo === "7d"
        ? "Últimos 7 dias"
        : "Últimos 30 dias";
  const subtitulo = q.data
    ? `${title} — ${periodoLabel} (${new Date(q.data.inicio + "T00:00:00").toLocaleDateString("pt-BR")} → ${new Date(q.data.fim + "T00:00:00").toLocaleDateString("pt-BR")})`
    : title;
  const nomeArquivo = `gerencial_${metrica ?? "detalhe"}_${dia || periodo}`;
  const isDevolucoes = metrica === "devolucoes";
  const colunas = [
    { header: "Registro", value: (r: (typeof itens)[number]) => r.titulo },
    { header: "Detalhe", value: (r: (typeof itens)[number]) => r.subtitulo ?? "" },
    { header: "Observação", value: (r: (typeof itens)[number]) => r.extra ?? "" },
    ...(isDevolucoes
      ? [{ header: "Recebido por", value: (r: (typeof itens)[number]) => r.operador_nome ?? "—" }]
      : []),
    { header: "Base", value: (r: (typeof itens)[number]) => r.base_codigo ?? "" },
    {
      header: "Quando",
      value: (r: (typeof itens)[number]) => new Date(r.quando).toLocaleString("pt-BR"),
    },
  ];
  const handleImprimir = () => {
    abrirRelatorio({
      titulo: title,
      subtitulo,
      nomeArquivo,
      colunas,
      linhas: itens,
      autoPrint: true,
      assinaturas: false,
    });
  };
  const handleCsv = () => {
    baixarCSV({ titulo: title, nomeArquivo, colunas, linhas: itens });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {q.data ? `${q.data.total} registro(s) — ${periodoLabel}` : "Carregando…"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            Filtrar por dia:
            <input
              type="date"
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            />
          </label>
          {dia && (
            <Button size="sm" variant="ghost" onClick={() => setDia("")}>
              Limpar dia
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={handleCsv} disabled={itens.length === 0}>
            <Download className="w-4 h-4 mr-1.5" /> Baixar CSV
          </Button>
          <Button size="sm" onClick={handleImprimir} disabled={itens.length === 0}>
            <Printer className="w-4 h-4 mr-1.5" /> Imprimir / PDF
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 -mx-6 px-6">
          {q.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {q.error && (
            <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>
          )}
          {q.data && itens.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sem registros no período.
            </p>
          )}
          <ul className="divide-y divide-border">
            {itens.map((it) => (
              <li key={it.id} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-sm truncate">{it.titulo}</div>
                  {it.subtitulo && (
                    <div className="text-xs text-muted-foreground truncate">{it.subtitulo}</div>
                  )}
                  {it.extra && (
                    <div className="text-[11px] text-muted-foreground/80 truncate">{it.extra}</div>
                  )}
                  {isDevolucoes && (
                    <div className="text-[11px] text-muted-foreground/80 truncate">
                      Recebido por:{" "}
                      <span className="font-medium text-foreground">{it.operador_nome ?? "—"}</span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs">{new Date(it.quando).toLocaleString("pt-BR")}</div>
                  {it.base_codigo && (
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {it.base_codigo}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
