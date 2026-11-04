import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const filtroSchema = z.object({
  base_codigo: z.string().trim().toUpperCase().regex(/^(ESP|SSP|SSC)\d+$/).default("ESP18"),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type MonitoramentoRota = {
  id: string;
  route_id: string;
  nome_rota: string | null;
  motorista: string | null;
  placa: string | null;
  status: string | null;
  substatus: string | null;
  total: number;
  entregues: number;
  falhas: number;
  pendentes: number;
  sacas: number;
  saida_xpt_em: string | null;
  primeira_entrega_em: string | null;
  coletado_em: string;
};

export type MonitoramentoRotasResult = {
  status: "ok" | "erro";
  erro?: string;
  base_codigo: string;
  data_operacional: string;
  rotas: MonitoramentoRota[];
  atualizado_em: string | null;
};

function hojeSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export const monitoramentoRotasTempoReal = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((entrada: unknown) => filtroSchema.parse(entrada ?? {}))
  .handler(async ({ data, context }): Promise<MonitoramentoRotasResult> => {
    const dataOperacional = data.data ?? hojeSaoPaulo();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: papel } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .in("role", ["admin", "gerente", "supervisor"])
      .limit(1)
      .maybeSingle();
    if (!papel) {
      return { status: "erro", erro: "sem_permissao", base_codigo: data.base_codigo, data_operacional: dataOperacional, rotas: [], atualizado_em: null };
    }

    const { data: rotas, error } = await (supabaseAdmin as any)
      .from("meli_monitoramento_rotas")
      .select("id,route_id,nome_rota,motorista,placa,status,substatus,total,entregues,falhas,pendentes,sacas,saida_xpt_em,primeira_entrega_em,coletado_em")
      .eq("base_codigo", data.base_codigo)
      .eq("data_operacional", dataOperacional)
      .order("entregues", { ascending: false })
      .order("nome_rota", { ascending: true });

    if (error) {
      return { status: "erro", erro: error.message, base_codigo: data.base_codigo, data_operacional: dataOperacional, rotas: [], atualizado_em: null };
    }
    const lista = (rotas ?? []) as MonitoramentoRota[];
    return {
      status: "ok",
      base_codigo: data.base_codigo,
      data_operacional: dataOperacional,
      rotas: lista,
      atualizado_em: lista.reduce<string | null>((maisRecente, rota) =>
        !maisRecente || rota.coletado_em > maisRecente ? rota.coletado_em : maisRecente, null),
    };
  });

