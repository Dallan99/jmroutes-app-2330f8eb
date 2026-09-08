import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CalendarDays, CheckCircle2, CircleAlert, Package, RefreshCcw, Truck } from "lucide-react";
import { obterDashboardGeral } from "@/lib/dashboard-geral.functions";
import { hojeOperacional } from "@/lib/dia-operacional";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const nf = (n: number | null | undefined) => n == null ? "—" : n.toLocaleString("pt-BR");
const pc = (n: number | null | undefined) => n == null ? "—" : `${n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}%`;

export function DashboardGeralOperacional() {
  const [data, setData] = useState(hojeOperacional());
  const buscar = useServerFn(obterDashboardGeral);
  const query = useQuery({
    queryKey: ["dashboard-geral-multibase", data],
    queryFn: () => buscar({ data: { data } }),
    refetchInterval: 60_000,
  });
  const bases = query.data?.bases ?? [];
  const totais = query.data?.totais;
  const atualizadas = useMemo(() => bases.filter((b) => b.status === "ok").length, [bases]);

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard Geral</h1>
          <p className="text-sm text-muted-foreground">Todas as operações JM atendidas para o Mercado Livre, incluindo Services e XPTs.</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="relative">
            <CalendarDays className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="pl-8 w-40" aria-label="Dia operacional" />
          </label>
          <Button variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCcw className={`w-4 h-4 mr-2 ${query.isFetching ? "animate-spin" : ""}`} />Atualizar
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Kpi label="Bases com dados" value={`${atualizadas}/${bases.length || 17}`} icon={Building2} />
        <Kpi label="Veículos" value={nf(totais?.veiculos)} icon={Truck} />
        <Kpi label="Pacotes" value={nf(totais?.pacotes)} icon={Package} />
        <Kpi label="Entregas realizadas" value={nf(totais?.entregues)} icon={CheckCircle2} tone="text-success" />
        <Kpi label="Insucessos normais" value={nf(totais?.insucessos)} icon={CircleAlert} tone="text-destructive" />
      </div>

      <Card className="overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="font-display text-xl font-bold">Performance por base</h2>
          <p className="text-xs text-muted-foreground">Fechamento operacional no mesmo formato da planilha da gestão.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="p-3 text-left">Base</th><th className="p-3 text-left">Tipo</th>
                <th className="p-3 text-right">Veículos</th><th className="p-3 text-right">Pacotes</th>
                <th className="p-3 text-right">Entregas realizadas</th><th className="p-3 text-right">DC cancelado</th>
                <th className="p-3 text-right">Sinistro</th><th className="p-3 text-right">Insucessos normais</th>
                <th className="p-3 text-right">PNR</th><th className="p-3 text-right">Performance Logistics</th>
                <th className="p-3 text-right">Performance s/ DC Meli</th><th className="p-3 text-right">Performance s/ DC e sinistros</th>
              </tr>
            </thead>
            <tbody>
              {query.isLoading && <tr><td colSpan={12} className="p-10 text-center text-muted-foreground">Carregando todas as bases...</td></tr>}
              {query.isError && <tr><td colSpan={12} className="p-10 text-center text-destructive">{query.error.message}</td></tr>}
              {bases.map((b) => (
                <tr key={b.id} className="border-t hover:bg-muted/30">
                  <td className="p-3"><div className="font-semibold">{b.nome}</div><div className="text-xs text-muted-foreground">{b.codigo} · {b.cidade}/{b.uf}</div></td>
                  <td className="p-3"><Badge variant={b.tipo === "XPT" ? "default" : "outline"}>{b.tipo}</Badge>{b.status === "sem_dados" && <Badge variant="secondary" className="ml-2">sem dados</Badge>}</td>
                  <Num value={b.veiculos} /><Num value={b.pacotes} /><Num value={b.entregues} tone="text-success" />
                  <Num value={b.dc_cancelado} /><Num value={b.sinistros} /><Num value={b.insucessos} tone="text-destructive" /><Num value={b.pnr} />
                  <Pct value={b.performance_logistics} /><Pct value={b.performance_sem_dc} /><Pct value={b.performance_sem_dc_sinistro} />
                </tr>
              ))}
            </tbody>
            {totais && <tfoot className="border-t-2 bg-muted/40 font-bold"><tr>
              <td className="p-3" colSpan={2}>Consolidado</td><Num value={totais.veiculos} /><Num value={totais.pacotes} /><Num value={totais.entregues} tone="text-success" />
              <Num value={totais.dc_cancelado} /><Num value={totais.sinistros} /><Num value={totais.insucessos} tone="text-destructive" /><Num value={totais.pnr} />
              <Pct value={totais.performance_logistics} /><Pct value={totais.performance_sem_dc} /><Pct value={totais.performance_sem_dc_sinistro} />
            </tr></tfoot>}
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">O fechamento é registrado em snapshot diário. O envio por e-mail será ativado quando os destinatários e a credencial do provedor forem configurados.</p>
    </div>
  );
}

function Kpi({ label, value, icon: Icon, tone = "text-primary" }: { label: string; value: string; icon: typeof Truck; tone?: string }) {
  return <Card className="p-4"><div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground"><span>{label}</span><Icon className={`w-4 h-4 ${tone}`} /></div><div className={`mt-2 font-display text-2xl md:text-3xl font-bold tabular-nums ${tone}`}>{value}</div></Card>;
}
function Num({ value, tone = "" }: { value: number | null | undefined; tone?: string }) { return <td className={`p-3 text-right tabular-nums ${tone}`}>{nf(value)}</td>; }
function Pct({ value }: { value: number | null | undefined }) { return <td className="p-3 text-right tabular-nums font-semibold">{pc(value)}</td>; }
