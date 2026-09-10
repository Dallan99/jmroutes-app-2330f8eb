import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const bipSchema = z.object({
  codigo: z.string().trim().min(3).max(120).transform((s) => s.replace(/[^0-9A-Za-z]/g, "")),
  tempoDesdeUltimaMs: z.number().int().nonnegative().optional(),
  // Fase 2 — contexto operacional usado apenas para o fallback de pacotes Meli.
  baseId: z.string().uuid().optional(),
  dataOperacional: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});


export type BipResult = {
  resultado:
    | "ok"
    | "duplicado"
    | "inexistente"
    | "outra_rota"
    | "outra_base"
    | "cancelada"
    | "encerrada"
    | "volume_repetido";
  mensagem: string;
  hora: string;
  rota?: {
    id: string;
    codigo: string;
    cidade: string;
    motorista: string | null;
    placa: string | null;
    base_codigo: string | null;
    base_nome: string | null;
    base_origem_codigo: string | null;
    pack_id: string | null;
    nf: string | null;
    rota_final: string | null;
    destinatario_nome: string | null;
    destinatario_cep: string | null;
    destinatario_endereco: string | null;
    data_prevista: string | null;
    janela_despacho: string | null;
    quantidade_prevista: number;
    quantidade_recebida: number;
    percentual: number;
    status: string;
  };
  volume?: { codigo: string; sequencia: number; total: number };
};

export const bipar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => bipSchema.parse(data))
  .handler(async ({ data, context }): Promise<BipResult> => {
    const { supabase, userId } = context;
    const { auditRequestMeta, registrarAuditInterno } = await import("./audit.server");
    const now = new Date();
    const hora = now.toISOString();

    // Base do operador (pra validar "outra_base")
    const { data: perfil } = await supabase
      .from("profiles")
      .select("base_id")
      .eq("id", userId)
      .maybeSingle();
    const baseOperadorId = perfil?.base_id ?? null;

    // Captura IP / UA
    const { ip, user_agent: userAgent } = auditRequestMeta();
    const tempo = data.tempoDesdeUltimaMs ?? null;

    async function logResult(
      resultado: BipResult["resultado"],
      mensagem: string,
      rotaId: string | null,
      volumeId: string | null,
      baseId: string | null,
    ) {
      await supabase.from("recebimentos").insert({
        codigo_bipado: data.codigo,
        rota_id: rotaId,
        volume_id: volumeId,
        base_id: baseId,
        operador_id: userId,
        resultado,
        mensagem,
        ip,
        user_agent: userAgent,
        tempo_desde_ultima_ms: tempo,
      });
      await registrarAuditInterno(supabase, userId, {
        acao: `recebimento.${resultado}`,
        entidade: "rota",
        entidade_id: rotaId ?? volumeId ?? null,
        detalhes: { codigo: data.codigo, mensagem, base_id: baseId },
      });
    }

    // 1) Procura volume pelo código bipado
    const { data: volume } = await supabase
      .from("volumes")
      .select("id, codigo, sequencia, total, recebido, rota_id")
      .eq("codigo", data.codigo)
      .maybeSingle();

    if (!volume) {
      // 1.a) Fase 2 — pacote publicado pela Integração Meli como carga esperada.
      if (data.baseId && data.dataOperacional) {
        const { receberEscalaMeli } = await import("./recebimento-escala.server");
        const meli = await receberEscalaMeli(supabase as never, {
          codigo: data.codigo,
          baseId: data.baseId,
          dataOperacional: data.dataOperacional,
          userId,
          hora,
        });
        if (meli) {
          await logResult(
            meli.resultado,
            meli.mensagem,
            null,
            null,
            meli.baseId ?? data.baseId,
          );
          return {
            resultado: meli.resultado,
            mensagem: meli.mensagem,
            hora,
            rota: {
              id: meli.escalaId,
              codigo: meli.rotaCodigo,
              cidade: "",
              motorista: null,
              placa: null,
              base_codigo: null,
              base_nome: null,
              base_origem_codigo: null,
              pack_id: null,
              nf: null,
              rota_final: meli.rotaCodigo,
              destinatario_nome: null,
              destinatario_cep: null,
              destinatario_endereco: null,
              data_prevista: data.dataOperacional,
              janela_despacho: null,
              quantidade_prevista: meli.previstos,
              quantidade_recebida: meli.recebidos,
              percentual: meli.previstos
                ? Math.round((meli.recebidos / meli.previstos) * 100)
                : 0,
              status: "em_recebimento",
            },
            volume: { codigo: data.codigo, sequencia: 1, total: 1 },
          };
        }
      }

      // talvez o código seja o código da rota inteira — tratamos como inexistente para volume
      const msg = "Código não encontrado.";
      await logResult("inexistente", msg, null, null, null);
      return { resultado: "inexistente", mensagem: msg, hora };
    }


    // 2) Busca rota com joins
    const { data: rota } = await supabase
      .from("rotas")
      .select(
        "id, codigo, cidade, status, quantidade_prevista, base_id, pack_id, nf, rota_final, destinatario_nome, destinatario_cep, destinatario_endereco, data_prevista, janela_despacho, bases!rotas_base_id_fkey(codigo, nome), base_origem:bases!rotas_base_origem_id_fkey(codigo, nome), motoristas(nome, placa)",
      )
      .eq("id", volume.rota_id)
      .maybeSingle();

    if (!rota) {
      const msg = "Rota da etiqueta não encontrada.";
      await logResult("inexistente", msg, null, volume.id, null);
      return { resultado: "inexistente", mensagem: msg, hora };
    }

    type RotaJoin = typeof rota & {
      bases: { codigo: string; nome: string } | null;
      base_origem: { codigo: string; nome: string } | null;
      motoristas: { nome: string; placa: string | null } | null;
      pack_id: string | null;
      nf: string | null;
      rota_final: string | null;
      destinatario_nome: string | null;
      destinatario_cep: string | null;
      destinatario_endereco: string | null;
      data_prevista: string | null;
      janela_despacho: string | null;
    };
    const r = rota as RotaJoin;

    const buildRota = (recebidos: number, statusOverride?: string) => ({
      id: r.id,
      codigo: r.codigo,
      cidade: r.cidade,
      motorista: r.motoristas?.nome ?? null,
      placa: r.motoristas?.placa ?? null,
      base_codigo: r.bases?.codigo ?? null,
      base_nome: r.bases?.nome ?? null,
      base_origem_codigo: r.base_origem?.codigo ?? null,
      pack_id: r.pack_id,
      nf: r.nf,
      rota_final: r.rota_final,
      destinatario_nome: r.destinatario_nome,
      destinatario_cep: r.destinatario_cep,
      destinatario_endereco: r.destinatario_endereco,
      data_prevista: r.data_prevista,
      janela_despacho: r.janela_despacho,
      quantidade_prevista: r.quantidade_prevista,
      quantidade_recebida: recebidos,
      percentual: r.quantidade_prevista
        ? Math.round((recebidos / r.quantidade_prevista) * 100)
        : 0,
      status: statusOverride ?? r.status,
    });

    // 2.5) Volume não pertence à base do operador
    if (baseOperadorId && r.base_id !== baseOperadorId) {
      const { count: recebidos } = await supabase
        .from("volumes")
        .select("id", { count: "exact", head: true })
        .eq("rota_id", r.id)
        .eq("recebido", true);
      const msg = `Volume pertence à base ${r.bases?.codigo ?? "?"} — esta base não é o destino correto.`;
      await logResult("outra_base", msg, r.id, volume.id, r.base_id);
      return {
        resultado: "outra_base",
        mensagem: msg,
        hora,
        rota: buildRota(recebidos ?? 0),
        volume: { codigo: volume.codigo, sequencia: volume.sequencia, total: volume.total },
      };
    }

    // 3) Validações de status
    if (r.status === "cancelada") {
      const msg = `Rota ${r.codigo} está CANCELADA.`;
      await logResult("cancelada", msg, r.id, volume.id, r.base_id);
      const { count: recebidos } = await supabase
        .from("volumes")
        .select("id", { count: "exact", head: true })
        .eq("rota_id", r.id)
        .eq("recebido", true);
      return { resultado: "cancelada", mensagem: msg, hora, rota: buildRota(recebidos ?? 0), volume: { codigo: volume.codigo, sequencia: volume.sequencia, total: volume.total } };
    }
    if (r.status === "encerrada") {
      const msg = `Rota ${r.codigo} já está ENCERRADA.`;
      await logResult("encerrada", msg, r.id, volume.id, r.base_id);
      const { count: recebidos } = await supabase
        .from("volumes")
        .select("id", { count: "exact", head: true })
        .eq("rota_id", r.id)
        .eq("recebido", true);
      return { resultado: "encerrada", mensagem: msg, hora, rota: buildRota(recebidos ?? 0), volume: { codigo: volume.codigo, sequencia: volume.sequencia, total: volume.total } };
    }

    // 4) Volume já recebido?
    if (volume.recebido) {
      const msg = `Volume ${volume.sequencia}/${volume.total} já foi recebido.`;
      await logResult("duplicado", msg, r.id, volume.id, r.base_id);
      const { count: recebidos } = await supabase
        .from("volumes")
        .select("id", { count: "exact", head: true })
        .eq("rota_id", r.id)
        .eq("recebido", true);
      return {
        resultado: "duplicado",
        mensagem: msg,
        hora,
        rota: buildRota(recebidos ?? 0),
        volume: { codigo: volume.codigo, sequencia: volume.sequencia, total: volume.total },
      };
    }

    // 5) Marca volume como recebido
    await supabase
      .from("volumes")
      .update({ recebido: true, recebido_em: hora, recebido_por: userId })
      .eq("id", volume.id);

    // 6) Conta recebidos e atualiza status da rota
    const { count: recebidosCount } = await supabase
      .from("volumes")
      .select("id", { count: "exact", head: true })
      .eq("rota_id", r.id)
      .eq("recebido", true);
    const recebidos = recebidosCount ?? 0;

    let novoStatus: "em_recebimento" | "recebida_parcial" | "recebida_completa" = "em_recebimento";
    if (recebidos >= r.quantidade_prevista) novoStatus = "recebida_completa";
    else if (recebidos > 0) novoStatus = "recebida_parcial";

    if (novoStatus !== r.status) {
      await supabase.from("rotas").update({ status: novoStatus, updated_at: hora }).eq("id", r.id);
    }

    const mensagem =
      novoStatus === "recebida_completa"
        ? `Recebimento COMPLETO da rota ${r.codigo}.`
        : `Volume ${volume.sequencia}/${volume.total} registrado (${recebidos}/${r.quantidade_prevista}).`;

    await logResult("ok", mensagem, r.id, volume.id, r.base_id);

    return {
      resultado: "ok",
      mensagem,
      hora,
      rota: buildRota(recebidos, novoStatus),
      volume: { codigo: volume.codigo, sequencia: volume.sequencia, total: volume.total },
    };
  });

export const ultimasLeituras = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("recebimentos")
      .select("id, codigo_bipado, resultado, mensagem, created_at, rotas(codigo)")
      .order("created_at", { ascending: false })
      .limit(20);
    return (data ?? []) as Array<{
      id: string;
      codigo_bipado: string;
      resultado: BipResult["resultado"];
      mensagem: string | null;
      created_at: string;
      rotas: { codigo: string } | null;
    }>;
  });

export const meuPerfil = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const carregar = async () =>
      Promise.all([
        supabase.from("profiles").select("id, nome, email, matricula, base_id, bases(codigo, nome)").eq("id", userId).maybeSingle(),
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("user_bases").select("base_id, bases(id, codigo, nome, cidade)").eq("user_id", userId),
      ]);

    // "Could not query the database for the schema cache" é transitório (PostgREST
    // recarregando o cache). Tentamos novamente antes de falhar.
    const transitorio = (msg?: string) =>
      !!msg &&
      (msg.includes("schema cache") ||
        msg.includes("Retrying") ||
        msg.includes("Could not query the database") ||
        msg.includes("fetch failed") ||
        msg.includes("timeout"));

    let profile: Awaited<ReturnType<typeof carregar>>[0]["data"] = null;
    let roles: Awaited<ReturnType<typeof carregar>>[1]["data"] = null;
    let extras: Awaited<ReturnType<typeof carregar>>[2]["data"] = null;
    let primeiroErro: { message: string } | null = null;

    for (let tentativa = 0; tentativa < 6; tentativa++) {
      const [p, r, e] = await carregar();
      profile = p.data;
      roles = r.data;
      extras = e.data;
      primeiroErro = p.error ?? r.error ?? e.error ?? null;
      if (!primeiroErro) break;
      if (!transitorio(primeiroErro.message)) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * (tentativa + 1)));
    }

    // O PostgREST pode ficar temporariamente indisponível enquanto recompõe o
    // cache do schema. Nesse caso, devolvemos um estado restrito e explícito em
    // vez de derrubar toda a interface. O cliente consulta novamente até o
    // serviço recuperar; nenhum papel ou base é liberado pelo fallback.
    if (primeiroErro && transitorio(primeiroErro.message)) {
      return {
        profile: null,
        roles: [],
        acessoTotal: false,
        basesPermitidas: [],
        indisponivelTemporariamente: true,
      };
    }
    if (primeiroErro) throw new Error(`Falha ao carregar perfil: ${primeiroErro.message}`);

    const rolesArr = (roles ?? []).map((r) => r.role);
    const acessoTotal = rolesArr.includes("admin") || rolesArr.includes("gerente");
    const basesPermitidasMap = new Map<string, { id: string; codigo: string; nome: string; cidade: string | null }>();
    if (profile?.base_id && profile.bases) {
      basesPermitidasMap.set(profile.base_id, {
        id: profile.base_id,
        codigo: (profile.bases as { codigo: string }).codigo,
        nome: (profile.bases as { nome: string }).nome,
        cidade: null,
      });
    }
    (extras ?? []).forEach((e) => {
      const b = e.bases as { id: string; codigo: string; nome: string; cidade: string | null } | null;
      if (b?.id) basesPermitidasMap.set(b.id, b);
    });
    return {
      profile,
      roles: rolesArr,
      acessoTotal,
      basesPermitidas: Array.from(basesPermitidasMap.values()),
      indisponivelTemporariamente: false,
    };
  });