import { ModuloEmImplantacao } from "@/components/ModuloEmImplantacao";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { listarVeiculos, salvarVeiculo, type VeiculoCadastro } from "@/lib/pagamentos.functions";
import { TIPO_VEICULO_LABEL, type TipoVeiculo } from "@/lib/pagamentos-domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/pagamentos-veiculos")({
  validateSearch: z.object({ placa: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Cadastro de veículos — JMRoutes" },
      { name: "description", content: "Classificação de placas por categoria para a prévia de pagamentos." },
      { property: "og:title", content: "Cadastro de veículos — JMRoutes" },
      { property: "og:description", content: "Classificação de placas por categoria para a prévia de pagamentos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VeiculosPage,
});

type Form = { id: string | null; placa: string; tipo_veiculo: TipoVeiculo; base_padrao_id: string; descricao: string; ativo: boolean; vigencia_inicio: string; observacao: string };
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const novo = (placa = ""): Form => ({ id: null, placa, tipo_veiculo: "carro", base_padrao_id: "", descricao: "", ativo: true, vigencia_inicio: "2026-01-01", observacao: "" });
const dataHora = (d: string) => new Date(d).toLocaleString("pt-BR");

function VeiculosPage() {
  const { placa } = Route.useSearch();
  const qc = useQueryClient();
  const fetchLista = useServerFn(listarVeiculos);
  const salvar = useServerFn(salvarVeiculo);
  const q = useQuery({ queryKey: ["pagamentos-veiculos"], queryFn: () => fetchLista() });
  const [form, setForm] = useState<Form | null>(placa ? novo(placa) : null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  const podeEditar = q.data?.podeEditar ?? false;
  const baseCod = (id: string | null) => q.data?.bases.find((b) => b.id === id)?.codigo ?? "—";

  async function enviar() {
    if (!form) return;
    setSalvando(true);
    const r = await salvar({ data: { ...form, base_padrao_id: form.base_padrao_id || null } });
    setSalvando(false);
    if (!r.ok) return toast.error(r.erro);
    toast.success("Veículo salvo. A prévia foi recalculada.");
    setForm(null);
    qc.invalidateQueries({ queryKey: ["pagamentos-veiculos"] });
    qc.invalidateQueries({ queryKey: ["pagamentos-previa"] });
  }

  const editar = (v: VeiculoCadastro) => setForm({
    id: v.id, placa: v.placa, tipo_veiculo: v.tipo_veiculo, base_padrao_id: v.base_padrao_id ?? "", descricao: v.descricao ?? "",
    ativo: v.ativo, vigencia_inicio: v.vigencia_inicio, observacao: "",
  });
  const lista = (q.data?.veiculos ?? []).filter((v) => !busca || v.placa.includes(busca.toUpperCase().replace(/[^A-Z0-9]/g, "")));

  if (q.data?.implantacao) return <ModuloEmImplantacao titulo="Cadastro de veículos" />;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-semibold">Cadastro de veículos</h1>
          <p className="text-sm text-muted-foreground">A categoria da placa define a tarifa. Mudar a categoria cria uma nova vigência; rotas anteriores mantêm a categoria da época.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" asChild><Link to="/pagamentos-motoristas">Voltar à prévia</Link></Button>
          {podeEditar && <Button onClick={() => setForm(novo())}>Novo veículo</Button>}
        </div>
      </div>
      {q.data?.erro && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm">{q.data.erro}</div>}
      {!podeEditar && q.isSuccess && <p className="text-sm text-muted-foreground">Somente leitura. Cadastro feito por Administrador, Gerente ou Supervisor.</p>}

      {form && podeEditar && (
        <Card className="p-4 grid gap-3 md:grid-cols-3">
          <div><Label>Placa</Label><Input value={form.placa} disabled={!!form.id} onChange={(e) => setForm({ ...form, placa: e.target.value.toUpperCase() })} /></div>
          <div><Label>Categoria</Label>
            <select className="w-full h-10 rounded-md border bg-background px-2" value={form.tipo_veiculo} onChange={(e) => setForm({ ...form, tipo_veiculo: e.target.value as TipoVeiculo })}>
              {(Object.keys(TIPO_VEICULO_LABEL) as TipoVeiculo[]).map((t) => <option key={t} value={t}>{TIPO_VEICULO_LABEL[t]}</option>)}
            </select></div>
          <div><Label>Base padrão</Label>
            <select className="w-full h-10 rounded-md border bg-background px-2" value={form.base_padrao_id} onChange={(e) => setForm({ ...form, base_padrao_id: e.target.value })}>
              <option value="">Não se aplica</option>
              {q.data?.bases.map((b) => <option key={b.id} value={b.id}>{b.codigo} · {b.nome}</option>)}
            </select></div>
          <div><Label>Descrição/modelo</Label><Input value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></div>
          <div><Label>Início da vigência</Label><Input type="date" value={form.vigencia_inicio} max={hoje()} onChange={(e) => setForm({ ...form, vigencia_inicio: e.target.value })} /></div>
          <div className="flex items-end gap-2"><label className="flex items-center gap-2 h-10"><input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativo</label></div>
          <div className="md:col-span-3"><Label>Observação {form.id && "(obrigatória se mudar a categoria)"}</Label><Textarea value={form.observacao} onChange={(e) => setForm({ ...form, observacao: e.target.value })} /></div>
          <div className="md:col-span-3 flex gap-2">
            <Button onClick={enviar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
          </div>
        </Card>
      )}

      <Input placeholder="Buscar placa" className="w-56" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>{["Placa", "Categoria", "Base", "Modelo", "Vigência", "Status", "Observação", "Criado", "Alterado", ""].map((h) => <th key={h} className="p-2 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {lista.length === 0 && <tr><td colSpan={10} className="p-4 text-center text-muted-foreground">{q.isLoading ? "Carregando…" : "Nenhum veículo cadastrado."}</td></tr>}
            {lista.map((v) => (
              <tr key={v.id} className="border-t">
                <td className="p-2 font-mono">{v.placa}</td>
                <td className="p-2">{TIPO_VEICULO_LABEL[v.tipo_veiculo]}</td>
                <td className="p-2">{baseCod(v.base_padrao_id)}</td>
                <td className="p-2">{v.descricao ?? "—"}</td>
                <td className="p-2">desde {new Date(v.vigencia_inicio + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                <td className="p-2">{v.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>}</td>
                <td className="p-2 max-w-[200px] truncate">{v.observacao ?? "—"}</td>
                <td className="p-2 text-xs">{dataHora(v.created_at)}</td>
                <td className="p-2 text-xs">{dataHora(v.updated_at)}</td>
                <td className="p-2">{podeEditar && <Button size="sm" variant="outline" onClick={() => editar(v)}>Editar</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
