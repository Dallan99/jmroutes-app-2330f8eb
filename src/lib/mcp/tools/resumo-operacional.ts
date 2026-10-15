import { clienteDeModulo } from "@/lib/modulo-client";
import { defineTool } from "@lovable.dev/mcp-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

export default defineTool({
  name: "resumo_operacional",
  title: "Resumo operacional do dia",
  description:
    "Retorna um resumo do dia operacional para as bases visíveis ao usuário: rotas na escala, recebimentos e transferências. Se `dia` for omitido, usa a data atual.",
  inputSchema: {
    dia: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato esperado: YYYY-MM-DD")
      .optional()
      .describe("Dia operacional no formato YYYY-MM-DD (opcional; padrão: hoje)."),
    base_codigo: z
      .string()
      .optional()
      .describe("Código da base (ex.: ESP16). Opcional; se omitido, considera todas as bases visíveis."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ dia, base_codigo }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado." }], isError: true };
    }
    const sb = createClient<any>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const diaOp = dia ?? new Date().toISOString().slice(0, 10);

    let basesQuery = sb.from("bases").select("id, codigo, nome").order("codigo", { ascending: true });
    if (base_codigo) basesQuery = basesQuery.eq("codigo", base_codigo.toUpperCase());
    const { data: bases, error: basesErr } = await basesQuery;
    if (basesErr) return { content: [{ type: "text", text: basesErr.message }], isError: true };
    if (!bases?.length) {
      return {
        content: [{ type: "text", text: "Nenhuma base visível para o usuário." }],
        structuredContent: { dia: diaOp, bases: [] },
      };
    }

    const baseIds = bases.map((b) => b.id);
    const [escalas, recebimentos, transferencias] = await Promise.all([
      sb.from("escalas").select("id", { count: "exact", head: true }).in("base_id", baseIds).eq("data_referencia", diaOp),
      sb.from("recebimentos").select("id", { count: "exact", head: true }).in("base_id", baseIds).eq("data_operacional", diaOp),
      clienteDeModulo(sb).from("transferencias").select("id", { count: "exact", head: true }).in("base_id", baseIds).eq("data_operacional", diaOp),
    ]);

    const resumo = {
      dia_operacional: diaOp,
      bases: bases.map((b) => ({ codigo: b.codigo, nome: b.nome })),
      totais: {
        escalas: escalas.count ?? null,
        recebimentos: recebimentos.count ?? null,
        transferencias: transferencias.count ?? null,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(resumo, null, 2) }],
      structuredContent: resumo,
    };
  },
});
