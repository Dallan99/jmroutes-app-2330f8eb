import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { MotivoDevolucao } from "@/lib/devolucoes.functions";
import type { TratamentoDevolucao } from "@/lib/devolucao-lotes-domain";

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type LoteDevolucao = {
  id: string;
  codigo: string;
  nome_exibicao: string;
  base_id: string;
  data_operacional: string;
  sequencia: number;
  estado: "aberta" | "finalizada";
  criado_por: string;
  criado_por_nome?: string | null;
  criado_em: string;
  finalizado_por: string | null;
  finalizado_em: string | null;
  total_pacotes: number;
};

export type LoteAbertoResult =
  | { status: "ok" | "ja_aberto"; lote: LoteDevolucao }
  | { status: "sem_lote" }
  | { status: "erro"; mensagem: string };

const baseDia = z.object({ baseId: z.string().uuid(), diaOperacional: dia });

export const criarLoteDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => baseDia.parse(d))
  .handler(async ({ data, context }): Promise<LoteAbertoResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_lote_criar",
      { p_base_id: data.baseId, p_data_operacional: data.diaOperacional },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as LoteAbertoResult;
  });

export const loteAbertoDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => baseDia.parse(d))
  .handler(async ({ data, context }): Promise<LoteAbertoResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_lote_aberto",
      { p_base_id: data.baseId, p_data_operacional: data.diaOperacional },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as LoteAbertoResult;
  });

export type BiparLoteResult = {
  status:
    | "ok"
    | "duplicado"
    | "base_divergente"
    | "lote_finalizado"
    | "observacao_obrigatoria"
    | "erro";
  mensagem?: string;
  base_correta?: string | null;
  devolvido_em?: string;
  occurrence_code?: string | null;
  motivo?: MotivoDevolucao;
  motivo_descricao?: string;
  total_pacotes?: number;
  devolucao?: {
    id: string;
    shipment_codigo: string;
    motivo: MotivoDevolucao;
    motivo_descricao: string | null;
    occurrence_code: string | null;
    meli_status: string | null;
    meli_substatus: string | null;
    tratamento: TratamentoDevolucao | null;
    divergencia_delivered: boolean;
    rota: string | null;
    motorista: string | null;
    devolvido_em: string;
  };
};

export const biparLoteDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        loteId: z.string().uuid(),
        codigo: z.string().trim().min(1).max(120),
        observacao: z.string().trim().max(500).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<BiparLoteResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_lote_bipar",
      { p_lote_id: data.loteId, p_codigo: data.codigo, p_observacao: data.observacao ?? null },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as BiparLoteResult;
  });

export type FinalizarLoteResult = {
  status: "ok" | "erro";
  mensagem?: string;
  lote?: LoteDevolucao;
  resumo?: { occurrence_code: string; motivo_descricao: string; total: number }[];
  trackings?: string[];
};

export const finalizarLoteDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ loteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<FinalizarLoteResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_lote_finalizar",
      { p_lote_id: data.loteId },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as FinalizarLoteResult;
  });

export const reabrirLoteDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({ loteId: z.string().uuid(), justificativa: z.string().trim().min(5).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ status: "ok" | "erro"; mensagem?: string }> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_lote_reabrir",
      { p_lote_id: data.loteId, p_justificativa: data.justificativa },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as { status: "ok" | "erro"; mensagem?: string };
  });

export const corrigirMotivoDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        devolucaoId: z.string().uuid(),
        motivo: z.enum([
          "cliente_ausente",
          "endereco_nao_localizado",
          "recusado",
          "avaria",
          "zona_de_risco",
          "comercio_fechado",
          "outros",
        ]),
        justificativa: z.string().trim().min(5).max(500),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ status: "ok" | "erro"; mensagem?: string }> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "devolucao_corrigir_motivo",
      {
        p_devolucao_id: data.devolucaoId,
        p_motivo: data.motivo,
        p_justificativa: data.justificativa,
      },
    );
    if (error) return { status: "erro", mensagem: error.message };
    return res as { status: "ok" | "erro"; mensagem?: string };
  });

/** Lista os lotes da base/dia (aberto e finalizados) para consulta e impressão. */
export const listarLotesDevolucao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => baseDia.parse(d))
  .handler(async ({ data, context }): Promise<LoteDevolucao[]> => {
    const { data: rows, error } = await clienteDeModulo(context.supabase)
      .from("devolucao_lotes")
      .select(
        "id, codigo, nome_exibicao, base_id, data_operacional, sequencia, estado, criado_por, criado_em, finalizado_por, finalizado_em, total_pacotes",
      )
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.diaOperacional)
      .order("sequencia", { ascending: true });
    if (error) throw new Error(error.message);
    return (rows ?? []) as unknown as LoteDevolucao[];
  });
