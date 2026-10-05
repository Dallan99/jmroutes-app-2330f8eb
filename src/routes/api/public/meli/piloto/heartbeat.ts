// Sinal de vida do worker Meli na nuvem (piloto DRY_RUN).
import { createFileRoute } from "@tanstack/react-router";
import { heartbeatSchema, lerCorpoAssinado, resposta } from "@/lib/meli-piloto.server";

export const Route = createFileRoute("/api/public/meli/piloto/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const lido = await lerCorpoAssinado(request);
        if (lido.erro) return lido.erro;
        const parsed = heartbeatSchema.safeParse(lido.json);
        if (!parsed.success) return resposta(400, { erro: "heartbeat_invalido", detalhes: parsed.error.issues.slice(0, 10) });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabaseAdmin as any).rpc("meli_piloto_registrar_heartbeat", { p: parsed.data });
        if (error) {
          console.error("[meli-piloto] heartbeat falhou", { code: error.code, message: error.message });
          return resposta(422, { erro: "heartbeat_recusado" });
        }
        return resposta(200, { ok: true });
      },
    },
  },
});
