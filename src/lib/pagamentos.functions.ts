import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calcularRotas,
  resumirMotoristas,
  semanaPagamento,
  type Adicional,
  type MotoristaResumo,
  type RotaEntrada,
  type Tarifa,
  type TipoVeiculo,
} from "@/lib/pagamentos-domain";

export const BASES_PAGAMENTO = ["ESP15", "ESP16", "ESP17", "ESP18"] as const;

export type PreviaPagamento = {
  status: "ok" | "erro";
  erro?: string;
  avisos: string[];
  semana: { inicio: string; fim: string; pagamento: string };
  bases: Array<{ id: string; codigo: string; nome: string }>;
  motoristas: MotoristaResumo[];
};

export const previaPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<PreviaPagamento> => {
    const semana = semanaPagamento(data.data);
    const vazio = { avisos: [], semana, bases: [], motoristas: [] };
    // Tabelas novas ainda não estão nos tipos gerados.
    const db = context.supabase as unknown as SupabaseClient;

    const { data: papeis } = await db.from("user_roles").select("role").eq("user_id", context.userId);
    const roles = (papeis ?? []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => ["admin", "gerente", "supervisor"].includes(r))) {
      return { ...vazio, status: "erro", erro: "Acesso restrito à gestão." };
    }

    const { data: bases, error: eb } = await db.from("bases").select("id,codigo,nome").in("codigo", [...BASES_PAGAMENTO]);
    if (eb) return { ...vazio, status: "erro", erro: "Não foi possível ler as bases." };
    const baseIds = (bases ?? []).map((b: { id: string }) => b.id);
    const codigoPorBase = new Map((bases ?? []).map((b: { id: string; codigo: string }) => [b.id, b.codigo]));

    const rotasDb: Array<Record<string, unknown>> = [];
    for (let de = 0; ; de += 1000) {
      const { data: lote, error } = await db
        .from("meli_rotas")
        .select("route_id,data_rota,base_id,cluster,driver_id,motorista_id,driver_name,vehicle_license,total_pacotes,delivered_total")
        .in("base_id", baseIds)
        .gte("data_rota", semana.inicio)
        .lte("data_rota", semana.fim)
        .order("route_id")
        .range(de, de + 999);
      if (error) return { ...vazio, status: "erro", erro: "Não foi possível ler as rotas." };
      rotasDb.push(...(lote ?? []));
      if (!lote || lote.length < 1000) break;
    }

    const rotas: RotaEntrada[] = rotasDb.map((r) => ({
      route_id: String(r["route_id"]),
      data_rota: (r["data_rota"] as string | null)?.slice(0, 10) ?? null,
      base_id: (r["base_id"] as string | null) ?? null,
      base_codigo: codigoPorBase.get(r["base_id"] as string) ?? null,
      regiao: (r["cluster"] as string | null) ?? null,
      motorista_id: (r["driver_id"] as string | null) ?? (r["motorista_id"] as string | null) ?? null,
      motorista_nome: (r["driver_name"] as string | null) ?? null,
      placa: (r["vehicle_license"] as string | null) ?? null,
      total_pedidos: (r["total_pacotes"] as number | null) ?? null,
      entregues: (r["delivered_total"] as number | null) ?? null,
    }));

    const avisos: string[] = [];
    const tarifasRes = await db.from("pagamento_tarifas").select("tipo_veiculo,base_id,regiao,valor,vigencia_inicio,vigencia_fim").eq("ativo", true);
    if (tarifasRes.error) avisos.push("Tabela de tarifas ainda não criada: nenhuma rota recebe valor.");
    const veiculosRes = await db.from("pagamento_veiculos").select("placa,tipo_veiculo").eq("ativo", true);
    if (veiculosRes.error) avisos.push("Cadastro de placas ainda não criado: todas as placas aparecem sem tipo.");
    const adicionaisRes = await db.from("pagamento_adicionais").select("motorista_chave,valor,motivo,observacao,data_relacionada").eq("semana_inicio", semana.inicio).eq("is_active", true);

    const tarifas = ((tarifasRes.data ?? []) as Tarifa[]).map((t) => ({ ...t, valor: Number(t.valor) }));
    const tipos = new Map<string, TipoVeiculo>(((veiculosRes.data ?? []) as Array<{ placa: string; tipo_veiculo: TipoVeiculo }>).map((v) => [v.placa, v.tipo_veiculo]));
    const adicionais = ((adicionaisRes.data ?? []) as Adicional[]).map((a) => ({ ...a, valor: Number(a.valor) }));

    const calculadas = calcularRotas(rotas, tipos, tarifas);
    return { status: "ok", avisos, semana, bases: (bases ?? []) as PreviaPagamento["bases"], motoristas: resumirMotoristas(calculadas, adicionais) };
  });
