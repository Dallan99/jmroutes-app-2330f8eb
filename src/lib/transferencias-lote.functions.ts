import { clienteDeModulo } from "@/lib/modulo-em-implantacao";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const dataSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const etapaSchema = z.enum(["chegada_service", "saida_service", "chegada_xpt", "saida_xpt"]);

const linhaCadastroSchema = z.object({
  service: z.string().trim().min(2).max(120),
  motorista: z.string().trim().min(2).max(160),
  placa: z.string().trim().min(5).max(20),
  tipoVeiculo: z.string().trim().max(80).optional(),
});

export type LinhaCadastroTransferencia = z.infer<typeof linhaCadastroSchema>;

export type ResultadoLote = {
  total: number;
  sucessos: number;
  falhas: number;
  detalhes: Array<{
    referencia: string;
    ok: boolean;
    mensagem: string;
  }>;
};

export const criarTransferenciasLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        dataOperacional: dataSchema,
        linhas: z.array(linhaCadastroSchema).min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoLote> => {
    const detalhes: ResultadoLote["detalhes"] = [];

    for (const linha of data.linhas) {
      const referencia = `${linha.placa.toUpperCase()} · ${linha.motorista}`;
      const { data: result, error } = await (context.supabase.rpc as any)("criar_transferencia", {
        p_base_id: data.baseId,
        p_data_operacional: data.dataOperacional,
        p_service: linha.service,
        p_motorista: linha.motorista,
        p_placa: linha.placa.toUpperCase(),
        p_tipo_veiculo: linha.tipoVeiculo || null,
        p_observacao: "Criada pela operação em lote",
      });

      detalhes.push({
        referencia,
        ok: !error,
        mensagem: error?.message ?? `Criada: ${(result as { codigo?: string } | null)?.codigo ?? "OK"}`,
      });
    }

    const sucessos = detalhes.filter((d) => d.ok).length;
    return { total: detalhes.length, sucessos, falhas: detalhes.length - sucessos, detalhes };
  });
export const registrarMarcosTransferenciaLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        transferenciaIds: z.array(z.string().uuid()).min(1).max(200),
        etapa: etapaSchema,
        ocorridoEm: z.string().datetime({ offset: true }),
        localizacaoTexto: z.string().trim().min(2).max(300),
        responsabilidade: z.enum(["JM_FROTA", "MELI", "EXTERNO", "EM_ANALISE"]).optional(),
        motivoCodigo: z.string().trim().max(80).optional(),
        observacao: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<ResultadoLote> => {
    const detalhes: ResultadoLote["detalhes"] = [];

    for (const transferenciaId of data.transferenciaIds) {
      const { data: transferencia } = await clienteDeModulo(context.supabase)
        .from("transferencias")
        .select("codigo, placa, motorista")
        .eq("id", transferenciaId)
        .maybeSingle();

      const referencia = transferencia
        ? `${transferencia.codigo} · ${transferencia.placa} · ${transferencia.motorista}`
        : transferenciaId;

      let { error } = await (context.supabase.rpc as any)("registrar_evento_transferencia_v2", {
        p_transferencia_id: transferenciaId,
        p_etapa: data.etapa,
        p_ocorrido_em: data.ocorridoEm,
        p_storage_path: null,
        p_timemark_url: null,
        p_horario_evidencia: null,
        p_localizacao_texto: data.localizacaoTexto,
        p_motivo_codigo: data.motivoCodigo || null,
        p_responsabilidade: data.responsabilidade || null,
        p_observacao: data.observacao || "Marco registrado pela operação em lote; evidência pendente.",
      });

      const v2Ausente = error?.code === "PGRST202" || error?.message.includes("registrar_evento_transferencia_v2");
      if (v2Ausente && data.etapa !== "saida_xpt") {
        const legado = await (context.supabase.rpc as any)("registrar_evento_transferencia", {
          p_transferencia_id: transferenciaId,
          p_etapa: data.etapa,
          p_ocorrido_em: data.ocorridoEm,
          p_storage_path: null,
          p_timemark_url: null,
          p_horario_evidencia: null,
          p_localizacao_texto: data.localizacaoTexto,
          p_motivo_codigo: data.motivoCodigo || "OUTRO",
          p_responsabilidade: data.responsabilidade || "EM_ANALISE",
          p_observacao: data.observacao || "Pendente de classificação operacional.",
        });
        error = legado.error;
      } else if (v2Ausente && data.etapa === "saida_xpt") {
        error = { ...(error as any), message: "A etapa Saída do XPT aguarda a atualização do banco." } as any;
      }

      detalhes.push({
        referencia,
        ok: !error,
        mensagem: error?.message ?? "Marco registrado; evidência pendente.",
      });
    }

    const sucessos = detalhes.filter((d) => d.ok).length;
    return { total: detalhes.length, sucessos, falhas: detalhes.length - sucessos, detalhes };
  });
