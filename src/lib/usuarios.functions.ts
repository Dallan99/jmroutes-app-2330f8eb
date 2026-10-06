import { clienteDeModulo, tabelaImplantada } from "@/lib/modulo-em-implantacao";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type Role = "admin" | "supervisor" | "gerente" | "operador";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error("Falha ao verificar permissões.");
  if (!data) throw new Error("Acesso negado: apenas administradores.");
}

export type UsuarioRow = {
  id: string;
  email: string;
  nome: string;
  matricula: string | null;
  placa: string | null;
  meli_driver_id: string | null;
  meli_driver_nome: string | null;
  base_id: string | null;
  base_nome: string | null;
  ativo: boolean;
  roles: Role[];
  last_sign_in_at: string | null;
  created_at: string;
};

export const listarUsuarios = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsuarioRow[]> => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    const { data: profiles, error: pErr } = await supabaseAdmin
      .from("profiles")
      .select("id, nome, email, matricula, placa, meli_driver_id, base_id, ativo, created_at, bases(nome)")
      .order("created_at", { ascending: false });
    if (pErr) throw new Error(pErr.message);

    const { data: roles, error: rErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role");
    if (rErr) throw new Error(rErr.message);

    // Catálogo Meli é opcional: a tabela só existe numa etapa futura da
    // implantação. Sem o guard, a consulta lança ModuloEmImplantacaoError
    // e aborta a listagem inteira.
    let nomeMeliPorId = new Map<string, string>();
    if (tabelaImplantada("meli_motoristas_catalogo")) {
      const { data: catalogo } = await supabaseAdmin
        .from("meli_motoristas_catalogo")
        .select("meli_driver_id, nome");
      nomeMeliPorId = new Map((catalogo ?? []).map((m) => [m.meli_driver_id, m.nome]));
    }

    const rolesByUser = new Map<string, Role[]>();
    for (const r of roles ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as Role);
      rolesByUser.set(r.user_id, arr);
    }

    const profilesById = new Map<string, any>();
    for (const p of profiles ?? []) profilesById.set(p.id, p);

    // Auth é a fonte primária da lista: se o profile não existir, o usuário ainda aparece.
    const authUsers: any[] = [];
    const lastByUser = new Map<string, string | null>();
    let page = 1;
    for (;;) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      for (const u of data.users) {
        authUsers.push(u);
        lastByUser.set(u.id, u.last_sign_in_at ?? null);
      }
      if (data.users.length < 200) break;
      page++;
      if (page > 10) break;
    }

    const merged = new Map<string, UsuarioRow>();
    for (const u of authUsers) {
      const p = profilesById.get(u.id);
      if (p?.meli_driver_id) continue;
      const metadataNome = typeof u.user_metadata?.nome === "string" ? u.user_metadata.nome : null;
      const email = p?.email ?? u.email ?? "";
      merged.set(u.id, {
        id: u.id,
        email,
        nome: p?.nome ?? metadataNome ?? email.split("@")[0] ?? "Usuário",
        matricula: p?.matricula ?? null,
        placa: p?.placa ?? null,
        meli_driver_id: p?.meli_driver_id ?? null,
        meli_driver_nome: p?.meli_driver_id ? nomeMeliPorId.get(p.meli_driver_id) ?? null : null,
        base_id: p?.base_id ?? null,
        base_nome: p?.bases?.nome ?? null,
        ativo: p?.ativo ?? !u.banned_until,
        roles: rolesByUser.get(u.id) ?? [],
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: p?.created_at ?? u.created_at,
      });
    }

    for (const p of profiles ?? []) {
      if (merged.has(p.id) || p.meli_driver_id) continue;
      merged.set(p.id, {
        id: p.id,
        email: p.email,
        nome: p.nome,
        matricula: p.matricula,
        placa: p.placa ?? null,
        meli_driver_id: p.meli_driver_id,
        meli_driver_nome: p.meli_driver_id ? nomeMeliPorId.get(p.meli_driver_id) ?? null : null,
        base_id: p.base_id,
        base_nome: (p.bases as unknown as { nome?: string | null } | null)?.nome ?? null,
        ativo: p.ativo,
        roles: rolesByUser.get(p.id) ?? [],
        last_sign_in_at: lastByUser.get(p.id) ?? null,
        created_at: p.created_at,
      });
    }

    return Array.from(merged.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

const criarSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  nome: z.string().trim().min(2).max(120),
  senha: z.string().min(8).max(72),
  role: z.enum(["admin", "gerente", "supervisor", "operador"]),
  matricula: z.string().trim().max(40).optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
});

export const criarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => criarSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (!data.email.endsWith("@jmdistribuicao.com.br")) {
      throw new Error("Apenas emails @jmdistribuicao.com.br são permitidos.");
    }
    if (data.role === "operador" && !data.base_id) {
      throw new Error("Operadores devem estar vinculados a uma base.");
    }
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.senha,
      email_confirm: true,
      user_metadata: { nome: data.nome },
    });
    if (error) throw new Error(error.message);
    const uid = created.user.id;

    // O trigger handle_new_user cria profile + role 'operador'. Ajustamos.
    await supabaseAdmin
      .from("profiles")
      .update({
        nome: data.nome,
        matricula: data.matricula ?? null,
        base_id: data.base_id ?? null,
      })
      .eq("id", uid);

    // O trigger handle_new_user já criou role 'operador'. Sincronizamos removendo
    // todas as roles existentes e inserindo apenas a solicitada (evita usuário
    // com dois perfis simultâneos, ex.: Operador + Administrador).
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.criado",
      entidade: "usuario",
      entidade_id: uid,
      detalhes: { email: data.email, nome: data.nome, role: data.role, base_id: data.base_id ?? null },
    });
    return { ok: true, id: uid };
  });

const atualizarSchema = z.object({
  user_id: z.string().uuid(),
  matricula: z.string().trim().max(40).optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  role: z.enum(["admin", "gerente", "supervisor", "operador"]),
});

export const atualizarUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => atualizarSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.role === "operador" && !data.base_id) {
      throw new Error("Operadores devem estar vinculados a uma base.");
    }
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    const { error: upErr } = await supabaseAdmin
      .from("profiles")
      .update({ matricula: data.matricula ?? null, base_id: data.base_id ?? null })
      .eq("id", data.user_id);
    if (upErr) throw new Error(upErr.message);

    // Sincroniza role: remove tudo, insere a nova
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error: rErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: data.role });
    if (rErr) throw new Error(rErr.message);
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.alterado",
      entidade: "usuario",
      entidade_id: data.user_id,
      detalhes: { matricula: data.matricula ?? null, base_id: data.base_id ?? null, role: data.role },
    });
    return { ok: true };
  });

const toggleSchema = z.object({ user_id: z.string().uuid(), ativo: z.boolean() });

export const setUsuarioAtivo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => toggleSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId && !data.ativo) {
      throw new Error("Você não pode desativar sua própria conta.");
    }
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    await supabaseAdmin.from("profiles").update({ ativo: data.ativo }).eq("id", data.user_id);
    // Bloqueia login via ban se desativado
    await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      ban_duration: data.ativo ? "none" : "876000h",
    });
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: data.ativo ? "usuario.ativado" : "usuario.desativado",
      entidade: "usuario",
      entidade_id: data.user_id,
      detalhes: null,
    });
    return { ok: true };
  });

const resetSchema = z.object({ user_id: z.string().uuid(), senha: z.string().min(8).max(72) });

export const resetSenhaUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => resetSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.senha,
    });
    if (error) throw new Error(error.message);
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.senha_resetada",
      entidade: "usuario",
      entidade_id: data.user_id,
      detalhes: null,
    });
    return { ok: true };
  });

const excluirSchema = z.object({ user_id: z.string().uuid() });

export const excluirUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => excluirSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error("Você não pode excluir sua própria conta.");
    }
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    // Remove role admin primeiro (trigger prevent_admin_role_grant permite service_role)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.excluido",
      entidade: "usuario",
      entidade_id: data.user_id,
      detalhes: null,
    });
    return { ok: true };
  });

export const listarBasesUsuario = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await clienteDeModulo(context.supabase)
      .from("bases")
      .select("id, codigo, nome, cidade, uf")
      .order("codigo");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const listUserBasesSchema = z.object({ user_id: z.string().uuid() });

export const listarUserBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => listUserBasesSchema.parse(d))
  .handler(async ({ data, context }): Promise<string[]> => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    const { data: rows, error } = await supabaseAdmin
      .from("user_bases")
      .select("base_id")
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: { base_id: string }) => r.base_id);
  });

const setUserBasesSchema = z.object({
  user_id: z.string().uuid(),
  base_ids: z.array(z.string().uuid()),
});

export const setUserBases = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => setUserBasesSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    await supabaseAdmin.from("user_bases").delete().eq("user_id", data.user_id);
    if (data.base_ids.length > 0) {
      const rows = data.base_ids.map((base_id) => ({ user_id: data.user_id, base_id }));
      const { error } = await supabaseAdmin.from("user_bases").insert(rows);
      if (error) throw new Error(error.message);
    }
    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.bases_atualizadas",
      entidade: "usuario",
      entidade_id: data.user_id,
      detalhes: { base_ids: data.base_ids },
    });
    return { ok: true };
  });

const importarSchema = z.object({
  usuarios: z
    .array(
      z.object({
        email: z.string().trim().toLowerCase().email(),
        nome: z.string().trim().min(2).max(120),
        senha: z.string().min(8).max(72),
        role: z.enum(["admin", "gerente", "supervisor", "operador"]),
        matricula: z.string().trim().max(40).optional().nullable(),
        base_codigo: z.string().trim().max(20).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export type ImportarUsuarioResultado = {
  linha: number;
  email: string;
  status: "criado" | "ja_existia" | "erro";
  mensagem?: string;
  senha_temporaria?: string;
};

export const importarUsuarios = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importarSchema.parse(d))
  .handler(async ({ data, context }): Promise<ImportarUsuarioResultado[]> => {
    await assertAdmin(context.supabase, context.userId);
    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    // Mapa codigo -> base_id
    const { data: basesRows } = await supabaseAdmin.from("bases").select("id, codigo");
    const baseByCodigo = new Map<string, string>();
    for (const b of basesRows ?? []) {
      if (b.codigo) baseByCodigo.set(String(b.codigo).toUpperCase(), b.id);
    }

    const resultados: ImportarUsuarioResultado[] = [];
    let linha = 1;
    for (const u of data.usuarios) {
      linha++;
      try {
        if (!u.email.endsWith("@jmdistribuicao.com.br")) {
          resultados.push({
            linha,
            email: u.email,
            status: "erro",
            mensagem: "Domínio não permitido (apenas @jmdistribuicao.com.br).",
          });
          continue;
        }
        let base_id: string | null = null;
        if (u.base_codigo) {
          base_id = baseByCodigo.get(u.base_codigo.toUpperCase()) ?? null;
          if (!base_id) {
            resultados.push({
              linha,
              email: u.email,
              status: "erro",
              mensagem: `Base '${u.base_codigo}' não encontrada.`,
            });
            continue;
          }
        }
        if (u.role === "operador" && !base_id) {
          resultados.push({
            linha,
            email: u.email,
            status: "erro",
            mensagem: "Operador exige base.",
          });
          continue;
        }

        const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
          email: u.email,
          password: u.senha,
          email_confirm: true,
          user_metadata: { nome: u.nome },
        });
        if (error) {
          const msg = error.message.toLowerCase();
          if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
            resultados.push({ linha, email: u.email, status: "ja_existia" });
          } else {
            resultados.push({ linha, email: u.email, status: "erro", mensagem: error.message });
          }
          continue;
        }
        const uid = created.user.id;

        await supabaseAdmin
          .from("profiles")
          .update({
            nome: u.nome,
            matricula: u.matricula ?? null,
            base_id,
          })
          .eq("id", uid);

        // Remove qualquer role pré-existente (trigger handle_new_user cria 'operador')
        // e insere exatamente a role solicitada, para não acumular perfis.
        await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
        await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: u.role });

        resultados.push({
          linha,
          email: u.email,
          status: "criado",
          senha_temporaria: u.senha,
        });
      } catch (e) {
        resultados.push({
          linha,
          email: u.email,
          status: "erro",
          mensagem: e instanceof Error ? e.message : "Erro desconhecido.",
        });
      }
    }

    const { registrarAuditInterno } = await import("./audit.server");
    await registrarAuditInterno(context.supabase, context.userId, {
      acao: "usuario.importado",
      entidade: "usuario",
      entidade_id: null,
      detalhes: {
        total: resultados.length,
        criados: resultados.filter((r) => r.status === "criado").length,
        ja_existiam: resultados.filter((r) => r.status === "ja_existia").length,
        erros: resultados.filter((r) => r.status === "erro").length,
      },
    });

    return resultados;
  });
