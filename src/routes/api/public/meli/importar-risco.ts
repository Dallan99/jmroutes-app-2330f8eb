import { clienteDeModulo } from "@/lib/modulo-client";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clienteDoUsuario, extrairBearer, json, MAX_BODY_BYTES } from "@/lib/meli-api-http";

const linhaSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facility: z.string().trim().min(1).max(30),
  cluster: z.string().trim().min(1).max(120),
  transportadora: z.string().trim().min(1).max(120),
  altoRisco: z.boolean(),
  regiao: z.string().trim().max(160).nullable(),
  idServico: z.string().trim().max(80).nullable(),
});
const payloadSchema = z.object({ linhas: z.array(linhaSchema).min(1).max(5000) });

export const Route = createFileRoute("/api/public/meli/importar-risco")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const origin = request.headers.get("origin");
        const token = extrairBearer(request);
        if (!token) return json({ ok: false, codigo: "nao_autenticado" }, 401, origin);
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return json({ ok: false, codigo: "body_muito_grande" }, 413, origin);
        let entrada: z.infer<typeof payloadSchema>;
        try { entrada = payloadSchema.parse(JSON.parse(raw)); }
        catch { return json({ ok: false, codigo: "payload_invalido" }, 400, origin); }

        const usuario = await clienteDoUsuario(token);
        if (usuario.status !== "ok") return json({ ok: false, codigo: usuario.status }, usuario.status === "config" ? 500 : 401, origin);
        const { supabaseAdmin: clienteAdminOriginal } = await import("@/integrations/supabase/client.server");
        const supabaseAdmin = clienteDeModulo(clienteAdminOriginal);
        const { data: papel } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", usuario.userId)
          .in("role", ["admin", "gerente", "supervisor"])
          .limit(1)
          .maybeSingle();
        if (!papel) return json({ ok: false, codigo: "sem_permissao" }, 403, origin);

        const datas = [...new Set(entrada.linhas.map((linha) => linha.data))];
        const { data: rotas, error } = await supabaseAdmin
          .from("meli_rotas")
          .select("id, route_id, data_rota, facility, cluster, carrier, codigo_area_risco")
          .in("data_rota", datas);
        if (error) return json({ ok: false, codigo: "falha_consulta_rotas" }, 500, origin);

        const normalizar = (valor: string | null | undefined) => (valor ?? "").trim().toLocaleLowerCase("pt-BR");
        const facilities = [...new Set(entrada.linhas.map((linha) => linha.facility))];
        const { data: bases, error: basesError } = await supabaseAdmin
          .from("bases")
          .select("id, meli_service_center_id")
          .in("meli_service_center_id", facilities);
        if (basesError) return json({ ok: false, codigo: "falha_consulta_bases" }, 500, origin);
        const basePorFacility = new Map((bases ?? []).map((base) => [normalizar(base.meli_service_center_id), base.id]));

        // O Rostering pode devolver o nome jurídico da transportadora, enquanto
        // route-detail usa o nome operacional. Data + facility + cluster é a
        // identidade estável da rota planejada e evita perder esse vínculo.
        const chave = (data: string, facility: string, cluster: string) =>
          [data, normalizar(facility), normalizar(cluster)].join("|");
        const indice = new Map<string, NonNullable<typeof rotas>[number]>();
        const placeholders = new Map<string, string>();
        for (const rota of rotas ?? []) {
          const k = chave(rota.data_rota!, rota.facility ?? "", rota.cluster ?? "");
          const placeholder = rota.route_id.startsWith("rostering:");
          if (placeholder) {
            placeholders.set(k, rota.id);
            if (!indice.has(k)) indice.set(k, rota);
          } else {
            indice.set(k, rota);
          }
        }
        const agora = new Date().toISOString();
        let encontradas = 0;
        let marcadasRisco = 0;
        let confirmadasSemRisco = 0;
        let criadasRostering = 0;
        const atualizacoes: PromiseLike<{ error: { message: string } | null }>[] = [];

        for (const linha of entrada.linhas) {
          const k = chave(linha.data, linha.facility, linha.cluster);
          const rota = indice.get(k);
          const placeholderId = placeholders.get(k);
          if (rota && !rota.route_id.startsWith("rostering:") && placeholderId) {
            atualizacoes.push(supabaseAdmin.from("meli_rotas").delete().eq("id", placeholderId));
            placeholders.delete(k);
          }
          if (!rota) {
            if (!linha.altoRisco || !linha.idServico) continue;
            const baseId = basePorFacility.get(normalizar(linha.facility));
            if (!baseId) continue;
            encontradas += 1;
            marcadasRisco += 1;
            criadasRostering += 1;
            atualizacoes.push(supabaseAdmin.from("meli_rotas").upsert({
              route_id: `rostering:${linha.data}:${linha.facility}:${linha.idServico}`,
              data_rota: linha.data,
              facility: linha.facility,
              service_center_id: linha.facility,
              cluster: linha.cluster,
              carrier: linha.transportadora,
              base_id: baseId,
              rota_area_risco: true,
              motivo_area_risco: linha.regiao ? `Zona de alto risco — ${linha.regiao}` : "Zona de alto risco",
              codigo_area_risco: "rostering_api",
              origem_area_risco: "rota",
              integration_source: "adminml",
              valor_original_area_risco: { fonte: "rostering_api", id_servico: linha.idServico, valor: true },
              area_risco_detectado_em: agora,
              last_synced_at: agora,
            }, { onConflict: "route_id" }));
            continue;
          }
          encontradas += 1;
          if (linha.altoRisco) {
            marcadasRisco += 1;
            atualizacoes.push(supabaseAdmin.from("meli_rotas").update({
              rota_area_risco: true,
              motivo_area_risco: linha.regiao ? `Zona de alto risco — ${linha.regiao}` : "Zona de alto risco",
              codigo_area_risco: "rostering_api",
              origem_area_risco: "rota",
              valor_original_area_risco: { fonte: "rostering_api", id_servico: linha.idServico, valor: true },
              area_risco_detectado_em: agora,
            }).eq("id", rota.id));
          } else if (["rostering_api", "rostering_csv"].includes(rota.codigo_area_risco ?? "")) {
            confirmadasSemRisco += 1;
            atualizacoes.push(supabaseAdmin.from("meli_rotas").update({
              rota_area_risco: false,
              motivo_area_risco: null,
              codigo_area_risco: null,
              origem_area_risco: null,
              valor_original_area_risco: null,
              area_risco_detectado_em: null,
            }).eq("id", rota.id));
          }
        }

        const resultados = await Promise.all(atualizacoes);
        if (resultados.some((resultado) => resultado.error)) {
          return json({ ok: false, codigo: "falha_atualizacao_rotas" }, 500, origin);
        }
        await supabaseAdmin.from("audit_logs").insert({
          user_id: usuario.userId,
          acao: "area_risco.sincronizado",
          entidade: "meli_rotas",
          detalhes: {
            fonte: "rostering_api",
            processadas: entrada.linhas.length,
            encontradas,
            marcadas_risco: marcadasRisco,
            confirmadas_sem_risco: confirmadasSemRisco,
            criadas_rostering: criadasRostering,
          },
        });
        return json({ ok: true, processadas: entrada.linhas.length, encontradas, marcadasRisco, confirmadasSemRisco, criadasRostering }, 200, origin);
      },
    },
  },
});
