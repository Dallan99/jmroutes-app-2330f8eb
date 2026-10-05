import { clienteDeModulo } from "@/lib/modulo-em-implantacao";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clienteDoUsuario, extrairBearer, json, MAX_BODY_BYTES } from "@/lib/meli-api-http";

const motoristaSchema = z.object({
  id: z.string().trim().min(1).max(80),
  nome: z.string().trim().min(2).max(200),
  status: z.enum(["active", "inactive", "blocked", "unknown"]),
  carrierId: z.string().trim().max(80).nullable(),
});
const payloadSchema = z.object({ motoristas: z.array(motoristaSchema).max(5000) });

export const Route = createFileRoute("/api/public/meli/importar-motoristas")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const token = extrairBearer(request);
        if (!token) return json({ ok: false, codigo: "nao_autenticado" }, 401, origin);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ ok: false, codigo: "body_muito_grande" }, 413, origin);
        let entrada;
        try { entrada = payloadSchema.parse(JSON.parse(raw)); }
        catch { return json({ ok: false, codigo: "payload_invalido" }, 400, origin); }

        const usuario = await clienteDoUsuario(token);
        if (usuario.status !== "ok") return json({ ok: false, codigo: usuario.status }, usuario.status === "config" ? 500 : 401, origin);
        const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
        const { data: papel } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", usuario.userId)
          .in("role", ["admin", "gerente", "supervisor"])
          .limit(1)
          .maybeSingle();
        if (!papel) return json({ ok: false, codigo: "sem_permissao" }, 403, origin);

        const agora = new Date().toISOString();
        const linhas = entrada.motoristas.map((m) => ({
          meli_driver_id: m.id,
          nome: m.nome,
          status: m.status,
          ativo: m.status === "active",
          carrier_id: m.carrierId,
          origem: "adminml",
          sincronizado_em: agora,
          updated_at: agora,
        }));
        if (linhas.length) {
          const { error } = await supabaseAdmin.from("meli_motoristas_catalogo").upsert(linhas, { onConflict: "meli_driver_id" });
          if (error) return json({ ok: false, codigo: "falha_catalogo" }, 500, origin);
        }
        return json({ ok: true, total: linhas.length }, 200, origin);
      },
    },
  },
});
