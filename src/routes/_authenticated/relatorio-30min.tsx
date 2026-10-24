import { createFileRoute } from "@tanstack/react-router";
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
import {
  meliRelatorio30Min,
  type Relatorio30MinResult,
} from "@/lib/meli-relatorio-30min.functions";

export const Route = createFileRoute("/_authenticated/relatorio-30min")({
  head: () => ({
    meta: [
      { title: "Report 30 min — JMRoutes" },
      {
        name: "description",
        content: "Relatório operacional do Meli atualizado a cada 30 minutos.",
      },
    ],
  }),
  component: Relatorio30MinPage,
});

const TRINTA_MINUTOS = 30 * 60_000;

function formatarNumero(valor: number | null) {
  return valor == null ? "não disponível" : valor.toLocaleString("pt-BR");
}

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

function montarTexto(dados: Extract<Relatorio30MinResult, { status: "ok" }>) {
  const r = dados.relatorio;
  const motivos = r.motivos.map((m) => `* ${m.descricao}: ${m.total}`).join("\n");
  return `📊 REPORT HORA A HORA - ${dados.base_codigo}
🕐 ${horaRelatorio(dados.atualizado_em)} - ${dataRelatorio(dados.atualizado_em)}

🔢 ROTAS: ${r.rotas}
🟡 ABERTAS: ${r.abertas}
✅ ENCERRADAS: ${r.encerradas}
📦 TOTAL PACOTES: ${r.total_pacotes}
✅ ENTREGUES: ${r.entregues}
⏳ PENDENTES: ${r.pendentes}
❌ INSUCESSOS: ${r.insucessos}
🎽 SACAS: não disponível
📌 PNR: não disponível
📈 DS% estimado: ${r.ds_percentual == null ? "não disponível" : `${r.ds_percentual.toFixed(1)}%`}

❌ INSUCESSOS POR MOTIVO:

${motivos}`;
}

function Relatorio30MinPage() {
  const buscar = useServerFn(meliRelatorio30Min);
  const query = useQuery({
    queryKey: ["meli-relatorio-30min", "ESP18"],
    queryFn: () => buscar({ data: { base_codigo: "ESP18" } }) as Promise<Relatorio30MinResult>,
    staleTime: 60_000,
    refetchInterval: TRINTA_MINUTOS,
    refetchIntervalInBackground: true,
  });

  const dados = query.data?.status === "ok" ? query.data : null;

  async function copiar() {
    if (!dados) return;
    await navigator.clipboard.writeText(montarTexto(dados));
    toast.success("Report copiado.");
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Clock3 className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Report a cada 30 minutos</h1>
            <Badge variant="secondary">Teste ESP18</Badge>
            <Badge variant="outline">Somente leitura</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Franco da Rocha · dados do piloto Meli · atualização automática a cada 30 minutos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
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
            Consolidando a ESP18…
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
                <span>Última coleta: <strong className="text-foreground">{formatarDataHora(dados.atualizado_em)}</strong></span>
                <span>Próxima leitura prevista: <strong className="text-foreground">{formatarDataHora(dados.proxima_atualizacao_em)}</strong></span>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metrica titulo="Rotas" valor={dados.relatorio.rotas} detalhe={`${dados.relatorio.abertas} abertas · ${dados.relatorio.encerradas} encerradas`} icone={RouteIcon} />
            <Metrica titulo="Total de pacotes" valor={dados.relatorio.total_pacotes} detalhe={`${dados.relatorio.entregues} entregues`} icone={Package} />
            <Metrica titulo="Pendentes" valor={dados.relatorio.pendentes} detalhe="Ainda sem desfecho" icone={Clock3} cor="text-warning" />
            <Metrica titulo="Insucessos" valor={dados.relatorio.insucessos} detalhe="Motivos confirmados abaixo" icone={TriangleAlert} cor="text-destructive" />
          </div>

          <div className="grid gap-3 lg:grid-cols-[1fr_1.25fr]">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Indicadores do report</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <Linha rotulo="🎽 Sacas" valor={formatarNumero(dados.relatorio.sacas)} />
                <Linha rotulo="📌 PNR" valor={formatarNumero(dados.relatorio.pnr)} />
                <Linha
                  rotulo="📈 DS% estimado"
                  valor={dados.relatorio.ds_percentual == null ? "não disponível" : `${dados.relatorio.ds_percentual.toFixed(1)}%`}
                  detalhe="Entregues ÷ (entregues + insucessos). A fórmula precisa ser homologada com o indicador oficial do Meli."
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Insucessos por motivo</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {dados.relatorio.motivos.map((motivo) => (
                  <div key={motivo.codigo} className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                    <span className="text-sm">{motivo.descricao}</span>
                    <strong className="tabular-nums">{motivo.total.toLocaleString("pt-BR")}</strong>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {dados.relatorio.avisos_integridade.length > 0 && (
            <Card className="border-warning/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TriangleAlert className="h-5 w-5 text-warning" />
                  Integridade dos dados
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm text-muted-foreground">
                {dados.relatorio.avisos_integridade.map((aviso) => <p key={aviso}>• {aviso}</p>)}
              </CardContent>
            </Card>
          )}

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            Esta tela não altera Recebimento, Triagem, pacotes ou rotas. Ela apenas lê as tabelas isoladas do piloto enquanto DRY_RUN permanece ativo.
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
  detalhe: string;
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
        <div className="mt-1 text-xs text-muted-foreground">{detalhe}</div>
      </CardContent>
    </Card>
  );
}

function Linha({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{rotulo}</div>
      <div className="mt-1 text-xl font-bold">{valor}</div>
      {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
    </div>
  );
}
