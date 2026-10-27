import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { dashboardData } from "@/lib/dashboard.functions";
import { BipagemBasesPanel } from "@/components/bipagem-bases";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  Line, LineChart, Legend,
} from "recharts";
import {
  Activity, AlertOctagon, CheckCircle2, Gauge, Package, PackageCheck,
  PackageSearch, Timer, TrendingUp, Truck, UserCog,
} from "lucide-react";
import { comTimeout } from "@/lib/consulta-com-timeout";

export const Route = createFileRoute("/tv/dashboard")({
  head: () => ({ meta: [{ title: "TV — Operacional" }] }),
  component: TvDashboard,
});

function fmtDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function TvDashboard() {
  const fn = useServerFn(dashboardData);
  const q = useQuery({
    queryKey: ["tv-dashboard"],
    queryFn: () => comTimeout(fn({ data: {} })),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  // Sem Realtime em "recebimentos"/"rotas" (ver dashboard.tsx): atualização periódica.

  const d = q.data;
  const now = new Date().toLocaleTimeString("pt-BR");

  return (
    <div className="p-6 xl:p-10 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-4xl xl:text-5xl font-black tracking-tight">Painel Operacional</h1>
          <p className="text-white/60 mt-1">Últimas 24 horas · atualizado {q.dataUpdatedAt ? new Date(q.dataUpdatedAt).toLocaleTimeString("pt-BR") : now}</p>
        </div>
        <div className="font-display text-3xl xl:text-4xl font-bold tabular-nums text-[var(--brand-yellow)]">{now}</div>
      </div>

      <BipagemBasesPanel tv refetchInterval={20_000} titulo="Bipagem por base (dia operacional)" />

      <Section title="Rotas">
        <TvKpi label="Previstas" value={d?.rotasPrevistas ?? "—"} icon={Truck} />
        <TvKpi label="Recebidas" value={d?.rotasRecebidas ?? "—"} icon={PackageCheck} tone="info" />
        <TvKpi label="Em triagem" value={d?.rotasEmTriagem ?? "—"} icon={Activity} tone="warning" />
        <TvKpi label="Finalizadas" value={d?.rotasFinalizadas ?? "—"} icon={CheckCircle2} tone="success" />
      </Section>

      <Section title="Volumes">
        <TvKpi label="Previstos" value={d?.volumesPrevistos ?? "—"} icon={Package} />
        <TvKpi label="Bipados" value={d?.volumesBipados ?? "—"} icon={PackageCheck} tone="success" />
        <TvKpi label="Pendentes" value={d?.volumesPendentes ?? "—"} icon={PackageSearch} tone="warning" />
        <TvKpi
          label="Eficiência"
          value={d ? `${d.eficiencia}%` : "—"}
          icon={Gauge}
          tone={d && d.eficiencia >= 90 ? "success" : d && d.eficiencia >= 60 ? "info" : "warning"}
        />
      </Section>

      <Section title="Performance">
        <TvKpi label="Produtividade/h" value={d ? `${d.produtividadeHora}` : "—"} icon={TrendingUp} tone="info" />
        <TvKpi label="T. médio / rota" value={fmtDuration(d?.tempoMedioRotaMs)} icon={Timer} />
        <TvKpi label="T. médio / operador" value={fmtDuration(d?.tempoMedioOperadorMs)} icon={UserCog} />
        <TvKpi
          label="Alertas"
          value={d?.alertas ?? "—"}
          icon={AlertOctagon}
          tone={d && d.alertas > 0 ? "danger" : "success"}
        />
      </Section>

      <div className="grid lg:grid-cols-3 gap-4">
        <TvCard className="lg:col-span-2" title="Bipagens por hora">
          <div className="h-72">
            <ResponsiveContainer>
              <LineChart data={d?.porHora ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="hora" tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
                <YAxis tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
                <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
                <Line type="monotone" dataKey="total" stroke="var(--brand-yellow)" strokeWidth={3} dot={{ fill: "var(--brand-yellow)", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </TvCard>
        <TvCard title="Bipagens por operador">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={d?.porOperador ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis type="number" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }} />
                <YAxis type="category" dataKey="operador" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.7)" }} width={120} />
                <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
                <Bar dataKey="total" fill="var(--brand-yellow)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TvCard>
        <TvCard className="lg:col-span-3" title="Bipagens por base">
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={d?.porBase ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                <XAxis dataKey="base" tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
                <YAxis tick={{ fontSize: 13, fill: "rgba(255,255,255,0.7)" }} />
                <Tooltip contentStyle={{ background: "#0b1220", border: "1px solid rgba(255,255,255,0.15)", color: "#fff" }} />
                <Legend wrapperStyle={{ color: "#fff", fontSize: 13 }} />
                <Bar dataKey="total" name="Bipagens" fill="var(--brand-yellow)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TvCard>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-[0.2em] text-[var(--brand-yellow)] font-bold">{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

function TvKpi({
  label, value, icon: Icon, tone,
}: {
  label: string; value: string | number;
  icon: typeof Truck;
  tone?: "success" | "warning" | "danger" | "info";
}) {
  const color =
    tone === "success" ? "text-emerald-400"
    : tone === "warning" ? "text-amber-300"
    : tone === "danger" ? "text-rose-400"
    : tone === "info" ? "text-sky-300"
    : "text-[var(--brand-yellow)]";
  return (
    <div className="rounded-2xl bg-white/[0.06] border border-white/10 p-5 xl:p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] xl:text-xs uppercase tracking-widest text-white/60 font-semibold">{label}</span>
        <Icon className={`w-6 h-6 ${color}`} />
      </div>
      <div className={`font-display text-4xl xl:text-6xl font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function TvCard({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-white/[0.06] border border-white/10 p-5 ${className}`}>
      <h2 className="text-sm uppercase tracking-widest text-white/70 font-semibold mb-3">{title}</h2>
      {children}
    </div>
  );
}