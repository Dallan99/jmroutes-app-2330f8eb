import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const TRANSFERENCIA_ETAPAS = [
  { value: "chegada_service", label: "Chegada no Service" },
  { value: "saida_service", label: "Saída do Service" },
  { value: "chegada_xpt", label: "Chegada no XPT" },
  { value: "saida_xpt", label: "Saída do XPT" },
] as const;

export const TRANSFERENCIA_ETAPAS_ATIVAS = TRANSFERENCIA_ETAPAS.filter(
  (e) => e.value !== "saida_xpt",
);


export const TRANSFERENCIA_STATUS = [
  { value: "aguardando_chegada_service", label: "Aguardando chegada no Service" },
  { value: "no_service", label: "No Service / carregando" },
  { value: "em_transito_xpt", label: "Em trânsito para o XPT" },
  { value: "no_xpt", label: "No XPT" },
  { value: "concluida_no_prazo", label: "Concluída no prazo" },
  { value: "concluida_com_atraso", label: "Concluída com atraso" },
  { value: "pendente_evidencia", label: "Pendente de evidência" },
  { value: "em_analise", label: "Em análise" },
  { value: "cancelada", label: "Cancelada" },
] as const;

export const RESPONSABILIDADES = [
  { value: "JM_FROTA", label: "JM / Frota" },
  { value: "MELI", label: "Mercado Livre" },
  { value: "EXTERNO", label: "Fator externo" },
  { value: "EM_ANALISE", label: "Em análise" },
] as const;

export type TransferenciaEtapa = (typeof TRANSFERENCIA_ETAPAS)[number]["value"];
export type TransferenciaResponsabilidade = (typeof RESPONSABILIDADES)[number]["value"];

export type TransferenciaMotivo = {
  id: string;
  codigo: string;
  nome: string;
  responsabilidade: TransferenciaResponsabilidade;
  etapa: TransferenciaEtapa | null;
  exige_descricao: boolean;
  ordem: number;
};

export type TransferenciaEvento = {
  id: string;
  etapa: TransferenciaEtapa;
  ocorrido_em: string;
  localizacao_texto: string | null;
  minutos_atraso: number;
  registrado_por: string;
};

export type TransferenciaOcorrencia = {
  id: string;
  evento_id: string;
  etapa: TransferenciaEtapa;
  motivo_id: string | null;
  responsabilidade: string;
  minutos_atraso: number;
  observacao: string | null;
};

export type TransferenciaEvidencia = {
  id: string;
  evento_id: string;
  etapa: TransferenciaEtapa;
  storage_path: string | null;
  timemark_url: string | null;
  horario_evidencia: string | null;
  localizacao_texto: string | null;
  status: string;
  signed_url: string | null;
};

export type TransferenciaDetalhe = {
  id: string;
  codigo: string;
  base_id: string;
  base_codigo: string;
  base_nome: string;
  data_operacional: string;
  service: string;
  motorista: string;
  placa: string;
  tipo_veiculo: string | null;
  status: string;
  observacao: string | null;
  criado_por: string;
  finalizada_em: string | null;
  cancelada_em: string | null;
  cancelamento_motivo: string | null;
  created_at: string;
  updated_at: string;
  eventos: TransferenciaEvento[];
  ocorrencias: TransferenciaOcorrencia[];
  evidencias: TransferenciaEvidencia[];
};

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const filtrosSchema = z
  .object({
    inicio: dateSchema,
    fim: dateSchema,
    baseId: z.string().uuid().optional(),
    service: z.string().trim().max(120).optional(),
    motorista: z.string().trim().max(160).optional(),
    placa: z.string().trim().max(20).optional(),
    status: z.string().max(60).optional(),
    responsabilidade: z.string().max(40).optional(),
    motivoId: z.string().uuid().optional(),
  })
  .refine((v) => v.inicio <= v.fim, { message: "Período inválido." })
  .refine(
    (v) =>
      Math.round(
        (Date.parse(`${v.fim}T00:00:00Z`) - Date.parse(`${v.inicio}T00:00:00Z`)) / 86_400_000,
      ) <= 93,
    { message: "Selecione um período de até 93 dias." },
  );

export type TransferenciaFiltros = z.infer<typeof filtrosSchema>;

export const listarMotivosTransferencia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TransferenciaMotivo[]> => {
    const { data, error } = await clienteDeModulo(context.supabase)
      .from("transferencia_motivos")
      .select("id, codigo, nome, responsabilidade, etapa, exige_descricao, ordem")
      .eq("ativo", true)
      .order("ordem", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as TransferenciaMotivo[];
  });

export const listarTransferencias = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtrosSchema.parse(input))
  .handler(async ({ data: filtros, context }): Promise<TransferenciaDetalhe[]> => {
    const supabase = clienteDeModulo(context.supabase);
    type TransferenciaRow = Omit<
      TransferenciaDetalhe,
      "base_codigo" | "base_nome" | "eventos" | "ocorrencias" | "evidencias"
    >;
    const transferencias: TransferenciaRow[] = [];
    const page = 1000;
    for (let pagina = 0; pagina < 100; pagina++) {
      let query = supabase
        .from("transferencias")
        .select(
          "id, codigo, base_id, data_operacional, service, motorista, placa, tipo_veiculo, status, observacao, criado_por, finalizada_em, cancelada_em, cancelamento_motivo, created_at, updated_at",
        )
        .gte("data_operacional", filtros.inicio)
        .lte("data_operacional", filtros.fim)
        .order("data_operacional", { ascending: false })
        .order("created_at", { ascending: false })
        .range(pagina * page, pagina * page + page - 1);

      if (filtros.baseId) query = query.eq("base_id", filtros.baseId);
      if (filtros.service) query = query.ilike("service", `%${filtros.service}%`);
      if (filtros.motorista) query = query.ilike("motorista", `%${filtros.motorista}%`);
      if (filtros.placa) query = query.ilike("placa", `%${filtros.placa}%`);
      if (filtros.status) query = query.eq("status", filtros.status);

      const { data: paginaRows, error } = await query;
      if (error) throw new Error(error.message);
      transferencias.push(...((paginaRows ?? []) as TransferenciaRow[]));
      if (!paginaRows || paginaRows.length < page) break;
      if (pagina === 99) {
        throw new Error(
          "Mais de 100 mil transferências no período. Reduza o intervalo do relatório.",
        );
      }
    }
    if (!transferencias.length) return [];

    const ids = transferencias.map((t) => t.id);
    const baseIds = Array.from(new Set(transferencias.map((t) => t.base_id)));
    const { data: bases, error: basesError } = await supabase
      .from("bases")
      .select("id, codigo, nome")
      .in("id", baseIds);
    if (basesError) throw new Error(basesError.message);

    type EventoRaw = TransferenciaEvento & { transferencia_id: string };
    type OcorrenciaRaw = TransferenciaOcorrencia & { transferencia_id: string };
    type EvidenciaRaw = Omit<TransferenciaEvidencia, "signed_url"> & {
      transferencia_id: string;
    };
    const eventos: EventoRaw[] = [];
    const ocorrencias: OcorrenciaRaw[] = [];
    const evidencias: EvidenciaRaw[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const lote = ids.slice(i, i + 200);
      const [eventosRes, ocorrenciasRes, evidenciasRes] = await Promise.all([
        supabase
          .from("transferencia_eventos")
          .select(
            "id, transferencia_id, etapa, ocorrido_em, localizacao_texto, minutos_atraso, registrado_por",
          )
          .in("transferencia_id", lote)
          .order("ocorrido_em", { ascending: true }),
        supabase
          .from("transferencia_ocorrencias")
          .select(
            "id, transferencia_id, evento_id, etapa, motivo_id, responsabilidade, minutos_atraso, observacao",
          )
          .in("transferencia_id", lote),
        supabase
          .from("transferencia_evidencias")
          .select(
            "id, transferencia_id, evento_id, etapa, storage_path, timemark_url, horario_evidencia, localizacao_texto, status",
          )
          .in("transferencia_id", lote)
          .is("substituida_por", null),
      ]);
      if (eventosRes.error) throw new Error(eventosRes.error.message);
      if (ocorrenciasRes.error) throw new Error(ocorrenciasRes.error.message);
      if (evidenciasRes.error) throw new Error(evidenciasRes.error.message);
      eventos.push(...((eventosRes.data ?? []) as EventoRaw[]));
      ocorrencias.push(...((ocorrenciasRes.data ?? []) as OcorrenciaRaw[]));
      evidencias.push(...((evidenciasRes.data ?? []) as EvidenciaRaw[]));
    }

    const ocorrFiltradas = ocorrencias.filter(
      (o) =>
        (!filtros.responsabilidade || o.responsabilidade === filtros.responsabilidade) &&
        (!filtros.motivoId || o.motivo_id === filtros.motivoId),
    );
    const idsPorOcorrencia = new Set(ocorrFiltradas.map((o) => o.transferencia_id));
    const filtrarPorOcorrencia = !!filtros.responsabilidade || !!filtros.motivoId;
    const baseMap = new Map((bases ?? []).map((b) => [b.id, b]));

    const evidenciasComUrl = await Promise.all(
      evidencias.map(async (e) => {
        let signedUrl: string | null = null;
        if (e.storage_path) {
          const { data: signed } = await supabase.storage
            .from("transferencias-evidencias")
            .createSignedUrl(e.storage_path, 3600);
          signedUrl = signed?.signedUrl ?? null;
        }
        return { ...e, signed_url: signedUrl };
      }),
    );
    const agrupar = <T extends { transferencia_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const grupo = map.get(row.transferencia_id) ?? [];
        grupo.push(row);
        map.set(row.transferencia_id, grupo);
      }
      return map;
    };
    const eventosMap = agrupar(eventos);
    const ocorrenciasMap = agrupar(ocorrencias);
    const evidenciasMap = agrupar(evidenciasComUrl);

    return transferencias
      .filter((t) => !filtrarPorOcorrencia || idsPorOcorrencia.has(t.id))
      .map((t) => {
        const base = baseMap.get(t.base_id);
        return {
          ...t,
          base_codigo: base?.codigo ?? "—",
          base_nome: base?.nome ?? "Base não encontrada",
          eventos: eventosMap.get(t.id) ?? [],
          ocorrencias: ocorrenciasMap.get(t.id) ?? [],
          evidencias: evidenciasMap.get(t.id) ?? [],
        } as TransferenciaDetalhe;
      });
  });

const criarSchema = z.object({
  baseId: z.string().uuid(),
  dataOperacional: dateSchema,
  service: z.string().trim().min(2).max(120),
  motorista: z.string().trim().min(2).max(160),
  placa: z.string().trim().min(5).max(20),
  tipoVeiculo: z.string().trim().max(80).optional(),
  observacao: z.string().trim().max(1000).optional(),
});

export const criarTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => criarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase.rpc as any)("criar_transferencia", {
      p_base_id: data.baseId,
      p_data_operacional: data.dataOperacional,
      p_service: data.service,
      p_motorista: data.motorista,
      p_placa: data.placa,
      p_tipo_veiculo: data.tipoVeiculo || null,
      p_observacao: data.observacao || null,
    });
    if (error) throw new Error(error.message);
    return result;
  });

/**
 * Segurança: o caminho no bucket "transferencias-evidencias" é usado pelas
 * policies de storage (storage.foldername(name)[2] = transferencia_id).
 * Como o caminho chega do cliente, ele é revalidado aqui contra a própria
 * transferência: precisa ser exatamente
 * `<base_id da transferência>/<transferencia_id>/<arquivo>`, sem subpastas
 * extras nem travessia de diretório.
 */
async function validarCaminhoEvidencia(
  supabase: { from: (t: string) => any },
  transferenciaId: string,
  storagePath: string | undefined,
): Promise<void> {
  if (!storagePath) return;
  const caminho = storagePath.trim();
  if (
    caminho.includes("..") ||
    caminho.startsWith("/") ||
    !/^[A-Za-z0-9._/-]+$/.test(caminho)
  ) {
    throw new Error("Caminho de evidência inválido.");
  }
  const partes = caminho.split("/");
  if (partes.length !== 3 || partes.some((p) => p.length === 0)) {
    throw new Error("Caminho de evidência inválido.");
  }
  const { data: transferencia, error } = await supabase
    .from("transferencias")
    .select("id, base_id")
    .eq("id", transferenciaId)
    .single();
  if (error || !transferencia) throw new Error("Transferência não encontrada.");
  if (partes[0] !== transferencia.base_id || partes[1] !== transferenciaId) {
    throw new Error("Caminho de evidência não corresponde à transferência.");
  }
}

const marcoSchema = z.object({
  transferenciaId: z.string().uuid(),
  etapa: z.enum(["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"]),
  ocorridoEm: z.string().datetime({ offset: true }),
  storagePath: z.string().max(500).optional(),
  timemarkUrl: z.string().url().max(1000).optional(),
  horarioEvidencia: z.string().datetime({ offset: true }).optional(),
  localizacaoTexto: z.string().trim().max(300).optional(),
  motivoCodigo: z.string().trim().max(80).optional(),
  responsabilidade: z.enum(["JM_FROTA", "MELI", "EXTERNO", "EM_ANALISE"]).optional(),
  observacao: z.string().trim().max(1000).optional(),
});

export const registrarMarcoTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => marcoSchema.parse(input))
  .handler(async ({ data, context }) => {
    await validarCaminhoEvidencia(context.supabase as any, data.transferenciaId, data.storagePath);
    const { data: result, error } = await (context.supabase.rpc as any)("registrar_evento_transferencia_v2", {
      p_transferencia_id: data.transferenciaId,
      p_etapa: data.etapa,
      p_ocorrido_em: data.ocorridoEm,
      p_storage_path: data.storagePath || null,
      p_timemark_url: data.timemarkUrl || null,
      p_horario_evidencia: data.horarioEvidencia || null,
      p_localizacao_texto: data.localizacaoTexto || null,
      p_motivo_codigo: data.motivoCodigo || null,
      p_responsabilidade: data.responsabilidade || null,
      p_observacao: data.observacao || null,
    });
    if (!error) return result;

    const v2Ausente = error.code === "PGRST202" || error.message.includes("registrar_evento_transferencia_v2");
    if (!v2Ausente) throw new Error(error.message);
    if (data.etapa === "saida_xpt") {
      throw new Error("A etapa Saída do XPT aguarda a atualização do banco. As três etapas anteriores continuam disponíveis.");
    }

    const { data: legado, error: legadoError } = await (context.supabase.rpc as any)("registrar_evento_transferencia", {
      p_transferencia_id: data.transferenciaId,
      p_etapa: data.etapa,
      p_ocorrido_em: data.ocorridoEm,
      p_storage_path: data.storagePath || null,
      p_timemark_url: data.timemarkUrl || null,
      p_horario_evidencia: data.horarioEvidencia || null,
      p_localizacao_texto: data.localizacaoTexto || null,
      p_motivo_codigo: data.motivoCodigo || "OUTRO",
      p_responsabilidade: data.responsabilidade || "EM_ANALISE",
      p_observacao: data.observacao || "Pendente de classificação operacional.",
    });
    if (legadoError) throw new Error(legadoError.message);
    return legado;
  });

const corrigirMarcoSchema = z.object({
  transferenciaId: z.string().uuid(),
  etapa: z.enum(["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"]),
  ocorridoEm: z.string().datetime({ offset: true }),
  localizacaoTexto: z.string().trim().max(300).optional(),
  storagePath: z.string().trim().max(500).optional(),
  timemarkUrl: z.union([z.string().url().max(1000), z.literal("")]).optional(),
  horarioEvidencia: z.string().datetime({ offset: true }).optional(),
});

export const corrigirMarcoTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => corrigirMarcoSchema.parse(input))
  .handler(async ({ data, context }) => {
    await validarCaminhoEvidencia(context.supabase as any, data.transferenciaId, data.storagePath);
    const { data: correcaoRpc, error: correcaoRpcError } = await (context.supabase as any).rpc(
      "corrigir_etapa_transferencia",
      {
        p_transferencia_id: data.transferenciaId,
        p_etapa: data.etapa,
        p_ocorrido_em: data.ocorridoEm,
        p_localizacao_texto: data.localizacaoTexto || null,
        p_storage_path: data.storagePath || null,
        p_timemark_url: data.timemarkUrl ?? null,
        p_horario_evidencia: data.horarioEvidencia || null,
        p_editar_evidencia: data.storagePath !== undefined || data.timemarkUrl !== undefined,
      },
    );
    if (!correcaoRpcError) return correcaoRpc;

    const rpcAusente = correcaoRpcError.code === "PGRST202"
      || correcaoRpcError.message.includes("corrigir_etapa_transferencia");
    if (!rpcAusente) {
      if (correcaoRpcError.message.includes("horario_anterior_etapa_precedente")) {
        throw new Error("O horário não pode ser anterior à etapa precedente.");
      }
      if (correcaoRpcError.message.includes("horario_posterior_etapa_seguinte")) {
        throw new Error("O horário não pode ser posterior à etapa seguinte.");
      }
      throw new Error(correcaoRpcError.message);
    }

    // Compatibilidade temporária para ambientes que ainda não aplicaram a
    // migração da RPC acima. Pode usar uma das duas nomenclaturas de chave.
    const { data: transferencia, error: transferenciaError } = await clienteDeModulo(context.supabase)
      .from("transferencias")
      .select("id, base_id, data_operacional, service, finalizada_em")
      .eq("id", data.transferenciaId)
      .single();
    if (transferenciaError) throw new Error(transferenciaError.message);

    const { data: eventos, error: eventosError } = await clienteDeModulo(context.supabase)
      .from("transferencia_eventos")
      .select("id, etapa, ocorrido_em, localizacao_texto, minutos_atraso")
      .eq("transferencia_id", data.transferenciaId)
      .order("ocorrido_em", { ascending: true });
    if (eventosError) throw new Error(eventosError.message);

    const ordem: TransferenciaEtapa[] = ["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"];
    const indice = ordem.indexOf(data.etapa);
    const evento = eventos?.find((item) => item.etapa === data.etapa);
    if (!evento) throw new Error("Etapa não encontrada para edição.");
    const anterior = indice > 0 ? eventos?.find((item) => item.etapa === ordem[indice - 1]) : null;
    const seguinte = indice < ordem.length - 1 ? eventos?.find((item) => item.etapa === ordem[indice + 1]) : null;
    const novoHorario = Date.parse(data.ocorridoEm);
    if (anterior && novoHorario < Date.parse(anterior.ocorrido_em)) throw new Error("O horário não pode ser anterior à etapa precedente.");
    if (seguinte && novoHorario > Date.parse(seguinte.ocorrido_em)) throw new Error("O horário não pode ser posterior à etapa seguinte.");

    const { data: sla } = await clienteDeModulo(context.supabase)
      .from("transferencia_slas")
      .select("chegada_service_limite, saida_service_limite, transito_max_minutos")
      .eq("base_id", transferencia.base_id)
      .ilike("service", transferencia.service)
      .eq("ativo", true)
      .maybeSingle();
    const limiteChegada = sla?.chegada_service_limite ?? "07:00:00";
    const limiteSaida = sla?.saida_service_limite ?? "09:00:00";
    let referencia = novoHorario;
    if (data.etapa === "chegada_service") referencia = Date.parse(`${transferencia.data_operacional}T${limiteChegada}-03:00`);
    if (data.etapa === "saida_service") referencia = Date.parse(`${transferencia.data_operacional}T${limiteSaida}-03:00`);
    if (data.etapa === "chegada_xpt" && anterior) referencia = Date.parse(anterior.ocorrido_em) + (sla?.transito_max_minutos ?? 80) * 60_000;
    const minutosAtraso = Math.max(0, Math.ceil((novoHorario - referencia) / 60_000));

    try {
      const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
      const { error: updateError } = await supabaseAdmin
        .from("transferencia_eventos")
        .update({ ocorrido_em: data.ocorridoEm, localizacao_texto: data.localizacaoTexto || null, minutos_atraso: minutosAtraso })
        .eq("id", evento.id);
      if (updateError) throw new Error(updateError.message);

      const { data: ocorrencia } = await supabaseAdmin
        .from("transferencia_ocorrencias")
        .select("id")
        .eq("evento_id", evento.id)
        .maybeSingle();
      if (ocorrencia) {
        await supabaseAdmin.from("transferencia_ocorrencias").update({ minutos_atraso: minutosAtraso }).eq("id", ocorrencia.id);
      }

      if ((data.etapa === "saida_xpt" || (data.etapa === "chegada_xpt" && !seguinte)) && transferencia.finalizada_em) {
        await supabaseAdmin.from("transferencias").update({ finalizada_em: data.ocorridoEm }).eq("id", transferencia.id);
      }

      const { data: evidenciaAtual } = await supabaseAdmin
        .from("transferencia_evidencias")
        .select("id, storage_path, timemark_url")
        .eq("transferencia_id", transferencia.id)
        .eq("etapa", data.etapa)
        .is("substituida_por", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const storagePath = data.storagePath ?? evidenciaAtual?.storage_path ?? null;
      const timemarkUrl = data.timemarkUrl === undefined
        ? evidenciaAtual?.timemark_url ?? null
        : data.timemarkUrl || null;
      if ((data.storagePath !== undefined || data.timemarkUrl !== undefined) && (storagePath || timemarkUrl)) {
        const { data: novaEvidencia, error: evidenciaError } = await supabaseAdmin
          .from("transferencia_evidencias")
          .insert({
            transferencia_id: transferencia.id,
            evento_id: evento.id,
            etapa: data.etapa,
            storage_path: storagePath,
            timemark_url: timemarkUrl,
            horario_evidencia: data.horarioEvidencia ?? data.ocorridoEm,
            localizacao_texto: data.localizacaoTexto || null,
            status: "enviada",
            enviado_por: context.userId,
          })
          .select("id")
          .single();
        if (evidenciaError) throw new Error(evidenciaError.message);
        if (evidenciaAtual) {
          await supabaseAdmin
            .from("transferencia_evidencias")
            .update({ substituida_por: novaEvidencia.id })
            .eq("id", evidenciaAtual.id);
        }
      }

      await supabaseAdmin.from("audit_logs").insert({
        user_id: context.userId,
        acao: "transferencia.evento.corrigir",
        entidade: "transferencia_evento",
        entidade_id: evento.id,
        detalhes: {
          etapa: data.etapa,
          horario_anterior: evento.ocorrido_em,
          horario_novo: data.ocorridoEm,
          localizacao_anterior: evento.localizacao_texto,
          localizacao_nova: data.localizacaoTexto || null,
          link_corrigido: data.timemarkUrl !== undefined,
          foto_substituida: !!data.storagePath,
          minutos_atraso: minutosAtraso,
        },
      });
      return { id: evento.id, ocorrido_em: data.ocorridoEm, minutos_atraso: minutosAtraso };
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Erro ao corrigir a etapa.";
      if (mensagem.includes("SUPABASE_SERVICE_ROLE_KEY") || mensagem.includes("SUPABASE_SECRET_KEY")) {
        throw new Error("A edição da etapa precisa da chave secreta da Supabase configurada no ambiente da Vercel.");
      }
      throw error;
    }
  });

const evidenciaSchema = z.object({
  transferenciaId: z.string().uuid(),
  etapa: z.enum(["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"]),
  storagePath: z.string().trim().min(1).max(500),
  timemarkUrl: z.string().url().max(1000),
  horarioEvidencia: z.string().datetime({ offset: true }).optional(),
  localizacaoTexto: z.string().trim().max(300).optional(),
});

export const anexarEvidenciaTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => evidenciaSchema.parse(input))
  .handler(async ({ data, context }) => {
    await validarCaminhoEvidencia(context.supabase as any, data.transferenciaId, data.storagePath);
    const { data: result, error } = await (context.supabase.rpc as any)("anexar_evidencia_transferencia_v2", {
      p_transferencia_id: data.transferenciaId,
      p_etapa: data.etapa,
      p_storage_path: data.storagePath,
      p_timemark_url: data.timemarkUrl,
      p_horario_evidencia: data.horarioEvidencia || null,
      p_localizacao_texto: data.localizacaoTexto || null,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const cancelarTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        transferenciaId: z.string().uuid(),
        justificativa: z.string().trim().min(10).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await clienteDeModulo(context.supabase).rpc("cancelar_transferencia", {
      p_transferencia_id: data.transferenciaId,
      p_justificativa: data.justificativa,
    });
    if (error) throw new Error(error.message);
    return result;
  });

const editarSchema = z.object({
  transferenciaId: z.string().uuid(),
  service: z.string().trim().min(2).max(120),
  motorista: z.string().trim().min(2).max(160),
  placa: z.string().trim().min(5).max(20),
  tipoVeiculo: z.string().trim().max(80).optional(),
  observacao: z.string().max(4000).optional(),
});

export const editarTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => editarSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: anterior, error: leituraError } = await clienteDeModulo(context.supabase)
      .from("transferencias")
      .select("id, service, motorista, placa, tipo_veiculo, status, observacao")
      .eq("id", data.transferenciaId)
      .single();
    if (leituraError) throw new Error(leituraError.message);
    if (anterior.status === "cancelada") throw new Error("Transferência cancelada não pode ser editada.");

    const novo: {
      service: string;
      motorista: string;
      placa: string;
      tipo_veiculo: string | null;
      observacao?: string | null;
    } = {
      service: data.service.toUpperCase(),
      motorista: data.motorista.trim(),
      placa: data.placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
      tipo_veiculo: data.tipoVeiculo?.trim() || null,
    };
    if (data.observacao !== undefined) {
      novo.observacao = data.observacao.trim() || null;
    }
    const { data: result, error } = await clienteDeModulo(context.supabase)
      .from("transferencias")
      .update(novo)
      .eq("id", data.transferenciaId)
      .select("id")
      .single();
    if (error) throw new Error(error.message);



    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "transferencia.editar",
      entidade: "transferencia",
      entidade_id: data.transferenciaId,
      detalhes: { anterior, novo },
    });
    return result;
  });

export const salvarSlaTransferencia = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        service: z.string().trim().min(2).max(120),
        chegadaServiceLimite: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        saidaServiceLimite: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        transitoMaxMinutos: z.number().int().min(1).max(1440),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await clienteDeModulo(context.supabase).rpc("salvar_sla_transferencia", {
      p_base_id: data.baseId,
      p_service: data.service,
      p_chegada_service_limite: data.chegadaServiceLimite,
      p_saida_service_limite: data.saidaServiceLimite,
      p_transito_max_minutos: data.transitoMaxMinutos,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export function proximaEtapa(eventos: TransferenciaEvento[]): TransferenciaEtapa | null {
  const etapas = new Set(eventos.map((e) => e.etapa));
  if (!etapas.has("chegada_service")) return "chegada_service";
  if (!etapas.has("saida_service")) return "saida_service";
  if (!etapas.has("chegada_xpt")) return "chegada_xpt";
  return null;
}


export function caminhoEvidenciaTransferencia(
  baseId: string,
  transferenciaId: string,
  etapa: TransferenciaEtapa,
  nomeOriginal: string,
): string {
  const ext =
    nomeOriginal
      .split(".")
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "jpg";
  return `${baseId}/${transferenciaId}/${etapa}-${crypto.randomUUID()}.${ext}`;
}
