import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const BASES_RELATORIO_30MIN = [
  { codigo: "ESP15", nome: "Ibiúna" },
  { codigo: "ESP16", nome: "Guarujá" },
  { codigo: "ESP17", nome: "XPT Embu Guaçu" },
  { codigo: "ESP18", nome: "Franco da Rocha" },
  { codigo: "SSC2", nome: "Biguaçu" },
  { codigo: "SSP06", nome: "Mauá" },
  { codigo: "SSP15", nome: "São Vicente" },
  { codigo: "SSP17", nome: "São Bernardo do Campo" },
  { codigo: "SSP20", nome: "Sorocaba" },
  { codigo: "SSP23", nome: "Suzano" },
  { codigo: "SSP37/03", nome: "Campinas" },
  { codigo: "SSP38", nome: "Itupeva" },
  { codigo: "SSP45", nome: "Itaquera" },
  { codigo: "SSP5", nome: "Barueri" },
] as const;

const codigosPermitidos = new Set<string>(BASES_RELATORIO_30MIN.map((base) => base.codigo));

const entradaSchema = z.object({
  base_codigo: z
    .string()
    .trim()
    .toUpperCase()
    .refine((codigo) => codigosPermitidos.has(codigo), "Base não permitida"),
});

export type Relatorio30MinMetricas = {
  rotas_totais: number;
  rotas_entrega: number;
  rotas_coleta: number;
  rotas_mistas: number;
  rotas_em_andamento: number;
  pacotes: number;
  sacas: number;
  pendentes: number;
  com_falhas: number;
  bem_sucedidos: number;
  percentual_entrega: number;
  percentual_coleta: number;
  percentual_mistas: number;
  percentual_pendentes: number;
  percentual_falhas: number;
  percentual_bem_sucedidos: number;
};

export type Relatorio30MinResult =
  | {
      status: "ok";
      base_codigo: string;
      base_nome: string;
      data_operacional: string;
      atualizado_em: string;
      proxima_atualizacao_em: string;
      desatualizado: boolean;
      relatorio: Relatorio30MinMetricas;
    }
  | { status: "erro"; erro: string };

function numero(valor: unknown): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function percentual(parte: number, total: number): number {
  return total > 0 ? Math.round((parte / total) * 1000) / 10 : 0;
}

export const meliRelatorio30Min = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((dados: unknown) => entradaSchema.parse(dados ?? {}))
  .handler(async ({ data, context }): Promise<Relatorio30MinResult> => {
    const baseDefinida = BASES_RELATORIO_30MIN.find((base) => base.codigo === data.base_codigo);
    if (!baseDefinida) return { status: "erro", erro: "Base não permitida." };

    const { data: snapshot, error } = await context.supabase
      .from("meli_monitoramento_snapshots")
      .select(
        "base_codigo,data_operacional,rotas_totais,rotas_entrega,rotas_coleta,rotas_mistas,rotas_em_andamento,pacotes,sacas,pendentes,com_falhas,bem_sucedidos,coletado_em",
      )
      .eq("base_codigo", data.base_codigo)
      .order("data_operacional", { ascending: false })
      .order("coletado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return { status: "erro", erro: `Não foi possível consultar o monitoramento de ${data.base_codigo}.` };
    }
    if (!snapshot?.coletado_em) {
      return { status: "erro", erro: `Ainda não há coleta de monitoramento para ${data.base_codigo}.` };
    }

    const rotasTotais = numero(snapshot.rotas_totais);
    const pacotes = numero(snapshot.pacotes);
    const rotasEntrega = numero(snapshot.rotas_entrega);
    const rotasColeta = numero(snapshot.rotas_coleta);
    const rotasMistas = numero(snapshot.rotas_mistas);
    const pendentes = numero(snapshot.pendentes);
    const falhas = numero(snapshot.com_falhas);
    const bemSucedidos = numero(snapshot.bem_sucedidos);
    const atualizadoEm = String(snapshot.coletado_em);
    const atualizadoMs = new Date(atualizadoEm).getTime();
    const proximaAtualizacaoMs = atualizadoMs + 30 * 60_000;

    return {
      status: "ok",
      base_codigo: data.base_codigo,
      base_nome: baseDefinida.nome,
      data_operacional: String(snapshot.data_operacional),
      atualizado_em: atualizadoEm,
      proxima_atualizacao_em: new Date(proximaAtualizacaoMs).toISOString(),
      desatualizado: !Number.isFinite(atualizadoMs) || Date.now() - atualizadoMs > 35 * 60_000,
      relatorio: {
        rotas_totais: rotasTotais,
        rotas_entrega: rotasEntrega,
        rotas_coleta: rotasColeta,
        rotas_mistas: rotasMistas,
        rotas_em_andamento: numero(snapshot.rotas_em_andamento),
        pacotes,
        sacas: numero(snapshot.sacas),
        pendentes,
        com_falhas: falhas,
        bem_sucedidos: bemSucedidos,
        percentual_entrega: percentual(rotasEntrega, rotasTotais),
        percentual_coleta: percentual(rotasColeta, rotasTotais),
        percentual_mistas: percentual(rotasMistas, rotasTotais),
        percentual_pendentes: percentual(pendentes, pacotes),
        percentual_falhas: percentual(falhas, pacotes),
        percentual_bem_sucedidos: percentual(bemSucedidos, pacotes),
      },
    };
  });
