import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, Eye, Lock } from "lucide-react";

export const Route = createFileRoute("/preview-pagamentos")({
  head: () => ({ meta: [{ title: "Prévia de pagamentos — JM Routes" }] }),
  component: PreviewPagamentos,
});

const dados = [
  { base: "ESP15", motorista: "João Silva", veiculo: "Utilitário", rotas: [
    { id: "ESP15-123", entregues: 99, total: 104, percentual: 95.2, pagavel: true, extra: 30, valor: 330 },
    { id: "ESP15-124", entregues: 86, total: 100, percentual: 86, pagavel: false, extra: 0, valor: 0 },
  ]},
  { base: "ESP16", motorista: "Carlos Lima", veiculo: "Carro de passeio", rotas: [
    { id: "ESP16-130", entregues: 96, total: 100, percentual: 96, pagavel: true, extra: 0, valor: 200 },
    { id: "ESP16-131", entregues: 91, total: 100, percentual: 91, pagavel: true, extra: 0, valor: 200 },
  ]},
  { base: "ESP17", motorista: "Marcos Souza", veiculo: "VUC", rotas: [
    { id: "ESP17-205", entregues: 180, total: 190, percentual: 94.7, pagavel: true, extra: 50, valor: 550 },
  ]},
  { base: "ESP18", motorista: "André Santos", veiculo: "Utilitário", rotas: [
    { id: "ESP18-301", entregues: 90, total: 100, percentual: 90, pagavel: false, extra: 0, valor: 0 },
  ]},
];

const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function PreviewPagamentos() {
  const [abertos, setAbertos] = useState(new Set<string>());
  const total = dados.flatMap((d) => d.rotas).reduce((s, r) => s + r.valor, 0);
  const toggle = (nome: string) => setAbertos((atual) => { const novo = new Set(atual); novo.has(nome) ? novo.delete(nome) : novo.add(nome); return novo; });
  return <main className="min-h-screen bg-muted/30 p-4 md:p-8">
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <div className="flex items-start gap-3"><Eye className="mt-0.5 h-5 w-5"/><div><strong>Prévia temporária sem login</strong><p className="text-sm">Dados demonstrativos. Nenhuma consulta, cálculo, alteração ou pagamento é realizado no banco de produção.</p></div></div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-sm font-semibold text-primary">JM ROUTES</p><h1 className="text-3xl font-bold">Pagamentos de motoristas</h1><p className="text-muted-foreground">Semana de 04/10/2026 a 10/10/2026 · pagamento previsto em 14/10/2026</p></div><Badge variant="outline" className="gap-1"><Lock className="h-3 w-3"/>Somente demonstração</Badge></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Kpi titulo="Motoristas" valor="4"/><Kpi titulo="Rotas" valor="6"/><Kpi titulo="Rotas pagáveis" valor="4"/><Kpi titulo="Total previsto" valor={moeda.format(total)}/></div>
      <Card className="overflow-hidden"><Table><TableHeader><TableRow><TableHead className="w-10"/><TableHead>Base</TableHead><TableHead>Motorista</TableHead><TableHead>Veículo</TableHead><TableHead className="text-center">Rotas</TableHead><TableHead className="text-center">Pagáveis</TableHead><TableHead className="text-center">Não pagáveis</TableHead><TableHead className="text-right">Média entregue</TableHead><TableHead className="text-right">Total a pagar</TableHead></TableRow></TableHeader><TableBody>{dados.map((d) => { const aberto=abertos.has(d.motorista); const pagaveis=d.rotas.filter(r=>r.pagavel).length; const media=d.rotas.reduce((s,r)=>s+r.percentual,0)/d.rotas.length; const valor=d.rotas.reduce((s,r)=>s+r.valor,0); return <>
        <TableRow key={d.motorista} className="cursor-pointer" onClick={()=>toggle(d.motorista)}><TableCell>{aberto?<ChevronDown className="h-4 w-4"/>:<ChevronRight className="h-4 w-4"/>}</TableCell><TableCell><Badge variant="outline">{d.base}</Badge></TableCell><TableCell className="font-medium">{d.motorista}</TableCell><TableCell>{d.veiculo}</TableCell><TableCell className="text-center">{d.rotas.length}</TableCell><TableCell className="text-center text-emerald-600">{pagaveis}</TableCell><TableCell className="text-center text-red-600">{d.rotas.length-pagaveis}</TableCell><TableCell className="text-right">{media.toFixed(1)}%</TableCell><TableCell className="text-right font-bold">{moeda.format(valor)}</TableCell></TableRow>
        {aberto && <TableRow key={`${d.motorista}-detalhe`}><TableCell colSpan={9} className="bg-muted/30 p-3"><Table><TableHeader><TableRow><TableHead>ID da rota</TableHead><TableHead>Pedidos entregues</TableHead><TableHead>% entregue</TableHead><TableHead>Situação</TableHead><TableHead className="text-right">Extra</TableHead><TableHead className="text-right">Total</TableHead></TableRow></TableHeader><TableBody>{d.rotas.map(r=><TableRow key={r.id}><TableCell className="font-mono">{r.id}</TableCell><TableCell>{r.entregues}/{r.total}</TableCell><TableCell>{r.percentual.toFixed(1)}%</TableCell><TableCell>{r.pagavel?<Badge className="bg-emerald-600">Pagável</Badge>:<Badge variant="destructive">Não pagável</Badge>}</TableCell><TableCell className="text-right">{moeda.format(r.extra)}</TableCell><TableCell className="text-right font-semibold">{moeda.format(r.valor)}</TableCell></TableRow>)}</TableBody></Table></TableCell></TableRow>}
      </>;})}</TableBody></Table></Card>
      <p className="text-center text-xs text-muted-foreground">Para reativar o login na branch, basta restaurar o redirecionamento inicial para /auth.</p>
    </div>
  </main>;
}

function Kpi({ titulo, valor }: { titulo: string; valor: string }) { return <Card><CardContent className="pt-5"><p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p><p className="mt-1 text-2xl font-bold">{valor}</p></CardContent></Card>; }
