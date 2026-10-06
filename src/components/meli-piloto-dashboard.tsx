import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { pilotoDashboard } from "@/lib/meli-piloto-dashboard.functions";
import type { PainelBase } from "@/lib/meli-piloto-dashboard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const ND = "não disponível";
const n = (v: number | null) => (v == null ? ND : v.toLocaleString("pt-BR"));
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : ND);

export function MeliPilotoDashboard({ data }: { data: string }) {
  const fn = useServerFn(pilotoDashboard);
  const q = useQuery({
    queryKey: ["piloto-dashboard", data],
    queryFn: () => fn({ data: { data } }),
    refetchInterval: 60_000,
  });
  if (q.isLoading) return <Card className="p-4 text-sm text-muted-foreground">Carregando dados do piloto…</Card>;
  if (q.error) return <Card className="p-4 text-sm text-destructive">Sem dados do piloto: {(q.error as Error).message}</Card>;
  const painel = q.data?.painel ?? [];
  const ativas = painel.filter((b) => b.situacao === "ativa");
  const tot = (k: "rotas" | "pacotes" | "entregues") => {
    const v = ativas.map((b) => b[k]).filter((x): x is number => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) : null;
  };
  const p = tot("pacotes"), e = tot("entregues");
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-lg font-bold">Operação Meli — piloto (somente leitura)</h2>
        <p className="text-xs text-muted-foreground">Último ciclo concluído de cada base no dia {data}. Ciclos repetidos não são somados.</p>
      </div>
      {!ativas.length && <Card className="p-4 text-sm text-muted-foreground">Sem dados do piloto para este dia.</Card>}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Rotas em rota" v={n(tot("rotas"))} />
        <Kpi label="Pacotes" v={n(p)} />
        <Kpi label="Entregues" v={n(e)} />
        <Kpi label="Falhas/insucessos" v={ND} />
        <Kpi label="% entregue" v={p && e != null ? `${Math.round((e / p) * 1000) / 10}%` : ND} />
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {painel.map((b) => <BaseCard key={b.base_codigo} b={b} />)}
      </div>
      {q.data?.rotasTruncadas && <p className="text-xs text-destructive">Atenção: limite de 1000 rotas atingido; totais podem estar incompletos.</p>}
    </section>
  );
}

function Kpi({ label, v }: { label: string; v: string }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-display text-2xl font-bold tabular-nums">{v}</div>
    </Card>
  );
}

function BaseCard({ b }: { b: PainelBase }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Card className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{b.base_codigo} · {b.base_nome}</div>
        {b.situacao === "ativa" && <Badge>Ativa</Badge>}
        {b.situacao === "sem_dados" && <Badge variant="secondary">Sem dados</Badge>}
        {b.situacao === "desativada" && <Badge variant="outline">Desativada / não configurada</Badge>}
      </div>
      {b.situacao === "desativada" ? (
        <p className="text-sm text-muted-foreground">Fora do piloto: estação externa não confirmada. Nenhum dado é exibido.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <span>Rotas: <b>{n(b.rotas)}</b></span>
            <span>Pacotes: <b>{n(b.pacotes)}</b></span>
            <span>Entregues: <b>{n(b.entregues)}</b></span>
            <span>Falhas: <b>{ND}</b></span>
            <span>% entregue: <b>{b.perc_entregue == null ? ND : `${b.perc_entregue}%`}</b></span>
            <span className="col-span-3 text-xs text-muted-foreground">Última sincronização: {hora(b.ultima_sincronizacao)}</span>
          </div>
          {b.integridade.length > 0 && (
            <ul className="text-xs text-warning list-disc pl-4">{b.integridade.map((i) => <li key={i}>{i}</li>)}</ul>
          )}
          {b.lista.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setAberto((v) => !v)}>{aberto ? "Ocultar rotas" : `Ver ${b.lista.length} rotas`}</Button>
          )}
          {aberto && (
            <div className="max-h-72 overflow-auto text-xs">
              <table className="w-full">
                <thead className="text-muted-foreground"><tr><th className="text-left">Rota</th><th className="text-left">Motorista</th><th className="text-left">Placa</th><th className="text-right">Pacotes</th><th className="text-right">Entregues</th></tr></thead>
                <tbody>
                  {b.lista.map((r) => (
                    <tr key={r.route_id} className="border-t border-border">
                      <td>{r.route_id}</td><td>{r.motorista_nome ?? ND}</td><td>{r.placa ?? ND}</td>
                      <td className="text-right tabular-nums">{n(r.total_pedidos)}</td><td className="text-right tabular-nums">{n(r.total_entregue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
