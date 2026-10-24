import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Package,
  RefreshCcw,
  Route as RouteIcon,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BASES_RELATORIO_30MIN,
  meliRelatorio30Min,
  type Relatorio30MinResult,
} from "@/lib/meli-relatorio-30min.functions";

export const Route = createFileRoute("/_authenticated/relatorio-30min")({
  head: () => ({
    meta: [
      { title: "Report 30 min — JMRoutes" },
      {
        name: "description",
        content: "Relatório oficial do Monitoramento Logistics atualizado a cada 30 minutos.",
      },
    ],
  }),
  component: Relatorio30MinPage,
});

const TRINTA_MINUTOS = 30 * 60_000;

function formatarDataHora(valor: string | null | undefined) {
  if (!valor) return "não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(valor));
}

function horaRelatorio(valor: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(valor));
}

function dataRelatorio(valor: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(valor));
}

function percentual(valor: number) {
  return `${valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function montarTexto(dados: Extract<Relatorio30MinResult, { status: "ok" }>) {
  const r = dados.relatorio;
  return `📊 REPORT HORA A HORA - ${dados.base_codigo}
🕐 ${horaRelatorio(dados.atualizado_em)} - ${dataRelatorio(dados.atualizado_em)}

🔢 ROTAS TOTAIS: ${r.rotas_totais}
🚚 DE ENTREGA: ${r.rotas_entrega} (${percentual(r.percentual_entrega)})
📥 DE COLETA: ${r.rotas_coleta} (${percentual(r.percentual_coleta)})
🔄 MISTAS: ${r.rotas_mistas} (${percentual(r.percentual_mistas)})
🟡 EM ANDAMENTO: ${r.rotas_em_andamento}
📦 PACOTES: ${r.pacotes}
🎽 SACAS: ${r.sacas}
⏳ PENDENTES: ${r.pendentes} (${percentual(r.percentual_pendentes)})
❌ COM FALHAS: ${r.com_falhas} (${percentual(r.percentual_falhas)})
✅ BEM-SUCEDIDOS: ${r.bem_sucedidos} (${percentual(r.percentual_bem_sucedidos)})`;
}

function Relatorio30MinPage() {
  const [baseCodigo, setBaseCodigo] = useState<string>("ESP18");
  const buscar = useServerFn(meliRelatorio30Min);
  const query = useQuery({
    queryKey: ["meli-relatorio-30min", baseCodigo],
    queryFn: () => buscar({ data: { base_codigo: baseCodigo } }) as Promise<Relatorio30MinResult>,
    staleTime: 60_000,
    refetchInterval: TRINTA_MINUTOS,
    refetchIntervalInBackground: true,
  });

  const dados = query.data?.status === "ok" ? query.data : null;

  async function copiar() {
    if (!dados) return;
    await navigator.clipboard.writeText(montarTexto(dados));
    toast.success(`Report de ${dados.base_codigo} copiado.`);
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Report a cada 30 minutos</h1>
            <Badge variant="secondary">Todas as bases</Badge>
            <Badge variant="outline">Somente leitura</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Mesmos indicadores do quadro Rotas totais do Monitoramento Logistics.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={baseCodigo} onValueChange={setBaseCodigo}>
            <SelectTrigger className="w-full sm:w-[250px]" aria-label="Selecionar base">
              <SelectValue placeholder="Selecione a base" />
            </SelectTrigger>
            <SelectContent>
              {BASES_RELATORIO_30MIN.map((base) => (
                <SelectItem key={base.codigo} value={base.codigo}>
                  {base.codigo} · {base.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
            <RefreshCcw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
            Atualizar agora
          </Button>
          <Button onClick={copiar} disabled={!dados}>
            <Copy className="mr-2 h-4 w-4" />
            Copiar report
          </Button>
        </div>
      </header>

      {query.isLoading && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Consolidando {baseCodigo}…
          </CardContent>
        </Card>
      )}

      {(query.isError || query.data?.status === "erro") && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 p-4 text-sm text-destructive">
            <XCircle className="h-5 w-5" />
            {query.data?.status === "erro"
              ? query.data.erro
              : "Não foi possível consultar o report agora."}
          </CardContent>
        </Card>
      )}

      {dados && (
        <>
          {dados.desatualizado && (
            <Card className="border-destructive bg-destructive/5">
              <CardContent className="flex items-start gap-3 p-4">
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                <div>
                  <p className="font-semibold text-destructive">Coleta desatualizada</p>
                  <p className="text-sm text-muted-foreground">
                    O card está mantendo o último snapshot válido de {formatarDataHora(dados.atualizado_em)}.
                    A sessão do AdminML precisa estar válida para os números avançarem.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-primary/40">
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-semibold">
                  {dados.base_codigo} · {dados.base_nome}
                </div>
                <div className="text-xs text-muted-foreground">
                  Data operacional {dataRelatorio(`${dados.data_operacional}T12:00:00-03:00`)}
                </div>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground md:text-right">
                <span>
                  Última coleta: <strong className="text-foreground">{formatarDataHora(dados.atualizado_em)}</strong>
                </span>
                <span>
                  Próxima leitura prevista: <strong className="text-foreground">{formatarDataHora(dados.proxima_atualizacao_em)}</strong>
                </span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metrica titulo="Rotas totais" valor={dados.relatorio.rotas_totais} icone={RouteIcon} />
            <Metrica titulo="Em andamento" valor={dados.relatorio.rotas_em_andamento} icone={Clock3} cor="text-warning" />
            <Metrica titulo="Pacotes" valor={dados.relatorio.pacotes} icone={Package} />
            <Metrica titulo="Sacas" valor={dados.relatorio.sacas} icone={Package} />
            <Metrica
              titulo="Bem-sucedidos"
              valor={dados.relatorio.bem_sucedidos}
              detalhe={percentual(dados.relatorio.percentual_bem_sucedidos)}
              icone={CheckCircle2}
              cor="text-success"
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Composição das rotas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <MetricaInterna
                  titulo="De entrega"
                  valor={dados.relatorio.rotas_entrega}
                  percentualValor={dados.relatorio.percentual_entrega}
                />
                <MetricaInterna
                  titulo="De coleta"
                  valor={dados.relatorio.rotas_coleta}
                  percentualValor={dados.relatorio.percentual_coleta}
                />
                <MetricaInterna
                  titulo="Mistas"
                  valor={dados.relatorio.rotas_mistas}
                  percentualValor={dados.relatorio.percentual_mistas}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Situação dos pacotes</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                <MetricaInterna
                  titulo="Pendentes"
                  valor={dados.relatorio.pendentes}
                  percentualValor={dados.relatorio.percentual_pendentes}
                />
                <MetricaInterna
                  titulo="Com falhas"
                  valor={dados.relatorio.com_falhas}
                  percentualValor={dados.relatorio.percentual_falhas}
                  cor="text-destructive"
                />
                <MetricaInterna
                  titulo="Bem-sucedidos"
                  valor={dados.relatorio.bem_sucedidos}
                  percentualValor={dados.relatorio.percentual_bem_sucedidos}
                  cor="text-success"
                />
              </CardContent>
            </Card>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Os valores vêm do mesmo snapshot agregado que alimenta os cards das bases. A página apenas consulta dados e não altera a operação.
          </p>
        </>
      )}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  detalhe,
  icone: Icone,
  cor = "text-foreground",
}: {
  titulo: string;
  valor: number;
  detalhe?: string;
  icone: typeof Package;
  cor?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {titulo}
          <Icone className="h-4 w-4" />
        </div>
        <div className={`mt-2 text-3xl font-bold tabular-nums ${cor}`}>
          {valor.toLocaleString("pt-BR")}
        </div>
        {detalhe && <div className="mt-1 text-xs text-muted-foreground">{detalhe}</div>}
      </CardContent>
    </Card>
  );
}

function MetricaInterna({
  titulo,
  valor,
  percentualValor,
  cor = "text-foreground",
}: {
  titulo: string;
  valor: number;
  percentualValor: number;
  cor?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${cor}`}>
        {valor.toLocaleString("pt-BR")}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{percentual(percentualValor)}</div>
    </div>
  );
}
