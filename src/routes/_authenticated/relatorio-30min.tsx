import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQueries } from "@tanstack/react-query";
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
  const [basesSelecionadas, setBasesSelecionadas] = useState<string[]>(["ESP18"]);
  const buscar = useServerFn(meliRelatorio30Min);
  const consultas = useQueries({
    queries: basesSelecionadas.map((baseCodigo) => ({
      queryKey: ["meli-relatorio-30min", baseCodigo],
      queryFn: () => buscar({ data: { base_codigo: baseCodigo } }) as Promise<Relatorio30MinResult>,
      staleTime: 60_000,
      refetchInterval: TRINTA_MINUTOS,
      refetchIntervalInBackground: true,
    })),
  });

  const atualizando = consultas.some((consulta) => consulta.isFetching);

  function alternarBase(baseCodigo: string) {
    setBasesSelecionadas((atuais) =>
      atuais.includes(baseCodigo)
        ? atuais.filter((codigo) => codigo !== baseCodigo)
        : [...atuais, baseCodigo],
    );
  }

  function selecionarTodas() {
    setBasesSelecionadas(BASES_RELATORIO_30MIN.map((base) => base.codigo));
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Report a cada 30 minutos</h1>
            <Badge variant="secondary">Comparação por base</Badge>
            <Badge variant="outline">Somente leitura</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecione uma ou mais bases. Cada painel mantém seus próprios números, sem somar resultados.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => consultas.forEach((consulta) => void consulta.refetch())}
          disabled={!consultas.length || atualizando}
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${atualizando ? "animate-spin" : ""}`} />
          Atualizar selecionadas
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">Bases exibidas</CardTitle>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={selecionarTodas}>
                Todas
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setBasesSelecionadas([])}
                disabled={!basesSelecionadas.length}
              >
                Limpar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Selecionar bases do relatório">
            {BASES_RELATORIO_30MIN.map((base) => {
              const selecionada = basesSelecionadas.includes(base.codigo);
              return (
                <Button
                  key={base.codigo}
                  type="button"
                  size="sm"
                  variant={selecionada ? "default" : "outline"}
                  aria-pressed={selecionada}
                  onClick={() => alternarBase(base.codigo)}
                >
                  {base.codigo} · {base.nome}
                </Button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {basesSelecionadas.length
              ? `${basesSelecionadas.length} base${basesSelecionadas.length === 1 ? "" : "s"} selecionada${basesSelecionadas.length === 1 ? "" : "s"}.`
              : "Nenhuma base selecionada."}
          </p>
        </CardContent>
      </Card>

      {!basesSelecionadas.length && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Escolha pelo menos uma base para exibir o relatório.
          </CardContent>
        </Card>
      )}

      <div className="grid items-start gap-5 2xl:grid-cols-2">
        {basesSelecionadas.map((baseCodigo, indice) => (
          <RelatorioDaBase
            key={baseCodigo}
            baseCodigo={baseCodigo}
            consulta={consultas[indice]}
          />
        ))}
      </div>

      {!!basesSelecionadas.length && (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          Cada painel consulta o snapshot da própria base. Os valores não são consolidados nem somados entre bases.
        </p>
      )}
    </div>
  );
}

function RelatorioDaBase({
  baseCodigo,
  consulta,
}: {
  baseCodigo: string;
  consulta: ReturnType<typeof useQueries>[number];
}) {
  const resultado = consulta.data as Relatorio30MinResult | undefined;
  const dados = resultado?.status === "ok" ? resultado : null;

  async function copiar() {
    if (!dados) return;
    await navigator.clipboard.writeText(montarTexto(dados));
    toast.success(`Report de ${dados.base_codigo} copiado.`);
  }

  if (consulta.isLoading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Consolidando {baseCodigo}…
        </CardContent>
      </Card>
    );
  }

  if (consulta.isError || resultado?.status === "erro") {
    return (
      <Card className="border-destructive">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{baseCodigo}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2 p-4 pt-0 text-sm text-destructive">
          <XCircle className="h-5 w-5 shrink-0" />
          {resultado?.status === "erro"
            ? resultado.erro
            : "Não foi possível consultar o report desta base agora."}
        </CardContent>
      </Card>
    );
  }

  if (!dados) return null;

  return (
    <section className="space-y-3 rounded-xl border border-primary/30 bg-card/40 p-3 md:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">{dados.base_codigo} · {dados.base_nome}</h2>
          <p className="text-xs text-muted-foreground">
            Data operacional {dataRelatorio(`${dados.data_operacional}T12:00:00-03:00`)}
          </p>
        </div>
        <Button size="sm" onClick={copiar}>
          <Copy className="mr-2 h-4 w-4" />
          Copiar {dados.base_codigo}
        </Button>
      </div>

      {dados.desatualizado && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Coleta desatualizada</p>
              <p className="text-sm text-muted-foreground">
                Último snapshot válido de {formatarDataHora(dados.atualizado_em)}.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/30">
        <CardContent className="grid gap-1 p-3 text-xs text-muted-foreground sm:grid-cols-2 sm:gap-3 sm:text-right">
          <span>
            Última coleta: <strong className="text-foreground">{formatarDataHora(dados.atualizado_em)}</strong>
          </span>
          <span>
            Próxima prevista: <strong className="text-foreground">{formatarDataHora(dados.proxima_atualizacao_em)}</strong>
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 2xl:grid-cols-3">
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

      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Composição das rotas</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <MetricaInterna titulo="De entrega" valor={dados.relatorio.rotas_entrega} percentualValor={dados.relatorio.percentual_entrega} />
            <MetricaInterna titulo="De coleta" valor={dados.relatorio.rotas_coleta} percentualValor={dados.relatorio.percentual_coleta} />
            <MetricaInterna titulo="Mistas" valor={dados.relatorio.rotas_mistas} percentualValor={dados.relatorio.percentual_mistas} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Situação dos pacotes</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            <MetricaInterna titulo="Pendentes" valor={dados.relatorio.pendentes} percentualValor={dados.relatorio.percentual_pendentes} />
            <MetricaInterna titulo="Com falhas" valor={dados.relatorio.com_falhas} percentualValor={dados.relatorio.percentual_falhas} cor="text-destructive" />
            <MetricaInterna titulo="Bem-sucedidos" valor={dados.relatorio.bem_sucedidos} percentualValor={dados.relatorio.percentual_bem_sucedidos} cor="text-success" />
          </CardContent>
        </Card>
      </div>
    </section>
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
