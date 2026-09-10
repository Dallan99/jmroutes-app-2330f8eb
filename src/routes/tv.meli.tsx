import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  meliDashboardOperacional,
  type MeliDashboardFiltros,
  type MeliDashboardRota,
} from "@/lib/meli-dashboard.functions";
import { descreverMotivo, type SituacaoMeli } from "@/lib/meli-status";
import { TV_BASES_INTEGRADAS } from "@/lib/tv-flags";
import { Button } from "@/components/ui/button";
import {
  ChevronLeft, ChevronRight, Pause, Play, RefreshCw, Repeat, ShieldAlert, ShieldCheck,
} from "lucide-react";
import { buscarDashboardComContingencia } from "@/lib/meli-dashboard-cache";

type Risco = "qualquer" | "integral" | "parcial";

type Busca = {
  data?: string;
  base_id?: string;
  motorista?: string;
  rota?: string;
  status?: SituacaoMeli;
  transportadora?: string;
  risco?: Risco;
};

const SITUACOES: SituacaoMeli[] = [
  "nao_iniciado", "em_rota", "entregue", "insucesso", "cancelado", "desconhecido",
];
const RISCOS: Risco[] = ["qualquer", "integral", "parcial"];

export const Route = createFileRoute("/tv/meli")({

  head: () => ({
    meta: [
      { title: "Operação — Modo TV | JMRoutes" },
      { name: "description", content: "Painel de televisão da operação em tempo real: rotas, entregas, insucessos e área de risco." },
      { property: "og:title", content: "Operação — Modo TV | JMRoutes" },
      { property: "og:description", content: "Painel de televisão da operação em tempo real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): Busca => ({
    data: typeof s.data === "string" ? s.data : undefined,
    base_id: typeof s.base_id === "string" ? s.base_id : undefined,
    motorista: typeof s.motorista === "string" ? s.motorista : undefined,
    rota: typeof s.rota === "string" ? s.rota : undefined,
    status: SITUACOES.includes(s.status as SituacaoMeli) ? (s.status as SituacaoMeli) : undefined,
    transportadora: typeof s.transportadora === "string" ? s.transportadora : undefined,
    risco: RISCOS.includes(s.risco as Risco) ? (s.risco as Risco) : undefined,
  }),
  component: TvMeli,
});

const REFETCH_MS = 30_000;
const SEM_SYNC_MS = 2 * 60_000;
const ROTA_PARADA_MS = 15 * 60_000;
const VISAO_MS = 12_000;
const PAGINA_MS = 6_000;
const PREF_KEY = "jmroutes.tv.meli.prefs";

type Visao = "resumo" | "rotas" | "insucessos" | "risco" | "bases";
const VISOES: { id: Visao; label: string }[] = [
  { id: "resumo", label: "Resumo geral" },
  { id: "rotas", label: "Operações / rotas" },
  { id: "insucessos", label: "Insucessos" },
  { id: "risco", label: "Área de risco" },
  { id: "bases", label: "Bases" },
];

type Prefs = { rotacaoAuto: boolean };

function hhmmss(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function lerPrefs(inicial: Prefs): Prefs {
  if (typeof window === "undefined") return inicial;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (!raw) return inicial;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return { rotacaoAuto: p.rotacaoAuto === undefined ? true : !!p.rotacaoAuto };
  } catch {
    return inicial;
  }
}

/** Mede a altura útil da área de conteúdo para caber tudo sem rolagem. */
function useAlturaUtil<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [altura, setAltura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => setAltura(el.clientHeight);
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, altura };
}

function TvMeli() {
  const busca = Route.useSearch();
  const fetchDados = useServerFn(meliDashboardOperacional);
  const { ref: areaRef, altura: alturaArea } = useAlturaUtil<HTMLDivElement>();

  const [prefs, setPrefs] = useState<Prefs>(() => lerPrefs({ rotacaoAuto: true }));
  const [visao, setVisao] = useState<Visao>("resumo");
  const [pagina, setPagina] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [restante, setRestante] = useState(VISAO_MS / 1000);
  const [ciclo, setCiclo] = useState(0);
  const [segundosDados, setSegundosDados] = useState(REFETCH_MS / 1000);
  const visaoRef = useRef(visao);
  visaoRef.current = visao;

  useEffect(() => {
    try {
      window.localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch { /* preferências são opcionais */ }
  }, [prefs]);

  const filtros = useMemo<MeliDashboardFiltros>(
    () => ({
      data: busca.data ?? null,
      base_id: busca.base_id ?? null,
      motorista: busca.motorista ?? null,
      rota: busca.rota ?? null,
      status: busca.status ?? null,
      transportadora: busca.transportadora ?? null,
      risco: busca.risco ?? null,
    }),
    [busca],
  );

  const q = useQuery({
    queryKey: ["tv-meli", filtros],
    queryFn: () => buscarDashboardComContingencia(() => fetchDados({ data: filtros }), filtros),
    refetchInterval: REFETCH_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
  });

  // Contador da próxima atualização dos dados (independente do carrossel).
  useEffect(() => {
    setSegundosDados(REFETCH_MS / 1000);
    const t = setInterval(() => setSegundosDados((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [q.dataUpdatedAt]);

  const irPara = useCallback((v: Visao) => {
    setVisao(v);
    setPagina(0);
    setCiclo((c) => c + 1);
  }, []);

  const mover = useCallback((delta: number) => {
    const i = VISOES.findIndex((x) => x.id === visaoRef.current);
    const prox = VISOES[(i + delta + VISOES.length) % VISOES.length]!.id;
    irPara(prox);
  }, [irPara]);

  // Carrossel: 12s por visão.
  useEffect(() => {
    if (!prefs.rotacaoAuto || pausado) return;
    setRestante(VISAO_MS / 1000);
    const tick = setInterval(() => setRestante((r) => (r > 0 ? r - 1 : 0)), 1000);
    const avanca = setTimeout(() => mover(1), VISAO_MS);
    return () => { clearInterval(tick); clearTimeout(avanca); };
  }, [prefs.rotacaoAuto, pausado, visao, ciclo, mover]);

  const d = q.data?.status === "ok" ? q.data : undefined;
  const cards = d?.cards;
  const rotas = d?.rotas ?? [];
  const serverTime = d?.server_time ?? null;
  const agora = serverTime ? new Date(serverTime).getTime() : Date.now();
  const ultimaSync = d?.ultima_sincronizacao ?? null;
  const syncAtrasada = !ultimaSync || agora - new Date(ultimaSync).getTime() > SEM_SYNC_MS;
  const syncStatus = d?.cache_local ? "Sem conexão" : q.data?.status === "erro" ? "Com erro" : syncAtrasada ? "Atrasada" : "Em dia";

  const rotasOperacionais = useMemo(
    () => rotas.filter((r) => r.total > 0 || r.nao_iniciado > 0 || r.em_rota > 0 || r.entregue > 0 || r.insucesso > 0),
    [rotas],
  );
  const rotasOrdenadas = useMemo(() => {
    const atraso = (r: MeliDashboardRota) =>
      !r.last_synced_at ? Number.MAX_SAFE_INTEGER : agora - new Date(r.last_synced_at).getTime();
    return [...rotasOperacionais].sort((a, b) => {
      const aAtraso = atraso(a) > ROTA_PARADA_MS ? 1 : 0;
      const bAtraso = atraso(b) > ROTA_PARADA_MS ? 1 : 0;
      if (aAtraso !== bAtraso) return bAtraso - aAtraso;
      const aRisco = a.rota_area_risco || a.area_risco_parcial ? 1 : 0;
      const bRisco = b.rota_area_risco || b.area_risco_parcial ? 1 : 0;
      if (aRisco !== bRisco) return bRisco - aRisco;
      if (b.insucesso !== a.insucesso) return b.insucesso - a.insucesso;
      if (a.perc_entrega !== b.perc_entrega) return a.perc_entrega - b.perc_entrega;
      return b.nao_iniciado - a.nao_iniciado;
    });
  }, [rotasOperacionais, agora]);

  const rotasAtrasadas = useMemo(
    () => rotasOperacionais.filter((r) => !r.last_synced_at || agora - new Date(r.last_synced_at).getTime() > ROTA_PARADA_MS).length,
    [rotasOperacionais, agora],
  );

  /** Linhas que cabem na área útil: cabeçalho da tabela + rodapé de paginação. */
  const linhasPorPagina = useMemo(() => {
    const disponivel = Math.max(0, alturaArea - 150);
    return Math.max(4, Math.floor(disponivel / 46));
  }, [alturaArea]);

  const totalPaginas = Math.max(1, Math.ceil(rotasOrdenadas.length / linhasPorPagina));
  const paginaAtual = Math.min(pagina, totalPaginas - 1);
  const linhas = rotasOrdenadas.slice(paginaAtual * linhasPorPagina, (paginaAtual + 1) * linhasPorPagina);

  // Paginação automática dentro da visão de rotas (6s), sem trocar a visão.
  useEffect(() => {
    if (visao !== "rotas" || pausado || totalPaginas <= 1) return;
    const id = setInterval(() => setPagina((p) => (p + 1) % totalPaginas), PAGINA_MS);
    return () => clearInterval(id);
  }, [visao, pausado, totalPaginas, ciclo]);

  const bases = d?.bases ?? [];
  const basesComDados = useMemo(() => bases.filter((b) => b.total > 0 || b.rotas > 0), [bases]);
  const basesComInsucesso = useMemo(
    () => basesComDados.filter((b) => b.insucesso > 0).sort((a, b) => b.insucesso - a.insucesso),
    [basesComDados],
  );

  const motivos = (d?.motivos_insucesso ?? []).filter((m) => m.total > 0);
  const totalOperacao = cards?.total ?? 0;
  const rotasRisco = rotasOrdenadas.filter((r) => r.rota_area_risco || r.area_risco_parcial);
  const semRisco = rotasRisco.length === 0 && !(d?.area_risco?.pacotes ?? 0);

  const itensLista = useMemo(() => Math.max(3, Math.floor(Math.max(0, alturaArea - 220) / 52)), [alturaArea]);

  const indiceVisao = VISOES.findIndex((v) => v.id === visao);
  const progresso = Math.max(0, Math.min(100, (restante / (VISAO_MS / 1000)) * 100));
  const rotacaoAtiva = prefs.rotacaoAuto && !pausado;

  return (
    <div className="flex h-full flex-col gap-3 overflow-hidden p-4 xl:p-6">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-black leading-tight tracking-tight xl:text-4xl">
            Operação — Modo TV
          </h1>
          <p className="text-sm text-white/70 xl:text-base">
            Dia <span className="font-semibold tabular-nums">{d?.data_operacional ?? busca.data ?? "—"}</span>
            {" · "}Base{" "}
            <span className="font-semibold">
              {busca.base_id ? (bases.find((b) => b.base_id === busca.base_id)?.base_codigo ?? "selecionada") : "Todas"}
            </span>
            {" · "}Últ. sync <span className="font-semibold tabular-nums">{hhmmss(ultimaSync)}</span>
            {" · "}
            <span
              className={`inline-flex items-center gap-1.5 font-semibold ${
                syncStatus === "Em dia" ? "text-emerald-400" : syncStatus === "Atrasada" ? "text-amber-300" : "text-rose-400"
              }`}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  syncStatus === "Em dia" ? "bg-emerald-400" : syncStatus === "Atrasada" ? "bg-amber-300" : "bg-rose-500"
                }`}
                aria-hidden
              />
              {syncStatus}
            </span>
            {" · "}Atualiza em <span className="font-semibold tabular-nums">{segundosDados}s</span>
            {q.isFetching && (
              <RefreshCw className="ml-2 inline h-3.5 w-3.5 animate-spin text-white/50 motion-reduce:animate-none" aria-hidden />
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold xl:text-base" aria-live="polite">
            {VISOES[indiceVisao]?.label}
            <span className="text-white/60"> · {indiceVisao + 1}/{VISOES.length} · </span>
            {rotacaoAtiva ? (
              <span className="tabular-nums text-[var(--brand-yellow)]">{restante}s</span>
            ) : (
              <span className="text-white/60">pausado</span>
            )}
          </p>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" title="Visão anterior" aria-label="Visão anterior"
              className="text-white hover:bg-white/10 hover:text-white" onClick={() => mover(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost"
              title={pausado ? "Iniciar rotação" : "Pausar rotação"}
              aria-label={pausado ? "Iniciar rotação" : "Pausar rotação"}
              className="text-white hover:bg-white/10 hover:text-white"
              onClick={() => setPausado((p) => !p)}>
              {pausado ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" title="Próxima visão" aria-label="Próxima visão"
              className="text-white hover:bg-white/10 hover:text-white" onClick={() => mover(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost"
              title={prefs.rotacaoAuto ? "Desativar rotação automática" : "Ativar rotação automática"}
              aria-label={prefs.rotacaoAuto ? "Desativar rotação automática" : "Ativar rotação automática"}
              aria-pressed={prefs.rotacaoAuto}
              className={`hover:bg-white/10 hover:text-white ${prefs.rotacaoAuto ? "text-[var(--brand-yellow)]" : "text-white/60"}`}
              onClick={() => { setPrefs((p) => ({ ...p, rotacaoAuto: !p.rotacaoAuto })); setPausado(false); setCiclo((c) => c + 1); }}>
              <Repeat className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="h-1 w-full shrink-0 overflow-hidden rounded-full bg-white/10" role="presentation">
          <div
            className="h-full rounded-full bg-[var(--brand-yellow)] transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
            style={{ width: rotacaoAtiva ? `${progresso}%` : "100%" }}
          />
        </div>
      </header>

      <div ref={areaRef} className="min-h-0 flex-1 overflow-hidden">
        <div key={visao} className="h-full animate-in fade-in duration-500 motion-reduce:animate-none">
          {visao === "resumo" && (
            <div className="grid h-full auto-rows-fr grid-cols-3 gap-3 xl:grid-cols-4">
              <TvNum label="Total de pacotes" valor={cards?.total} />
              <TvNum label="Não iniciados" valor={cards?.nao_iniciado} tom="neutro" />
              <TvNum label="Em rota" valor={cards?.em_rota} tom="info" />
              <TvNum label="Entregues" valor={cards?.entregue} tom="ok" />
              <TvNum label="Insucessos" valor={cards?.insucesso} tom="atencao" />
              <TvNum label="Cancelados" valor={cards?.cancelado} tom="neutro" />
              <TvNum label="% Entrega" valor={cards ? `${cards.perc_entrega}%` : undefined} tom="ok" />
              <TvNum label="Rotas" valor={cards?.rotas} />
              <TvNum label="Rotas em risco" valor={cards?.rotas_risco} tom="critico" />
              <TvNum label="Pacotes em risco" valor={cards?.area_risco_pacotes} tom="critico" />
              <TvNum label="Rotas paradas +15min" valor={rotasAtrasadas} tom={rotasAtrasadas ? "atencao" : "ok"} />
              <TvNum label="Sincronização" valor={syncStatus} tom={syncStatus === "Em dia" ? "ok" : syncStatus === "Atrasada" ? "atencao" : "critico"} />
            </div>
          )}

          {visao === "rotas" && (
            <TvCard
              titulo={rotasOrdenadas.length > 0
                ? `Operações / rotas (${rotasOrdenadas.length})`
                : `Operações por base (${basesComDados.length})`}
              rodape={
                <div className="flex items-center justify-between gap-3 text-sm text-white/70">
                  <span className="tabular-nums">Página {paginaAtual + 1} de {totalPaginas}</span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" aria-label="Página anterior" title="Página anterior" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setPagina((p) => (p - 1 + totalPaginas) % totalPaginas)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Próxima página" title="Próxima página" className="text-white hover:bg-white/10 hover:text-white" onClick={() => setPagina((p) => (p + 1) % totalPaginas)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              }
            >
              <table className="w-full text-base xl:text-lg">
                <thead>
                  <tr className="border-b border-white/15 text-left text-xs uppercase tracking-wider text-white/60">
                    <th className="p-1.5">Rota / cluster</th>
                    <th className="p-1.5">Motorista</th>
                    <th className="p-1.5">Total</th>
                    <th className="p-1.5">Não inic.</th>
                    <th className="p-1.5">Em rota</th>
                    <th className="p-1.5">Entregues</th>
                    <th className="p-1.5">Insuc.</th>
                    <th className="p-1.5">% Entrega</th>
                    <th className="p-1.5">Risco</th>
                    <th className="p-1.5">Últ. sync</th>
                  </tr>
                </thead>
                <tbody>
                  {rotasOrdenadas.length === 0 && basesComDados.slice(0, linhasPorPagina).map((b) => (
                    <tr key={b.base_id ?? b.base_codigo ?? "sem"} className="border-b border-white/10">
                      <td className="p-1.5 font-semibold">{b.base_nome ?? b.base_codigo ?? "—"}<span className="ml-2 text-xs font-normal text-white/50">{b.base_codigo}</span></td>
                      <td className="p-1.5 text-white/50">Consolidado</td>
                      <td className="p-1.5 tabular-nums">{b.total}</td>
                      <td className="p-1.5 tabular-nums text-white/60">—</td>
                      <td className="p-1.5 tabular-nums text-sky-300">{b.em_rota}</td>
                      <td className="p-1.5 tabular-nums text-emerald-400">{b.entregue}</td>
                      <td className="p-1.5 tabular-nums text-amber-300">{b.insucesso}</td>
                      <td className="p-1.5 tabular-nums font-semibold">{b.perc_entrega}%</td>
                      <td className="p-1.5">—</td>
                      <td className="p-1.5 tabular-nums">{hhmmss(d?.snapshot_at)}</td>
                    </tr>
                  ))}
                  {linhas.map((r) => {
                    const atrasada = !r.last_synced_at || agora - new Date(r.last_synced_at).getTime() > ROTA_PARADA_MS;
                    return (
                      <tr key={r.rota_id} className={`border-b border-white/10 ${atrasada ? "bg-rose-500/10" : ""}`}>
                        <td className="p-1.5 font-semibold">
                          {r.nome_operacional}
                          <span className="ml-2 text-xs font-normal text-white/50">{r.base_codigo ?? "—"}</span>
                        </td>
                        <td className="p-1.5">{r.driver_name ?? "—"}</td>
                        <td className="p-1.5 tabular-nums">{r.total}</td>
                        <td className="p-1.5 tabular-nums text-white/60">{r.nao_iniciado}</td>
                        <td className="p-1.5 tabular-nums text-sky-300">{r.em_rota}</td>
                        <td className="p-1.5 tabular-nums text-emerald-400">{r.entregue}</td>
                        <td className="p-1.5 tabular-nums text-amber-300">{r.insucesso}</td>
                        <td className="p-1.5 tabular-nums font-semibold">{r.perc_entrega}%</td>
                        <td className="p-1.5">
                          {r.rota_area_risco || r.area_risco_parcial ? (
                            <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-sm text-rose-300">
                              <ShieldAlert className="h-4 w-4" aria-hidden />
                              {r.rota_area_risco ? "Integral" : "Parcial"}
                            </span>
                          ) : "—"}
                        </td>
                        <td className={`p-1.5 tabular-nums ${atrasada ? "font-semibold text-rose-300" : ""}`}>{hhmmss(r.last_synced_at)}</td>
                      </tr>
                    );
                  })}
                  {linhas.length === 0 && basesComDados.length === 0 && (
                    <tr><td colSpan={10} className="p-6 text-center text-white/60">Nenhuma rota no dia operacional.</td></tr>
                  )}
                </tbody>
              </table>
            </TvCard>
          )}

          {visao === "insucessos" && (
            motivos.length === 0 && basesComInsucesso.length === 0 ? (
              <VisaoPositiva
                titulo="Nenhum insucesso registrado"
                subtitulo="Operação sem tentativas de entrega frustradas no momento"
              />
            ) : (
              <div className="flex h-full flex-col gap-3">
                <div className="grid shrink-0 grid-cols-4 gap-3">
                  <TvNum label="Total de insucessos" valor={cards?.insucesso} tom="atencao" compacto />
                  <TvNum
                    label="% sobre a operação"
                    valor={totalOperacao ? `${Math.round(((cards?.insucesso ?? 0) / totalOperacao) * 1000) / 10}%` : "—"}
                    tom="atencao"
                    compacto
                  />
                  <TvNum label="Motivos distintos" valor={motivos.length} tom="neutro" compacto />
                  <TvNum label="Operações envolvidas" valor={rotas.length > 0 ? rotas.filter((r) => r.insucesso > 0).length : basesComInsucesso.length} tom="atencao" compacto />
                </div>
                <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-2">
                  <TvCard titulo="Principais motivos">
                    <ul className="space-y-1.5">
                      {motivos.slice(0, itensLista).map((m) => (
                        <li key={m.codigo} className="flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                          <span className="truncate text-base xl:text-lg">{descreverMotivo(m.codigo, m.descricao)}</span>
                          <span className="font-display text-xl font-black tabular-nums text-amber-300 xl:text-2xl">
                            {m.total}
                            {totalOperacao > 0 && (
                              <span className="ml-2 text-sm font-semibold text-white/50">
                                {Math.round((m.total / totalOperacao) * 1000) / 10}%
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </TvCard>
                  <TvCard titulo={rotas.length > 0 ? "Rotas com insucesso" : "Bases com insucesso"}>
                    <ul className="space-y-1.5 text-base xl:text-lg">
                      {(rotas.length > 0 ? rotas.filter((r) => r.insucesso > 0) : basesComInsucesso.map((b) => ({
                          rota_id: b.base_id ?? b.base_codigo ?? "sem",
                          nome_operacional: b.base_nome ?? b.base_codigo ?? "—",
                          base_codigo: b.base_codigo,
                          insucesso: b.insucesso,
                          total: b.total,
                        })))
                        .sort((a, b) => b.insucesso - a.insucesso)
                        .slice(0, itensLista)
                        .map((r) => (
                          <li key={r.rota_id} className="flex items-center justify-between gap-3 rounded bg-white/5 px-3 py-2">
                            <span className="truncate">{r.nome_operacional} <span className="text-white/50">· {r.base_codigo ?? "—"}</span></span>
                            <span className="shrink-0 tabular-nums text-amber-300">
                              {r.insucesso} · {r.total > 0 ? Math.round((r.insucesso / r.total) * 100) : 0}%
                            </span>
                          </li>
                        ))}
                    </ul>
                  </TvCard>
                </div>
              </div>
            )
          )}

          {visao === "risco" && (
            semRisco ? (
              <VisaoPositiva
                titulo="Nenhuma rota em área de risco"
                subtitulo="Operação sem ocorrências de risco no momento"
              />
            ) : (
              <div className="flex h-full flex-col gap-3">
                <div className="grid shrink-0 grid-cols-4 gap-3">
                  <TvNum label="Rotas em risco" valor={d?.area_risco?.rotas} tom="critico" compacto />
                  <TvNum label="Integrais" valor={d?.area_risco?.integrais} tom="critico" compacto />
                  <TvNum label="Parciais" valor={d?.area_risco?.parciais} tom="atencao" compacto />
                  <TvNum label="Pacotes em risco" valor={d?.area_risco?.pacotes} tom="critico" compacto />
                  <TvNum label="Entregues" valor={d?.area_risco?.entregue} tom="ok" compacto />
                  <TvNum label="Em rota" valor={d?.area_risco?.em_rota} tom="info" compacto />
                  <TvNum label="Insucessos" valor={d?.area_risco?.insucesso} tom="atencao" compacto />
                  <TvNum label="% Conclusão" valor={d?.area_risco ? `${d.area_risco.perc_conclusao}%` : undefined} tom="ok" compacto />
                </div>
                <TvCard titulo="Rotas de área de risco" className="min-h-0 flex-1">
                  <ul className="space-y-1.5 text-base xl:text-lg">
                    {rotasRisco.slice(0, itensLista).map((r) => (
                      <li key={r.rota_id} className="flex items-center justify-between gap-3 rounded bg-white/5 px-3 py-2">
                        <span className="truncate">
                          {r.nome_operacional} <span className="text-white/50">· {r.base_codigo ?? "—"}</span>
                          <span className="ml-2 text-sm text-rose-300">{r.rota_area_risco ? "Integral" : "Parcial"}</span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {r.entregue}/{r.total} · <span className="font-semibold">{r.perc_entrega}%</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </TvCard>
              </div>
            )
          )}

          {visao === "bases" && (
            <TvCard titulo={`Bases integradas ao Worker (${basesComDados.length})`} className="h-full">
              <table className="w-full text-base xl:text-lg">
                <thead>
                  <tr className="border-b border-white/15 text-left text-xs uppercase tracking-wider text-white/60">
                    <th className="p-1.5">Base</th>
                    <th className="p-1.5">Rotas</th>
                    <th className="p-1.5">Rotas risco</th>
                    <th className="p-1.5">Total</th>
                    <th className="p-1.5">Entregues</th>
                    <th className="p-1.5">Em rota</th>
                    <th className="p-1.5">Insucessos</th>
                    <th className="p-1.5">% Entrega</th>
                  </tr>
                </thead>
                <tbody>
                  {basesComDados.slice(0, linhasPorPagina).map((b) => (
                    <tr key={b.base_id ?? b.base_codigo ?? "sem"} className="border-b border-white/10">
                      <td className="p-1.5 font-semibold">{b.base_codigo ?? "—"}</td>
                      <td className="p-1.5 tabular-nums">{b.rotas}</td>
                      <td className="p-1.5 tabular-nums text-rose-300">{b.rotas_risco}</td>
                      <td className="p-1.5 tabular-nums">{b.total}</td>
                      <td className="p-1.5 tabular-nums text-emerald-400">{b.entregue}</td>
                      <td className="p-1.5 tabular-nums text-sky-300">{b.em_rota}</td>
                      <td className="p-1.5 tabular-nums text-amber-300">{b.insucesso}</td>
                      <td className="p-1.5 tabular-nums font-semibold">{b.perc_entrega}%</td>
                    </tr>
                  ))}
                  {basesComDados.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-white/60">
                        Nenhuma base com dados no dia operacional. Integração ativa hoje: {TV_BASES_INTEGRADAS.join(", ")}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </TvCard>
          )}
        </div>
      </div>

      {q.isPending && !d && <p className="shrink-0 text-white/60">Carregando dados da operação…</p>}
    </div>
  );
}

function VisaoPositiva({ titulo, subtitulo }: { titulo: string; subtitulo: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-6 text-center">
      <ShieldCheck className="h-16 w-16 text-emerald-400 xl:h-24 xl:w-24" aria-hidden />
      <p className="font-display text-3xl font-black text-emerald-300 xl:text-5xl">{titulo}</p>
      <p className="text-lg text-white/70 xl:text-2xl">{subtitulo}</p>
    </div>
  );
}

function TvCard({
  titulo, children, rodape, className,
}: {
  titulo: string;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-4 ${className ?? "h-full"}`}>
      <h2 className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-widest text-white/70">{titulo}</h2>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      {rodape && <div className="mt-2 shrink-0 border-t border-white/10 pt-2">{rodape}</div>}
    </div>
  );
}

function TvNum({
  label, valor, tom, compacto,
}: {
  label: string;
  valor: number | string | undefined;
  tom?: "ok" | "info" | "atencao" | "critico" | "neutro";
  compacto?: boolean;
}) {
  const cor =
    tom === "ok" ? "text-emerald-400"
    : tom === "info" ? "text-sky-300"
    : tom === "atencao" ? "text-amber-300"
    : tom === "critico" ? "text-rose-400"
    : tom === "neutro" ? "text-white/60"
    : "text-[var(--brand-yellow)]";
  return (
    <div
      className={`flex flex-col justify-center overflow-hidden rounded-2xl border px-4 py-2 ${
        tom === "critico" ? "border-rose-500/50 bg-rose-500/10" : "border-white/10 bg-white/[0.06]"
      }`}
    >
      <p className="mb-1 truncate text-[11px] font-semibold uppercase tracking-widest text-white/60 xl:text-xs">{label}</p>
      <p
        className={`font-display font-black leading-none tabular-nums ${cor}`}
        style={{ fontSize: compacto ? "clamp(1.25rem, 3.2vh, 2.5rem)" : "clamp(1.5rem, 6vh, 5rem)" }}
      >
        {valor ?? "—"}
      </p>
    </div>
  );
}
