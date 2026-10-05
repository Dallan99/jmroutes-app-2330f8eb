import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  calcularRotas,
  resumirMotoristas,
  criarClassificador,
  normalizarPlaca,
  semanaPagamento,
  type VeiculoVigencia,
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
  podeCadastrar: boolean;
  semana: { inicio: string; fim: string; pagamento: string };
  bases: Array<{ id: string; codigo: string; nome: string }>;
  motoristas: MotoristaResumo[];
};

export const previaPagamento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<PreviaPagamento> => {
    const semana = semanaPagamento(data.data);
    const vazio = { avisos: [] as string[], semana, bases: [], motoristas: [], podeCadastrar: false };
    // Tabelas novas ainda não estão nos tipos gerados.
    const db = context.supabase as unknown as SupabaseClient;

    const { data: papeis } = await db.from("user_roles").select("role").eq("user_id", context.userId);
    const roles = (papeis ?? []).map((r: { role: string }) => r.role);
    if (!roles.some((r) => ["admin", "gerente", "supervisor"].includes(r))) {
      return { ...vazio, podeCadastrar: false, status: "erro", erro: "Acesso restrito à gestão." };
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
    const veiculosRes = await db.from("pagamento_veiculos").select("placa,tipo_veiculo,vigencia_inicio,ativo");
    if (veiculosRes.error) avisos.push("Cadastro de placas ainda não criado: todas as placas aparecem sem tipo.");
    const adicionaisRes = await db.from("pagamento_adicionais").select("motorista_chave,valor,motivo,observacao,data_relacionada").eq("semana_inicio", semana.inicio).eq("is_active", true);

    const tarifas = ((tarifasRes.data ?? []) as Tarifa[]).map((t) => ({ ...t, valor: Number(t.valor) }));
    const tipos = criarClassificador((veiculosRes.data ?? []) as VeiculoVigencia[]);
    const adicionais = ((adicionaisRes.data ?? []) as Adicional[]).map((a) => ({ ...a, valor: Number(a.valor) }));

    const calculadas = calcularRotas(rotas, tipos, tarifas);
    return {
      status: "ok", avisos, semana, podeCadastrar: true,
      bases: (bases ?? []) as PreviaPagamento["bases"],
      motoristas: resumirMotoristas(calculadas, adicionais),
    };
  });

const GESTAO = ["admin", "gerente", "supervisor"];

async function papeisDe(db: SupabaseClient, userId: string) {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r: { role: string }) => r.role);
}

export type VeiculoCadastro = {
  id: string; placa: string; tipo_veiculo: TipoVeiculo; base_padrao_id: string | null; descricao: string | null;
  ativo: boolean; vigencia_inicio: string; observacao: string | null; criado_por: string; atualizado_por: string | null;
  created_at: string; updated_at: string;
};

export const listarVeiculos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const [roles, res, bases] = await Promise.all([
      papeisDe(db, context.userId),
      db.from("pagamento_veiculos").select("*").order("placa").order("vigencia_inicio", { ascending: false }),
      db.from("bases").select("id,codigo,nome").in("codigo", [...BASES_PAGAMENTO]),
    ]);
    return {
      podeEditar: roles.some((r) => GESTAO.includes(r)),
      erro: res.error ? "Cadastro de veículos ainda não disponível neste banco." : null,
      veiculos: (res.data ?? []) as VeiculoCadastro[],
      bases: (bases.data ?? []) as Array<{ id: string; codigo: string; nome: string }>,
    };
  });

const veiculoSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  placa: z.string().min(5).max(10),
  tipo_veiculo: z.enum(["carro", "utilitario", "vuc"]),
  base_padrao_id: z.string().uuid().optional().nullable(),
  descricao: z.string().max(120).optional().nullable(),
  ativo: z.boolean(),
  vigencia_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  observacao: z.string().max(500).optional().nullable(),
});

/**
 * Salva a classificação. Mudar categoria nunca sobrescreve: cria nova vigência,
 * e rotas anteriores continuam com a categoria da época.
 */
export const salvarVeiculo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => veiculoSchema.parse(d))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as SupabaseClient;
    const roles = await papeisDe(db, context.userId);
    if (!roles.some((r) => GESTAO.includes(r))) return { ok: false as const, erro: "Somente Administrador, Gerente ou Supervisor." };
    const placa = normalizarPlaca(data.placa);
    if (!placa || !/^[A-Z0-9]{5,8}$/.test(placa)) return { ok: false as const, erro: "Placa inválida." };

    if (data.id) {
      const { data: atual } = await db.from("pagamento_veiculos").select("tipo_veiculo,vigencia_inicio").eq("id", data.id).maybeSingle();
      const mudouCategoria = atual && (atual.tipo_veiculo !== data.tipo_veiculo || atual.vigencia_inicio !== data.vigencia_inicio);
      if (!mudouCategoria) {
        const { error } = await db.from("pagamento_veiculos").update({
          base_padrao_id: data.base_padrao_id ?? null, descricao: data.descricao ?? null,
          ativo: data.ativo, observacao: data.observacao ?? null,
        }).eq("id", data.id);
        return error ? { ok: false as const, erro: "Não foi possível salvar." } : { ok: true as const };
      }
      if (!data.observacao?.trim()) return { ok: false as const, erro: "Informe o motivo da mudança de categoria na observação." };
    }
    const { error } = await db.from("pagamento_veiculos").insert({
      placa, tipo_veiculo: data.tipo_veiculo, base_padrao_id: data.base_padrao_id ?? null,
      descricao: data.descricao ?? null, ativo: data.ativo, vigencia_inicio: data.vigencia_inicio,
      observacao: data.observacao ?? null, criado_por: context.userId,
    });
    if (error) return { ok: false as const, erro: error.code === "23505" ? "Já existe uma vigência dessa placa nessa data." : "Não foi possível salvar." };
    return { ok: true as const };
  });
