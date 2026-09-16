import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meliSyncStatusBases, type MeliSyncBase } from "@/lib/meli-sync.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

export type SituacaoSync = "atualizado" | "atencao" | "desatualizado" | "sem_info";

const MIN = 60_000;

export const LABEL_SITUACAO_SYNC: Record<SituacaoSync, string> = {
  atualizado: "Atualizado",
  atencao: "Atenção",
  desatualizado: "Desatualizado",
  sem_info: "Sem informação",
};

export const COR_SITUACAO_SYNC: Record<SituacaoSync, string> = {
  atualizado: "var(--success)",
  atencao: "var(--warning)",
  desatualizado: "var(--destructive)",
  sem_info: "var(--muted-foreground)",
};

/** Minutos desde a última sincronização bem-sucedida (segundo o relógio do servidor). */
export function minutosDesde(iso: string | null | undefined, serverTime: string | null | undefined) {
  if (!iso) return null;
  const ref = serverTime ? new Date(serverTime).getTime() : Date.now();
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diff = ref - t;
  if (diff < 0) return 0;
  return Math.floor(diff / MIN);
}

export function situacaoDaBase(b: MeliSyncBase, serverTime: string | null | undefined): SituacaoSync {
  const min = minutosDesde(b.ultimo_sucesso_em, serverTime);
  if (min === null) return "sem_info";

  const status = (b.status ?? "").toLowerCase();
  const erroReal = status === "erro" || (b.erros ?? 0) > 0;
  const sucessoParcial = status === "sucesso_parcial" || status === "divergencia_totais";

  // Vermelho: > 25 min sem sucesso OU erro real impeditivo
  if (min > 25 || erroReal) return "desatualizado";

  // Amarelo: Entre 15 e 25 min OU sucesso parcial recente
  if (min > 15 || sucessoParcial) return "atencao";

  // Verde: Até 15 min e sem erros
  return "atualizado";
}

export function situacaoGeral(bases: MeliSyncBase[], serverTime: string | null | undefined): SituacaoSync {
  if (bases.length === 0) return "sem_info";
  const sits = bases.map((b) => situacaoDaBase(b, serverTime));

  // O estado geral será vermelho somente se alguma base estiver há mais de 25 minutos sem sucesso ou tiver erro impeditivo.
  if (sits.includes("desatualizado")) return "desatualizado";

  // Se houver apenas sucesso parcial recente, o estado geral será amarelo.
  if (sits.includes("atencao")) return "atencao";

  if (sits.every((s) => s === "sem_info")) return "sem_info";
  return "atualizado";
}

export function textoAtraso(min: number | null, situacao: SituacaoSync, status?: string | null) {
  if (min === null) return "Sem informação de sincronização";
  if (min <= 0) return "Atualizado agora";
  if (min === 1) return "Atualizado há 1 min";
  if (min > 1440) return "Sem sincronização hoje";

  const quando = `há ${min} min`;
  const statusLower = (status ?? "").toLowerCase();
  const isParcial = statusLower === "sucesso_parcial" || statusLower === "divergencia_totais";

  if (situacao === "atualizado") return `Atualizado ${quando}`;
  if (isParcial) return `Atualização parcial ${quando}`;
  if (situacao === "atencao") return `Atenção — última atualização ${quando}`;
  return `Desatualizado ${quando}`;
}

function fmtHora(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDataHora(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} às ${d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/** Consulta a telemetria real de sincronização (atualiza a cada 60s). */
export function useMeliSync() {
  const fetchSync = useServerFn(meliSyncStatusBases);
  const q = useQuery({
    queryKey: ["meli-sync-status"],
    queryFn: () => fetchSync(),
    refetchInterval: 60_000,
    staleTime: 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const bases = q.data?.status === "ok" ? (q.data.bases ?? []) : [];
  const serverTime = q.data?.status === "ok" ? (q.data.server_time ?? null) : null;

  const porCodigo = useMemo(() => {
    const m = new Map<
      string,
      {
        base: MeliSyncBase;
        situacao: SituacaoSync;
        minutos: number | null;
        status: string | null;
        sincronizando: boolean;
      }
    >();
    for (const b of bases) {
      if (!b.base_codigo) continue;
      m.set(b.base_codigo, {
        base: b,
        situacao: situacaoDaBase(b, serverTime),
        minutos: minutosDesde(b.ultimo_sucesso_em, serverTime),
        status: b.status,
        sincronizando: b.sincronizando === true,
      });
    }
    return m;
  }, [bases, serverTime]);

  const geral = situacaoGeral(bases, serverTime);
  const ultimoSucessoGeral = bases.reduce<string | null>((acc, b) => {
    if (!b.ultimo_sucesso_em) return acc;
    if (!acc) return b.ultimo_sucesso_em;
    return new Date(b.ultimo_sucesso_em) > new Date(acc) ? acc : b.ultimo_sucesso_em;
  }, null);

  return { query: q, bases, serverTime, porCodigo, geral, ultimoSucessoGeral };
}

/**
 * Selo "Sincronizando nova atualização" — indica que existe um lote em
 * construção no staging. Os números exibidos continuam sendo do último lote
 * completo; nada parcial é mostrado.
 */
export function SeloSincronizando({ ativo }: { ativo: boolean }) {
  if (!ativo) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-[11px] font-medium text-info">
      <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
      Sincronizando nova atualização
    </span>
  );
}

export function SyncDot({ situacao, className }: { situacao: SituacaoSync; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${className ?? ""}`}
      style={{ background: COR_SITUACAO_SYNC[situacao] }}
    />
  );
}

/** Indicador compacto usado nos cartões das bases. */
export function SyncBaseIndicador({
  situacao,
  minutos,
  status,
}: {
  situacao: SituacaoSync;
  minutos: number | null;
  status?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: COR_SITUACAO_SYNC[situacao] }}>
      <SyncDot situacao={situacao} />
      {textoAtraso(minutos, situacao, status)}
    </span>
  );
}

/**
 * Situação da operação — calculada apenas com o último sucesso
 * registrado pelo backend por base (nunca pelo temporizador da tela).
 */

export function MeliSyncMonitor({ sync }: { sync: ReturnType<typeof useMeliSync> }) {
  const [aberto, setAberto] = useState(false);
  const { bases, serverTime, geral } = sync;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider"
          style={{
            color: COR_SITUACAO_SYNC[geral],
            background: `color-mix(in oklab, ${COR_SITUACAO_SYNC[geral]} 12%, transparent)`,
          }}
          role="status"
        >
          <SyncDot situacao={geral} />
          Situação da operação: {LABEL_SITUACAO_SYNC[geral]}
          {geral === "desatualizado" && bases.some(b => (b.base_codigo === "ESP16" || b.base_nome?.toLowerCase().includes("guaruja")) && situacaoDaBase(b, serverTime) === "desatualizado") && (
            <span className="ml-2 lowercase opacity-80">(parece que o problema é na base do guaruja)</span>
          )}
        </span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setAberto((v) => !v)}>
          Detalhes da sincronização
          {aberto ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
        </Button>
      </div>

      {aberto && (
        <Card className="p-3">
          {bases.length === 0 ? (
            <p className="py-3 text-center text-sm text-muted-foreground">
              Sem histórico de sincronização registrado pelo backend.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {bases.map((b) => {
                const sit = situacaoDaBase(b, serverTime);
                const min = minutosDesde(b.ultimo_sucesso_em, serverTime);
                return (
                  <div key={b.base_codigo ?? b.base_id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold">{b.base_codigo ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">{b.base_nome ?? "—"}</div>
                      </div>
                      <span
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                        style={{ color: COR_SITUACAO_SYNC[sit] }}
                      >
                        <SyncDot situacao={sit} />
                        {LABEL_SITUACAO_SYNC[sit]}
                      </span>
                    </div>
                    <dl className="mt-2 space-y-1 text-[11px]">
                      <Linha rotulo="Último sucesso" valor={`${fmtHora(b.ultimo_sucesso_em)}${min === null ? "" : ` (${textoAtraso(min, sit, b.status).toLowerCase()})`}`} />
                      <Linha rotulo="Última tentativa" valor={fmtHora(b.ultima_tentativa_em)} />
                      <Linha rotulo="Rotas" valor={b.rotas_encontradas.toLocaleString("pt-BR")} />
                      <Linha rotulo="Pacotes" valor={b.pacotes_encontrados.toLocaleString("pt-BR")} />
                      <Linha
                        rotulo="Último ciclo"
                        valor={
                          b.status === "divergencia_totais"
                            ? "Divergência de totais — dados recebidos parcialmente"
                            : b.status
                              ? b.status.replace(/_/g, " ")
                              : "sem registro de ciclo"
                        }
                      />
                    </dl>
                    {b.mensagem_segura && (
                      <p className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px]">
                        {b.mensagem_segura}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="tabular-nums font-medium">{valor}</dd>
    </div>
  );
}
