import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  montarRelatorio30Min,
  type PacoteRelatorioRow,
  type Relatorio30Min,
  type RotaRelatorioRow,
} from "@/lib/meli-relatorio-30min";

const entradaSchema = z.object({
  base_codigo: z.literal("ESP18").default("ESP18"),
});

export type Relatorio30MinResult =
  | {
      status: "ok";
      base_codigo: "ESP18";
      base_nome: string;
      data_operacional: string;
      atualizado_em: string;
      proxima_atualizacao_em: string;
      relatorio: Relatorio30Min;
    }
  | { status: "erro"; erro: string };

const TAMANHO_PAGINA = 1000;

export const meliRelatorio30Min = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((dados: unknown) => entradaSchema.parse(dados ?? {}))
  .handler(async ({ data, context }): Promise<Relatorio30MinResult> => {
    const sb = context.supabase;
    const { data: base, error: erroBase } = await sb
      .from("bases")
      .select("id,codigo,nome")
      .eq("codigo", data.base_codigo)
      .maybeSingle();

    if (erroBase || !base) return { status: "erro", erro: "Base ESP18 não encontrada." };

    const { data: ultimaRota, error: erroUltimaRota } = await sb
      .from("meli_piloto_rotas")
      .select("data_rota")
      .eq("base_codigo", data.base_codigo)
      .order("data_rota", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (erroUltimaRota || !ultimaRota?.data_rota) {
      return { status: "erro", erro: "Ainda não há coleta do piloto para a ESP18." };
    }

    const dataOperacional = String(ultimaRota.data_rota);
    const { data: rotasData, error: erroRotas } = await sb
      .from("meli_piloto_rotas")
      .select("route_id,total_pedidos,total_entregue,coletado_em,payload")
      .eq("base_codigo", data.base_codigo)
      .eq("data_rota", dataOperacional)
      .limit(1000);

    if (erroRotas) return { status: "erro", erro: "Não foi possível consultar as rotas do piloto." };

    const rotas = (rotasData ?? []) as RotaRelatorioRow[];
    const idsRotas = [...new Set(rotas.map((rota) => rota.route_id).filter(Boolean))];
    const pacotes: PacoteRelatorioRow[] = [];

    for (let inicio = 0; idsRotas.length && inicio < 50_000; inicio += TAMANHO_PAGINA) {
      const { data: pagina, error } = await sb
        .from("meli_piloto_pacotes")
        .select("shipment_id,status,coletado_em,payload")
        .eq("base_id", base.id)
        .in("route_id", idsRotas)
        .order("id", { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) return { status: "erro", erro: "Não foi possível consultar os pacotes do piloto." };
      const linhas = (pagina ?? []) as PacoteRelatorioRow[];
      pacotes.push(...linhas);
      if (linhas.length < TAMANHO_PAGINA) break;
    }

    const relatorio = montarRelatorio30Min(rotas, pacotes);
    const atualizadoEm = relatorio.ultima_coleta ?? new Date().toISOString();
    const proximaAtualizacao = new Date(new Date(atualizadoEm).getTime() + 30 * 60_000).toISOString();

    return {
      status: "ok",
      base_codigo: "ESP18",
      base_nome: base.nome,
      data_operacional: dataOperacional,
      atualizado_em: atualizadoEm,
      proxima_atualizacao_em: proximaAtualizacao,
      relatorio,
    };
  });
