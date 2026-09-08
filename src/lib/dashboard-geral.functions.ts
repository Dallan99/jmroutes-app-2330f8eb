import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type DashboardGeralBase = {
  id: string;
  codigo: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  tipo: "SERVICE" | "XPT";
  status: "ok" | "sem_dados";
  rotas_totais: number | null;
  rotas_entrega: number | null;
  rotas_coleta: number | null;
  rotas_mistas: number | null;
  rotas_em_andamento: number | null;
  pacotes: number | null;
  sacas: number | null;
  pendentes: number | null;
  com_falhas: number | null;
  bem_sucedidos: number | null;
  source_updated_at: string | null;
};

export type DashboardGeralResponse = {
  status: "ok";
  data: string;
  bases: DashboardGeralBase[];
  totais: Omit<DashboardGeralBase, "id" | "codigo" | "nome" | "cidade" | "uf" | "tipo" | "status" | "source_updated_at"> & {
    bases_com_dados: number;
  };
};

export const obterDashboardGeral = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(value))
  .handler(async ({ context, data }): Promise<DashboardGeralResponse> => {
    const client = context.supabase as any;
    const { data: result, error } = await client.rpc("meli_dashboard_geral", { p_data: data.data });
    if (error) throw new Error(`Falha ao carregar o Dashboard Geral: ${error.message}`);
    return result as DashboardGeralResponse;
  });
