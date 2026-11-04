import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  biparTriagem,
  triagemResumoDia,
  ultimasTriagens,
  triagemRotasDoDia,
  triagemShipmentsPendentes,
  localizarShipmentTriagem,
  concluirRotaComRessalva,
  type TriagemResult,
  type LocalizacaoShipmentTriagem,
} from "@/lib/triagem.functions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { beepError, beepOk, beepWarn } from "@/lib/scanner-sound";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ScanLine,
  Package,
  PackageCheck,
  PackageX,
  Percent,
  Download,
  Printer,
  RotateCcw,
  Pause,
  Play,
  Info,
  Copy,
  ArrowLeft,
  FileSpreadsheet,
  Search,
  Loader2,
  ArrowRight,
  Camera,
} from "lucide-react";
import { toast } from "sonner";
import {
  abrirRelatorio,
  baixarCSV,
  montarLinhasTriagemRota,
  type TriagemLinhaImpressao,
} from "@/lib/relatorio";
import { listarDiasOperacionais } from "@/lib/bases.functions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RequireBaseOperacional } from "@/components/base-operacional-selector";
import { useBaseOperacional } from "@/lib/base-operacional-context";
import { ErroBloqueioOverlay } from "@/components/erro-bloqueio-overlay";
import { leituraQrMeliCompleta, normalizarCodigoTriagem } from "@/lib/triagem-domain";
import { useCollectorMode } from "@/lib/collector-mode";
import { nomenclaturaRota } from "@/lib/rota-nomenclatura";

export const Route = createFileRoute("/_authenticated/triagem")({
  head: () => ({ meta: [{ title: "Recebimento — JM Transportes" }] }),
  component: TriagemGuard,
});

function TriagemGuard() {
  return (
    <RequireBaseOperacional
      titulo="Recebimento"
      descricao="Selecione a Base e o Dia Operacional. A escala ativa correspondente será carregada."
    >
      <TriagemComHeader />
    </RequireBaseOperacional>
  );
}

function TriagemComHeader() {
  const { base, diaOperacional, limpar } = useBaseOperacional();
  return (
    <>
      <div className="border-b bg-muted/30 px-4 md:px-6 py-2 flex items-center gap-3 flex-wrap text-xs">
        <span className="font-display font-semibold text-sm">Recebimento</span>
        <span className="text-muted-foreground">·</span>
        <span>
          Base: <b>{base?.nome ?? "—"}</b>
          {base?.codigo && (
            <span className="font-mono text-muted-foreground"> ({base.codigo})</span>
          )}
        </span>
        <span className="text-muted-foreground">·</span>
        <span>
          Dia Operacional:{" "}
          <b className="font-mono">
            {diaOperacional
              ? new Date(diaOperacional + "T00:00:00").toLocaleDateString("pt-BR")
              : "—"}
          </b>
        </span>
        <Button
          size="sm"
          variant="outline"
          className="ml-auto h-7 text-xs"
          onClick={() => limpar()}
        >
          Trocar base / dia
        </Button>
      </div>
      <TriagemPage />
    </>
  );
}

const DEDUPE_MS = 700;
const STORAGE_KEY = "triagem:session:v1";
const ROTA_STORAGE_KEY = "triagem:rota-selecionada:v1";

type PersistedSession = {
  startedAt: number | null;
  accumulatedMs: number;
  paused: boolean;
  sessionOk: number;
  sessionErr: number;
  last: TriagemResult | null;
};

const defaultSession: PersistedSession = {
  startedAt: null,
  accumulatedMs: 0,
  paused: false,
  sessionOk: 0,
  sessionErr: 0,
  last: null,
};

function loadSession(): PersistedSession {
  if (typeof window === "undefined") return defaultSession;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSession;
    return { ...defaultSession, ...JSON.parse(raw) };
  } catch {
    return defaultSession;
  }
}

function TriagemPage() {
  const qc = useQueryClient();
  const { base, diaOperacional, trocarDia } = useBaseOperacional();
  const baseId = base!.id;
  const dataOperacional = diaOperacional!;
  const biparFn = useServerFn(biparTriagem);
  const listaFn = useServerFn(ultimasTriagens);
  const resumoFn = useServerFn(triagemResumoDia);
  const rotasFn = useServerFn(triagemRotasDoDia);
  const pendentesFn = useServerFn(triagemShipmentsPendentes);
  const localizarFn = useServerFn(localizarShipmentTriagem);
  const concluirRessalvaFn = useServerFn(concluirRotaComRessalva);
  const listarDiasFn = useServerFn(listarDiasOperacionais);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<{ codigo: string; ts: number } | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAjusteDiaRef = useRef<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [session, setSession] = useState<PersistedSession>(defaultSession);
  const [hydrated, setHydrated] = useState(false);
  const [flash, setFlash] = useState<"ok" | "error" | null>(null);
  const [now, setNow] = useState(Date.now());
  const [rotaSelecionada, setRotaSelecionada] = useState<string | null>(null);
  const [rotaDetalhe, setRotaDetalhe] = useState<string | null>(null);
  const [modoRota, setModoRota] = useState(false);
  const [shipmentConsulta, setShipmentConsulta] = useState("");
  const [resultadoConsulta, setResultadoConsulta] = useState<LocalizacaoShipmentTriagem | null>(
    null,
  );
  const [dialogRessalvaAberto, setDialogRessalvaAberto] = useState(false);
  const [motivoRessalva, setMotivoRessalva] = useState("");
  const [bloqueioErro, setBloqueioErro] = useState<string | null>(null);
  const [cameraAberta, setCameraAberta] = useState(false);
  const { modoColetor } = useCollectorMode();

  const detalheQuery = useQuery({
    queryKey: ["triagem-pendentes", baseId, dataOperacional, rotaDetalhe],
    queryFn: () => pendentesFn({ data: { baseId, dataOperacional, rota: rotaDetalhe! } }),
    enabled: !!rotaDetalhe,
    refetchInterval: rotaDetalhe ? 15000 : false,
  });

  const rotaOperacaoQuery = useQuery({
    queryKey: ["triagem-rota-operacao", baseId, dataOperacional, rotaSelecionada],
    queryFn: () => pendentesFn({ data: { baseId, dataOperacional, rota: rotaSelecionada! } }),
    enabled: modoRota && !!rotaSelecionada,
    refetchInterval: modoRota && rotaSelecionada ? 15000 : false,
  });

  const { startedAt, accumulatedMs, paused, sessionOk, sessionErr, last } = session;

  // hydrate from localStorage
  useEffect(() => {
    setSession(loadSession());
    setHydrated(true);
  }, []);

  // hydrate rota selecionada por base+dia
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`${ROTA_STORAGE_KEY}:${baseId}:${dataOperacional}`);
      setRotaSelecionada(raw && raw.length ? raw : null);
    } catch {
      setRotaSelecionada(null);
    }
  }, [baseId, dataOperacional]);

  const escolherRota = useCallback(
    (rota: string | null) => {
      setRotaSelecionada(rota);
      try {
        const key = `${ROTA_STORAGE_KEY}:${baseId}:${dataOperacional}`;
        if (rota) window.localStorage.setItem(key, rota);
        else window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    },
    [baseId, dataOperacional],
  );

  const abrirRota = useCallback(
    (rota: string) => {
      escolherRota(rota);
      setModoRota(true);
    },
    [escolherRota],
  );

  const voltarParaRotas = useCallback(() => {
    setModoRota(false);
    setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 0);
  }, []);

  // persist
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      // ignore
    }
  }, [session, hydrated]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const resumo = useQuery({
    queryKey: ["triagem-resumo", baseId, dataOperacional],
    queryFn: () => resumoFn({ data: { baseId, dataOperacional } }),
    refetchInterval: 15000,
  });
  const lista = useQuery({
    queryKey: ["triagem-ultimas"],
    queryFn: () => listaFn(),
    refetchInterval: 5000,
  });
  const rotas = useQuery({
    queryKey: ["triagem-rotas", baseId, dataOperacional],
    queryFn: () => rotasFn({ data: { baseId, dataOperacional } }),
    refetchInterval: false,
    retry: 1,
    staleTime: 30000,
  });
  const diasImportados = useQuery({
    queryKey: ["dias-operacionais", baseId],
    queryFn: () => listarDiasFn({ data: { baseId } }),
    staleTime: 60_000,
  });

  const rotaAtual = (rotas.data ?? []).find((r) => r.rota === rotaSelecionada) ?? null;
  const nomeRotaAtual = nomenclaturaRota({
    nome_operacional: rotaAtual?.nome_operacional,
    route_id: rotaSelecionada ?? "",
  });
  const rotaConcluidaRessalva = rotaAtual?.status === "concluida_ressalva";

  const agendarAtualizacoes = useCallback(() => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: ["triagem-ultimas"] });
      void qc.invalidateQueries({ queryKey: ["triagem-resumo"] });
      void qc.invalidateQueries({ queryKey: ["triagem-rotas"] });
      void qc.invalidateQueries({ queryKey: ["triagem-rota-operacao"] });
      void qc.invalidateQueries({ queryKey: ["triagem-pendentes"] });
      refreshTimerRef.current = null;
    }, 800);
  }, [qc]);

  useEffect(
    () => () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    },
    [],
  );

  // Se a rota selecionada bateu 100%, mantém aberta mas indica; se sumiu da lista, limpa.
  useEffect(() => {
    if (!rotaSelecionada || !rotas.data) return;
    const existe = rotas.data.some((r) => r.rota === rotaSelecionada);
    if (!existe) escolherRota(null);
  }, [rotas.data, rotaSelecionada, escolherRota]);

  const mutation = useMutation({
    mutationFn: (cod: string) => {
      const tempo = lastRef.current ? Date.now() - lastRef.current.ts : undefined;
      return biparFn({
        data: {
          codigo: cod,
          baseId,
          dataOperacional,
          tempoDesdeUltimaMs: tempo,
          rotaSelecionada: rotaSelecionada ?? undefined,
        },
      });
    },
    onSuccess: (res) => {
      // Consolida os refetches quando há vários bips seguidos. O resultado do bip
      // aparece imediatamente, sem cinco consultas disputando a próxima leitura.
      agendarAtualizacoes();
      const isOk = res.resultado === "ok";
      const isWarn = res.resultado === "duplicado";
      if (isOk) {
        beepOk();
        setFlash("ok");
        toast.success(res.mensagem);
      } else if (isWarn) {
        beepWarn();
        setFlash("error");
        toast.warning(res.mensagem);
      } else {
        beepError();
        setFlash("error");
        setBloqueioErro(res.mensagem);
      }
      setSession((s) => ({
        ...s,
        startedAt: s.paused ? Date.now() : (s.startedAt ?? Date.now()),
        paused: false,
        last: res,
        sessionOk: s.sessionOk + (isOk ? 1 : 0),
        sessionErr: s.sessionErr + (isOk ? 0 : 1),
      }));
      setTimeout(() => setFlash(null), 500);
      inputRef.current?.focus();
    },
    onError: (err: unknown) => {
      beepError();
      setFlash("error");
      setSession((s) => ({
        ...s,
        startedAt: s.paused ? Date.now() : (s.startedAt ?? Date.now()),
        paused: false,
        sessionErr: s.sessionErr + 1,
      }));
      setBloqueioErro(err instanceof Error ? err.message : "Falha no recebimento.");
      setTimeout(() => setFlash(null), 500);
    },
  });

  const concluirRessalvaMutation = useMutation({
    mutationFn: () => {
      if (!rotaSelecionada) {
        throw new Error("Selecione uma rota.");
      }

      return concluirRessalvaFn({
        data: {
          baseId,
          dataOperacional,
          rota: rotaSelecionada,
          motivo: motivoRessalva.trim(),
        },
      });
    },
    onSuccess: (resultado) => {
      qc.invalidateQueries({ queryKey: ["triagem-rotas", baseId, dataOperacional] });
      qc.invalidateQueries({
        queryKey: ["triagem-rota-operacao", baseId, dataOperacional, rotaSelecionada],
      });
      qc.invalidateQueries({
        queryKey: ["triagem-pendentes", baseId, dataOperacional],
      });

      setDialogRessalvaAberto(false);
      setMotivoRessalva("");
      setCodigo("");
      setSession((s) => ({ ...s, paused: true, startedAt: null }));

      toast.success(
        `Rota ${resultado.rota} concluída com ressalva — ${resultado.faltantes} item(ns) faltante(s).`,
        { duration: 7000 },
      );
    },
    onError: (erro: unknown) => {
      beepError();
      toast.error(erro instanceof Error ? erro.message : "Falha ao concluir a rota com ressalva.", {
        duration: 7000,
      });
    },
  });

  const localizarMutation = useMutation({
    mutationFn: (shipment: string) => localizarFn({ data: { baseId, dataOperacional, shipment } }),
    onSuccess: (resultado) => {
      setResultadoConsulta(resultado);
      if (resultado.encontrado) {
        toast.success(`Shipment pertence à rota ${resultado.rota}.`);
      } else {
        beepWarn();
        toast.warning(resultado.mensagem);
      }
    },
    onError: (erro: unknown) => {
      setResultadoConsulta(null);
      beepError();
      toast.error(erro instanceof Error ? erro.message : "Falha ao localizar shipment.");
    },
  });

  const consultarShipment = (valor: string) => {
    const normalizado = normalizarCodigoTriagem(valor);
    if (normalizado.length < 3) {
      toast.warning("Bipe ou digite um shipment válido.");
      return;
    }
    setShipmentConsulta(normalizado);
    setResultadoConsulta(null);
    localizarMutation.mutate(normalizado);
  };

  const submit = useCallback(
    (cod: string) => {
      if (paused) {
        toast.warning("Sessão pausada. Retome para bipar.");
        setCodigo("");
        return;
      }
      if (!rotaSelecionada) {
        toast.warning("Selecione a rota que será triada antes de bipar.");
        setCodigo("");
        return;
      }
      if (rotaConcluidaRessalva) {
        beepError();
        setBloqueioErro(
          `A rota ${rotaSelecionada} foi concluída com ressalva e está bloqueada para novas bipagens.`,
        );
        setCodigo("");
        return;
      }
      const normalizado = normalizarCodigoTriagem(cod);
      if (normalizado.length < 3) return;
      const ts = Date.now();
      if (
        lastRef.current &&
        lastRef.current.codigo === normalizado &&
        ts - lastRef.current.ts < DEDUPE_MS
      ) {
        setCodigo("");
        inputRef.current?.focus();
        return;
      }
      lastRef.current = { codigo: normalizado, ts };
      mutation.mutate(normalizado);
      setCodigo("");
    },
    [mutation, paused, rotaSelecionada, rotaConcluidaRessalva],
  );
  const processarLeituraCamera = useCallback((valor: string) => submit(valor), [submit]);

  // Mantém o foco no scanner sem roubar o foco de campos, diálogos ou formulários.
  useEffect(() => {
    const elementoEditavelAtivo = () => {
      const ativo = document.activeElement as HTMLElement | null;

      return Boolean(
        ativo?.closest("input, textarea, select, [contenteditable='true'], [role='textbox']"),
      );
    };

    const focarScanner = () => {
      if (!modoRota || dialogRessalvaAberto || rotaConcluidaRessalva || elementoEditavelAtivo()) {
        return;
      }

      inputRef.current?.focus();
    };

    focarScanner();

    const onClick = (evento: MouseEvent) => {
      const alvo = evento.target as HTMLElement | null;

      if (
        alvo?.closest(
          "button, a, input, textarea, select, [contenteditable='true'], [role='button'], [role='textbox'], [role='dialog']",
        )
      ) {
        return;
      }

      focarScanner();
    };

    const onKeyDown = (evento: KeyboardEvent) => {
      const alvo = evento.target as HTMLElement | null;

      if (
        dialogRessalvaAberto ||
        alvo?.closest(
          "input, textarea, select, [contenteditable='true'], [role='textbox'], [role='dialog']",
        )
      ) {
        return;
      }

      focarScanner();
    };

    window.addEventListener("click", onClick);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modoRota, dialogRessalvaAberto, rotaConcluidaRessalva]);

  const imprimirDetalheRota = useCallback(
    (
      rota: string,
      detalhe: {
        pendentes: Array<{ shipment: string; cidade: string | null }>;
        triados: Array<{ shipment: string; cidade: string | null }>;
      },
    ) => {
      const linhas = montarLinhasTriagemRota(detalhe);
      const totalRota = linhas.length;
      const totalTriados = detalhe.triados.length;
      const totalPendentes = detalhe.pendentes.length;
      const pctRota = totalRota ? Math.round((totalTriados / totalRota) * 100) : 0;
      const ok = abrirRelatorio<TriagemLinhaImpressao>({
        titulo: `Recebimento — Rota ${rota}`,
        subtitulo: `${base?.nome ?? ""} · ${dataOperacional ? new Date(dataOperacional + "T00:00:00").toLocaleDateString("pt-BR") : ""}`,
        nomeArquivo: `triagem_rota_${rota}_${dataOperacional}`,
        kpis: [
          { label: "Total da rota", value: totalRota },
          { label: "Recebidos", value: totalTriados },
          { label: "Pendentes", value: totalPendentes },
          { label: "Conclusão", value: `${pctRota}%` },
        ],
        colunas: [
          { header: "ID (Shipment)", value: (l) => l.shipment },
          { header: "Cidade", value: (l) => l.cidade ?? "" },
          { header: "Status", value: (l) => (l.status === "triado" ? "Recebido" : "Pendente") },
        ],
        linhas,
        autoPrint: true,
      });
      if (!ok) toast.error("Bloqueador de pop-up impediu abrir o relatório.");
    },
    [base?.nome, dataOperacional],
  );

  const imprimirRotaSelecionada = async () => {
    if (!rotaSelecionada) {
      toast.warning("Selecione uma rota para imprimir seus IDs.");
      return;
    }
    let detalhe = rotaOperacaoQuery.data ?? detalheQuery.data;
    if (!detalhe || detalhe.rota !== rotaSelecionada) {
      try {
        detalhe = await pendentesFn({
          data: { baseId, dataOperacional, rota: rotaSelecionada },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar rota.");
        return;
      }
    }
    if (!detalhe) return;
    imprimirDetalheRota(rotaSelecionada, detalhe);
  };

  const baixarCsvRotaSelecionada = async () => {
    if (!rotaSelecionada) return;
    let detalhe = rotaOperacaoQuery.data;
    if (!detalhe || detalhe.rota !== rotaSelecionada) {
      try {
        detalhe = await pendentesFn({
          data: { baseId, dataOperacional, rota: rotaSelecionada },
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao carregar rota.");
        return;
      }
    }
    const linhas = montarLinhasTriagemRota(detalhe);
    baixarCSV({
      titulo: `Recebimento — Rota ${rotaSelecionada}`,
      nomeArquivo: `triagem_rota_${rotaSelecionada}_${dataOperacional}`,
      colunas: [
        { header: "ID (Shipment)", value: (l) => l.shipment },
        { header: "Cidade", value: (l) => l.cidade ?? "" },
        { header: "Status", value: (l) => (l.status === "triado" ? "Recebido" : "Pendente") },
      ],
      linhas,
    });
  };

  const imprimirDetalheModal = () => {
    if (!rotaDetalhe || !detalheQuery.data) return;
    imprimirDetalheRota(rotaDetalhe, detalheQuery.data);
  };

  const pauseSession = () => {
    setSession((s) => {
      if (s.paused) return s;
      const add = s.startedAt ? Date.now() - s.startedAt : 0;
      return { ...s, paused: true, startedAt: null, accumulatedMs: s.accumulatedMs + add };
    });
    toast.info("Sessão pausada.");
  };
  const resumeSession = () => {
    setSession((s) => (s.paused ? { ...s, paused: false, startedAt: Date.now() } : s));
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const resetSession = () => {
    if (!window.confirm("Encerrar e zerar a sessão atual?")) return;
    setSession(defaultSession);
    lastRef.current = null;
  };

  const totalPrev = resumo.data?.totalPrevistos ?? 0;
  const totalTri = resumo.data?.totalTriados ?? 0;
  const pendentes = resumo.data?.pendentes ?? 0;
  const pct = totalPrev ? Math.round((totalTri / totalPrev) * 100) : 0;
  const ultimoDiaImportado = diasImportados.data?.find((dia) => dia.versao_ativa != null) ?? null;
  const diaSemImportacao =
    resumo.data?.temImportacao === false &&
    !!ultimoDiaImportado &&
    ultimoDiaImportado.data_operacional !== dataOperacional;

  useEffect(() => {
    if (!diaSemImportacao || !ultimoDiaImportado) return;

    const chave = `${baseId}:${dataOperacional}->${ultimoDiaImportado.data_operacional}`;
    if (autoAjusteDiaRef.current === chave) return;

    autoAjusteDiaRef.current = chave;
    trocarDia(ultimoDiaImportado.data_operacional);
    toast.info(
      `Recebimento ajustado para o último dia importado da base ${base?.codigo ?? ""}: ${new Date(
        ultimoDiaImportado.data_operacional + "T00:00:00",
      ).toLocaleDateString("pt-BR")}.`,
    );
  }, [base?.codigo, baseId, dataOperacional, diaSemImportacao, trocarDia, ultimoDiaImportado]);

  const flashClass = flash === "ok" ? "scan-flash-ok" : flash === "error" ? "scan-flash-error" : "";

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <ErroBloqueioOverlay
        mensagem={bloqueioErro}
        onOk={() => {
          setBloqueioErro(null);
          setCodigo("");
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      />
      {!modoRota ? (
        <>
          {/* KPIs gerais */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Kpi
              icon={PackageCheck}
              label="Volumes recebidos"
              value={totalTri.toLocaleString("pt-BR")}
              tone="success"
            />
            <Kpi
              icon={PackageX}
              label="Pendentes"
              value={pendentes.toLocaleString("pt-BR")}
              tone="warning"
            />
            <Kpi icon={Percent} label="Conclusão" value={`${pct}%`} tone="primary" />
            <Kpi
              icon={Package}
              label="Meus hoje"
              value={(resumo.data?.meusHoje ?? 0).toLocaleString("pt-BR")}
            />
          </div>
          <Progress value={pct} className="h-2" />

          {diaSemImportacao && (
            <Card className="p-4 border-warning/40 bg-warning/5 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-start gap-3 text-sm">
                <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">Não há escala ativa neste dia operacional.</div>
                  <div className="text-muted-foreground">
                    Última importação da base:{" "}
                    {new Date(ultimoDiaImportado.data_operacional + "T00:00:00").toLocaleDateString(
                      "pt-BR",
                    )}{" "}
                    · {ultimoDiaImportado.total_linhas.toLocaleString("pt-BR")} IDs ·{" "}
                    {ultimoDiaImportado.total_rotas.toLocaleString("pt-BR")} rotas.
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => trocarDia(ultimoDiaImportado.data_operacional)}
              >
                Usar último dia importado
              </Button>
            </Card>
          )}

          <Card className="p-4 md:p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
              <div>
                <h2 className="font-display text-sm uppercase tracking-wider font-semibold">
                  Localizar rota pelo shipment
                </h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Bipe a etiqueta para descobrir a rota na base e no dia operacional atuais.
                </p>
              </div>
              <Search className="w-5 h-5 text-muted-foreground" />
            </div>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={(evento) => {
                evento.preventDefault();
                consultarShipment(shipmentConsulta);
              }}
            >
              <Input
                value={shipmentConsulta}
                onChange={(evento) => {
                  setShipmentConsulta(evento.target.value);
                  setResultadoConsulta(null);
                }}
                placeholder="Bipe ou digite o ID (shipment)…"
                className="font-mono h-12 text-base"
                autoComplete="off"
                spellCheck={false}
              />
              <Button type="submit" className="h-12 gap-2" disabled={localizarMutation.isPending}>
                {localizarMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                Localizar
              </Button>
              {modoColetor && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 gap-2"
                  onClick={() => setCameraAberta(true)}
                  disabled={localizarMutation.isPending}
                >
                  <Camera className="h-5 w-5" />
                  Ler com a câmera
                </Button>
              )}
            </form>

            {modoColetor && (
              <CameraBarcodeDialog
                open={cameraAberta}
                onOpenChange={setCameraAberta}
                onScan={consultarShipment}
              />
            )}

            {resultadoConsulta && (
              <div
                className={`mt-3 rounded-md border p-3 flex items-center justify-between gap-3 flex-wrap ${
                  resultadoConsulta.encontrado
                    ? "border-primary/40 bg-primary/5"
                    : "border-warning/40 bg-warning/5"
                }`}
              >
                {resultadoConsulta.encontrado ? (
                  <>
                    <div>
                      <div className="text-xs text-muted-foreground">Shipment</div>
                      <div className="font-mono font-semibold">{resultadoConsulta.shipment}</div>
                      <div className="mt-1 text-sm">
                        Rota <b className="font-mono text-lg">{resultadoConsulta.rota}</b>
                        {resultadoConsulta.cidade ? ` · ${resultadoConsulta.cidade}` : ""}
                        {resultadoConsulta.triado && (
                          <Badge variant="secondary" className="ml-2">
                            Já recebido
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button onClick={() => abrirRota(resultadoConsulta.rota)} className="gap-2">
                      Abrir rota <ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <div>
                    <div className="font-mono font-semibold">{resultadoConsulta.shipment}</div>
                    <div className="text-sm text-muted-foreground">
                      {resultadoConsulta.mensagem}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Seletor de rota */}
          <RotasSelector
            rotas={rotas.data ?? []}
            selecionada={rotaSelecionada}
            onAbrir={abrirRota}
            onDetalhes={(r) => setRotaDetalhe(r)}
            loading={rotas.isLoading}
            error={rotas.error}
            onRetry={() => void rotas.refetch()}
          />
        </>
      ) : (
        <Card
          className={`p-4 md:p-6 border-2 ${
            rotaConcluidaRessalva
              ? "border-amber-500 bg-amber-50/80"
              : rotaAtual?.percentual === 100
                ? "border-success bg-success/5"
                : "border-destructive bg-destructive/5"
          }`}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={voltarParaRotas} className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Todas as rotas
              </Button>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  Rota em operação
                </div>
                <h1 className="text-2xl md:text-3xl font-bold break-words">{nomeRotaAtual}</h1>
                <p className="font-mono text-xs text-muted-foreground mt-1">
                  ID da rota: {rotaSelecionada}
                </p>
              </div>
            </div>
            <Badge
              className={
                rotaConcluidaRessalva
                  ? "bg-amber-500 text-white"
                  : rotaAtual?.percentual === 100
                    ? "bg-success text-success-foreground"
                    : "bg-destructive text-destructive-foreground"
              }
            >
              {rotaConcluidaRessalva
                ? "Concluída com ressalva"
                : rotaAtual?.percentual === 100
                  ? "100% concluída"
                  : "Incompleta"}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 text-center">
            <div>
              <div className="text-xs text-muted-foreground">Previstos</div>
              <b className="text-xl">{rotaAtual?.previstos ?? 0}</b>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Recebidos</div>
              <b className="text-xl">{rotaAtual?.triados ?? 0}</b>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Faltando</div>
              <b
                className={`text-xl ${
                  rotaConcluidaRessalva ? "text-amber-700" : "text-destructive"
                }`}
              >
                {rotaAtual?.pendentes ?? 0}
              </b>
            </div>
          </div>
          <Progress
            value={rotaAtual?.percentual ?? 0}
            className={`h-3 mt-4 ${
              rotaConcluidaRessalva
                ? "bg-amber-200 [&>div]:bg-amber-500"
                : rotaAtual?.percentual === 100
                  ? "bg-success/20 [&>div]:bg-success"
                  : "bg-destructive/20 [&>div]:bg-destructive"
            }`}
          />

          {rotaConcluidaRessalva && rotaAtual?.conclusaoRessalva ? (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-100/80 p-3">
              <div className="flex items-center gap-2 font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                Concluída com ressalva
              </div>
              <p className="mt-1 text-sm text-amber-900">
                Motivo: {rotaAtual.conclusaoRessalva.motivo}
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Finalizada em{" "}
                {new Date(rotaAtual.conclusaoRessalva.concluidaEm).toLocaleString("pt-BR")} ·{" "}
                {rotaAtual.conclusaoRessalva.faltantes} item(ns) faltante(s)
              </p>
            </div>
          ) : rotaAtual && rotaAtual.percentual < 100 ? (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="gap-2 border-amber-500 text-amber-700 hover:bg-amber-50"
                onClick={() => setDialogRessalvaAberto(true)}
              >
                <AlertTriangle className="h-4 w-4" />
                Concluir com itens faltantes
              </Button>
            </div>
          ) : null}
        </Card>
      )}

      {/* Scanner + status */}
      {modoRota && (
        <>
          <div className="grid md:grid-cols-3 gap-6">
            <Card className={`md:col-span-2 p-6 md:p-10 ${flashClass} transition-colors`}>
              <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-md brand-gradient flex items-center justify-center">
                    <ScanLine className="w-5 h-5 text-[var(--brand-yellow)]" />
                  </div>
                  <div>
                    <h1 className="font-display text-2xl md:text-3xl font-bold leading-tight">
                      Recebimento de Volumes
                    </h1>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      {paused
                        ? "Sessão pausada."
                        : "A sessão inicia automaticamente na primeira leitura."}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {paused ? (
                    <Button
                      onClick={resumeSession}
                      className="gap-2"
                      disabled={rotaConcluidaRessalva}
                    >
                      <Play className="w-4 h-4" />
                      Retomar
                    </Button>
                  ) : (
                    <Button
                      onClick={pauseSession}
                      variant="secondary"
                      className="gap-2"
                      disabled={!startedAt && accumulatedMs === 0}
                    >
                      <Pause className="w-4 h-4" />
                      Pausar
                    </Button>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" className="gap-2">
                        <Download className="w-4 h-4" />
                        Baixar
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={imprimirRotaSelecionada}>
                        <Printer className="w-4 h-4 mr-2" /> Imprimir rota
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={baixarCsvRotaSelecionada}>
                        <FileSpreadsheet className="w-4 h-4 mr-2" /> Excel da rota
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button onClick={imprimirRotaSelecionada} variant="secondary" className="gap-2">
                    <Printer className="w-4 h-4" />
                    Imprimir
                  </Button>
                  {(sessionOk > 0 || sessionErr > 0 || last) && (
                    <Button onClick={resetSession} variant="ghost" size="icon" title="Zerar sessão">
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              {modoColetor && (
                <Button
                  type="button"
                  variant="outline"
                  className="mb-3 h-14 w-full gap-2 text-base"
                  onClick={() => setCameraAberta(true)}
                  disabled={!rotaSelecionada || rotaConcluidaRessalva}
                >
                  <Camera className="h-5 w-5" />
                  Ler código de barras com a câmera
                </Button>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submit(codigo);
                }}
              >
                <Input
                  ref={inputRef}
                  value={codigo}
                  onChange={(e) => {
                    const leitura = e.target.value;
                    setCodigo(leitura);
                    if (leituraQrMeliCompleta(leitura)) submit(leitura);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Tab") {
                      e.preventDefault();
                      submit(codigo);
                    }
                  }}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={
                    rotaConcluidaRessalva
                      ? `Rota ${rotaSelecionada} — concluída com ressalva`
                      : rotaSelecionada
                        ? `Rota ${rotaSelecionada} — aguardando leitura…`
                        : "Selecione uma rota para começar…"
                  }
                  className="h-20 md:h-24 text-3xl md:text-4xl font-mono tracking-widest text-center"
                  disabled={!rotaSelecionada || rotaConcluidaRessalva}
                />
              </form>

              <CameraBarcodeDialog
                open={cameraAberta}
                onOpenChange={setCameraAberta}
                onScan={processarLeituraCamera}
              />

              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Sessão: <span className="text-success font-semibold">{sessionOk} OK</span> ·{" "}
                  <span className="text-destructive font-semibold">{sessionErr} erros</span>
                </span>
                {last?.hora && (
                  <span>Última: {new Date(last.hora).toLocaleTimeString("pt-BR")}</span>
                )}
              </div>
            </Card>

            <UltimoCard last={last} progressoRota={rotaAtual} />
          </div>

          <Card className="p-4 md:p-6">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground">
                Conferência da rota {rotaSelecionada}
              </h2>
              <span className="text-xs text-muted-foreground">
                {rotaOperacaoQuery.isFetching ? "Atualizando…" : "Atualização automática"}
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <ListaShipments
                titulo="Faltando"
                tone="destructive"
                linhas={rotaOperacaoQuery.data?.pendentes ?? []}
              />
              <ListaShipments
                titulo="Recebidos"
                tone="success"
                linhas={rotaOperacaoQuery.data?.triados ?? []}
              />
            </div>
          </Card>
        </>
      )}
      <Dialog
        open={dialogRessalvaAberto}
        onOpenChange={(aberto) => {
          setDialogRessalvaAberto(aberto);
          if (!aberto) setMotivoRessalva("");
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Concluir rota com itens faltantes</DialogTitle>
            <DialogDescription>
              A rota {rotaSelecionada} possui {rotaAtual?.pendentes ?? 0} item(ns) faltante(s).
              Informe obrigatoriamente o motivo da conclusão. Os shipment IDs não localizados serão
              preservados na auditoria como divergência de Recebimento, sem marcação LOST.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label htmlFor="motivo-ressalva" className="text-sm font-medium">
              Motivo da conclusão <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="motivo-ressalva"
              value={motivoRessalva}
              onChange={(e) => setMotivoRessalva(e.target.value)}
              placeholder="Ex.: itens não localizados após conferência física e validação com a liderança."
              rows={5}
              maxLength={1000}
              autoFocus
            />
            <div className="text-right text-xs text-muted-foreground">
              {motivoRessalva.trim().length}/1000
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogRessalvaAberto(false)}
              disabled={concluirRessalvaMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={() => concluirRessalvaMutation.mutate()}
              disabled={motivoRessalva.trim().length < 5 || concluirRessalvaMutation.isPending}
            >
              {concluirRessalvaMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <AlertTriangle className="mr-2 h-4 w-4" />
              )}
              Concluir com ressalva
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <RotaDetalheDialog
        rota={rotaDetalhe}
        onClose={() => setRotaDetalhe(null)}
        data={detalheQuery.data}
        loading={detalheQuery.isFetching}
        onImprimir={imprimirDetalheModal}
      />
    </div>
  );
}

function ListaShipments({
  titulo,
  tone,
  linhas,
}: {
  titulo: string;
  tone: "success" | "destructive";
  linhas: Array<{ shipment: string; cidade: string | null }>;
}) {
  const toneClass = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className="min-w-0">
      <div className={`text-xs uppercase tracking-wider font-semibold mb-2 ${toneClass}`}>
        {titulo} ({linhas.length})
      </div>
      <div className="border rounded-md max-h-[38vh] overflow-auto divide-y">
        {linhas.length === 0 ? (
          <div className="px-3 py-6 text-sm text-center text-muted-foreground">Nenhum item.</div>
        ) : (
          linhas.map((item) => (
            <div
              key={item.shipment}
              className="px-3 py-2 text-sm flex items-center justify-between gap-2 min-w-0"
            >
              <span className="font-mono font-medium truncate">{item.shipment}</span>
              <span className="text-xs text-muted-foreground truncate">{item.cidade ?? ""}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: "success" | "warning" | "primary";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "primary"
          ? "text-primary"
          : "text-foreground";
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        <Icon className={`w-4 h-4 ${toneCls}`} />
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl md:text-3xl font-bold ${toneCls}`}>{value}</div>
    </Card>
  );
}

function UltimoCard({
  last,
  progressoRota,
}: {
  last: TriagemResult | null;
  progressoRota: RotaResumo | null;
}) {
  const progressoAtual =
    last?.rota && progressoRota?.rota === last.rota.codigo
      ? {
          quantidade_triada: progressoRota.triados,
          quantidade_prevista: progressoRota.previstos,
          percentual_triagem: progressoRota.percentual,
        }
      : last?.rota
        ? {
            quantidade_triada: last.rota.quantidade_triada,
            quantidade_prevista: last.rota.quantidade_prevista,
            percentual_triagem: last.rota.percentual_triagem,
          }
        : null;
  const status = (() => {
    if (!last) return null;
    if (last.resultado === "ok")
      return {
        tag:
          progressoAtual && progressoAtual.quantidade_triada >= progressoAtual.quantidade_prevista
            ? "Rota completa"
            : "Recebido com sucesso",
        icon: CheckCircle2,
        color: "bg-success text-success-foreground",
      };
    if (last.resultado === "duplicado")
      return {
        tag: "Já recebido",
        icon: AlertTriangle,
        color: "bg-warning text-warning-foreground",
      };
    return {
      tag: labelRes(last.resultado),
      icon: XCircle,
      color: "bg-destructive text-destructive-foreground",
    };
  })();

  if (!last || !status) {
    return (
      <Card className="p-6 border-dashed flex items-center justify-center text-center">
        <div className="text-sm text-muted-foreground">A última leitura aparecerá aqui.</div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          Último código lido
        </div>
        <Badge
          className={`${status.color} text-[10px] font-semibold uppercase tracking-wider px-2 py-1`}
        >
          <status.icon className="w-3 h-3 mr-1" />
          {status.tag}
        </Badge>
      </div>
      <div className="font-mono text-lg md:text-xl font-bold break-all">
        {last.volume?.codigo ?? "—"}
      </div>
      {last.rota && progressoAtual && (
        <div className="mt-4 space-y-3">
          <div className="text-xs text-muted-foreground">
            Rota <span className="font-mono font-semibold">{last.rota.codigo}</span>
            {last.rota.rota_final ? ` · ${last.rota.rota_final}` : ""} ·{" "}
            {last.rota.base_codigo ?? "?"}
          </div>
          <div>
            <div className="flex items-end justify-between text-xs mb-1">
              <span className="text-muted-foreground uppercase tracking-wider">
                Progresso da rota
              </span>
              <span className="font-mono">
                <span className="font-bold">{progressoAtual.quantidade_triada}</span>/
                {progressoAtual.quantidade_prevista} · {progressoAtual.percentual_triagem}%
              </span>
            </div>
            <Progress value={progressoAtual.percentual_triagem} className="h-2" />
          </div>
        </div>
      )}
      <div className="mt-4 text-sm">
        {last.resultado === "ok" && last.rota && progressoAtual
          ? `Shipment recebido — rota ${last.rota.codigo} (${progressoAtual.quantidade_triada}/${progressoAtual.quantidade_prevista}).`
          : last.mensagem}
      </div>
    </Card>
  );
}

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorInstance = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorInstance;

function CameraBarcodeDialog({
  open,
  onOpenChange,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (valor: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const onOpenChangeRef = useRef(onOpenChange);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    let ativo = true;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    const iniciar = async () => {
      const Detector = (window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor })
        .BarcodeDetector;
      if (!Detector) {
        setErro(
          "Este navegador não oferece leitura pela câmera. Use o Chrome atualizado ou o leitor físico.",
        );
        return;
      }
      try {
        setErro(null);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (!ativo || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({
          formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix"],
        });
        timer = setInterval(async () => {
          const video = videoRef.current;
          if (!ativo || !video || video.readyState < 2) return;
          try {
            const resultados = await detector.detect(video);
            const valor = resultados.find((r) => r.rawValue)?.rawValue;
            if (!valor) return;
            ativo = false;
            onOpenChangeRef.current(false);
            onScanRef.current(valor);
          } catch {
            // Continua procurando enquanto a câmera estiver aberta.
          }
        }, 250);
      } catch {
        setErro(
          "Não foi possível abrir a câmera. Autorize o acesso à câmera nas configurações do navegador.",
        );
      }
    };

    void iniciar();
    return () => {
      ativo = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4">
        <DialogHeader>
          <DialogTitle>Ler código de barras</DialogTitle>
          <DialogDescription>Aponte a câmera traseira para o código da etiqueta.</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-[3/4] overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-x-8 top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white shadow-[0_0_0_999px_rgba(0,0,0,0.25)]" />
        </div>
        {erro && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{erro}</p>
        )}
        <Button variant="outline" className="h-12" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function labelRes(r: TriagemResult["resultado"]) {
  switch (r) {
    case "inexistente":
      return "Não encontrado";
    case "nao_recebido":
      return "Não recebido";
    case "outra_base":
      return "Outra base";
    case "outra_data":
      return "Outra data";
    case "outra_expedicao":
      return "Outra expedição";
    case "rota_divergente":
      return "Outra rota";
    case "cancelada":
      return "Cancelada";
    case "encerrada":
      return "Encerrada";
    default:
      return r;
  }
}

type RotaResumo = {
  rota: string;
  nome_operacional?: string;
  previstos: number;
  triados: number;
  pendentes: number;
  percentual: number;
  status: "aberta" | "fechada" | "concluida_ressalva";
  conclusaoRessalva?: {
    motivo: string;
    concluidaEm: string;
    concluidaPor: string;
    faltantes: number;
  };
};

function RotasSelector({
  rotas,
  selecionada,
  onAbrir,
  onDetalhes,
  loading,
  error,
  onRetry,
}: {
  rotas: RotaResumo[];
  selecionada: string | null;
  onAbrir: (rota: string) => void;
  onDetalhes: (rota: string) => void;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  const abertas = rotas.filter((r) => r.status === "aberta");
  const ressalvas = rotas.filter((r) => r.status === "concluida_ressalva");
  const fechadas = rotas.filter((r) => r.status === "fechada");
  return (
    <Card className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground">
            Rotas do dia
          </h2>
          <p className="text-xs text-muted-foreground">
            Escolha a rota que será triada. A rota permanece aberta até bater 100%.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="border-warning text-warning">
            {abertas.length} abertas
          </Badge>
          <Badge variant="outline" className="border-amber-500 text-amber-700">
            {ressalvas.length} com ressalva
          </Badge>
          <Badge variant="outline" className="border-success text-success">
            {fechadas.length} fechadas
          </Badge>
        </div>
      </div>
      {error && rotas.length === 0 ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Não foi possível carregar as rotas agora.
          </div>
          <p className="mt-1 text-muted-foreground">
            {error.message.includes("statement timeout")
              ? "A consulta demorou demais. Tente novamente; o carregamento foi otimizado para não repetir a falha."
              : error.message}
          </p>
          <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : loading && rotas.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">Carregando rotas…</div>
      ) : rotas.length === 0 ? (
        <div className="text-sm text-muted-foreground py-6 text-center">
          Nenhuma rota importada para esta base/dia.
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {[...abertas, ...ressalvas, ...fechadas].map((r) => {
            const isSel = r.rota === selecionada;
            const fechada = r.status === "fechada";
            const comRessalva = r.status === "concluida_ressalva";
            return (
              <button
                key={r.rota}
                type="button"
                onClick={() => onAbrir(r.rota)}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDetalhes(r.rota);
                }}
                title="Duplo clique para ver IDs faltantes"
                className={`text-left rounded-md border p-3 transition-colors ${
                  isSel
                    ? "border-primary bg-primary/5 ring-2 ring-primary"
                    : comRessalva
                      ? "border-amber-500/70 bg-amber-50 hover:bg-amber-100"
                      : fechada
                        ? "border-success/50 bg-success/5 hover:bg-success/10"
                        : "border-destructive/50 bg-destructive/10 hover:bg-destructive/15"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <div className="font-mono font-bold text-sm truncate" title={r.nome_operacional ?? r.rota}>
                      {nomenclaturaRota({ nome_operacional: r.nome_operacional, route_id: r.rota })}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground truncate" title={r.rota}>
                      ID: {r.rota}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      className={`text-[10px] px-1.5 py-0 ${
                        comRessalva
                          ? "bg-amber-500 text-white"
                          : fechada
                            ? "bg-success text-success-foreground"
                            : "bg-destructive text-destructive-foreground"
                      }`}
                    >
                      {comRessalva ? "Com ressalva" : fechada ? "Fechada" : "Aberta"}
                    </Badge>
                    <span
                      role="button"
                      tabIndex={-1}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDetalhes(r.rota);
                      }}
                      className="p-1 rounded hover:bg-muted-foreground/10 text-muted-foreground"
                      title="Ver IDs faltantes"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
                <div className="font-mono text-lg font-bold">
                  {r.triados}
                  <span className="text-muted-foreground text-sm font-normal">/{r.previstos}</span>
                </div>
                <Progress
                  value={r.percentual}
                  className={`h-1.5 mt-2 ${
                    comRessalva
                      ? "bg-amber-200 [&>div]:bg-amber-500"
                      : fechada
                        ? "bg-success/20 [&>div]:bg-success"
                        : "bg-destructive/20 [&>div]:bg-destructive"
                  }`}
                />
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function RotaDetalheDialog({
  rota,
  onClose,
  data,
  loading,
  onImprimir,
}: {
  rota: string | null;
  onClose: () => void;
  data:
    | {
        rota: string;
        pendentes: Array<{ shipment: string; cidade: string | null }>;
        triados: Array<{ shipment: string; cidade: string | null }>;
      }
    | undefined;
  loading: boolean;
  onImprimir: () => void;
}) {
  const copiar = () => {
    if (!data) return;
    const txt = data.pendentes.map((p) => p.shipment).join("\n");
    navigator.clipboard.writeText(txt).then(
      () => toast.success("IDs faltantes copiados."),
      () => toast.error("Não foi possível copiar."),
    );
  };
  const podeImprimir = !!data && !loading;
  return (
    <Dialog open={!!rota} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono">Rota {rota}</DialogTitle>
          <DialogDescription>
            Shipments pendentes (não bipados) e já recebidos desta rota.
          </DialogDescription>
        </DialogHeader>
        {loading && !data ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : !data ? null : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="min-w-0">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="text-xs uppercase tracking-wider font-semibold text-warning">
                  Faltando ({data.pendentes.length})
                </div>
                <div className="flex items-center gap-1">
                  {data.pendentes.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={copiar}
                      className="h-7 gap-1 text-xs"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onImprimir}
                    disabled={!podeImprimir}
                    className="h-7 gap-1 text-xs"
                  >
                    <Printer className="w-3 h-3" /> Imprimir rota
                  </Button>
                </div>
              </div>
              <div className="border rounded-md max-h-[32vh] md:max-h-[50vh] overflow-auto divide-y">
                {data.pendentes.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    Nenhum pendente — rota completa.
                  </div>
                ) : (
                  data.pendentes.map((p) => (
                    <div
                      key={p.shipment}
                      className="px-3 py-1.5 text-sm flex items-center justify-between gap-2 min-w-0"
                    >
                      <span className="font-mono truncate">{p.shipment}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[45%] text-right">
                        {p.cidade ?? ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider font-semibold text-success mb-2">
                Recebidos ({data.triados.length})
              </div>
              <div className="border rounded-md max-h-[32vh] md:max-h-[50vh] overflow-auto divide-y">
                {data.triados.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">Nenhum recebido ainda.</div>
                ) : (
                  data.triados.map((p) => (
                    <div
                      key={p.shipment}
                      className="px-3 py-1.5 text-sm flex items-center justify-between gap-2 min-w-0"
                    >
                      <span className="font-mono truncate">{p.shipment}</span>
                      <span className="text-xs text-muted-foreground truncate max-w-[45%] text-right">
                        {p.cidade ?? ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2 border-t pt-3">
          <Button onClick={onImprimir} disabled={!podeImprimir} className="gap-2">
            <Printer className="w-4 h-4" /> Imprimir rota
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  r,
}: {
  r: {
    id: string;
    codigo_bipado: string;
    resultado: string;
    created_at: string;
    mensagem: string | null;
    rotas: { codigo: string } | null;
  };
}) {
  const dot =
    r.resultado === "ok"
      ? "bg-success"
      : r.resultado === "duplicado"
        ? "bg-warning"
        : "bg-destructive";
  return (
    <div className="py-2.5 flex items-center gap-3 text-sm">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} />
      <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
        {new Date(r.created_at).toLocaleTimeString("pt-BR")}
      </span>
      <span className="font-mono text-xs truncate max-w-[200px]">{r.codigo_bipado}</span>
      <span className="text-xs text-muted-foreground hidden md:block truncate flex-1">
        {r.rotas?.codigo ? `${r.rotas.codigo} · ` : ""}
        {r.mensagem}
      </span>
    </div>
  );
}
