import { clienteDeModulo } from "@/lib/modulo-em-implantacao";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ============================================================
// Types
// ============================================================

export type BaseResumo = {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  total_escalas: number;
  total_pacotes: number;
  ultima_importacao: string | null;
  ultimo_usuario: string | null;
  data_operacional: string; // hoje YYYY-MM-DD
  escalas_hoje: number;
  pacotes_hoje: number;
  status: "atualizada" | "aguardando" | "erro";
  dias_operacionais: number;
};

export type DiaOperacional = {
  data_operacional: string;
  versoes: number;
  versao_ativa: number | null;
  importacao_ativa_id: string | null;
  total_linhas: number;
  total_pacotes: number;
  total_motoristas: number;
  total_rotas: number;
  ultimo_usuario: string | null;
  ultima_importacao: string | null;
};

export type VersaoImportacao = {
  id: string;
  versao: number;
  ativa: boolean;
  importado_por: string | null;
  importado_em: string;
  arquivada_em: string | null;
  arquivada_por: string | null;
  arquivo_nome: string | null;
  total_linhas: number;
  total_pacotes: number;
  total_motoristas: number;
  total_rotas: number;
};

type MeliSyncBaseResumo = {
  base_id: string | null;
  data_rota: string | null;
  rotas_encontradas: number;
  pacotes_encontrados: number;
  ultimo_sucesso_em: string | null;
};

type MeliSyncResumoResponse = {
  status: "ok" | "erro";
  erro?: string;
  bases?: MeliSyncBaseResumo[];
};

export function dataOperacionalHoje(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

export function dataOperacionalDeInstante(instante: string | Date): string {
  return dataOperacionalHoje(typeof instante === "string" ? new Date(instante) : instante);
}

// ============================================================
// listarBasesComResumo
// ============================================================
export const listarBasesComResumo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BaseResumo[]> => {
    const { supabase, userId } = context;
    const hoje = dataOperacionalHoje();

    // Restringe a lista de bases: somente admin vê todas.
    // Demais perfis (gerente, supervisor, operador) só enxergam as bases
    // vinculadas em profiles.base_id ou user_bases.
    const [{ data: rolesRows }, { data: perfil }, { data: extras }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("base_id").eq("id", userId).maybeSingle(),
      supabase.from("user_bases").select("base_id").eq("user_id", userId),
    ]);
    const roles = (rolesRows ?? []).map((r) => r.role as string);
    const acessoTotal = roles.includes("admin");

    let basesQuery = supabase
      .from("bases")
      .select("id, codigo, nome, cidade, uf")
      .order("codigo");
    if (!acessoTotal) {
      const permitidas = new Set<string>();
      if (perfil?.base_id) permitidas.add(perfil.base_id);
      (extras ?? []).forEach((e) => e.base_id && permitidas.add(e.base_id));
      if (permitidas.size === 0) return [];
      basesQuery = basesQuery.in("id", Array.from(permitidas));
    }

    const { data: bases, error } = await basesQuery;
    if (error) throw new Error(error.message);


    const [{ data: imps, error: impsError }, syncResult] = await Promise.all([
      supabase
        .from("importacoes_escala")
        .select("base_id, data_operacional, ativa, importado_por, importado_em, total_linhas, total_pacotes, total_rotas"),
      supabase.rpc("meli_sync_status_bases"),
    ]);
    if (impsError) throw new Error(`Falha ao carregar importacoes das bases: ${impsError.message}`);
    if (syncResult.error) throw new Error(`Falha ao carregar sincronizacao das bases: ${syncResult.error.message}`);

    const sync = syncResult.data as MeliSyncResumoResponse | null;
    if (sync?.status === "erro") {
      throw new Error(`Falha ao carregar sincronizacao das bases: ${sync.erro ?? "erro desconhecido"}`);
    }

    type Agg = {
      total_linhas: number;
      total_pacotes: number;
      ultima: string | null;
      ultimoUser: string | null;
      escalasHoje: number;
      pacotesHoje: number;
      dias: Set<string>;
    };
    const map = new Map<string, Agg>();
    for (const i of imps ?? []) {
      if (!i.base_id) continue;
      const cur =
        map.get(i.base_id) ??
        {
          total_linhas: 0, total_pacotes: 0, ultima: null, ultimoUser: null,
          escalasHoje: 0, pacotesHoje: 0, dias: new Set<string>(),
        };
      if (i.ativa) {
        cur.total_linhas += i.total_linhas ?? 0;
        cur.total_pacotes += i.total_pacotes ?? 0;
        cur.dias.add(i.data_operacional);
        if (i.data_operacional === hoje) {
          cur.escalasHoje += i.total_rotas ?? 0;
          cur.pacotesHoje += i.total_pacotes ?? 0;
        }
      }
      if (!cur.ultima || (i.importado_em && i.importado_em > cur.ultima)) {
        cur.ultima = i.importado_em;
        cur.ultimoUser = i.importado_por ?? cur.ultimoUser;
      }
      map.set(i.base_id, cur);
    }

    // A sincronizacao automatica publica um lote Meli por base/dia. Quando a
    // materializacao operacional ainda nao existe, o lote ativo continua sendo
    // a fonte autoritativa para os contadores exibidos no card.
    for (const s of sync?.bases ?? []) {
      if (!s.base_id || s.data_rota !== hoje) continue;
      const cur = map.get(s.base_id) ?? {
        total_linhas: 0, total_pacotes: 0, ultima: null, ultimoUser: null,
        escalasHoje: 0, pacotesHoje: 0, dias: new Set<string>(),
      };
      cur.escalasHoje = Math.max(cur.escalasHoje, s.rotas_encontradas ?? 0);
      cur.pacotesHoje = Math.max(cur.pacotesHoje, s.pacotes_encontrados ?? 0);
      cur.total_linhas = Math.max(cur.total_linhas, s.rotas_encontradas ?? 0);
      cur.total_pacotes = Math.max(cur.total_pacotes, s.pacotes_encontrados ?? 0);
      cur.dias.add(hoje);
      if (s.ultimo_sucesso_em && (!cur.ultima || s.ultimo_sucesso_em > cur.ultima)) {
        cur.ultima = s.ultimo_sucesso_em;
        cur.ultimoUser = null;
      }
      map.set(s.base_id, cur);
    }

    const uids = Array.from(
      new Set(Array.from(map.values()).map((a) => a.ultimoUser).filter(Boolean) as string[]),
    );
    const nomes = new Map<string, string>();
    if (uids.length) {
      const { data: perfis } = await supabase.from("profiles").select("id, nome").in("id", uids);
      for (const p of perfis ?? []) nomes.set(p.id, (p.nome as string) ?? "—");
    }

    return (bases ?? []).map((b) => {
      const m = map.get(b.id);
      const status: BaseResumo["status"] = (m?.escalasHoje ?? 0) > 0 ? "atualizada" : "aguardando";
      return {
        id: b.id,
        codigo: b.codigo,
        nome: b.nome,
        cidade: b.cidade,
        uf: b.uf,
        total_escalas: m?.total_linhas ?? 0,
        total_pacotes: m?.total_pacotes ?? 0,
        ultima_importacao: m?.ultima ?? null,
        ultimo_usuario: m?.ultimoUser ? nomes.get(m.ultimoUser) ?? null : null,
        data_operacional: hoje,
        escalas_hoje: m?.escalasHoje ?? 0,
        pacotes_hoje: m?.pacotesHoje ?? 0,
        status,
        dias_operacionais: m?.dias.size ?? 0,
      };
    });
  });

// ============================================================
// listarBasesSimples (para seletores)
// ============================================================
export const listarBasesSimples = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Verifica se é admin/gerente (acesso total)
    const [{ data: rolesRows }, { data: perfil }, { data: extras }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("profiles").select("base_id").eq("id", userId).maybeSingle(),
      supabase.from("user_bases").select("base_id").eq("user_id", userId),
    ]);
    const roles = (rolesRows ?? []).map((r) => r.role as string);
    // Somente ADMIN pode escolher/entrar em qualquer base.
    // Gerentes e operadores acessam apenas as bases atribuídas em user_bases/profiles.
    const acessoTotal = roles.includes("admin");

    let query = supabase
      .from("bases")
      .select("id, codigo, nome, cidade, uf")
      .order("codigo");

    if (!acessoTotal) {
      const permitidas = new Set<string>();
      if (perfil?.base_id) permitidas.add(perfil.base_id);
      (extras ?? []).forEach((e) => e.base_id && permitidas.add(e.base_id));
      if (permitidas.size === 0) return [];
      query = query.in("id", Array.from(permitidas));
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ============================================================
// existeEscalaDoDia (existência de versão ativa)
// ============================================================
export const existeEscalaDoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { baseId: string; dataOperacional: string }) =>
    z.object({
      baseId: z.string().uuid(),
      dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await clienteDeModulo(context.supabase)
      .from("importacoes_escala")
      .select("id, versao")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .order("versao", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const r = rows?.[0];
    return { existe: !!r, ultimaVersao: r?.versao ?? 0 };
  });

// ============================================================
// importarEscala — cria SEMPRE nova versão. Nunca deleta.
// ============================================================
const linhaSchema = z.object({
  facility_id: z.string().nullish(),
  shipment: z.string().nullish(),
  nro_rota: z.string().nullish(),
  ordem: z.number().int().nullish(),
  planejada: z.string().nullish(),
  otimizada: z.string().nullish(),
  pacotes: z.number().int().nullish(),
  paradas: z.number().int().nullish(),
  modal: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  rua: z.string().nullish(),
  numero: z.string().nullish(),
  cep: z.string().nullish(),
  referencias: z.string().nullish(),
  duracao: z.number().nullish(),
  distancia: z.number().nullish(),
  order_id_veiculo: z.string().nullish(),
  ocupacao: z.number().nullish(),
  spr: z.number().nullish(),
  parada: z.string().nullish(),
  cluster: z.string().nullish(),
  transportadora: z.string().nullish(),
  giro: z.string().nullish(),
  vaga: z.string().nullish(),
  tipo: z.string().nullish(),
  roteiro: z.string().nullish(),
  placa: z.string().nullish(),
  driver: z.string().nullish(),
  placa_troca: z.string().nullish(),
});

const importSchema = z.object({
  baseId: z.string().uuid(),
  dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  arquivoNome: z.string().max(200).nullish(),
  linhas: z.array(linhaSchema).min(1).max(50000),
});

export const importarEscala = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => importSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Determina próxima versão e arquiva versões ativas anteriores
    const { data: existentes, error: e1 } = await supabase
      .from("importacoes_escala")
      .select("id, versao, ativa")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .order("versao", { ascending: false });
    if (e1) throw new Error(e1.message);

    const proxVersao = ((existentes?.[0]?.versao ?? 0) as number) + 1;
    const ativasAnteriores = (existentes ?? []).filter((r) => r.ativa).map((r) => r.id);
    if (ativasAnteriores.length) {
      const { error: eArq } = await supabase
        .from("importacoes_escala")
        .update({ ativa: false, arquivada_em: new Date().toISOString(), arquivada_por: userId })
        .in("id", ativasAnteriores);
      if (eArq) throw new Error(eArq.message);
    }

    // 2) Cria a nova importação
    // Cada linha do arquivo = 1 Shipment (pacote). Se houver coluna "pacotes"
    // agregada, também é aceita; caso contrário, cada linha conta como 1.
    const temShipment = data.linhas.some((l) => l.shipment);
    const totalPacotes = temShipment
      ? data.linhas.filter((l) => l.shipment).length
      : data.linhas.reduce((s, l) => s + (l.pacotes ?? 1), 0);
    const drivers = new Set(data.linhas.map((l) => l.driver).filter(Boolean));
    const rotas = new Set(
      data.linhas.map((l) => l.planejada ?? l.otimizada).filter(Boolean),
    );

    const { data: novaImp, error: eIns } = await supabase
      .from("importacoes_escala")
      .insert({
        base_id: data.baseId,
        data_operacional: data.dataOperacional,
        versao: proxVersao,
        ativa: true,
        importado_por: userId,
        arquivo_nome: data.arquivoNome ?? null,
        total_linhas: data.linhas.length,
        total_pacotes: totalPacotes,
        total_motoristas: drivers.size,
        total_rotas: rotas.size,
      })
      .select("id")
      .single();
    if (eIns || !novaImp) throw new Error(eIns?.message ?? "Falha ao criar importação");

    // 3) Insere linhas ligadas à importação
    const rows = data.linhas.map((l) => ({
      base_id: data.baseId,
      data_referencia: data.dataOperacional,
      importacao_id: novaImp.id,
      facility_id: l.facility_id ?? null,
      shipment: l.shipment ?? null,
      nro_rota: l.nro_rota ?? null,
      ordem: l.ordem ?? null,
      planejada: l.planejada ?? null,
      otimizada: l.otimizada ?? null,
      pacotes: l.pacotes ?? null,
      paradas: l.paradas ?? null,
      modal: l.modal ?? null,
      bairro: l.bairro ?? null,
      cidade: l.cidade ?? null,
      rua: l.rua ?? null,
      numero: l.numero ?? null,
      cep: l.cep ?? null,
      referencias: l.referencias ?? null,
      duracao: l.duracao ?? null,
      distancia: l.distancia ?? null,
      order_id_veiculo: l.order_id_veiculo ?? null,
      ocupacao: l.ocupacao ?? null,
      spr: l.spr ?? null,
      parada: l.parada ?? null,
      cluster: l.cluster ?? null,
      transportadora: l.transportadora ?? null,
      giro: l.giro ?? null,
      vaga: l.vaga ?? null,
      tipo: l.tipo ?? null,
      roteiro: l.roteiro ?? null,
      placa: l.placa ?? null,
      driver: l.driver ?? null,
      placa_troca: l.placa_troca ?? null,
      importado_por: userId,
    }));
    // Insere em lotes para evitar payloads gigantes
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { error: eEsc } = await supabase.from("escalas").insert(rows.slice(i, i + CHUNK));
      if (eEsc) throw new Error(eEsc.message);
    }

    // 4) Registrar auditoria (best-effort)
    try {
      const { registrarAuditInterno } = await import("./audit.server");
      await registrarAuditInterno(supabase, userId, {
        acao: proxVersao === 1 ? "escala_importada" : "escala_substituida",
        entidade: "importacoes_escala",
        entidade_id: novaImp.id,
        detalhes: {
          base_id: data.baseId,
          data_operacional: data.dataOperacional,
          versao: proxVersao,
          linhas: data.linhas.length,
          pacotes: totalPacotes,
          arquivo: data.arquivoNome ?? null,
        },
      });
    } catch {
      /* auditoria não deve bloquear */
    }

    return {
      importacaoId: novaImp.id,
      versao: proxVersao,
      inseridos: data.linhas.length,
      dataOperacional: data.dataOperacional,
      substituiu: ativasAnteriores.length > 0,
    };
  });

// ============================================================
// listarDiasOperacionais(baseId) — árvore Dias
// ============================================================
export const listarDiasOperacionais = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { baseId: string }) =>
    z.object({ baseId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<DiaOperacional[]> => {
    const { data: imps, error } = await clienteDeModulo(context.supabase)
      .from("importacoes_escala")
      .select("id, data_operacional, versao, ativa, importado_por, importado_em, total_linhas, total_pacotes, total_motoristas, total_rotas")
      .eq("base_id", data.baseId)
      .order("data_operacional", { ascending: false })
      .order("versao", { ascending: false });
    if (error) throw new Error(error.message);

    const uids = Array.from(new Set((imps ?? []).map((i) => i.importado_por).filter(Boolean) as string[]));
    const nomes = new Map<string, string>();
    if (uids.length) {
      const { data: perfis } = await clienteDeModulo(context.supabase).from("profiles").select("id, nome").in("id", uids);
      for (const p of perfis ?? []) nomes.set(p.id, (p.nome as string) ?? "—");
    }

    const grupos = new Map<string, typeof imps>();
    for (const i of imps ?? []) {
      if (!grupos.has(i.data_operacional)) grupos.set(i.data_operacional, []);
      grupos.get(i.data_operacional)!.push(i);
    }
    const out: DiaOperacional[] = [];
    for (const [dia, versoes] of grupos) {
      const ativa = versoes.find((v) => v.ativa) ?? versoes[0];
      out.push({
        data_operacional: dia,
        versoes: versoes.length,
        versao_ativa: ativa?.versao ?? null,
        importacao_ativa_id: ativa?.id ?? null,
        total_linhas: ativa?.total_linhas ?? 0,
        total_pacotes: ativa?.total_pacotes ?? 0,
        total_motoristas: ativa?.total_motoristas ?? 0,
        total_rotas: ativa?.total_rotas ?? 0,
        ultimo_usuario: ativa?.importado_por ? nomes.get(ativa.importado_por) ?? null : null,
        ultima_importacao: ativa?.importado_em ?? null,
      });
    }
    out.sort((a, b) => b.data_operacional.localeCompare(a.data_operacional));
    return out;
  });

// ============================================================
// listarVersoesDoDia
// ============================================================
export const listarVersoesDoDia = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { baseId: string; dataOperacional: string }) =>
    z.object({
      baseId: z.string().uuid(),
      dataOperacional: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }).parse(input),
  )
  .handler(async ({ data, context }): Promise<VersaoImportacao[]> => {
    const { data: imps, error } = await clienteDeModulo(context.supabase)
      .from("importacoes_escala")
      .select("id, versao, ativa, importado_por, importado_em, arquivada_em, arquivada_por, arquivo_nome, total_linhas, total_pacotes, total_motoristas, total_rotas")
      .eq("base_id", data.baseId)
      .eq("data_operacional", data.dataOperacional)
      .order("versao", { ascending: false });
    if (error) throw new Error(error.message);

    const uids = Array.from(new Set(
      (imps ?? []).flatMap((i) => [i.importado_por, i.arquivada_por]).filter(Boolean) as string[],
    ));
    const nomes = new Map<string, string>();
    if (uids.length) {
      const { data: perfis } = await clienteDeModulo(context.supabase).from("profiles").select("id, nome").in("id", uids);
      for (const p of perfis ?? []) nomes.set(p.id, (p.nome as string) ?? "—");
    }
    return (imps ?? []).map((i) => ({
      id: i.id,
      versao: i.versao,
      ativa: i.ativa,
      importado_por: i.importado_por ? nomes.get(i.importado_por) ?? null : null,
      importado_em: i.importado_em,
      arquivada_em: i.arquivada_em,
      arquivada_por: i.arquivada_por ? nomes.get(i.arquivada_por) ?? null : null,
      arquivo_nome: i.arquivo_nome,
      total_linhas: i.total_linhas,
      total_pacotes: i.total_pacotes,
      total_motoristas: i.total_motoristas,
      total_rotas: i.total_rotas,
    }));
  });

// ============================================================
// listarEscalaPorImportacao
// ============================================================
export const listarEscalaPorImportacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { importacaoId: string }) =>
    z.object({ importacaoId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await clienteDeModulo(context.supabase)
      .from("escalas")
      .select("id, data_referencia, facility_id, shipment, nro_rota, ordem, planejada, otimizada, pacotes, paradas, modal, bairro, cidade, rua, numero, cep, referencias, duracao, distancia, order_id_veiculo, ocupacao, spr, parada, cluster, transportadora, giro, vaga, tipo, roteiro, placa, driver, placa_troca, created_at")
      .eq("importacao_id", data.importacaoId)
      .order("planejada", { ascending: true })
      .order("ordem", { ascending: true })
      .limit(20000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============================================================
// listarEscalaPorBase — mantido para compat (retorna todas as linhas do histórico)
// ============================================================
export const listarEscalaPorBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { baseId: string }) =>
    z.object({ baseId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await clienteDeModulo(context.supabase)
      .from("escalas")
      .select("id, data_referencia, planejada, otimizada, pacotes, paradas, modal, bairro, cidade, giro, vaga, tipo, roteiro, placa, driver, placa_troca, created_at, importacao_id")
      .eq("base_id", data.baseId)
      .order("created_at", { ascending: false })
      .limit(2000);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============================================================
// listarHistoricoImportacoes com filtros
// ============================================================
export type ImportacaoHistorico = {
  importacao_id: string;
  base_id: string;
  base_codigo: string;
  base_nome: string;
  data_operacional: string;
  versao: number;
  ativa: boolean;
  linhas: number;
  pacotes: number;
  motoristas: number;
  rotas: number;
  importado_por: string | null;
  importado_em: string;
  arquivada_em: string | null;
};

const filtroHistoricoSchema = z.object({
  baseId: z.string().uuid().optional().nullable(),
  usuarioId: z.string().uuid().optional().nullable(),
  dataOperacional: z.string().optional().nullable(),
  periodoInicio: z.string().optional().nullable(),
  periodoFim: z.string().optional().nullable(),
  status: z.enum(["todas", "ativa", "arquivada"]).optional().default("todas"),
  limit: z.number().int().positive().max(2000).optional(),
});

export const listarHistoricoImportacoes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => filtroHistoricoSchema.parse(input ?? {}))
  .handler(async ({ data, context }): Promise<ImportacaoHistorico[]> => {
    const { supabase } = context;
    const { data: bases } = await supabase.from("bases").select("id, codigo, nome");
    const baseMap = new Map((bases ?? []).map((b) => [b.id, b]));

    let q = supabase
      .from("importacoes_escala")
      .select("id, base_id, data_operacional, versao, ativa, importado_por, importado_em, arquivada_em, total_linhas, total_pacotes, total_motoristas, total_rotas")
      .order("importado_em", { ascending: false })
      .limit(data.limit ?? 500);

    if (data.baseId) q = q.eq("base_id", data.baseId);
    if (data.dataOperacional) q = q.eq("data_operacional", data.dataOperacional);
    if (data.periodoInicio) q = q.gte("data_operacional", data.periodoInicio);
    if (data.periodoFim) q = q.lte("data_operacional", data.periodoFim);
    if (data.usuarioId) q = q.eq("importado_por", data.usuarioId);
    if (data.status === "ativa") q = q.eq("ativa", true);
    if (data.status === "arquivada") q = q.eq("ativa", false);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const uids = Array.from(new Set((rows ?? []).map((r) => r.importado_por).filter(Boolean) as string[]));
    const nomes = new Map<string, string>();
    if (uids.length) {
      const { data: perfis } = await supabase.from("profiles").select("id, nome").in("id", uids);
      for (const p of perfis ?? []) nomes.set(p.id, (p.nome as string) ?? "—");
    }

    return (rows ?? []).map((r) => {
      const b = baseMap.get(r.base_id);
      return {
        importacao_id: r.id,
        base_id: r.base_id,
        base_codigo: b?.codigo ?? "—",
        base_nome: b?.nome ?? "—",
        data_operacional: r.data_operacional,
        versao: r.versao,
        ativa: r.ativa,
        linhas: r.total_linhas,
        pacotes: r.total_pacotes,
        motoristas: r.total_motoristas,
        rotas: r.total_rotas,
        importado_por: r.importado_por ? nomes.get(r.importado_por) ?? null : null,
        importado_em: r.importado_em,
        arquivada_em: r.arquivada_em,
      };
    });
  });

// ============================================================
// excluirImportacao — remove uma importação (arquivo) e reativa a
// versão anterior mais recente, se houver. Apenas admin/gerente.
// ============================================================
export const excluirImportacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ importacaoId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const podeExcluir = (roles ?? []).some((r) =>
      ["admin", "gerente"].includes(r.role as string),
    );
    if (!podeExcluir) {
      throw new Error("Apenas admin ou gerente podem excluir importações.");
    }

    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    const { data: imp, error: eImp } = await supabaseAdmin
      .from("importacoes_escala")
      .select("id, base_id, data_operacional, ativa")
      .eq("id", data.importacaoId)
      .maybeSingle();
    if (eImp) throw new Error(eImp.message);
    if (!imp) throw new Error("Importação não encontrada.");

    // Apaga escalas ligadas em lotes
    const { error: eDelEsc } = await supabaseAdmin
      .from("escalas")
      .delete()
      .eq("importacao_id", imp.id);
    if (eDelEsc) throw new Error(eDelEsc.message);

    const { error: eDelImp } = await supabaseAdmin
      .from("importacoes_escala")
      .delete()
      .eq("id", imp.id);
    if (eDelImp) throw new Error(eDelImp.message);

    // Não reativa nenhuma versão anterior — a exclusão remove definitivamente.
    const reativada: { id: string; versao: number } | null = null;

    try {
      const { registrarAuditInterno } = await import("./audit.server");
      await registrarAuditInterno(supabase, userId, {
        acao: "escala_excluida",
        entidade: "importacoes_escala",
        entidade_id: imp.id,
        detalhes: {
          base_id: imp.base_id,
          data_operacional: imp.data_operacional,
          era_ativa: imp.ativa,
          reativada: null,
        },
      });
    } catch {
      /* ignore */
    }

    return { ok: true, reativada };
  });

// ============================================================
// renomearBase — atualiza o nome (e opcionalmente cidade/uf) de uma base.
// Apenas admin/gerente.
// ============================================================
export const renomearBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        baseId: z.string().uuid(),
        nome: z.string().trim().min(2).max(120),
        cidade: z.string().trim().max(120).optional().nullable(),
        uf: z.string().trim().max(4).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const pode = (roles ?? []).some((r) =>
      ["admin", "gerente"].includes(r.role as string),
    );
    if (!pode) {
      throw new Error("Apenas admin ou gerente podem renomear bases.");
    }

    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);

    const patch: { nome: string; cidade?: string; uf?: string } = {
      nome: data.nome,
    };
    if (data.cidade !== undefined && data.cidade) patch.cidade = data.cidade;
    if (data.uf !== undefined && data.uf) patch.uf = data.uf.toUpperCase();

    const { error } = await supabaseAdmin
      .from("bases")
      .update(patch)
      .eq("id", data.baseId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });
