import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  mensagemRotaDivergente,
  normalizarCodigoTriagem,
  resumirRotasTriagem,
  rotaEfetivaTriagem,
} from "./triagem-domain";
import { nomeOperacionalRota } from "./meli-status";

// O PostgREST/Supabase limita respostas a 1.000 linhas por página neste projeto.
// Usar range maior retorna só 1.000 e fazia a Triagem parar antes de carregar todas as rotas.
const ESCALAS_PAGE_SIZE = 1000;

const bipSchema = z.object({
  codigo: z.string().trim().min(3).max(120).transform(normalizarCodigoTriagem),
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  tempoDesdeUltimaMs: z.number().int().nonnegative().optional(),
  rotaSelecionada: z.string().trim().min(1).max(120).optional(),
});

export type TriagemResult = {
  resultado:
    | "ok"
    | "duplicado"
    | "inexistente"
    | "nao_recebido"
    | "outra_base"
    | "outra_data"
    | "outra_expedicao"
    | "rota_divergente"
    | "cancelada"
    | "encerrada";
  mensagem: string;
  hora: string;
  rota?: {
    id: string;
    codigo: string;
    cidade: string;
    base_codigo: string | null;
    base_nome: string | null;
    rota_final: string | null;
    destinatario_nome: string | null;
    destinatario_cep: string | null;
    quantidade_prevista: number;
    quantidade_triada: number;
    percentual_triagem: number;
  };
  volume?: { codigo: string; sequencia: number; total: number };
};

export type LocalizacaoShipmentTriagem =
  | {
      encontrado: true;
      shipment: string;
      rota: string;
      planejada: string | null;
      otimizada: string | null;
      cidade: string | null;
      triado: boolean;
    }
  | { encontrado: false; shipment: string; mensagem: string };

const concluirRotaRessalvaSchema = z.object({
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rota: z.string().trim().min(1).max(120),
  motivo: z.string().trim().min(5, "Informe um motivo com pelo menos 5 caracteres.").max(1000),
});

export type ConclusaoRotaRessalva = {
  rota: string;
  motivo: string;
  previstos: number;
  triados: number;
  faltantes: number;
  concluidaEm: string;
  concluidaPor: string;
  shipmentIdsNaoLocalizados: string[];
};

export const concluirRotaComRessalva = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => concluirRotaRessalvaSchema.parse(data))
  .handler(async ({ data, context }): Promise<ConclusaoRotaRessalva> => {
    const { userId } = context;
    const supabase = clienteDeModulo(context.supabase);

    const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);

    const { auditRequestMeta } = await import("./audit.server");

    const { data: importacao, error: importacaoErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    if (importacaoErro) {
      throw new Error(importacaoErro.message);
    }

    if (!importacao) {
      throw new Error("Não existe importação ativa para esta base e dia operacional.");
    }

    // Contagem via agregação no Postgres para evitar statement timeout.
    // Rota efetiva = otimizada (se preenchida) senão planejada.
    // Usamos queries separadas em vez de .or() com and() aninhado porque
    // o PostgREST não otimiza esse filtro composto e cai em seq scan.
    const rotaFiltro = data.rota;
    const baseQ = () =>
      supabaseAdmin
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", importacao.id)
        .not("shipment", "is", null)
        .neq("shipment", "");

    const [
      { count: prevOtim, error: e1 },
      { count: prevPlanNull, error: e2 },
      { count: prevPlanEmpty, error: e3 },
      { count: triOtim, error: e4 },
      { count: triPlanNull, error: e5 },
      { count: triPlanEmpty, error: e6 },
    ] = await Promise.all([
      baseQ().eq("otimizada", rotaFiltro),
      baseQ().is("otimizada", null).eq("planejada", rotaFiltro),
      baseQ().eq("otimizada", "").eq("planejada", rotaFiltro),
      baseQ().eq("otimizada", rotaFiltro).eq("triado", true),
      baseQ().is("otimizada", null).eq("planejada", rotaFiltro).eq("triado", true),
      baseQ().eq("otimizada", "").eq("planejada", rotaFiltro).eq("triado", true),
    ]);
    const err = e1 || e2 || e3 || e4 || e5 || e6;
    if (err) throw new Error(err.message);

    const previstos = (prevOtim ?? 0) + (prevPlanNull ?? 0) + (prevPlanEmpty ?? 0);
    const triados = (triOtim ?? 0) + (triPlanNull ?? 0) + (triPlanEmpty ?? 0);
    const faltantes = Math.max(previstos - triados, 0);

    if (previstos === 0) {
      throw new Error("Rota não encontrada na importação ativa.");
    }

    if (faltantes === 0) {
      throw new Error("Esta rota já está 100% concluída e não precisa de ressalva.");
    }

    // Congela os IDs ausentes no instante da conclusão. A Expedição poderá
    // reconciliá-los depois sem apagar esta ocorrência original.
    type LinhaFaltante = { id: string; shipment: string | null };
    const carregarFaltantes = async (modo: "otimizada" | "planejadaNula" | "planejadaVazia") => {
      const linhas: LinhaFaltante[] = [];
      for (let inicio = 0; ; inicio += ESCALAS_PAGE_SIZE) {
        let query = supabaseAdmin
          .from("escalas")
          .select("id, shipment")
          .eq("importacao_id", importacao.id)
          .eq("triado", false)
          .not("shipment", "is", null)
          .neq("shipment", "")
          .order("id", { ascending: true });

        if (modo === "otimizada") {
          query = query.eq("otimizada", rotaFiltro);
        } else if (modo === "planejadaNula") {
          query = query.is("otimizada", null).eq("planejada", rotaFiltro);
        } else {
          query = query.eq("otimizada", "").eq("planejada", rotaFiltro);
        }

        const { data: pagina, error } = await query.range(inicio, inicio + ESCALAS_PAGE_SIZE - 1);
        if (error) throw new Error(error.message);
        if (!pagina || pagina.length === 0) break;
        linhas.push(...pagina);
        if (pagina.length < ESCALAS_PAGE_SIZE) break;
      }
      return linhas;
    };

    const [faltantesOtimizadas, faltantesPlanejadasNulas, faltantesPlanejadasVazias] =
      await Promise.all([
        carregarFaltantes("otimizada"),
        carregarFaltantes("planejadaNula"),
        carregarFaltantes("planejadaVazia"),
      ]);
    const shipmentIdsNaoLocalizados = Array.from(
      new Map(
        [...faltantesOtimizadas, ...faltantesPlanejadasNulas, ...faltantesPlanejadasVazias].map(
          (linha) => [linha.id, linha],
        ),
      ).values(),
    )
      .map((linha) => linha.shipment?.trim())
      .filter((shipment): shipment is string => !!shipment)
      .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));

    if (shipmentIdsNaoLocalizados.length !== faltantes) {
      throw new Error(
        "A relação de IDs faltantes mudou durante a conclusão. Atualize a rota e tente novamente.",
      );
    }

    const { data: conclusaoExistente } = await supabaseAdmin
      .from("audit_logs")
      .select("user_id, created_at, detalhes")
      .eq("acao", "triagem.rota_concluida_ressalva")
      .eq("entidade", "importacao_escala")
      .eq("entidade_id", importacao.id)
      .contains("detalhes", {
        rota: data.rota,
      } as never)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (conclusaoExistente) {
      const detalhes = (conclusaoExistente.detalhes ?? {}) as Record<string, unknown>;

      return {
        rota: data.rota,
        motivo: String(detalhes.motivo ?? data.motivo),
        previstos: Number(detalhes.previstos ?? previstos),
        triados: Number(detalhes.triados ?? triados),
        faltantes: Number(detalhes.faltantes ?? faltantes),
        concluidaEm: conclusaoExistente.created_at,
        concluidaPor: conclusaoExistente.user_id ?? userId,
        shipmentIdsNaoLocalizados: Array.isArray(detalhes.shipment_ids_nao_localizados)
          ? detalhes.shipment_ids_nao_localizados.map(String)
          : [],
      };
    }

    const concluidaEm = new Date().toISOString();
    const { ip, user_agent } = auditRequestMeta();

    const { error: auditoriaErro } = await supabaseAdmin.from("audit_logs").insert({
      user_id: userId,
      acao: "triagem.rota_concluida_ressalva",
      entidade: "importacao_escala",
      entidade_id: importacao.id,
      detalhes: {
        rota: data.rota,
        motivo: data.motivo,
        previstos,
        triados,
        faltantes,
        base_id: data.baseId,
        data_operacional: data.dataOperacional,
        status: "concluida_ressalva",
        tipo_divergencia: "nao_localizado_no_recebimento",
        shipment_ids_nao_localizados: shipmentIdsNaoLocalizados,
      } as never,
      ip,
      user_agent,
    });

    if (auditoriaErro) {
      throw new Error(`Não foi possível registrar a conclusão: ${auditoriaErro.message}`);
    }

    return {
      rota: data.rota,
      motivo: data.motivo,
      previstos,
      triados,
      faltantes,
      concluidaEm,
      concluidaPor: userId,
      shipmentIdsNaoLocalizados,
    };
  });

/**
 * Bipagem de Triagem — trabalha em cima da PLANILHA importada (escala).
 * Cada linha da planilha = 1 Shipment bipável, escopado por Base + Dia Operacional.
 */
export const biparTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bipSchema.parse(data))
  .handler(async ({ data, context }): Promise<TriagemResult> => {
    const { userId } = context;
    const supabase = clienteDeModulo(context.supabase);
    const { auditRequestMeta, registrarAuditInterno } = await import("./audit.server");
    const hora = new Date().toISOString();
    const { ip, user_agent: userAgent } = auditRequestMeta();
    const tempo = data.tempoDesdeUltimaMs ?? null;

    async function log(
      resultado: TriagemResult["resultado"],
      mensagem: string,
      baseId: string | null,
      escalaId: string | null,
    ) {
      const mapped =
        resultado === "nao_recebido"
          ? "inexistente"
          : resultado === "outra_data" || resultado === "outra_expedicao"
            ? "inexistente"
            : resultado === "rota_divergente"
              ? "outra_rota"
              : resultado;
      const registro = supabase.from("recebimentos").insert({
        codigo_bipado: data.codigo,
        rota_id: null,
        volume_id: null,
        base_id: baseId,
        operador_id: userId,
        resultado: mapped,
        mensagem,
        ip,
        user_agent: userAgent,
        tempo_desde_ultima_ms: tempo,
        stage: "triagem",
      });
      const auditoria = registrarAuditInterno(supabase, userId, {
        acao: `triagem.${resultado}`,
        entidade: "escala",
        entidade_id: escalaId,
        detalhes: { codigo: data.codigo, mensagem, base_id: baseId, dia: data.dataOperacional },
      });
      await Promise.all([registro, auditoria]);
    }

    // 1) Importação ativa da Base + Dia
    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    // 2) Procura o Shipment dentro dessa importação
    let escala: {
      id: string;
      shipment: string | null;
      planejada: string | null;
      otimizada: string | null;
      cidade: string | null;
      cep: string | null;
      triado: boolean;
      base_id: string | null;
      importacao_id: string | null;
      recebido?: boolean | null;
      meli_pacote_id?: string | null;
    } | null = null;
    if (impAtiva) {
      const { data: row } = await supabase
        .from("escalas")
        .select(
          "id, shipment, planejada, otimizada, cidade, cep, triado, base_id, importacao_id, recebido, meli_pacote_id",
        )
        .eq("importacao_id", impAtiva.id)
        .eq("shipment", data.codigo)
        .maybeSingle();
      escala = row ?? null;
    }

    // 3) Não achou na escala ativa do dia? Primeiro diferencia a mesma base
    // em outra data/versão. Só acusa "outra base" quando a base é realmente outra.
    if (!escala) {
      const { data: encontrados } = await supabase
        .from("escalas")
        .select(
          "id, base_id, triado, recebido, bases:base_id(codigo, nome), importacao:importacao_id!inner(id, data_operacional, ativa, arquivo_nome, versao, importado_em)",
        )
        .eq("shipment", data.codigo)
        .limit(100);

      type ShipmentEncontrado = {
        id: string;
        base_id: string;
        triado: boolean | null;
        recebido: boolean | null;
        bases: { codigo: string; nome: string } | null;
        importacao: {
          id: string;
          data_operacional: string;
          ativa: boolean;
          arquivo_nome: string | null;
          versao: number;
          importado_em: string;
        } | null;
      };

      const candidatos = (encontrados ?? []) as unknown as ShipmentEncontrado[];
      const mesmaBase = candidatos
        .filter((item) => item.base_id === data.baseId && item.importacao)
        .sort((a, b) => {
          const mesmaDataA = Number(a.importacao!.data_operacional === data.dataOperacional);
          const mesmaDataB = Number(b.importacao!.data_operacional === data.dataOperacional);
          if (mesmaDataA !== mesmaDataB) return mesmaDataB - mesmaDataA;
          const ativa = Number(b.importacao!.ativa) - Number(a.importacao!.ativa);
          if (ativa !== 0) return ativa;
          return b.importacao!.importado_em.localeCompare(a.importacao!.importado_em);
        })[0];

      if (mesmaBase?.importacao) {
        const imp = mesmaBase.importacao;
        const dataEncontrada = new Date(`${imp.data_operacional}T00:00:00`).toLocaleDateString(
          "pt-BR",
        );
        const status = mesmaBase.triado
          ? "já triado nessa operação"
          : mesmaBase.recebido
            ? "recebido e aguardando triagem"
            : "aguardando recebimento/triagem";
        const exp = imp.arquivo_nome ? `, expedição ${imp.arquivo_nome}` : `, versão ${imp.versao}`;

        if (imp.data_operacional !== data.dataOperacional) {
          const msg = `Pedido pertence à mesma base ${mesmaBase.bases?.codigo ?? ""} ${mesmaBase.bases?.nome ?? ""}, mas ao dia operacional ${dataEncontrada}${exp}. Status: ${status}.`;
          await log("outra_data", msg, mesmaBase.base_id, mesmaBase.id);
          return { resultado: "outra_data", mensagem: msg, hora };
        }

        const msg = `Pedido pertence à mesma base e data, mas está em outra expedição${exp}. Status: ${status}.`;
        await log("outra_expedicao", msg, mesmaBase.base_id, mesmaBase.id);
        return { resultado: "outra_expedicao", mensagem: msg, hora };
      }

      const outraBase = candidatos.find((item) => item.base_id !== data.baseId);
      if (outraBase) {
        const msg = `Pedido pertence a outra operação — base ${outraBase.bases?.codigo ?? "?"} ${outraBase.bases?.nome ?? ""}.`;
        await log("outra_base", msg, outraBase.base_id, outraBase.id);
        return { resultado: "outra_base", mensagem: msg, hora };
      }
      const msg = "Shipment não encontrado nas planilhas importadas.";
      await log("inexistente", msg, data.baseId, null);
      return { resultado: "inexistente", mensagem: msg, hora };
    }

    // 4) Métricas por rota planejada
    // A operação confere por Rota Otimizada (coluna "Rota Otimizada" da planilha).
    const rotaCodigo = rotaEfetivaTriagem(escala) ?? "—";

    /*
     * Verifica se a rota foi concluída manualmente com ressalva.
     * Uma falha isolada na auditoria não deve derrubar toda a bipagem.
     */
    try {
      const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);

      const { data: rotaEncerradaComRessalva, error: ressalvaErro } = await supabaseAdmin
        .from("audit_logs")
        .select("id")
        .eq("acao", "triagem.rota_concluida_ressalva")
        .eq("entidade", "importacao_escala")
        .eq("entidade_id", escala.importacao_id!)
        .contains("detalhes", {
          rota: rotaCodigo,
        } as never)
        .limit(1)
        .maybeSingle();

      if (ressalvaErro) {
        console.error("Falha ao verificar conclusão de rota com ressalva:", ressalvaErro.message);
      } else if (rotaEncerradaComRessalva) {
        const mensagem = `A rota ${rotaCodigo} foi concluída com ressalva e está bloqueada para novas bipagens.`;

        await log("encerrada", mensagem, escala.base_id, escala.id);

        return {
          resultado: "encerrada",
          mensagem,
          hora,
        };
      }
    } catch (erro) {
      console.error("Não foi possível verificar a conclusão da rota com ressalva:", erro);
    }

    // 4.a) Se o operador escolheu uma rota, o shipment tem que pertencer a ela
    if (data.rotaSelecionada && rotaCodigo !== data.rotaSelecionada) {
      const msg = mensagemRotaDivergente(data.rotaSelecionada, rotaCodigo);
      await log("rota_divergente", msg, escala.base_id, escala.id);
      return { resultado: "rota_divergente", mensagem: msg, hora };
    }

    const countRota = async () => {
      const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
      let previstosQuery = supabaseAdmin
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", escala!.importacao_id!)
        .not("shipment", "is", null)
        .neq("shipment", "");
      let triadosQuery = supabaseAdmin
        .from("escalas")
        .select("id", { count: "exact", head: true })
        .eq("importacao_id", escala!.importacao_id!)
        .not("shipment", "is", null)
        .neq("shipment", "")
        .eq("triado", true);

      if (escala!.otimizada?.trim()) {
        previstosQuery = previstosQuery.eq("otimizada", escala!.otimizada);
        triadosQuery = triadosQuery.eq("otimizada", escala!.otimizada);
      } else {
        previstosQuery = previstosQuery
          .is("otimizada", null)
          .eq("planejada", escala!.planejada ?? "");
        triadosQuery = triadosQuery.is("otimizada", null).eq("planejada", escala!.planejada ?? "");
      }

      const [{ count: prev }, { count: tri }] = await Promise.all([previstosQuery, triadosQuery]);
      return { prev: prev ?? 0, tri: tri ?? 0 };
    };
    const build = async () => {
      const { prev, tri } = await countRota();
      return {
        id: escala!.id,
        codigo: rotaCodigo,
        cidade: escala!.cidade ?? "",
        base_codigo: null,
        base_nome: null,
        rota_final: escala!.otimizada,
        destinatario_nome: null,
        destinatario_cep: escala!.cep,
        quantidade_prevista: prev,
        quantidade_triada: tri,
        percentual_triagem: prev ? Math.round((tri / prev) * 100) : 0,
      };
    };

    // 4.b) Trava de recebimento físico removida: a triagem pode ser feita
    // direto na bipagem das rotas, mesmo sem passar pelo Recebimento.

    // 5) Duplicado

    if (escala.triado) {
      const msg = `Shipment ${escala.shipment} já foi recebido.`;
      await log("duplicado", msg, escala.base_id, escala.id);
      return {
        resultado: "duplicado",
        mensagem: msg,
        hora,
        rota: await build(),
        volume: { codigo: escala.shipment ?? data.codigo, sequencia: 1, total: 1 },
      };
    }

    // 6) Marca triado (e registra o recebimento implícito, quando ainda não houve)
    const { data: atualizado, error: upErr } = await supabase
      .from("escalas")
      .update(
        escala.recebido === true
          ? { triado: true, triado_em: hora, triado_por: userId }
          : {
              triado: true,
              triado_em: hora,
              triado_por: userId,
              recebido: true,
              recebido_em: hora,
              recebido_por: userId,
            },
      )
      .eq("id", escala.id)
      .eq("triado", false)
      .select("id")
      .maybeSingle();
    if (upErr) throw new Error(upErr.message);

    // Outra leitura pode ter vencido a corrida entre o SELECT e o UPDATE.
    // Nesse caso a segunda tentativa é duplicada, nunca um segundo "ok".
    if (!atualizado) {
      const msg = `Shipment ${escala.shipment} já foi recebido.`;
      await log("duplicado", msg, escala.base_id, escala.id);
      return {
        resultado: "duplicado",
        mensagem: msg,
        hora,
        rota: await build(),
        volume: { codigo: escala.shipment ?? data.codigo, sequencia: 1, total: 1 },
      };
    }

    const rotaInfo = await build();
    const mensagem =
      rotaInfo.quantidade_triada >= rotaInfo.quantidade_prevista
        ? `Recebimento COMPLETO da rota ${rotaCodigo}.`
        : `Shipment recebido — rota ${rotaCodigo} (${rotaInfo.quantidade_triada}/${rotaInfo.quantidade_prevista}).`;
    await log("ok", mensagem, escala.base_id, escala.id);

    return {
      resultado: "ok",
      mensagem,
      hora,
      rota: rotaInfo,
      volume: { codigo: escala.shipment ?? data.codigo, sequencia: 1, total: 1 },
    };
  });

export const triagemRotasDoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = clienteDeModulo(context.supabase);

    type RotaTriagemDia = {
      rota: string;
      /** Nome operacional (cluster do Meli / nº de rota da planilha). */
      nome_operacional: string;
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

    const { data: impAtiva, error: importacaoErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    if (importacaoErro) {
      throw new Error(importacaoErro.message);
    }

    if (!impAtiva) {
      return [] as RotaTriagemDia[];
    }

    const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);

    const PAGE_SIZE = ESCALAS_PAGE_SIZE;

    const linhas: Array<{
      shipment: string | null;
      planejada: string | null;
      otimizada: string | null;
      nro_rota: string | null;
      triado: boolean | null;
    }> = [];

    for (let inicio = 0; ; inicio += PAGE_SIZE) {
      // A consulta autenticada estoura timeout em importações grandes porque
      // cada linha passa pelas policies/RLS. O acesso à importação já foi
      // validado acima com o client autenticado; aqui usamos o client admin
      // apenas para leitura agregada em memória, sem alterar dados ou schema.
      const { data: pagina, error: paginaErro } = await supabaseAdmin
        .from("escalas")
        .select("shipment, planejada, otimizada, nro_rota, triado")
        .eq("importacao_id", impAtiva.id)
        .not("shipment", "is", null)
        .neq("shipment", "")
        .order("id", { ascending: true })
        .range(inicio, inicio + PAGE_SIZE - 1);

      if (paginaErro) {
        throw new Error(paginaErro.message);
      }

      if (!pagina || pagina.length === 0) {
        break;
      }

      linhas.push(...pagina);

      if (pagina.length < PAGE_SIZE) {
        break;
      }
    }

    // Nome operacional por rota técnica (nunca substitui a chave técnica).
    const nomePorRota = new Map<string, string>();
    for (const l of linhas) {
      const chave = rotaEfetivaTriagem(l);
      if (!chave || nomePorRota.has(chave)) continue;
      const nome = nomeOperacionalRota({ nro_rota: l.nro_rota, route_id: chave });
      nomePorRota.set(chave, nome);
    }

    const resumo = (resumirRotasTriagem(linhas) as RotaTriagemDia[]).map((r) => ({
      ...r,
      nome_operacional: nomePorRota.get(r.rota) ?? r.rota,
    }));

    try {
      const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);

      const { data: conclusoes, error: conclusoesErro } = await supabaseAdmin
        .from("audit_logs")
        .select("user_id, created_at, detalhes")
        .eq("acao", "triagem.rota_concluida_ressalva")
        .eq("entidade", "importacao_escala")
        .eq("entidade_id", impAtiva.id)
        .order("created_at", { ascending: false });

      if (conclusoesErro) {
        console.error(
          "Falha ao consultar conclusões de rota com ressalva:",
          conclusoesErro.message,
        );
        return resumo;
      }

      const conclusoesPorRota = new Map<
        string,
        {
          motivo: string;
          concluidaEm: string;
          concluidaPor: string;
          faltantes: number;
        }
      >();

      for (const registro of conclusoes ?? []) {
        const detalhes = (registro.detalhes ?? {}) as Record<string, unknown>;

        const rota = typeof detalhes.rota === "string" ? detalhes.rota.trim() : "";

        if (!rota || conclusoesPorRota.has(rota)) {
          continue;
        }

        conclusoesPorRota.set(rota, {
          motivo:
            typeof detalhes.motivo === "string" && detalhes.motivo.trim().length > 0
              ? detalhes.motivo
              : "Motivo não informado",
          concluidaEm: registro.created_at ?? new Date().toISOString(),
          concluidaPor: registro.user_id ?? "Usuário não identificado",
          faltantes: Number(detalhes.faltantes ?? 0),
        });
      }

      return resumo.map((rota) => {
        const ressalva = conclusoesPorRota.get(rota.rota);

        if (!ressalva) {
          return rota;
        }

        return {
          ...rota,
          status: "concluida_ressalva" as const,
          conclusaoRessalva: ressalva,
        };
      });
    } catch (erro) {
      console.error("Não foi possível carregar as ressalvas das rotas:", erro);
      return resumo;
    }
  });

export const localizarShipmentTriagem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        shipment: z
          .string()
          .trim()
          .min(3)
          .max(120)
          .transform((valor) => valor.replace(/[^0-9A-Za-z]/g, ""))
          .refine((valor) => valor.length >= 3, "Shipment inválido."),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LocalizacaoShipmentTriagem> => {
    const supabase = clienteDeModulo(context.supabase);
    const { data: impAtiva, error: impErro } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (impErro) throw new Error(impErro.message);
    if (!impAtiva) {
      return {
        encontrado: false,
        shipment: data.shipment,
        mensagem: "Não existe importação ativa para esta base e dia operacional.",
      };
    }

    const { data: linhas, error } = await supabase
      .from("escalas")
      .select("shipment, planejada, otimizada, cidade, triado")
      .eq("importacao_id", impAtiva.id)
      .eq("shipment", data.shipment)
      .limit(2);
    if (error) throw new Error(error.message);

    const linha = linhas?.[0];
    if (!linha) {
      return {
        encontrado: false,
        shipment: data.shipment,
        mensagem: "Shipment não encontrado na operação ativa desta base e dia.",
      };
    }
    if ((linhas?.length ?? 0) > 1) {
      throw new Error("Shipment duplicado na importação ativa. Acione a supervisão.");
    }

    const rota = rotaEfetivaTriagem(linha);
    if (!rota) {
      throw new Error("Shipment encontrado, mas sem rota planejada ou otimizada.");
    }

    return {
      encontrado: true,
      shipment: linha.shipment ?? data.shipment,
      rota,
      planejada: linha.planejada,
      otimizada: linha.otimizada,
      cidade: linha.cidade,
      triado: !!linha.triado,
    };
  });

export const ultimasTriagens = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await clienteDeModulo(context.supabase)
      .from("recebimentos")
      .select("id, codigo_bipado, resultado, mensagem, created_at")
      .eq("stage", "triagem")
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []).map((r) => ({
      id: r.id as string,
      codigo_bipado: r.codigo_bipado as string,
      resultado: r.resultado as string,
      mensagem: (r.mensagem as string) ?? null,
      created_at: r.created_at as string,
      rotas: null as { codigo: string } | null,
    }));
  });

export const triagemResumoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const supabase = clienteDeModulo(context.supabase);
    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();

    let totalPrev = 0;
    let triados = 0;
    if (impAtiva) {
      const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
      const [{ count: p }, { count: t }] = await Promise.all([
        supabaseAdmin
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", ""),
        supabaseAdmin
          .from("escalas")
          .select("id", { count: "exact", head: true })
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", "")
          .eq("triado", true),
      ]);
      totalPrev = p ?? 0;
      triados = t ?? 0;
    }

    const { count: meus } = await supabase
      .from("recebimentos")
      .select("id", { count: "exact", head: true })
      .eq("stage", "triagem")
      .eq("operador_id", userId)
      .eq("resultado", "ok")
      .gte("created_at", start.toISOString());

    return {
      totalPrevistos: totalPrev,
      totalTriados: triados,
      pendentes: Math.max(totalPrev - triados, 0),
      meusHoje: meus ?? 0,
      temImportacao: !!impAtiva,
    };
  });

export const triagemShipmentsPendentes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        rota: z.string().trim().min(1).max(120),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const supabase = clienteDeModulo(context.supabase);
    const { data: impAtiva } = await supabase
      .from("importacoes_escala")
      .select("id")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .eq("ativa", true)
      .maybeSingle();
    if (!impAtiva)
      return {
        rota: data.rota,
        pendentes: [] as Array<{ shipment: string; cidade: string | null }>,
        triados: [] as Array<{ shipment: string; cidade: string | null }>,
      };

    const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);

    const PAGE = ESCALAS_PAGE_SIZE;
    type LinhaRota = {
      id: string;
      shipment: string | null;
      cidade: string | null;
      triado: boolean | null;
    };
    const carregar = async (modo: "otimizada" | "planejadaNula" | "planejadaVazia") => {
      const resultado: LinhaRota[] = [];
      for (let from = 0; ; from += PAGE) {
        let query = supabaseAdmin
          .from("escalas")
          .select("id, shipment, cidade, triado")
          .eq("importacao_id", impAtiva.id)
          .not("shipment", "is", null)
          .neq("shipment", "")
          .order("id", { ascending: true });
        if (modo === "otimizada") {
          query = query.eq("otimizada", data.rota);
        } else if (modo === "planejadaNula") {
          query = query.is("otimizada", null).eq("planejada", data.rota);
        } else {
          query = query.eq("otimizada", "").eq("planejada", data.rota);
        }
        const { data: page, error } = await query.range(from, from + PAGE - 1);
        if (error) throw new Error(error.message);
        if (!page || page.length === 0) break;
        resultado.push(...page);
        if (page.length < PAGE) break;
      }
      return resultado;
    };
    const [otimizadas, planejadasNulas, planejadasVazias] = await Promise.all([
      carregar("otimizada"),
      carregar("planejadaNula"),
      carregar("planejadaVazia"),
    ]);
    const rows = Array.from(
      new Map(
        [...otimizadas, ...planejadasNulas, ...planejadasVazias].map((linha) => [linha.id, linha]),
      ).values(),
    );
    const pendentes = rows
      .filter((r) => !r.triado && r.shipment)
      .map((r) => ({ shipment: r.shipment as string, cidade: r.cidade }))
      .sort((a, b) => a.shipment.localeCompare(b.shipment));
    const triados = rows
      .filter((r) => r.triado && r.shipment)
      .map((r) => ({ shipment: r.shipment as string, cidade: r.cidade }))
      .sort((a, b) => a.shipment.localeCompare(b.shipment));
    return { rota: data.rota, pendentes, triados };
  });
