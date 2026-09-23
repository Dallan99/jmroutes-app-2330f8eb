import { createFileRoute } from "@tanstack/react-router";
import { Activity, CheckCircle2, Clock3, RefreshCcw, Server, TriangleAlert, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LABEL_SITUACAO_SYNC,
  fmtDataHora,
  minutosDesde,
  situacaoDaBase,
  textoAtraso,
  useMeliSync,
  type SituacaoSync,
} from "@/components/meli-sync-monitor";

export const Route = createFileRoute("/_authenticated/monitoramento-workers")({
  head: () => ({
    meta: [
      { title: "Monitoramento de Workers — JMRoutes" },
      { name: "description", content: "Saúde dos workers e sincronizações do JMRoutes." },
    ],
  }),
  component: MonitoramentoWorkersPage,
});

const visual: Record<SituacaoSync, { borda: string; fundo: string; texto: string; icone: typeof CheckCircle2 }> = {
  atualizado: { borda: "border-success/60", fundo: "bg-success/10", texto: "text-success", icone: CheckCircle2 },
  atencao: { borda: "border-warning/60", fundo: "bg-warning/10", texto: "text-warning", icone: TriangleAlert },
  desatualizado: { borda: "border-destructive/60", fundo: "bg-destructive/10", texto: "text-destructive", icone: XCircle },
  sem_info: { borda: "border-muted-foreground/30", fundo: "bg-muted", texto: "text-muted-foreground", icone: Clock3 },
};

function MonitoramentoWorkersPage() {
  const sync = useMeliSync();
  const { bases, serverTime, geral, query } = sync;
  const atualizadas = bases.filter((base) => situacaoDaBase(base, serverTime) === "atualizado").length;
  const atencao = bases.filter((base) => situacaoDaBase(base, serverTime) === "atencao").length;
  const fora = bases.filter((base) => situacaoDaBase(base, serverTime) === "desatualizado").length;
  const workerVisual = visual[geral];
  const WorkerIcon = workerVisual.icone;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-semibold">Monitoramento de Workers</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Saúde da coleta AdminML no Fly e última sincronização registrada por base.
          </p>
        </div>
        <Button variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo titulo="Workers monitorados" valor={String(bases.length)} detalhe="Bases com telemetria" />
        <Resumo titulo="Online" valor={String(atualizadas)} detalhe="Atualização até 15 min" cor="text-success" />
        <Resumo titulo="Atenção" valor={String(atencao)} detalhe="Entre 15 e 25 min" cor="text-warning" />
        <Resumo titulo="Fora do ar" valor={String(fora)} detalhe="Erro ou mais de 25 min" cor="text-destructive" />
      </div>

      <Card className={`${workerVisual.borda} border-l-4`}>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className={`rounded-full p-2.5 ${workerVisual.fundo} ${workerVisual.texto}`}>
              <Server className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold">Sincronizador AdminML — Fly.io</div>
              <div className="text-xs text-muted-foreground">
                Estado inferido pelos ciclos registrados no banco · atualização automática a cada 60s
              </div>
            </div>
          </div>
          <div className={`flex items-center gap-2 font-semibold ${workerVisual.texto}`}>
            <WorkerIcon className="h-5 w-5" />
            {LABEL_SITUACAO_SYNC[geral]}
          </div>
        </CardContent>
      </Card>

      {query.isError && (
        <Card className="border-destructive">
          <CardContent className="p-4 text-sm text-destructive">
            Não foi possível consultar a telemetria agora. O último estado exibido será preservado durante novas tentativas.
          </CardContent>
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-base font-semibold">Workers por base</h2>
        {bases.length === 0 && !query.isLoading ? (
          <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Nenhuma telemetria registrada.</CardContent></Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {bases.map((base) => {
              const situacao = situacaoDaBase(base, serverTime);
              const estilo = visual[situacao];
              const Icone = estilo.icone;
              const minutos = minutosDesde(base.ultimo_sucesso_em, serverTime);
              return (
                <Card key={base.base_codigo ?? base.base_id} className={`${estilo.borda} border-t-4`}>
                  <CardHeader className="space-y-2 pb-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">{base.base_codigo ?? "Base sem código"}</CardTitle>
                        <p className="text-xs text-muted-foreground">{base.base_nome ?? "—"}</p>
                      </div>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${estilo.fundo} ${estilo.texto}`}>
                        <Icone className="h-3.5 w-3.5" /> {LABEL_SITUACAO_SYNC[situacao]}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className={`text-xs font-medium ${estilo.texto}`}>
                      {textoAtraso(minutos, situacao, base.status)}
                    </p>
                    <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/40 p-2 text-center">
                      <Metrica rotulo="Rotas" valor={base.rotas_encontradas} />
                      <Metrica rotulo="Pacotes" valor={base.pacotes_encontrados} />
                      <Metrica rotulo="Erros" valor={base.erros} destaque={base.erros > 0} />
                    </div>
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div>Último sucesso: <strong className="text-foreground">{fmtDataHora(base.ultimo_sucesso_em)}</strong></div>
                      <div>Última tentativa: <strong className="text-foreground">{fmtDataHora(base.ultima_tentativa_em)}</strong></div>
                      <div>Resultado: <strong className="text-foreground">{base.status?.replace(/_/g, " ") ?? "sem registro"}</strong></div>
                    </div>
                    {base.mensagem_segura && <p className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">{base.mensagem_segura}</p>}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Relógio do servidor: {fmtDataHora(serverTime)}. Esta página monitora infraestrutura e sincronização; a futura Torre de Controle terá acompanhamento operacional separado.
      </p>
    </div>
  );
}

function Resumo({ titulo, valor, detalhe, cor = "text-foreground" }: { titulo: string; valor: string; detalhe: string; cor?: string }) {
  return <Card><CardContent className="p-4"><div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</div><div className={`mt-1 text-3xl font-bold tabular-nums ${cor}`}>{valor}</div><div className="mt-1 text-xs text-muted-foreground">{detalhe}</div></CardContent></Card>;
}

function Metrica({ rotulo, valor, destaque = false }: { rotulo: string; valor: number; destaque?: boolean }) {
  return <div><div className={`text-base font-bold tabular-nums ${destaque ? "text-destructive" : ""}`}>{valor.toLocaleString("pt-BR")}</div><div className="text-[9px] uppercase text-muted-foreground">{rotulo}</div></div>;
}
