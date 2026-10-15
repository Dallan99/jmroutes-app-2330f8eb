import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error || !data) throw new Error("Acesso negado: apenas administradores.");
}

export type MotoristaCadastro = { id: string; nome: string; placa: string; meliDriverId: string; meliNome: string | null; ativo: boolean; createdAt: string; usuario: string | null; baseNome: string | null };

export const listarMotoristasCadastrados = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }): Promise<MotoristaCadastro[]> => {
  await assertAdmin(context.supabase, context.userId);
  const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
  const [{ data: motoristas, error }, { data: catalogo }] = await Promise.all([
    supabaseAdmin.from("motoristas").select("id, nome, placa, meli_driver_id, ativo, created_at, usuario, bases(nome)").not("meli_driver_id", "is", null).order("nome"),
    supabaseAdmin.from("meli_motoristas_catalogo").select("meli_driver_id, nome"),
  ]);
  if (error) throw new Error(error.message);
  const nomes = new Map((catalogo ?? []).map((m) => [m.meli_driver_id, m.nome]));
  return (motoristas ?? []).map((m) => ({ id: m.id, nome: m.nome, placa: m.placa ?? "", meliDriverId: m.meli_driver_id ?? "", meliNome: m.meli_driver_id ? nomes.get(m.meli_driver_id) ?? null : null, ativo: m.ativo, createdAt: m.created_at, usuario: m.usuario ?? null, baseNome: (m.bases as { nome?: string } | null)?.nome ?? null }));
});

export const listarBasesParaMotorista = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await assertAdmin(context.supabase, context.userId);
  const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
  const { data, error } = await supabaseAdmin.from("bases").select("id, codigo, nome").eq("ativa", true).order("codigo");
  if (error) throw new Error(error.message);
  return data ?? [];
});

const acessoSchema = z.object({ usuario: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9._-]+$/, "Use somente letras, números, ponto, traço ou sublinhado."), meliDriverId: z.string().trim().min(1).max(80), baseId: z.string().uuid().nullable(), senha: z.string().min(8).max(72), confirmarSenha: z.string().min(8).max(72) }).refine((d) => d.senha === d.confirmarSenha, { message: "As senhas não conferem.", path: ["confirmarSenha"] });

export const criarAcessoMotorista = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((entrada: unknown) => acessoSchema.parse(entrada)).handler(async ({ data, context }) => {
  await assertAdmin(context.supabase, context.userId);
  const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
  const { data: identidade, error: identidadeErro } = await supabaseAdmin.from("meli_motoristas_catalogo").select("meli_driver_id, nome, status").eq("meli_driver_id", data.meliDriverId).single();
  if (identidadeErro || !identidade) throw new Error("Motorista Meli não encontrado no catálogo.");
  if (identidade.status !== "active") throw new Error("Este motorista está pausado ou bloqueado no Meli.");
  const usuario = data.usuario.toLowerCase();
  const emailInterno = `${usuario}@motoristas.jmroutes.local`;
  const { data: rotaRecente } = await supabaseAdmin.from("meli_rotas").select("vehicle_license").eq("driver_id", data.meliDriverId).not("vehicle_license", "is", null).order("data_rota", { ascending: false }).limit(1).maybeSingle();
  const { data: authCriado, error: authErro } = await supabaseAdmin.auth.admin.createUser({ email: emailInterno, password: data.senha, email_confirm: true, user_metadata: { nome: identidade.nome, usuario, tipo_usuario: "motorista" } });
  if (authErro) throw new Error(authErro.message.includes("already") ? "Este usuário já está em uso." : authErro.message);
  const authUserId = authCriado.user.id;
  const { data: criado, error } = await supabaseAdmin.from("motoristas").insert({ nome: identidade.nome, placa: rotaRecente?.vehicle_license ?? null, meli_driver_id: data.meliDriverId, base_id: data.baseId, auth_user_id: authUserId, usuario, ativo: true }).select("id").single();
  if (error) { await supabaseAdmin.auth.admin.deleteUser(authUserId); if (error.code === "23505") throw new Error("Este usuário ou motorista do Meli já possui acesso."); throw new Error(error.message); }
  await supabaseAdmin.from("profiles").update({ nome: identidade.nome, base_id: data.baseId, meli_driver_id: data.meliDriverId, placa: rotaRecente?.vehicle_license ?? null }).eq("id", authUserId);
  await supabaseAdmin.from("user_roles").delete().eq("user_id", authUserId);
  await supabaseAdmin.from("meli_rotas").update({ motorista_id: criado.id }).eq("driver_id", data.meliDriverId);
  await supabaseAdmin.from("audit_logs").insert({ user_id: context.userId, acao: "motorista.acesso_criado", entidade: "motorista", entidade_id: criado.id, detalhes: { nome: identidade.nome, usuario, meli_driver_id: data.meliDriverId, base_id: data.baseId } });
  return { id: criado.id };
});

const ativoSchema = z.object({ id: z.string().uuid(), ativo: z.boolean() });
export const definirMotoristaAtivo = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).inputValidator((entrada: unknown) => ativoSchema.parse(entrada)).handler(async ({ data, context }) => {
  await assertAdmin(context.supabase, context.userId);
  const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
    const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
  const { data: motorista, error } = await supabaseAdmin.from("motoristas").update({ ativo: data.ativo }).eq("id", data.id).select("meli_driver_id, auth_user_id").single();
  if (error) throw new Error(error.message);
  if (motorista.auth_user_id) await supabaseAdmin.auth.admin.updateUserById(motorista.auth_user_id, { ban_duration: data.ativo ? "none" : "876000h" });
  if (motorista.meli_driver_id) await supabaseAdmin.from("meli_rotas").update({ motorista_id: data.ativo ? data.id : null }).eq("driver_id", motorista.meli_driver_id);
  return { ok: true };
});
