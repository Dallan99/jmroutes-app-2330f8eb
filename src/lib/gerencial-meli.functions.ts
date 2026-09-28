import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MeliBaseResumo = {
  base_codigo: string;
  dias: number;
  rotas: number;
  pacotes: number;
  entregues: number;
  insucessos: number;
  pendentes: number;
  perc_entrega: number;
};

export type MeliGerencialData = {
  inicio: string;
  fim: string;
  bases: MeliBaseResumo[];
  totais: Omit<MeliBaseResumo, "base_codigo">;
  porDia: { dia: string; pacotes: number; entregues: number; insucessos: number }[];
};

function ymdBrasilia(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Resumo Meli (rotas/pacotes/entregas) por base no período, a partir do snapshot diário. Somente leitura. */
export const meliResumoGerencial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ periodo: z.enum(["hoje", "7d", "30d"]) }).parse(i))
  .handler(async ({ data, context }): Promise<MeliGerencialData> => {
    const hoje = new Date();
    const fim = ymdBrasilia(hoje);
    const dias = data.periodo === "hoje" ? 0 : data.periodo === "7d" ? 6 : 29;
    const inicio = ymdBrasilia(new Date(hoje.getTime() - dias * 86400000));

    const { data: rows, error } = await context.supabase
      .from("meli_monitoramento_snapshots")
      .select("data_operacional, base_codigo, rotas_totais, pacotes, bem_sucedidos, com_falhas, pendentes")
      .gte("data_operacional", inicio)
      .lte("data_operacional", fim)
      .limit(5000);
    if (error) throw new Error(error.message);

    const porBase = new Map<string, MeliBaseResumo>();
    const porDia = new Map<string, { dia: string; pacotes: number; entregues: number; insucessos: number }>();
    for (const r of rows ?? []) {
      const b = porBase.get(r.base_codigo) ?? {
        base_codigo: r.base_codigo, dias: 0, rotas: 0, pacotes: 0, entregues: 0, insucessos: 0, pendentes: 0, perc_entrega: 0,
      };
      b.dias += 1;
      b.rotas += r.rotas_totais ?? 0;
      b.pacotes += r.pacotes ?? 0;
      b.entregues += r.bem_sucedidos ?? 0;
      b.insucessos += r.com_falhas ?? 0;
      b.pendentes += r.pendentes ?? 0;
      porBase.set(r.base_codigo, b);
      const d = porDia.get(r.data_operacional) ?? { dia: r.data_operacional, pacotes: 0, entregues: 0, insucessos: 0 };
      d.pacotes += r.pacotes ?? 0;
      d.entregues += r.bem_sucedidos ?? 0;
      d.insucessos += r.com_falhas ?? 0;
      porDia.set(r.data_operacional, d);
    }
    const bases = [...porBase.values()]
      .map((b) => ({ ...b, perc_entrega: pct(b.entregues, b.pacotes) }))
      .sort((a, b) => b.pacotes - a.pacotes);
    const t = bases.reduce(
      (acc, b) => ({
        dias: Math.max(acc.dias, b.dias), rotas: acc.rotas + b.rotas, pacotes: acc.pacotes + b.pacotes,
        entregues: acc.entregues + b.entregues, insucessos: acc.insucessos + b.insucessos,
        pendentes: acc.pendentes + b.pendentes, perc_entrega: 0,
      }),
      { dias: 0, rotas: 0, pacotes: 0, entregues: 0, insucessos: 0, pendentes: 0, perc_entrega: 0 },
    );
    t.perc_entrega = pct(t.entregues, t.pacotes);
    return { inicio, fim, bases, totais: t, porDia: [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia)) };
  });
