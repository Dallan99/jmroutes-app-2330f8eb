import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { meliResumoGerencial } from "@/lib/gerencial-meli.functions";

export function MeliEntregasPanel({ periodo }: { periodo: "hoje" | "7d" | "30d" }) {
  const fn = useServerFn(meliResumoGerencial);
  const q = useQuery({
    queryKey: ["gerencial-meli", periodo],
    queryFn: () => fn({ data: { periodo } }),
    refetchInterval: 120_000,
  });
  const d = q.data;
  const fmt = (n: number) => n.toLocaleString("pt-BR");
  const dataBR = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("pt-BR");
  return (
    <Card className="p-4">
      <div className="mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <Truck className="w-4 h-4" /> Entregas Mercado Livre por base
        </h2>
        <p className="text-xs text-muted-foreground">
          {d ? `${dataBR(d.inicio)} → ${dataBR(d.fim)} · soma das leituras diárias de cada base` : "Carregando…"}
        </p>
      </div>
      {q.isError && <p className="text-sm text-destructive">Não foi possível carregar os dados do Mercado Livre.</p>}
      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {[
              { l: "Rotas", v: fmt(d.totais.rotas) },
              { l: "Pacotes", v: fmt(d.totais.pacotes) },
              { l: "Entregues", v: fmt(d.totais.entregues) },
              { l: "Insucessos", v: fmt(d.totais.insucessos) },
              { l: "% entrega", v: `${d.totais.perc_entrega.toFixed(1)}%` },
            ].map((k) => (
              <div key={k.l} className="rounded-lg border p-3">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.l}</div>
                <div className="text-2xl font-bold tabular-nums">{k.v}</div>
              </div>
            ))}
          </div>
          {d.bases.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem leituras do Mercado Livre no período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2">Base</th>
                    <th className="text-right">Dias</th>
                    <th className="text-right">Rotas</th>
                    <th className="text-right">Pacotes</th>
                    <th className="text-right">Entregues</th>
                    <th className="text-right">Insucessos</th>
                    <th className="text-right">% entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {d.bases.map((b) => (
                    <tr key={b.base_codigo} className="border-b last:border-0">
                      <td className="py-2 font-medium">{b.base_codigo}</td>
                      <td className="text-right tabular-nums">{b.dias}</td>
                      <td className="text-right tabular-nums">{fmt(b.rotas)}</td>
                      <td className="text-right tabular-nums">{fmt(b.pacotes)}</td>
                      <td className="text-right tabular-nums">{fmt(b.entregues)}</td>
                      <td className="text-right tabular-nums">{fmt(b.insucessos)}</td>
                      <td className="text-right tabular-nums font-semibold">{b.perc_entrega.toFixed(1)}%</td>
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
