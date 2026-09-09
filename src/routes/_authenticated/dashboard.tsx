import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardData, dashboardFiltrosOpcoes, type DashboardFilters } from "@/lib/dashboard.functions";
import { MeliDashboardSection } from "@/components/meli-dashboard";
import { fmtDataHora, useMeliSync } from "@/components/meli-sync-monitor";

import { DashboardGeral } from "@/components/dashboard-geral";
import { diaOperacionalInicial, hojeOperacional, salvarDiaEscolhido } from "@/lib/dia-operacional";

const CHAVE_DIA_DASHBOARD = "jm.dia.dashboard";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart, Pie, PieChart, Cell, Legend,
} from "recharts";
import {
  Activity, AlertOctagon, AlertTriangle, CheckCircle2, Clock, Gauge,
  Package, PackageCheck, PackageSearch, RefreshCcw, Timer, TrendingUp, Truck, Tv, UserCog,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — JM Transportes" }] }),
  component: DashboardPage,
});

const NONE = "__all";
const PIE_COLORS = ["var(--brand-navy)", "var(--brand-yellow)", "var(--info)", "var(--warning)"];

function fmtDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function DashboardPage() {
  const qc = useQueryClient();
  const [verInternos, setVerInternos] = useState(false);
  const sync = useMeliSync();

  const fetchOpcoes = useServerFn(dashboardFiltrosOpcoes);
  const fetchDados = useServerFn(dashboardData);

  // Abre sempre no dia operacional atual (America/Sao_Paulo), salvo escolha
  // explícita feita nesta mesma sessão e no mesmo dia.
  const [filters, setFilters] = useState<DashboardFilters>(() => ({
    date: diaOperacionalInicial(CHAVE_DIA_DASHBOARD),
    base_id: null, operador_id: null, motorista_id: null, transportadora: null, turno: null,
  }));
  const cleanFilters = useMemo(() => {
    const c: DashboardFilters = {};
    for (const [k, v] of Object.entries(filters)) if (v) (c as any)[k] = v;
    return c;
  }, [filters]);

  const opcoesQuery = useQuery({
    queryKey: ["dashboard-opcoes"],
    queryFn: () => fetchOpcoes(),
    staleTime: 5 * 60_000,
  });
  const dadosQuery = useQuery({
    queryKey: ["dashboard", cleanFilters],
    queryFn: () => fetchDados({ data: cleanFilters }),
    refetchInterval: 10_000,
    staleTime: 10_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    const ch = supabase
      .channel("dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "recebimentos" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "rotas" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const d = dadosQuery.data;
  const op = opcoesQuery.data;

  function setF<K extends keyof DashboardFilters>(k: K, v: DashboardFilters[K]) {
    if (k === "date" && typeof v === "string" && v) salvarDiaEscolhido(CHAVE_DIA_DASHBOARD, v);
    setFilters((prev) => ({ ...prev, [k]: v }));
  }
  return (
    <div className="relative p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      {/* Imagem institucional ao fundo (decorativa) */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center opacity-[0.07]"
        style={{
          backgroundImage:
            "url('/__l5e/assets-v1/49cb86eb-5372-47f1-aa79-869f502baca5/jm-hero.png')",
        }}
      />
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Dados Meli sincronizados em{" "}
              <span className="font-semibold tabular-nums">{fmtDataHora(sync.ultimoSucessoGeral)}</span>
              {" · "}
              <span className="text-xs">consulta do painel renovada a cada 60s</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
          <Link
            to="/tv/meli"
            search={{
              data: filters.date ?? hojeOperacional(),
              base_id: filters.base_id ?? undefined,
            }}
            aria-label="Abrir Modo TV da operação Meli"
          >
            <Button size="sm" className="font-semibold">
              <Tv className="w-4 h-4 mr-2" aria-hidden /> Modo TV
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["dashboard"] });
              qc.invalidateQueries({ queryKey: ["meli-dashboard-operacional"] });
              sync.query.refetch();
            }}
          >
            <RefreshCcw className="w-4 h-4 mr-2" /> Atualizar
          </Button>
          </div>
        </div>
      </header>

      {/* ── Cartões da operação (primeiro de tudo) ── */}
      <DashboardGeral data={filters.date || undefined} syncPorCodigo={sync.porCodigo} />

      {/* ── Detalhamento da operação (mesmo dashboard) ── */}
      <MeliDashboardSection
        data={filters.date || undefined}
        bases={op?.bases ?? []}
        baseId={filters.base_id ?? null}
      />

      {/* ── Indicadores internos JM (Recebimento / Triagem) — sob demanda ── */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Indicadores internos JM</h2>
          <p className="text-xs text-muted-foreground">Recebimento físico na base e triagem — não é entrega ao destinatário.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setVerInternos((v) => !v)}>
          {verInternos ? "Ocultar" : "Ver detalhes"}
        </Button>
      </div>


      {verInternos && (
      <>
      {/* KPIs — Rotas */}
      <SectionLabel>Rotas</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Previstas" value={d?.rotasPrevistas ?? "—"} icon={Truck} />
        <Kpi label="Recebidas" value={d?.rotasRecebidas ?? "—"} icon={PackageCheck} accent="info" />
        <Kpi label="Em triagem" value={d?.rotasEmTriagem ?? "—"} icon={Activity} accent="warning" />
        <Kpi label="Finalizadas" value={d?.rotasFinalizadas ?? "—"} icon={CheckCircle2} accent="success" />
      </div>

      {/* KPIs — Volumes */}
      <SectionLabel>Volumes</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Previstos" value={d?.volumesPrevistos ?? "—"} icon={Package} />
        <Kpi label="Bipados" value={d?.volumesBipados ?? "—"} icon={PackageCheck} accent="success" />
        <Kpi label="Pendentes" value={d?.volumesPendentes ?? "—"} icon={PackageSearch} accent="warning" />
        <Kpi label="Eficiência" value={d ? `${d.eficiencia}%` : "—"} icon={Gauge} accent={d && d.eficiencia >= 90 ? "success" : d && d.eficiencia >= 60 ? "info" : "warning"} />
      </div>

      {/* KPIs — Performance */}
      <SectionLabel>Performance & alertas</SectionLabel>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Prod. por hora" value={d ? `${d.produtividadeHora}/h` : "—"} icon={TrendingUp} accent="info" />
        <Kpi label="Tempo médio/rota" value={fmtDuration(d?.tempoMedioRotaMs)} icon={Timer} />
        <Kpi label="Tempo médio/operador" value={fmtDuration(d?.tempoMedioOperadorMs)} icon={UserCog} />
        <Kpi label="Alertas" value={d?.alertas ?? "—"} icon={AlertOctagon} accent={d && d.alertas > 0 ? "destructive" : "success"} />
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Bipagens por hora</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={d?.porHora ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="hora" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Line type="monotone" dataKey="total" stroke="var(--brand-navy)" strokeWidth={2} dot={{ fill: "var(--brand-yellow)", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Status das rotas</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={d?.porStatus ?? []} dataKey="total" nameKey="status" innerRadius={45} outerRadius={80} paddingAngle={2}>
                  {(d?.porStatus ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold mb-3">Bipagens por operador</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d?.porOperador ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="operador" tick={{ fontSize: 11 }} width={120} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Bar dataKey="total" fill="var(--brand-navy)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold mb-3">Bipagens por base</h2>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d?.porBase ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="base" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 }} />
                <Bar dataKey="total" fill="var(--brand-yellow)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* Ocorrências */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" /> Últimas ocorrências
          </h2>
          <span className="text-xs text-muted-foreground">{d?.ocorrencias?.length ?? 0} exibidas</span>
        </div>
        {(!d?.ocorrencias || d.ocorrencias.length === 0) ? (
          <div className="text-sm text-muted-foreground py-6 text-center">Nenhuma ocorrência no período.</div>
        ) : (
          <ScrollArea className="h-56">
            <ul className="divide-y">
              {d.ocorrencias.map((o) => (
                <li key={o.id} className="py-2 flex items-start gap-3 text-sm">
                  <Badge variant="outline" className="uppercase text-[10px] mt-0.5">{o.tipo.replace(/_/g, " ")}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{o.mensagem ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(o.created_at).toLocaleString("pt-BR")} {o.operador ? `· ${o.operador}` : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </Card>
      </>
      )}


      <div className="text-[10px] text-muted-foreground flex items-center gap-2 justify-end">
        <Clock className="w-3 h-3" /> atualização automática a cada 10s + realtime
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-medium mt-2">
      {children}
    </div>
  );
}

function Kpi({
  label, value, icon: Icon, accent,
}: {
  label: string;
  value: string | number;
  icon: typeof Truck;
  accent?: "success" | "warning" | "destructive" | "info";
}) {
  const ring =
    accent === "success" ? "text-success"
    : accent === "warning" ? "text-warning"
    : accent === "destructive" ? "text-destructive"
    : accent === "info" ? "text-[var(--info)]"
    : "text-primary";
  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${ring}`} />
      </div>
      <div className="font-display text-2xl md:text-3xl font-bold">{value}</div>
    </Card>
  );
}
