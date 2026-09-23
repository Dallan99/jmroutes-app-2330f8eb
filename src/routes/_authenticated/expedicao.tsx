import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  PackageCheck,
  ScanLine,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  biparExpedicao,
  concluirExpedicao,
  detalharExpedicao,
  iniciarExpedicao,
  listarMotoristasMeli,
  listarRotasExpedicao,
} from "@/lib/expedicao.functions";

export const Route = createFileRoute("/_authenticated/expedicao")({
  head: () => ({ meta: [{ title: "Expedição — JM Transportes" }] }),
  component: ExpediacaoGuard,
});

function ExpediacaoGuard() {
  return (
    <RequireBaseOperacional
      titulo="Expedição"
      descricao="Selecione a Base e o Dia Operacional para conferir as rotas recebidas."
    >
      <ExpedicaoPage />
    </RequireBaseOperacional>
  );
}

function ExpedicaoPage() {
  const { base, diaOperacional, limpar } = useBaseOperacional();
  const baseId = base!.id;
  const dataOperacional = diaOperacional!;
  const qc = useQueryClient();
  const listarFn = useServerFn(listarRotasExpedicao);
  const iniciarFn = useServerFn(iniciarExpedicao);
  const listarMotoristasFn = useServerFn(listarMotoristasMeli);
  const detalheFn = useServerFn(detalharExpedicao);
  const biparFn = useServerFn(biparExpedicao);
  const concluirFn = useServerFn(concluirExpedicao);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rotaSelecionada, setRotaSelecionada] = useState<string | null>(null);
  const [expedicaoId, setExpedicaoId] = useState<string | null>(null);
  const [motorista, setMotorista] = useState("");
  const [motoristaMeliId, setMotoristaMeliId] = useState("");
  const [codigo, setCodigo] = useState("");
  const [responsavelMeli, setResponsavelMeli] = useState("");
  const [outro, setOutro] = useState("");

  const rotas = useQuery({
    queryKey: ["expedicao-rotas", baseId, dataOperacional],
    queryFn: () => listarFn({ data: { baseId, dataOperacional } }),
  });
  const motoristas = useQuery({
    queryKey: ["motoristas-meli", baseId],
    queryFn: () => listarMotoristasFn({ data: { baseId } }),
  });
  const detalhe = useQuery({
    queryKey: ["expedicao", expedicaoId],
    queryFn: () => detalheFn({ data: { expedicaoId: expedicaoId! } }),
    enabled: !!expedicaoId,
  });

  const iniciar = useMutation({
    mutationFn: () =>
      iniciarFn({ data: { baseId, dataOperacional, rota: rotaSelecionada!, motorista, motoristaMeliId } }),
    onSuccess: (resultado) => {
      setExpedicaoId(resultado.id);
      void qc.invalidateQueries({ queryKey: ["expedicao-rotas"] });
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const bipar = useMutation({
    mutationFn: (leitura: string) =>
      biparFn({ data: { expedicaoId: expedicaoId!, codigo: leitura } }),
    onSuccess: (resultado) => {
      if (resultado.resultado === "ok") {
        if (resultado.recuperado) toast.warning(resultado.mensagem, { duration: 7000 });
        else toast.success(resultado.mensagem);
      } else toast.error(resultado.mensagem);
      setCodigo("");
      void detalhe.refetch();
      void rotas.refetch();
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const concluir = useMutation({
    mutationFn: (confirmarComFaltantes: boolean) =>
      concluirFn({
        data: {
          expedicaoId: expedicaoId!,
          responsavelMeliSvc: responsavelMeli,
          outroResponsavel: outro,
          confirmarComFaltantes,
        },
      }),
    onSuccess: (resultado) => {
      toast.success(
        resultado.faltantes ? "Expedição concluída com ressalva." : "Expedição concluída.",
      );
      void detalhe.refetch();
      void rotas.refetch();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const rota = (rotas.data ?? []).find((item) => item.rota === rotaSelecionada);
  const expedicao = detalhe.data?.expedicao;
  const conferidos = expedicao?.quantidade_conferida ?? rota?.expedicao?.conferidos ?? 0;
  const previstos = expedicao?.quantidade_prevista ?? rota?.previstos ?? 0;
  const faltando = Math.max(previstos - conferidos, 0);
  const percentual = previstos ? Math.round((conferidos / previstos) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
      <div className="border-b bg-muted/30 -mx-4 md:-mx-6 -mt-4 md:-mt-6 px-4 md:px-6 py-2 flex items-center gap-3 text-xs">
        <b className="font-display text-sm">Expedição</b>
        <span>
          Base: <b>{base?.nome}</b> ({base?.codigo})
        </span>
        <span>
          Dia: <b>{new Date(dataOperacional + "T00:00:00").toLocaleDateString("pt-BR")}</b>
        </span>
        <Button variant="outline" size="sm" className="ml-auto h-7" onClick={limpar}>
          Trocar base / dia
        </Button>
      </div>

      <Card className="p-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
        <span>
          Catálogo Meli: <b>{motoristas.data?.length ?? 0} motoristas</b>
        </span>
        {!motoristas.isLoading && (
          <span className="text-muted-foreground">
            {(motoristas.data ?? []).some((item) => item.origem === "adminml")
              ? "Catálogo oficial sincronizado"
              : "Sincronização oficial pendente; exibindo histórico de rotas"}
          </span>
        )}
      </Card>

      {!rotaSelecionada ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {(rotas.data ?? []).map((item) => (
            <Card key={item.rota} className="p-3 space-y-2.5">
              <div className="flex justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs text-muted-foreground">Rota</div>
                  <b className="block truncate font-mono text-xl leading-tight">{item.rotaCodigo}</b>
                  {item.rotaCodigo !== item.rota && (
                    <span className="block font-mono text-xs text-muted-foreground">#{item.rota}</span>
                  )}
                </div>
                <Badge variant={item.pronta ? (item.expedicao ? "secondary" : "default") : "outline"}>
                  {item.expedicao?.status ?? (item.pronta ? "Pronta" : "Aguardando Recebimento")}
                </Badge>
              </div>
              <div className="grid grid-cols-3 text-center text-sm">
                <div>
                  <b>{item.previstos}</b>
                  <div className="text-xs text-muted-foreground">Original</div>
                </div>
                <div>
                  <b>{item.recebidos}</b>
                  <div className="text-xs text-muted-foreground">Recebidos</div>
                </div>
                <div>
                  <b className={item.faltantesRecebimento ? "text-amber-600" : ""}>
                    {item.faltantesRecebimento}
                  </b>
                  <div className="text-xs text-muted-foreground">Divergência</div>
                </div>
              </div>
              <Button
                className="h-9 w-full"
                disabled={!item.pronta}
                onClick={() => {
                  setRotaSelecionada(item.rota);
                  setExpedicaoId(item.expedicao?.id ?? null);
                  setMotorista(item.expedicao?.motorista ?? "");
                  setMotoristaMeliId("");
                }}
              >
                {!item.pronta ? "Concluir no Recebimento primeiro" : item.expedicao ? "Abrir conferência" : "Iniciar Expedição"}
              </Button>
            </Card>
          ))}
          {!rotas.isLoading && !(rotas.data ?? []).length && (
            <Card className="p-8 text-center text-muted-foreground md:col-span-2">
              Nenhuma rota foi encontrada para esta base e este dia operacional.
            </Card>
          )}
        </div>
      ) : !expedicaoId ? (
        <Card className="max-w-xl p-5 space-y-4">
          <Button variant="ghost" onClick={() => setRotaSelecionada(null)}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="font-display text-2xl font-bold">Iniciar rota {rotaSelecionada}</h1>
            <p className="text-sm text-muted-foreground">
              A conferência usará os {rota?.previstos ?? 0} shipment IDs da relação original.
            </p>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Motorista do catálogo Meli</div>
            <Select
              value={motoristaMeliId}
              onValueChange={(id) => {
                const selecionado = (motoristas.data ?? []).find((item) => item.id === id);
                setMotoristaMeliId(id);
                setMotorista(selecionado?.nome ?? "");
              }}
            >
              <SelectTrigger><SelectValue placeholder="Selecione o motorista" /></SelectTrigger>
              <SelectContent>
                {(motoristas.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id} disabled={item.status !== "active"}>
                    {item.nome}{item.status !== "active" ? ` — ${item.status === "blocked" ? "Bloqueado" : "Pausado"}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Catálogo oficial do Meli. Motoristas pausados ou bloqueados aparecem identificados e não podem ser atribuídos.
            </p>
          </div>
          <Button
            className="w-full"
            disabled={!motoristaMeliId || motorista.trim().length < 2 || iniciar.isPending}
            onClick={() => iniciar.mutate()}
          >
            <Truck className="w-4 h-4 mr-2" />
            Começar conferência
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <Button
                variant="outline"
                onClick={() => {
                  setRotaSelecionada(null);
                  setExpedicaoId(null);
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Rotas
              </Button>
              <h1 className="font-mono text-2xl font-bold">{rotaSelecionada}</h1>
              <Badge>{expedicao?.status ?? "em_conferencia"}</Badge>
            </div>
            <div className="grid grid-cols-3 text-center">
              <div>
                <b className="text-xl">{previstos}</b>
                <div className="text-xs text-muted-foreground">Previstos</div>
              </div>
              <div>
                <b className="text-xl">{conferidos}</b>
                <div className="text-xs text-muted-foreground">Conferidos</div>
              </div>
              <div>
                <b className="text-xl text-amber-600">{faltando}</b>
                <div className="text-xs text-muted-foreground">Faltando</div>
              </div>
            </div>
            <Progress value={percentual} />
          </Card>

          {expedicao?.status === "em_conferencia" || !expedicao ? (
            <Card className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <ScanLine className="w-6 h-6" />
                <div>
                  <h2 className="font-display text-xl font-bold">Conferência do motorista</h2>
                  <p className="text-sm text-muted-foreground">
                    Bipagem independente do Recebimento.
                  </p>
                </div>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (codigo.trim()) bipar.mutate(codigo);
                }}
                className="flex gap-2"
              >
                <Input
                  ref={inputRef}
                  className="h-14 font-mono text-lg"
                  autoFocus
                  value={codigo}
                  onChange={(e) => setCodigo(e.target.value)}
                  placeholder="Bipe o shipment"
                />
                <Button className="h-14" disabled={bipar.isPending}>
                  Confirmar
                </Button>
              </form>
              <div className="grid md:grid-cols-2 gap-2">
                <Input
                  placeholder="Responsável Mercado Livre – SVC"
                  value={responsavelMeli}
                  onChange={(e) => setResponsavelMeli(e.target.value)}
                />
                <Input
                  placeholder="Outro responsável"
                  value={outro}
                  onChange={(e) => setOutro(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                {faltando > 0 && (
                  <Button
                    variant="outline"
                    className="border-amber-500 text-amber-700"
                    onClick={() => concluir.mutate(true)}
                  >
                    <AlertTriangle className="w-4 h-4 mr-2" />
                    Concluir com faltantes
                  </Button>
                )}
                <Button
                  disabled={faltando > 0 || concluir.isPending}
                  onClick={() => concluir.mutate(false)}
                >
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Concluir Expedição
                </Button>
              </div>
            </Card>
          ) : (
            <Card className="p-6 flex items-center gap-3 text-success">
              <PackageCheck className="w-6 h-6" />
              <b>Expedição finalizada e pronta para emissão do romaneio.</b>
            </Card>
          )}

          {(detalhe.data?.leituras ?? []).some(
            (item) => item.localizado_posteriormente_na_expedicao,
          ) && (
            <Card className="p-4 border-amber-400 bg-amber-50">
              <b>Pacotes recuperados na Expedição</b>
              <div className="mt-2 font-mono text-sm">
                {detalhe
                  .data!.leituras.filter((item) => item.localizado_posteriormente_na_expedicao)
                  .map((item) => item.shipment)
                  .join(", ")}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
