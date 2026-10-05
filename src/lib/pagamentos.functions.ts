import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BASES_PAGAMENTO = ["ESP15", "ESP16", "ESP17", "ESP18"] as const;
const semanaSchema = z.object({
  semanaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  baseCodigo: z.enum(BASES_PAGAMENTO).nullable().optional(),
});

async function assertGestao(supabase: any, userId: string, aprovador = false) {
  const papeis = aprovador ? (["admin", "gerente"] as const) : (["admin", "gerente", "supervisor"] as const);
  const resultados = await Promise.all(papeis.map((role) => supabase.rpc("has_role", { _user_id: userId, _role: role })));
  if (!resultados.some((r) => !r.error && r.data)) throw new Error(aprovador ? "Acesso restrito a administradores e gerentes." : "Acesso restrito à gestão.");
}

export type PagamentoRota = {
  rota_uuid: string; route_id: string; data_rota: string; base_id: string; base_codigo: string;
  motorista_id: string | null; meli_driver_id: string | null; motorista_nome: string; placa: string | null;
  tipo_veiculo: "passeio" | "utilitario" | "vuc" | null; total_pedidos: number; pedidos_entregues: number;
  percentual_entregue: number; percentual_minimo: number; pagavel: boolean; motivo_nao_pagavel: string | null;
  valor_rota: number; valor_extras: number; valor_total: number;
};

export const listarPagamentosSemana = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => semanaSchema.parse(input))
  .handler(async ({ data, context }): Promise<PagamentoRota[]> => {
    await assertGestao(context.supabase, context.userId);
    const inicio = new Date(`${data.semanaInicio}T12:00:00Z`);
    if (inicio.getUTCDay() !== 0) throw new Error("A semana deve começar em um domingo.");
    const { data: linhas, error } = await (context.supabase as any).rpc("pagamentos_previa_semanal", {
      p_semana_inicio: data.semanaInicio,
      p_base_codigo: data.baseCodigo ?? null,
    });
    if (error) throw new Error(error.message);
    return ((linhas ?? []) as any[]).map((r) => ({ ...r,
      total_pedidos: Number(r.total_pedidos ?? 0), pedidos_entregues: Number(r.pedidos_entregues ?? 0),
      percentual_entregue: Number(r.percentual_entregue ?? 0), percentual_minimo: Number(r.percentual_minimo ?? 90),
      valor_rota: Number(r.valor_rota ?? 0), valor_extras: Number(r.valor_extras ?? 0), valor_total: Number(r.valor_total ?? 0),
    }));
  });

const veiculoSchema = z.object({
  meliDriverId: z.string().trim().min(1).max(100), motoristaId: z.string().uuid().nullable().optional(),
  tipoVeiculo: z.enum(["passeio", "utilitario", "vuc"]), placa: z.string().trim().max(20).nullable().optional(),
  vigenciaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export const salvarVeiculoMotorista = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => veiculoSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertGestao(context.supabase, context.userId, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const anterior = new Date(`${data.vigenciaInicio}T12:00:00Z`); anterior.setUTCDate(anterior.getUTCDate() - 1);
    await (supabaseAdmin as any).from("motorista_veiculos").update({ ativo: false, vigencia_fim: anterior.toISOString().slice(0, 10) })
      .eq("meli_driver_id", data.meliDriverId).eq("ativo", true).lt("vigencia_inicio", data.vigenciaInicio);
    const { error } = await (supabaseAdmin as any).from("motorista_veiculos").upsert({
      meli_driver_id: data.meliDriverId, motorista_id: data.motoristaId ?? null, tipo_veiculo: data.tipoVeiculo,
      placa: data.placa || null, vigencia_inicio: data.vigenciaInicio, ativo: true, criado_por: context.userId,
    }, { onConflict: "meli_driver_id,vigencia_inicio" });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({ user_id: context.userId, acao: "pagamento.veiculo_configurado", entidade: "motorista", entidade_id: data.motoristaId ?? null, detalhes: data });
    return { ok: true };
  });

const extraSchema = z.object({
  semanaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), rotaUuid: z.string().uuid(),
  valor: z.number().positive().max(10000), motivo: z.enum(["domingo", "feriado", "outro"]),
  observacao: z.string().trim().max(500).nullable().optional(), permitirRotaNaoPagavel: z.boolean().default(false),
});
export const adicionarExtraPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => extraSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertGestao(context.supabase, context.userId, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const agora = new Date().toISOString();
    const { data: criado, error } = await (supabaseAdmin as any).from("pagamento_extras").insert({
      semana_inicio: data.semanaInicio, meli_rota_id: data.rotaUuid, valor: data.valor, motivo: data.motivo,
      observacao: data.observacao || null, permitir_rota_nao_pagavel: data.permitirRotaNaoPagavel,
      aprovado_por: data.permitirRotaNaoPagavel ? context.userId : null,
      aprovado_em: data.permitirRotaNaoPagavel ? agora : null, criado_por: context.userId,
    }).select("id").single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("audit_logs").insert({ user_id: context.userId, acao: "pagamento.extra_adicionado", entidade: "pagamento_extra", entidade_id: criado.id, detalhes: data });
    return { id: criado.id };
  });

export const gerarFechamentosSemana = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => semanaSchema.pick({ semanaInicio: true }).parse(input))
  .handler(async ({ data, context }) => {
    await assertGestao(context.supabase, context.userId, true);
    const { data: ids, error } = await (context.supabase as any).rpc("pagamentos_gerar_fechamentos", { p_semana_inicio: data.semanaInicio });
    if (error) throw new Error(error.message);
    return { ids: ids ?? [] };
  });

export const listarFechamentosSemana = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => semanaSchema.pick({ semanaInicio: true }).parse(input))
  .handler(async ({ data, context }) => {
    await assertGestao(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin as any).from("pagamento_fechamentos")
      .select("id,base_id,semana_inicio,semana_fim,pagamento_previsto,status,total_rotas,rotas_pagaveis,rotas_nao_pagaveis,valor_rotas,valor_extras,valor_total,bases(codigo,nome)")
      .eq("semana_inicio", data.semanaInicio).order("base_id");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const statusSchema = z.object({ fechamentoId: z.string().uuid(), status: z.enum(["conferido","aprovado","enviado_financeiro","pago","cancelado"]), observacao: z.string().trim().max(500).nullable().optional() });
export const atualizarStatusFechamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth]).inputValidator((input: unknown) => statusSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertGestao(context.supabase, context.userId, true);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: atual, error: buscaErro } = await (supabaseAdmin as any).from("pagamento_fechamentos").select("status").eq("id", data.fechamentoId).single();
    if (buscaErro) throw new Error(buscaErro.message);
    const transicoes: Record<string, string[]> = { rascunho: ["conferido","cancelado"], conferido: ["aprovado","cancelado"], aprovado: ["enviado_financeiro","cancelado"], enviado_financeiro: ["pago","cancelado"] };
    if (!transicoes[atual.status]?.includes(data.status)) throw new Error(`Transição inválida: ${atual.status} → ${data.status}.`);
    const agora = new Date().toISOString(); const patch: Record<string, unknown> = { status: data.status, atualizado_em: agora, observacao: data.observacao || null };
    if (data.status === "conferido") Object.assign(patch, { conferido_por: context.userId, conferido_em: agora });
    if (data.status === "aprovado") Object.assign(patch, { aprovado_por: context.userId, aprovado_em: agora });
    if (data.status === "enviado_financeiro") Object.assign(patch, { enviado_financeiro_por: context.userId, enviado_financeiro_em: agora });
    if (data.status === "pago") Object.assign(patch, { pago_por: context.userId, pago_em: agora });
    const { error } = await (supabaseAdmin as any).from("pagamento_fechamentos").update(patch).eq("id", data.fechamentoId);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any).from("pagamento_status_historico").insert({ fechamento_id: data.fechamentoId, status_anterior: atual.status, status_novo: data.status, observacao: data.observacao || null, alterado_por: context.userId });
    await supabaseAdmin.from("audit_logs").insert({ user_id: context.userId, acao: "pagamento.status_alterado", entidade: "pagamento_fechamento", entidade_id: data.fechamentoId, detalhes: { anterior: atual.status, novo: data.status, observacao: data.observacao } });
    return { ok: true };
  });
