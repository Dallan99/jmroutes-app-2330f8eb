import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { previaPagamento } from "@/lib/pagamentos.functions";
import { PENDENCIA_LABEL, TIPO_VEICULO_LABEL, semanaAnterior, semanaPagamento, type MotoristaResumo } from "@/lib/pagamentos-domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/pagamentos-motoristas")({
  head: () => ({
    meta: [
      { title: "Prévia de pagamento de motoristas — JMRoutes" },
      { name: "description", content: "Prévia semanal do pagamento de motoristas por rota, base e veículo." },
      { property: "og:title", content: "Prévia de pagamento de motoristas — JMRoutes" },
      { property: "og:description", content: "Prévia semanal do pagamento de motoristas por rota, base e veículo." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PagamentosPage,
});

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBr = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("pt-BR");
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);
const hojeSp = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

function PagamentosPage() {
  const [dataRef, setDataRef] = useState(() => semanaAnterior(hojeSp()).inicio);
  const [base, setBase] = useState("todas");
  const [busca, setBusca] = useState("");
  const [soPendencias, setSoPendencias] = useState(false);
  const [aberto, setAberto] = useState<MotoristaResumo | null>(null);
  const semana = semanaPagamento(dataRef);
  const fetchPrevia = useServerFn(previaPagamento);
  const q = useQuery({ queryKey: ["pagamentos-previa", semana.inicio], queryFn: () => fetchPrevia({ data: { data: semana.inicio } }) });

  const motoristas = useMemo(() => {
    const todos = q.data?.motoristas ?? [];
    return todos.filter((m) =>
      (base === "todas" || m.base_codigo === base) &&
      (!busca || `${m.motorista_nome} ${m.placas.join(" ")}`.toLowerCase().includes(busca.toLowerCase())) &&
      (!soPendencias || m.pendencias.length > 0));
  }, [q.data, base, busca, soPendencias]);

  const todos = q.data?.motoristas ?? [];
  const soma = (l: MotoristaResumo[], f: (m: MotoristaResumo) => number) => l.reduce((s, m) => s + f(m), 0);
  const totalRotas = soma(todos, (m) => m.rotas.length);
  const pagaveis = soma(todos, (m) => m.pagaveis);
  const comPendencia = todos.filter((m) => m.pendencias.length).length;
  const semClass = [...new Set(todos.flatMap((m) => m.rotas.filter((r) => r.pendencias.includes("placa_sem_tipo")).map((r) => r.placa!)))];
  const podeCadastrar = q.data?.podeCadastrar ?? false;

  const mudarSemana = (dias: number) => {
    const [y, mo, d] = semana.inicio.split("-").map(Number);
    setDataRef(new Date(Date.UTC(y, mo - 1, d + dias)).toISOString().slice(0, 10));
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
        <strong>Prévia de pagamento — não autoriza pagamento.</strong> Os valores só serão oficiais depois da conferência operacional.
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-xl font-semibold">Pagamentos de Motoristas</h1>
          <p className="text-sm text-muted-foreground">
            Semana {dataBr(semana.inicio)} a {dataBr(semana.fim)} · pagamento previsto {dataBr(semana.pagamento)} (quarta)
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2 items-center">
          <Button variant="outline" asChild><Link to="/pagamentos-veiculos">Cadastro de veículos</Link></Button>
          <Button variant="outline" onClick={() => mudarSemana(-7)}>‹ Semana anterior</Button>
          <Input type="date" className="w-40" value={dataRef} onChange={(e) => e.target.value && setDataRef(e.target.value)} />
          <Button variant="outline" onClick={() => mudarSemana(7)}>Próxima ›</Button>
        </div>
      </div>

      {comPendencia > 0 && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">
          <strong>Validação da prévia bloqueada:</strong> {comPendencia} motorista(s) com pendência
          {semClass.length > 0 && <> · {semClass.length} placa(s) sem classificação</>}. Corrija antes da conferência.
        </div>
      )}
      {q.data?.avisos.map((a) => (
        <div key={a} className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">{a}</div>
      ))}
      {q.isError && <p className="text-destructive text-sm">Não foi possível carregar a prévia.</p>}
      {q.data?.status === "erro" && <p className="text-destructive text-sm">{q.data.erro}</p>}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi titulo="Motoristas" valor={String(todos.length)} />
        <Kpi titulo="Rotas" valor={String(totalRotas)} />
        <Kpi titulo="Pagáveis" valor={`${pagaveis} (${totalRotas ? Math.round((pagaveis / totalRotas) * 100) : 0}%)`} />
        <Kpi titulo="Não pagáveis" valor={String(totalRotas - pagaveis)} />
        <Kpi titulo="Prévia total" valor={brl(soma(todos, (m) => m.total))} />
        <Kpi titulo="Com pendência" valor={String(comPendencia)} alerta={comPendencia > 0} onClick={() => setSoPendencias(true)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(q.data?.bases ?? []).slice().sort((a, b) => a.codigo.localeCompare(b.codigo)).map((b) => {
          const l = todos.filter((m) => m.base_codigo === b.codigo);
          return (
            <button key={b.id} onClick={() => setBase(base === b.codigo ? "todas" : b.codigo)}
              className={`text-left rounded-lg border p-3 bg-card ${base === b.codigo ? "ring-2 ring-primary" : ""}`}>
              <div className="text-xs text-muted-foreground">{b.codigo} · {b.nome}</div>
              <div className="text-lg font-semibold">{brl(soma(l, (m) => m.total))}</div>
              <div className="text-xs text-muted-foreground">{l.length} motoristas · {soma(l, (m) => m.rotas.length)} rotas</div>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Input placeholder="Buscar motorista ou placa" className="w-64" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <Button variant={soPendencias ? "default" : "outline"} onClick={() => setSoPendencias((v) => !v)}>Só com pendência</Button>
        {base !== "todas" && <Button variant="ghost" onClick={() => setBase("todas")}>Ver as 4 bases</Button>}
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>{["Motorista", "Veículo", "Base", "Rotas", "IDs", "Pagáveis", "Não pag.", "Média entregue", "Valor rotas", "Adicionais", "Total (prévia)", "Situação"].map((h) => <th key={h} className="p-2 text-left whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={12} className="p-4 text-center text-muted-foreground">Carregando…</td></tr>}
            {!q.isLoading && motoristas.length === 0 && <tr><td colSpan={12} className="p-4 text-center text-muted-foreground">Nenhuma rota nesta semana.</td></tr>}
            {motoristas.map((m) => (
              <tr key={m.chave} className="border-t cursor-pointer hover:bg-muted/40" onClick={() => setAberto(m)}>
                <td className="p-2 font-medium">{m.motorista_nome}</td>
                <td className="p-2">{m.tipos.map((t) => TIPO_VEICULO_LABEL[t]).join(", ") || "—"}<div className="text-xs text-muted-foreground font-mono">{m.placas.join(", ")}</div></td>
                <td className="p-2">{m.base_codigo}</td>
                <td className="p-2">{m.rotas.length}</td>
                <td className="p-2 max-w-[160px] truncate font-mono text-xs">{m.rotas.map((r) => r.route_id).join(", ")}</td>
                <td className="p-2">{m.pagaveis}</td>
                <td className="p-2">{m.nao_pagaveis}</td>
                <td className="p-2">{pct(m.media_ponderada)}</td>
                <td className="p-2 whitespace-nowrap">{brl(m.valor_rotas)}</td>
                <td className="p-2 whitespace-nowrap">{brl(m.adicionais)}</td>
                <td className="p-2 whitespace-nowrap font-semibold">{brl(m.total)}</td>
                <td className="p-2">{m.pendencias.length ? <Badge variant="destructive">{m.pendencias.length} pendência(s)</Badge> : <Badge variant="secondary">Em apuração</Badge>}</td>
              </tr>
            ))}
          </tbody>
          {motoristas.length > 0 && (
            <tfoot className="border-t font-semibold">
              <tr><td className="p-2" colSpan={8}>Total exibido</td><td className="p-2">{brl(soma(motoristas, (m) => m.valor_rotas))}</td><td className="p-2">{brl(soma(motoristas, (m) => m.adicionais))}</td><td className="p-2">{brl(soma(motoristas, (m) => m.total))}</td><td /></tr>
            </tfoot>
          )}
        </table>
      </Card>

      <Sheet open={!!aberto} onOpenChange={(o) => !o && setAberto(null)}>
        <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
          {aberto && (
            <>
              <SheetHeader><SheetTitle>{aberto.motorista_nome} · {aberto.base_codigo}</SheetTitle></SheetHeader>
              <div className="mt-3 space-y-3 text-sm">
                {aberto.pendencias.length > 0 && (
                  <div className="flex flex-wrap gap-1">{aberto.pendencias.map((p) => <Badge key={p} variant="destructive">{PENDENCIA_LABEL[p]}</Badge>)}</div>
                )}
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(aberto.rotas.map((r) => r.route_id).join("\n")); toast.success("IDs copiados."); }}>Copiar IDs das rotas</Button>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr>{["Rota", "Data", "Região", "Veículo", "Pedidos", "Entregues", "%", "Situação", "Tarifa", "Valor"].map((h) => <th key={h} className="p-1 text-left">{h}</th>)}</tr></thead>
                  <tbody>
                    {aberto.rotas.map((r) => (
                      <tr key={r.route_id} className="border-t align-top">
                        <td className="p-1 font-mono">{r.route_id}</td>
                        <td className="p-1">{r.data_rota ? dataBr(r.data_rota) : "—"}</td>
                        <td className="p-1">{r.regiao ?? "—"}</td>
                        <td className="p-1">{r.tipo_veiculo ? TIPO_VEICULO_LABEL[r.tipo_veiculo] : "—"}<div className="font-mono text-muted-foreground">{r.placa ?? "sem placa"}</div></td>
                        <td className="p-1">{r.total_pedidos ?? "—"}</td>
                        <td className="p-1">{r.entregues ?? "—"}</td>
                        <td className="p-1">{pct(r.percentual)}</td>
                        <td className="p-1">{r.pagavel ? <Badge variant="secondary">Pagável</Badge> : <Badge variant="outline">Não pagável</Badge>}{r.motivo && <div className="text-muted-foreground">{r.motivo}</div>}{r.pendencias.map((p) => <div key={p} className="text-destructive">{PENDENCIA_LABEL[p]}</div>)}{podeCadastrar && r.placa && r.pendencias.includes("placa_sem_tipo") && <Link to="/pagamentos-veiculos" search={{ placa: r.placa }} className="text-primary underline">Cadastrar veículo</Link>}</td>
                        <td className="p-1">{r.tarifa !== null ? brl(r.tarifa) : "—"}</td>
                        <td className="p-1">{brl(r.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-muted-foreground">Origem: rotas do Mercado Livre sincronizadas no JMRoutes. Adicionais: {brl(aberto.adicionais)}.</p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Kpi({ titulo, valor, alerta, onClick }: { titulo: string; valor: string; alerta?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} className={`text-left rounded-lg border bg-card p-3 ${alerta ? "border-destructive/50" : ""}`}>
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className={`text-lg font-semibold ${alerta ? "text-destructive" : ""}`}>{valor}</div>
    </button>
  );
}
