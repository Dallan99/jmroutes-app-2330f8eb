import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Clock3, Search, Truck } from "lucide-react";
import { monitoramentoRotasTempoReal, type MonitoramentoRota } from "@/lib/monitoramento-rotas.functions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/monitoramento-rotas")({
  head: () => ({ meta: [{ title: "Monitoramento de Rotas — JM Routes" }] }),
  component: MonitoramentoRotasPage,
});

function percentual(rota: MonitoramentoRota) {
  return rota.total > 0 ? Math.min(100, Math.round((rota.entregues / rota.total) * 100)) : 0;
}

const LIMITE_PRIMEIRA_ENTREGA_MINUTOS = 60;

function atrasoPrimeiraEntrega(rota: MonitoramentoRota, agora = Date.now()) {
  if (!rota.saida_xpt_em) return { atrasada: false, minutos: null as number | null, aguardando: false };
  const saida = new Date(rota.saida_xpt_em).getTime();
  if (Number.isNaN(saida)) return { atrasada: false, minutos: null as number | null, aguardando: false };
  const primeira = rota.primeira_entrega_em ? new Date(rota.primeira_entrega_em).getTime() : agora;
  if (Number.isNaN(primeira)) return { atrasada: false, minutos: null as number | null, aguardando: false };
  const minutos = Math.max(0, Math.floor((primeira - saida) / 60_000));
  return {
    atrasada: minutos > LIMITE_PRIMEIRA_ENTREGA_MINUTOS,
    minutos,
    aguardando: !rota.primeira_entrega_em,
  };
}

function hora(valor: string | null) {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(valor));
}

function dataHora(valor: string | null) {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(valor));
}

function ProgressRing({ value }: { value: number }) {
  const raio = 24;
  const circ = 2 * Math.PI * raio;
  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={raio} fill="none" stroke="hsl(var(--muted))" strokeWidth="6" />
        <circle cx="32" cy="32" r={raio} fill="none" stroke="hsl(var(--success))" strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circ} strokeDashoffset={circ * (1 - value / 100)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold tabular-nums">{value}%</span>
    </div>
  );
}

function Metric({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return <div><div className={`text-xl font-bold tabular-nums ${tone}`}>{value.toLocaleString("pt-BR")}</div><div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div></div>;
}

function MonitoramentoRotasPage() {
  const [busca, setBusca] = useState("");
  const [selecionada, setSelecionada] = useState<MonitoramentoRota | null>(null);
  const carregar = useServerFn(monitoramentoRotasTempoReal);
  const consulta = useQuery({
    queryKey: ["monitoramento-rotas", "ESP18"],
    queryFn: () => carregar({ data: { base_codigo: "ESP18" } }),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const rotas = consulta.data?.rotas ?? [];
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return rotas;
    return rotas.filter((r) => [r.nome_rota, r.route_id, r.motorista, r.placa].some((v) => v?.toLowerCase().includes(termo)));
  }, [busca, rotas]);
  const totais = rotas.reduce((acc, r) => ({
    pacotes: acc.pacotes + r.total, entregues: acc.entregues + r.entregues,
    falhas: acc.falhas + r.falhas, pendentes: acc.pendentes + r.pendentes,
    andamento: acc.andamento + (r.entregues > 0 && r.pendentes > 0 ? 1 : 0),
  }), { pacotes: 0, entregues: 0, falhas: 0, pendentes: 0, andamento: 0 });
  const alertasPrimeiraEntrega = rotas.filter((rota) => atrasoPrimeiraEntrega(rota).atrasada).length;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><h1 className="text-2xl font-bold">Monitoramento de Rotas</h1><Badge>Piloto ESP18</Badge></div>
          <p className="text-sm text-muted-foreground">Progresso das rotas em tempo real, com saída do XPT e primeira entrega.</p></div>
        <div className="text-right text-xs text-muted-foreground"><div className="font-medium text-foreground">Atualização automática a cada 15s</div><div>Última coleta: {dataHora(consulta.data?.atualizado_em ?? null)}</div></div>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-4 md:grid-cols-6">
        <Metric label="Rotas" value={rotas.length} /><Metric label="Em andamento" value={totais.andamento} tone="text-info" />
        <Metric label="Pacotes" value={totais.pacotes} /><Metric label="Bem-sucedidos" value={totais.entregues} tone="text-success" />
        <Metric label="Com falhas" value={totais.falhas} tone="text-destructive" />
        <Metric label="1ª entrega acima de 60 min" value={alertasPrimeiraEntrega} tone={alertasPrimeiraEntrega > 0 ? "text-destructive" : "text-success"} />
      </Card>

      <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} className="pl-9" placeholder="Buscar rota, número, motorista ou placa" /></div>

      {consulta.data?.status === "erro" && <Card className="border-destructive/30 p-4 text-sm text-destructive"><AlertTriangle className="mr-2 inline h-4 w-4" />Não foi possível carregar o piloto: {consulta.data.erro}</Card>}
      {!consulta.isLoading && consulta.data?.status === "ok" && rotas.length === 0 && <Card className="p-8 text-center text-sm text-muted-foreground">Aguardando a primeira sincronização detalhada da ESP18.</Card>}

      <div className="space-y-3">
        {filtradas.map((rota) => {
          const progresso = percentual(rota);
          const alerta = atrasoPrimeiraEntrega(rota);
          return <button key={rota.id} onClick={() => setSelecionada(rota)} className={`grid w-full grid-cols-1 items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition hover:border-primary/40 hover:shadow-md md:grid-cols-[minmax(210px,1.2fr)_minmax(160px,1fr)_80px_minmax(280px,1.4fr)_100px_100px_minmax(150px,1fr)] ${alerta.atrasada ? "border-destructive/60 bg-destructive/[0.03]" : ""}`}>
            <div><div className="font-bold">{rota.nome_rota || "Rota"} <span className="font-medium text-muted-foreground">· #{rota.route_id}</span></div><div className="mt-1 text-xs text-muted-foreground">{rota.placa || "Veículo não informado"} · ESP18</div>{alerta.atrasada && <Badge variant="destructive" className="mt-2"><AlertTriangle className="mr-1 h-3 w-3" />{alerta.aguardando ? `Sem entrega há ${alerta.minutos} min` : `1ª entrega após ${alerta.minutos} min`}</Badge>}</div>
            <div className="truncate"><div className="font-medium">{rota.motorista || "Motorista não informado"}</div><div className="text-xs text-muted-foreground">Mercado Envios</div></div>
            <ProgressRing value={progresso} />
            <div><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">SPR</div><div className="text-sm">{rota.pendentes} pendentes, <span className="text-destructive">{rota.falhas} com falhas</span>, <span className="text-success">{rota.entregues} bem-sucedidos</span></div></div>
            <div><div className="text-[11px] text-muted-foreground">SAÍDA</div><div className="font-semibold tabular-nums">{hora(rota.saida_xpt_em)}</div></div>
            <div><div className="text-[11px] text-muted-foreground">1ª ENTREGA</div><div className="font-semibold tabular-nums">{hora(rota.primeira_entrega_em)}</div></div>
            <div className="text-sm font-medium">{rota.pendentes === 0 && rota.total > 0 ? "Rota concluída" : rota.entregues > 0 ? "Em curso a partir do XPT ESP18" : "A caminho do XPT ESP18"}</div>
          </button>;
        })}
      </div>

      <Sheet open={!!selecionada} onOpenChange={(open) => !open && setSelecionada(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selecionada && <><SheetHeader><SheetTitle>{selecionada.nome_rota || "Rota"} · #{selecionada.route_id}</SheetTitle><SheetDescription>{selecionada.motorista || "Motorista não informado"} · {selecionada.placa || "Sem placa"}</SheetDescription></SheetHeader>
            {atrasoPrimeiraEntrega(selecionada).atrasada && <div className="mt-5 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive"><AlertTriangle className="mr-2 inline h-4 w-4" /><strong>Alerta operacional:</strong> {atrasoPrimeiraEntrega(selecionada).aguardando ? `a rota saiu há ${atrasoPrimeiraEntrega(selecionada).minutos} minutos e ainda não realizou a primeira entrega.` : `a primeira entrega ocorreu ${atrasoPrimeiraEntrega(selecionada).minutos} minutos após a saída do XPT.`}</div>}
            <div className="mt-6 flex items-center gap-5 rounded-xl border p-4"><ProgressRing value={percentual(selecionada)} /><div className="grid flex-1 grid-cols-3 gap-3"><Metric label="Pendentes" value={selecionada.pendentes} /><Metric label="Falhas" value={selecionada.falhas} tone="text-destructive" /><Metric label="Entregues" value={selecionada.entregues} tone="text-success" /></div></div>
            <div className="mt-8"><h3 className="mb-5 font-semibold">Histórico da rota</h3><div className="relative ml-3 border-l-2 border-primary/30 pl-7">
              <div className="relative pb-8"><Truck className="absolute -left-[39px] top-0 h-5 w-5 rounded-full bg-background text-primary" /><div className="text-sm font-semibold">Saída do XPT ESP18</div><div className="text-sm text-muted-foreground">{dataHora(selecionada.saida_xpt_em)}</div></div>
              <div className="relative"><CheckCircle2 className="absolute -left-[39px] top-0 h-5 w-5 rounded-full bg-background text-success" /><div className="text-sm font-semibold">Primeira entrega</div><div className="text-sm text-muted-foreground">{dataHora(selecionada.primeira_entrega_em)}</div></div>
            </div></div>
            <div className="mt-8 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><Clock3 className="mr-2 inline h-4 w-4" />Último dado recebido em {dataHora(selecionada.coletado_em)}.</div></>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

