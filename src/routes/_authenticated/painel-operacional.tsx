import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { rotasPorBase } from "@/lib/gerencial.functions";
import { dashboardData } from "@/lib/dashboard.functions";
import { BipagemBasesPanel } from "@/components/bipagem-bases";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { hojeOperacional } from "@/lib/dia-operacional";
import { comTimeout } from "@/lib/consulta-com-timeout";
import { AvisoConsulta } from "@/components/aviso-consulta";

export const Route = createFileRoute("/_authenticated/painel-operacional")({
  head: () => ({
    meta: [
      { title: "Painel Operacional — JM Transportes" },
      { name: "description", content: "Percentual de bipagem por base e acompanhamento das rotas do dia." },
      { property: "og:title", content: "Painel Operacional — JM Transportes" },
      { property: "og:description", content: "Percentual de bipagem por base e acompanhamento das rotas do dia." },
    ],
  }),
  component: PainelOperacionalPage,
});

function fmtDuration(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${seconds}s`;
  return `${seconds}s`;
}

function PainelOperacionalPage() {
  const [dia, setDia] = useState<string>(() => hojeOperacional());
  const [baseSel, setBaseSel] = useState<string | null>(null);

  const fetchRotas = useServerFn(rotasPorBase);
  const fetchProdutividade = useServerFn(dashboardData);
  const q = useQuery({
    queryKey: ["painel-operacional-rotas", dia],
    queryFn: () => comTimeout(fetchRotas({ data: { data: dia } })),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });
  const produtividade = useQuery({
    queryKey: ["painel-operacional-produtividade", dia, baseSel],
    queryFn: () => comTimeout(fetchProdutividade({ data: { date: dia, base_id: baseSel } })),
    refetchInterval: 60_000,
    staleTime: 45_000,
  });


  const bases = q.data?.bases ?? [];
  const rotas = useMemo(
    () => (q.data?.rotas ?? []).filter((r) => !baseSel || r.base_id === baseSel),
    [q.data, baseSel],
  );

  return (
    <div className="p-4 md:p-6 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black tracking-tight">Painel Operacional</h1>
          <p className="text-sm text-muted-foreground">Percentual de bipagem por base no dia operacional.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <Label className="text-xs">Dia</Label>
            <Input type="date" value={dia} onChange={(e) => setDia(e.target.value)} className="h-9" />
          </div>
          <Button variant="outline" className="h-9" onClick={() => { q.refetch(); produtividade.refetch(); }}>
            Atualizar
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const d = prompt("Informe a data (YYYY-MM-DD):", dia);
              if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setDia(d);
            }}
          >
            Trocar data
          </Button>
        </div>
      </header>
      <AvisoConsulta erro={q.error ?? produtividade.error} temDados={!!q.data || !!produtividade.data} />

      <BipagemBasesPanel data={dia} />

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={baseSel ? "outline" : "default"} onClick={() => setBaseSel(null)}>
          Todas as bases
        </Button>
        {bases.map((b) => (
          <Button
            key={b.base_id}
            size="sm"
            variant={baseSel === b.base_id ? "default" : "outline"}
            onClick={() => setBaseSel(b.base_id)}
          >
            {b.codigo} · {b.pct.toFixed(0)}%
          </Button>
        ))}
      </div>

      <Card className="p-0 overflow-hidden">
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2">Base</th>
                <th className="text-left px-3 py-2">Rota</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Bipados</th>
                <th className="text-right px-3 py-2">Faltando</th>
                <th className="text-right px-3 py-2">% Bipagem</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rotas.map((r) => (
                <tr key={`${r.base_id}-${r.nro_rota}`} className="border-t">
                  <td className="px-3 py-1.5 font-medium">{r.base_codigo}</td>
                  <td className="px-3 py-1.5">{r.nro_rota}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.total}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.recebido}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.faltando}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{r.pct.toFixed(1)}%</td>
                  <td className="px-3 py-1.5 capitalize">{r.status}</td>
                </tr>
              ))}
              {rotas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    {q.isLoading ? "Carregando…" : "Nenhuma rota para o filtro selecionado."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">Ranking de produtividade</h2>
            <p className="text-xs text-muted-foreground">
              Eficiência e tempo de bipagem por funcionário. Pausas acima de 5 minutos não entram no tempo ativo.
            </p>
          </div>
          <Badge variant="outline">{produtividade.data?.porOperador.length ?? 0} funcionários ativos</Badge>
        </div>

        {!produtividade.data?.porOperador.length ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            {produtividade.isLoading ? "Carregando produtividade…" : "Nenhuma bipagem registrada no dia e base selecionados."}
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1080px] w-full text-sm">
              <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left"># · Funcionário</th>
                  <th className="px-3 py-2 text-right">Leituras</th>
                  <th className="px-3 py-2 text-right">OK</th>
                  <th className="px-3 py-2 text-right">Diverg.</th>
                  <th className="px-3 py-2 text-right">Eficiência</th>
                  <th className="px-3 py-2 text-right">Prod./hora</th>
                  <th className="px-3 py-2 text-right">Tempo ativo</th>
                  <th className="px-3 py-2 text-right">Média/bipagem</th>
                  <th className="px-3 py-2 text-right">Início–fim</th>
                </tr>
              </thead>
              <tbody>
                {produtividade.data.porOperador.map((item, index) => (
                  <tr key={item.operador} className="border-b last:border-0">
                    <td className="px-3 py-3 font-semibold">{index + 1} · {item.operador}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{item.leituras.toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums">{item.ok.toLocaleString("pt-BR")}</td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${item.divergencias ? "text-warning" : "text-success"}`}>{item.divergencias.toLocaleString("pt-BR")}</td>
                    <td className={`px-3 py-3 text-right font-semibold tabular-nums ${item.eficiencia >= 95 ? "text-success" : item.eficiencia < 85 ? "text-destructive" : ""}`}>{item.eficiencia.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">{item.porHora.toLocaleString("pt-BR")}/h</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtDuration(item.tempoAtivoMs)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{fmtDuration(item.tempoMedioMs)}</td>
                    <td className="px-3 py-3 text-right text-xs tabular-nums text-muted-foreground">
                      {item.primeiraBipagem && item.ultimaBipagem
                        ? `${new Date(item.primeiraBipagem).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–${new Date(item.ultimaBipagem).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
