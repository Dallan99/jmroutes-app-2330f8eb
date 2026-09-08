// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

type Linha = Record<string, number | string | null>;
const n = (v: unknown) => Number(v ?? 0).toLocaleString("pt-BR");
const pct = (v: unknown) => v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function htmlRelatorio(data: string, snapshot: { bases?: Linha[]; totais?: Linha }) {
  const linhas = (snapshot.bases ?? []).map((b) => `<tr>
    <td>${esc(b.nome)}<br><small>${esc(b.codigo)}</small></td><td>${n(b.veiculos)}</td><td>${n(b.pacotes)}</td>
    <td>${n(b.entregues)}</td><td>${n(b.dc_cancelado)}</td><td>${n(b.sinistros)}</td><td>${n(b.insucessos)}</td>
    <td>${n(b.pnr)}</td><td>${pct(b.performance_logistics)}</td><td>${pct(b.performance_sem_dc)}</td><td>${pct(b.performance_sem_dc_sinistro)}</td></tr>`).join("");
  const t = snapshot.totais ?? {};
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#101828">
    <h2>JMRoutes — Fechamento geral ${esc(data)}</h2>
    <p>Relatório fechado automaticamente à meia-noite (horário de São Paulo).</p>
    <table style="border-collapse:collapse;width:100%;font-size:12px" border="1" cellpadding="6">
      <thead style="background:#071b45;color:white"><tr><th>Base</th><th>Veículos</th><th>Pacotes</th><th>Entregas</th><th>DC</th><th>Sinistro</th><th>Insucessos normais</th><th>PNR</th><th>Logistics</th><th>S/DC</th><th>S/DC+Sinistro</th></tr></thead>
      <tbody>${linhas}</tbody><tfoot style="font-weight:bold;background:#f2f4f7"><tr><td>Consolidado</td><td>${n(t.veiculos)}</td><td>${n(t.pacotes)}</td><td>${n(t.entregues)}</td><td>${n(t.dc_cancelado)}</td><td>${n(t.sinistros)}</td><td>${n(t.insucessos)}</td><td>${n(t.pnr)}</td><td>${pct(t.performance_logistics)}</td><td>${pct(t.performance_sem_dc)}</td><td>${pct(t.performance_sem_dc_sinistro)}</td></tr></tfoot>
    </table></body></html>`;
}

export default {
  fetch: withSupabase({ auth: ["secret"] }, async (req, ctx) => {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("DASHBOARD_GERAL_FROM");
    const recipients = (Deno.env.get("DASHBOARD_GERAL_EMAILS") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    if (!resendKey || !from || recipients.length === 0) {
      return Response.json({ ok: false, erro: "Configure RESEND_API_KEY, DASHBOARD_GERAL_FROM e DASHBOARD_GERAL_EMAILS." }, { status: 503 });
    }
    const body = await req.json().catch(() => ({})) as { data?: string };
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const data = body.data && /^\d{4}-\d{2}-\d{2}$/.test(body.data)
      ? body.data
      : new Date(`${hoje}T12:00:00Z`).toISOString().slice(0, 10);
    const dataFechamento = body.data ? data : new Date(new Date(`${data}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);

    const { data: fechamentoId, error: fecharErro } = await ctx.supabaseAdmin.rpc("meli_fechar_dashboard_geral", { p_data: dataFechamento });
    if (fecharErro) return Response.json({ ok: false, erro: fecharErro.message }, { status: 500 });
    const { data: fechamento, error: buscaErro } = await ctx.supabaseAdmin.from("meli_performance_fechamentos").select("id,snapshot").eq("id", fechamentoId).single();
    if (buscaErro) return Response.json({ ok: false, erro: buscaErro.message }, { status: 500 });

    await ctx.supabaseAdmin.from("meli_performance_fechamentos").update({ email_status: "enviando", email_tentativas: 1, email_destinatarios: recipients }).eq("id", fechamentoId);
    const resposta = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({ from, to: recipients, subject: `JMRoutes — Fechamento geral ${dataFechamento}`, html: htmlRelatorio(dataFechamento, fechamento.snapshot) }),
    });
    const retorno = await resposta.json().catch(() => ({}));
    await ctx.supabaseAdmin.from("meli_performance_fechamentos").update({
      email_status: resposta.ok ? "enviado" : "erro", email_resposta: retorno,
      email_enviado_at: resposta.ok ? new Date().toISOString() : null,
    }).eq("id", fechamentoId);
    return Response.json({ ok: resposta.ok, fechamento_id: fechamentoId, resposta: retorno }, { status: resposta.ok ? 200 : 502 });
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/enviar-dashboard-geral' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
