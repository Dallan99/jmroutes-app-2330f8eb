import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { clienteDoUsuario, extrairBearer, json, MAX_BODY_BYTES } from "@/lib/meli-api-http";

const contador = z.number().int().nonnegative().max(10_000_000);
const schema = z.object({
  base_codigo: z.string().trim().toUpperCase().regex(/^(ESP|SSP|SSC)\d+$/),
  facility_id: z.string().trim().toUpperCase().regex(/^(ESP|SSP|SSC)\d+$/),
  service_center_id: z.string().trim().toUpperCase().regex(/^(SSP|SSC)\d+$/),
  rotas_totais: contador, rotas_entrega: contador, rotas_coleta: contador,
  rotas_mistas: contador, rotas_em_andamento: contador, pacotes: contador,
  sacas: contador, pendentes: contador, com_falhas: contador, bem_sucedidos: contador,
  coletado_em: z.string().datetime(),
  escopo_rotas: z.enum(["AM"]).optional(),
}).refine((v) => v.base_codigo === v.facility_id, { message: "facility_divergente" })
  .refine((v) => v.rotas_totais > 0 || v.pacotes > 0, {
    message: "snapshot_vazio",
  });

function dataEmSaoPaulo(iso: string): string {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return `${valor("year")}-${valor("month")}-${valor("day")}`;
}

export const Route = createFileRoute("/api/public/meli/importar-monitoramento")({
  server: { handlers: { POST: async ({ request }) => {
    const origin = request.headers.get("origin");
    const token = extrairBearer(request);
    if (!token) return json({ ok:false,codigo:"nao_autenticado" },401,origin);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok:false,codigo:"body_muito_grande" },413,origin);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ ok:false,codigo:"json_invalido" },400,origin); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ ok:false,codigo:"payload_invalido" },400,origin);
    const usuario = await clienteDoUsuario(token);
    if (usuario.status !== "ok") return json({ ok:false,codigo:usuario.status },401,origin);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: papel } = await supabaseAdmin.from("user_roles").select("role").eq("user_id",usuario.userId).in("role",["admin","gerente","supervisor"]).limit(1).maybeSingle();
    if (!papel) return json({ ok:false,codigo:"sem_permissao" },403,origin);
    const d = parsed.data;
    const dataOperacional = dataEmSaoPaulo(d.coletado_em);
    const { error } = await (supabaseAdmin as any).rpc("meli_monitoramento_upsert", {
      p_snapshot: { ...d, data_operacional: dataOperacional },
    });
    if (error) return json({ ok:false,codigo:"falha_persistencia" },500,origin);
    return json({ ok:true,base_codigo:d.base_codigo },200,origin);
  } } },
});
