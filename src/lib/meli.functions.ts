import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizarPayloadMeli } from "@/lib/meli-normalize";

const importarSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  arquivo_nome: z.string().trim().max(255).optional(),
});

const importarBrutoSchema = z.object({
  payload: z.record(z.string(), z.unknown()),
  arquivo_nome: z.string().trim().max(255).optional(),
  confirmar_divergencia: z.boolean().optional(),
});


const listarSchema = z.object({
  cluster: z.string().trim().min(1).max(120).optional(),
  data_de: z.string().trim().min(1).max(20).optional(),
  data_ate: z.string().trim().min(1).max(20).optional(),
  busca: z.string().trim().min(1).max(120).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

const detalharSchema = z.object({
  rota_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
});

export type MeliImportResult = {
  status: "ok" | "erro";
  erro?: string;
  sqlstate?: string;
  importacao_id?: string;
  rota_id?: string;
  route_id?: string;
  pacotes_recebidos?: number;
  pacotes_unicos?: number;
  pacotes_inseridos?: number;
  pacotes_atualizados?: number;
  pacotes_inalterados?: number;
  pacotes_invalidos?: number;
  pacotes_duplicados_no_payload?: number;
  pacotes_com_ordem_invalida?: number;
};

export type MeliRotaResumo = {
  id: string;
  route_id: string;
  cluster: string | null;
  carrier: string | null;
  facility: string | null;
  data_rota: string | null;
  total_pacotes: number;
  total_impressos: number;
  origem_importacao: string | null;
  created_at: string;
  updated_at: string;
  ultima_importacao_em: string | null;
};

export type MeliListarResult = {
  status: "ok" | "erro";
  erro?: string;
  total?: number;
  limit?: number;
  offset?: number;
  rotas?: MeliRotaResumo[];
};

export type MeliPacote = {
  id: string;
  rota_id: string;
  tracking_id: string;
  shipment_id: string | null;
  destinatario: string | null;
  endereco: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  status: string | null;
  printed_label: string | null;
  ordem: number | null;
  created_at: string;
  updated_at: string;
};

export type MeliDetalheResult = {
  status: "ok" | "erro";
  erro?: string;
  rota?: MeliRotaResumo;
  importacao?: { id: string; status: string; iniciado_em: string | null; finalizado_em: string | null; total_pacotes: number | null; total_erros: number | null; arquivo_nome: string | null } | null;
  pacotes?: MeliPacote[];
  total_pacotes?: number;
  limit?: number;
  offset?: number;
};

export const meliImportarRota = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importarSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliImportResult> => {
    const supabase = clienteDeModulo(context.supabase);
    const { data: res, error } = await supabase.rpc("meli_importar_rota", {
      p_payload: data.payload as never,
      p_arquivo_nome: data.arquivo_nome,
    });
    if (error) {
      return { status: "erro", erro: error.message };
    }
    return res as MeliImportResult;
  });

export const meliListarRotas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listarSchema.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<MeliListarResult> => {
    const supabase = clienteDeModulo(context.supabase);
    const { data: res, error } = await supabase.rpc("meli_listar_rotas", {
      p_cluster: data.cluster,
      p_data_de: data.data_de,
      p_data_ate: data.data_ate,
      p_busca: data.busca,
      p_limit: data.limit ?? 50,
      p_offset: data.offset ?? 0,
    });
    if (error) return { status: "erro", erro: error.message };
    return res as MeliListarResult;
  });

export const meliDetalharRota = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => detalharSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliDetalheResult> => {
    const supabase = clienteDeModulo(context.supabase);
    const { data: res, error } = await supabase.rpc("meli_detalhar_rota", {
      p_rota_id: data.rota_id,
      p_limit: data.limit ?? 100,
      p_offset: data.offset ?? 0,
    });
    if (error) return { status: "erro", erro: error.message };
    return res as MeliDetalheResult;
  });

export type MeliImportBrutoResult = MeliImportResult & {
  resumo?: {
    route_id: string;
    cluster: string | null;
    facility: string | null;
    total_paradas: number;
    total_extraidos: number;
    total_informado: number | null;
    diferenca: number | null;
    descartados_sem_tracking: number;
    duplicados_removidos: number;
  };
  alerta_divergencia?: boolean;
  publicacao?: {
    status: "ok" | "erro";
    erro?: string;
    base_id?: string;
    data_operacional?: string;
    importacao_id?: string;
    esperados_inseridos?: number;
    esperados_atualizados?: number;
    total_importacao?: number;
    facility?: string | null;
  };
};


/**
 * Recebe o JSON bruto do endpoint route-detail do Mercado Livre
 * (com id/stops/orders/transportUnits/relatedEntity/receiverInfo),
 * transforma para o formato aceito por meli_importar_rota e importa.
 *
 * Autorização: requer sessão autenticada. A RPC subjacente
 * (meli_importar_rota) valida perfil admin/gerente/supervisor via
 * meli_pode_operar() e retorna sem_permissao caso contrário.
 * Não usa service_role.
 */
export const meliImportarRotaBruta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => importarBrutoSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliImportBrutoResult> => {
    const { importarRotaBrutaComClient } = await import("@/lib/meli-import-bruto");
    return importarRotaBrutaComClient(context.supabase, data.payload, {
      arquivo_nome: data.arquivo_nome,
      confirmar_divergencia: data.confirmar_divergencia,
    });
  });


const publicarSchema = z.object({
  rota_id: z.string().uuid(),
  data_operacional: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export type MeliPublicarResult = {
  status: "ok" | "erro";
  erro?: string;
  facility?: string | null;
  rota_id?: string;
  route_id?: string;
  base_id?: string;
  data_operacional?: string;
  importacao_id?: string;
  esperados_inseridos?: number;
  esperados_atualizados?: number;
  total_importacao?: number;
};

/**
 * Fase 2 — publica uma rota já importada do Meli como carga esperada do dia
 * na base correta (mapeamento facility → bases.meli_service_center_id).
 * Os pacotes entram como não recebidos / não triados; registros existentes
 * têm apenas dados descritivos atualizados (nunca bipagens ou triagens).
 */
export const meliPublicarRotaOperacional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => publicarSchema.parse(data))
  .handler(async ({ data, context }): Promise<MeliPublicarResult> => {
    const { data: res, error } = await (
      context.supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      }
    ).rpc("meli_publicar_rota_operacional", {
      p_rota_id: data.rota_id,
      p_data_operacional: data.data_operacional ?? null,
    });
    if (error) return { status: "erro", erro: error.message };
    return res as MeliPublicarResult;
  });
