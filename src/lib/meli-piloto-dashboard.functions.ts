import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BASES_PILOTO, montarPainel, type BaseInfo, type CicloRow, type RotaRow } from "@/lib/meli-piloto-dashboard";

/** Painel do piloto Meli. Somente leitura, como o usuário (RLS por base). */
export const pilotoDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(i))
  .handler(async ({ data, context }) => {
    const sb = context.supabase;
    const [bRes, eRes, cRes, rRes] = await Promise.all([
      sb.from("bases").select("id, codigo, nome").in("codigo", [...BASES_PILOTO]),
      sb.from("meli_piloto_estacoes").select("base_id, confirmada, ativa_no_piloto"),
      sb.from("meli_piloto_ciclos")
        .select("id, base_id, base_codigo, status, iniciado_em, finalizado_em, rotas_esperadas, rotas_recebidas, pacotes_esperados, pacotes_recebidos, paginas_esperadas, paginas_lidas")
        .order("iniciado_em", { ascending: false }).limit(500),
      sb.from("meli_piloto_rotas")
        .select("base_id, route_id, data_rota, ultimo_ciclo_id, motorista_nome, placa, total_pedidos, total_entregue, coletado_em")
        .eq("data_rota", data.data).limit(1000),
    ]);
    const erro = bRes.error ?? eRes.error ?? cRes.error ?? rRes.error;
    if (erro) {
      console.error("[pilotoDashboard]", erro.message);
      throw new Error("Não foi possível ler os dados do piloto.");
    }
    const est = new Map((eRes.data ?? []).map((e) => [e.base_id, e]));
    const bases: BaseInfo[] = (bRes.data ?? [])
      .sort((a, b) => a.codigo.localeCompare(b.codigo, "pt-BR", { numeric: true }))
      .map((b) => ({
        id: b.id, codigo: b.codigo, nome: b.nome,
        ativa_no_piloto: !!est.get(b.id)?.ativa_no_piloto,
        estacao_confirmada: !!est.get(b.id)?.confirmada,
      }));
    const painel = montarPainel(bases, (cRes.data ?? []) as CicloRow[], (rRes.data ?? []) as RotaRow[], data.data);
    return { data: data.data, painel, rotasTruncadas: (rRes.data?.length ?? 0) >= 1000 };
  });
