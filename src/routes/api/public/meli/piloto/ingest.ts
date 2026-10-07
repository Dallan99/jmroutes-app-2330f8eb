// Recebe lotes do worker Meli (piloto DRY_RUN). Grava só em meli_piloto_*.
import { createFileRoute } from "@tanstack/react-router";
import { expandirDetalhes, lerCorpoAssinado, loteSchema, resposta } from "@/lib/meli-piloto.server";

export const Route = createFileRoute("/api/public/meli/piloto/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lido = await lerCorpoAssinado(request);
        if (lido.erro) return lido.erro;
        const parsed = loteSchema.safeParse(lido.json);
        if (!parsed.success) return resposta(400, { erro: "lote_invalido", detalhes: parsed.error.issues.slice(0, 10) });
        const lote = await expandirDetalhes(parsed.data);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabaseAdmin as any).rpc("meli_piloto_ingerir_lote", { p: lote });
        if (error) {
          console.error("[meli-piloto] ingest falhou", { code: error.code, message: error.message });
          return resposta(422, { erro: "ingestao_recusada", mensagem: error.message });
        }

        // Publica a carga esperada do piloto no Recebimento. A RPC é idempotente
        // e preserva recebido/triado em reprocessamentos do mesmo pacote.
        const datas = [...new Set(lote.rotas.map((rota) => rota.data_rota))];
        const recebimento: unknown[] = [];
        for (const dataOperacional of datas) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const publicado = await (supabaseAdmin as any).rpc("meli_piloto_publicar_recebimento", {
            p_base_codigo: lote.ciclo.base_codigo,
            p_data: dataOperacional,
          });
          if (publicado.error) {
            console.error("[meli-piloto] publicação no Recebimento falhou", {
              base: lote.ciclo.base_codigo,
              data: dataOperacional,
              code: publicado.error.code,
              message: publicado.error.message,
            });
          } else {
            recebimento.push(publicado.data);
          }
        }

        return resposta(200, { ok: true, resultado: data, recebimento });
      },
    },
  },
});
