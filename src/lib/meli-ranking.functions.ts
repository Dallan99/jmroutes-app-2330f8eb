import { clienteDeModulo } from "@/lib/modulo-client";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { normalizarSituacaoMeli, type SituacaoMeli } from "@/lib/meli-status";
import { pmExcluidaDosIndicadores } from "@/lib/meli-pm";

const rankingSchema = z.object({
  data: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  base_id: z.string().uuid().optional().nullable(),
  limite: z.number().int().min(1).max(200).optional(),
});

export type MeliRankingFiltros = z.infer<typeof rankingSchema>;

export type MeliRankingOcorrencia = { codigo: string; descricao: string; total: number };

export type MeliRankingMotorista = {
  motorista: string;
  bases: string[];
  rotas: number;
  total: number;
  entregue: number;
  insucesso: number;
  perc_insucesso: number;
  ocorrencias: MeliRankingOcorrencia[];
};

export type MeliRankingResult = {
  status: "ok" | "erro";
  erro?: string;
  data_operacional?: string;
  periodo_inicio?: string;
  periodo_fim?: string;
  motoristas?: MeliRankingMotorista[];
  ocorrencias_gerais?: MeliRankingOcorrencia[];
  total_insucessos?: number;
};

type RotaRow = {
  id: string;
  route_id: string;
  cluster: string | null;
  driver_name: string | null;
  base_id: string | null;
  route_status: string | null;
  route_substatus: string | null;
};

type PacoteRow = {
  rota_id: string;
  status: string | null;
  substatus: string | null;
  occurrence_code: string | null;
};

const PAGE = 1000;
const CHUNK = 60;

function diaOperacionalSp(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export function periodoSemanaMeli(dataReferencia: string): { inicio: string; fim: string } {
  const [ano, mes, dia] = dataReferencia.split("-").map(Number);
  const referencia = new Date(Date.UTC(ano, mes - 1, dia));
  const inicio = new Date(referencia);
  inicio.setUTCDate(referencia.getUTCDate() - referencia.getUTCDay());
  const fim = new Date(inicio);
  fim.setUTCDate(inicio.getUTCDate() + 6);
  return {
    inicio: inicio.toISOString().slice(0, 10),
    fim: fim.toISOString().slice(0, 10),
  };
}

export const meliRankingMotoristas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => rankingSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliRankingResult> => {
    const sb = clienteDeModulo(context.supabase);
    const dia = data.data ?? diaOperacionalSp();
    const periodo = periodoSemanaMeli(dia);

    let rotasQuery = sb
      .from("meli_rotas")
      .select("id, route_id, cluster, driver_name, base_id, route_status, route_substatus")
      .gte("data_rota", periodo.inicio)
      .lte("data_rota", periodo.fim);
    if (data.base_id) rotasQuery = rotasQuery.eq("base_id", data.base_id);

    const { data: rotasRaw, error: erroRotas } = await rotasQuery;
    if (erroRotas) return { status: "erro", erro: erroRotas.message };
    const rotas = (rotasRaw ?? []) as RotaRow[];
    if (!rotas.length) {
      return {
        status: "ok",
        data_operacional: dia,
        periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim,
        motoristas: [],
        ocorrencias_gerais: [],
        total_insucessos: 0,
      };
    }

    const { data: basesRaw } = await sb.from("bases").select("id, codigo");
    const codigoBase = new Map<string, string>();
    for (const b of (basesRaw ?? []) as { id: string; codigo: string }[]) codigoBase.set(b.id, b.codigo);

    const { data: codigosRaw } = await sb.from("meli_ocorrencia_codigos").select("codigo, descricao");
    const descricaoCodigo = new Map<string, string>();
    for (const c of (codigosRaw ?? []) as { codigo: string; descricao: string }[]) {
      descricaoCodigo.set(String(c.codigo).toLowerCase(), c.descricao);
    }

    // Pacotes das rotas do dia (paginado por lotes de rotas).
    const ids = rotas.map((r) => r.id);
    const pacotes: PacoteRow[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const lote = ids.slice(i, i + CHUNK);
      let de = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data: page, error } = await sb
          .from("meli_pacotes")
          .select("rota_id, status, substatus, occurrence_code")
          .in("rota_id", lote)
          .range(de, de + PAGE - 1);
        if (error) return { status: "erro", erro: error.message };
        const rows = (page ?? []) as PacoteRow[];
        pacotes.push(...rows);
        if (rows.length < PAGE) break;
        de += PAGE;
      }
    }

    type Agregado = {
      situacoes: SituacaoMeli[];
      insucessosPorCodigo: Map<string, number>;
    };
    const porRota = new Map<string, Agregado>();
    for (const r of rotas) porRota.set(r.id, { situacoes: [], insucessosPorCodigo: new Map() });

    for (const p of pacotes) {
      const ag = porRota.get(p.rota_id);
      if (!ag) continue;
      const situacao = normalizarSituacaoMeli(p.status, p.substatus, p.occurrence_code);
      ag.situacoes.push(situacao);
      if (situacao === "insucesso") {
        const cod = (p.occurrence_code || p.substatus || "sem_codigo").trim().toLowerCase();
        ag.insucessosPorCodigo.set(cod, (ag.insucessosPorCodigo.get(cod) ?? 0) + 1);
      }
    }

    type Acc = {
      motorista: string;
      bases: Set<string>;
      rotas: number;
      total: number;
      entregue: number;
      insucesso: number;
      codigos: Map<string, number>;
    };
    const porMotorista = new Map<string, Acc>();
    const geral = new Map<string, number>();

    for (const r of rotas) {
      const ag = porRota.get(r.id)!;
      const baseCodigo = r.base_id ? (codigoBase.get(r.base_id) ?? null) : null;
      // Rotas PM da ESP16 ainda não iniciadas ficam fora dos indicadores do dia.
      if (
        pmExcluidaDosIndicadores({
          base_codigo: baseCodigo,
          cluster: r.cluster,
          route_id: r.route_id,
          route_status: r.route_status,
          route_substatus: r.route_substatus,
          situacoes: ag.situacoes,
        })
      ) {
        continue;
      }

      const nome = (r.driver_name ?? "").trim() || "Sem motorista informado";
      const chave = nome.toLowerCase();
      const acc =
        porMotorista.get(chave) ??
        {
          motorista: nome,
          bases: new Set<string>(),
          rotas: 0,
          total: 0,
          entregue: 0,
          insucesso: 0,
          codigos: new Map<string, number>(),
        };
      if (baseCodigo) acc.bases.add(baseCodigo);
      acc.rotas += 1;
      acc.total += ag.situacoes.length;
      acc.entregue += ag.situacoes.filter((s) => s === "entregue").length;
      acc.insucesso += ag.situacoes.filter((s) => s === "insucesso").length;
      for (const [cod, qtd] of ag.insucessosPorCodigo) {
        acc.codigos.set(cod, (acc.codigos.get(cod) ?? 0) + qtd);
        geral.set(cod, (geral.get(cod) ?? 0) + qtd);
      }
      porMotorista.set(chave, acc);
    }

    const descrever = (cod: string) => descricaoCodigo.get(cod) ?? cod;

    const motoristas: MeliRankingMotorista[] = Array.from(porMotorista.values())
      .filter((m) => m.insucesso > 0)
      .map((m) => ({
        motorista: m.motorista,
        bases: Array.from(m.bases).sort(),
        rotas: m.rotas,
        total: m.total,
        entregue: m.entregue,
        insucesso: m.insucesso,
        perc_insucesso: m.total > 0 ? Math.round((m.insucesso / m.total) * 1000) / 10 : 0,
        ocorrencias: Array.from(m.codigos.entries())
          .map(([codigo, total]) => ({ codigo, descricao: descrever(codigo), total }))
          .sort((a, b) => b.total - a.total || a.codigo.localeCompare(b.codigo)),
      }))
      .sort(
        (a, b) =>
          b.insucesso - a.insucesso ||
          b.perc_insucesso - a.perc_insucesso ||
          a.motorista.localeCompare(b.motorista, "pt-BR"),
      )
      .slice(0, data.limite ?? 25);

    const ocorrencias_gerais = Array.from(geral.entries())
      .map(([codigo, total]) => ({ codigo, descricao: descrever(codigo), total }))
      .sort((a, b) => b.total - a.total);

    return {
      status: "ok",
      data_operacional: dia,
      periodo_inicio: periodo.inicio,
      periodo_fim: periodo.fim,
      motoristas,
      ocorrencias_gerais,
      total_insucessos: ocorrencias_gerais.reduce((s, o) => s + o.total, 0),
    };
  });
