import { clienteDeModulo } from "@/lib/modulo-em-implantacao";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const filtroSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  base_id: z.string().uuid().optional().nullable(),
  rota: z.string().trim().max(120).optional().nullable(),
  motorista: z.string().trim().max(120).optional().nullable(),
  transportadora: z.string().trim().max(120).optional().nullable(),
  risco: z.enum(["qualquer", "integral", "parcial"]).optional().nullable(),
  status: z
    .enum(["nao_iniciado", "em_rota", "entregue", "insucesso", "cancelado", "desconhecido"])
    .optional()
    .nullable(),
});

export type MeliRiscoFiltros = z.infer<typeof filtroSchema>;

export type MeliRiscoCards = {
  rotas: number;
  rotas_integrais: number;
  rotas_parciais: number;
  pacotes: number;
  entregue: number;
  pendente: number;
  insucesso: number;
  perc_conclusao: number;
  ultima_sincronizacao: string | null;
};

export type MeliRiscoRota = {
  rota_id: string;
  route_id: string;
  cluster: string | null;
  base_id: string | null;
  base_codigo: string | null;
  base_nome: string | null;
  driver_name: string | null;
  vehicle_license: string | null;
  carrier: string | null;
  data_rota: string | null;
  last_synced_at: string | null;
  rota_area_risco: boolean;
  area_risco_parcial: boolean;
  motivo_area_risco: string | null;
  codigo_area_risco: string | null;
  origem_area_risco: string | null;
  total: number;
  pacotes_risco: number;
  entregue_risco: number;
  pendente_risco: number;
  insucesso_risco: number;
  perc_conclusao: number;
};

export type SistemaRiscoRota = MeliRiscoRota;

export type MeliRiscoResult = {
  status: "ok" | "erro";
  erro?: string;
  data_operacional?: string;
  server_time?: string;
  cards?: MeliRiscoCards;
  rotas?: MeliRiscoRota[];
};

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const meliRotasAreaRisco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filtroSchema.parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MeliRiscoResult> => {
    const { data: res, error } = await (context.supabase as unknown as RpcClient).rpc(
      "meli_rotas_area_risco",
      {
        p_data: data.data ?? null,
        p_base_id: data.base_id ?? null,
        p_rota: data.rota || null,
        p_motorista: data.motorista || null,
        p_transportadora: data.transportadora || null,
        p_risco: data.risco ?? null,
        p_status: data.status ?? null,
      },
    );
    if (error) return { status: "erro", erro: error.message };
    return res as MeliRiscoResult;
  });

const linhaRosteringSchema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  facility: z.string().trim().min(1).max(30),
  cluster: z.string().trim().min(1).max(120),
  transportadora: z.string().trim().min(1).max(120),
  altoRisco: z.boolean(),
  regiao: z.string().trim().max(160).nullable(),
  idServico: z.string().trim().max(80).nullable(),
});

const importarRosteringSchema = z.object({
  linhas: z.array(linhaRosteringSchema).min(1).max(5000),
  arquivoNome: z.string().trim().min(1).max(200),
});

export type ImportacaoRiscoRosteringResultado = {
  processadas: number;
  encontradas: number;
  marcadasRisco: number;
  confirmadasSemRisco: number;
  naoEncontradas: Array<{ data: string; facility: string; cluster: string }>;
};

export const importarRiscoRostering = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => importarRosteringSchema.parse(d))
  .handler(async ({ data, context }): Promise<ImportacaoRiscoRosteringResultado> => {
    const permissoes = await Promise.all(
      (["admin", "supervisor", "gerente"] as const).map((role) =>
        clienteDeModulo(context.supabase).rpc("has_role", { _user_id: context.userId, _role: role }),
      ),
    );
    if (!permissoes.some((p) => !p.error && p.data)) throw new Error("Acesso negado para importar o CSV de risco.");

    const supabaseAdmin = clienteDeModulo((await import("@/integrations/supabase/client.server")).supabaseAdmin);
    const datas = [...new Set(data.linhas.map((l) => l.data))];
    const { data: rotas, error } = await supabaseAdmin
      .from("meli_rotas")
      .select("id, data_rota, facility, cluster, carrier, codigo_area_risco")
      .in("data_rota", datas);
    if (error) throw new Error(error.message);

    const normalizar = (v: string | null | undefined) => (v ?? "").trim().toLocaleLowerCase("pt-BR");
    const chave = (dataRota: string, facility: string, cluster: string, carrier: string) =>
      [dataRota, normalizar(facility), normalizar(cluster), normalizar(carrier)].join("|");
    const indice = new Map(
      (rotas ?? []).map((r) => [chave(r.data_rota!, r.facility ?? "", r.cluster ?? "", r.carrier ?? ""), r]),
    );

    let marcadasRisco = 0;
    let confirmadasSemRisco = 0;
    const naoEncontradas: Array<{ data: string; facility: string; cluster: string }> = [];
    const atualizacoes: Promise<unknown>[] = [];

    for (const linha of data.linhas) {
      const rota = indice.get(chave(linha.data, linha.facility, linha.cluster, linha.transportadora));
      if (!rota) {
        naoEncontradas.push({ data: linha.data, facility: linha.facility, cluster: linha.cluster });
        continue;
      }
      if (linha.altoRisco) {
        marcadasRisco++;
        atualizacoes.push(
          Promise.resolve(supabaseAdmin.from("meli_rotas").update({
            rota_area_risco: true,
            motivo_area_risco: linha.regiao ? `Zona de alto risco — ${linha.regiao}` : "Zona de alto risco",
            codigo_area_risco: "rostering_csv",
            origem_area_risco: "rota",
            valor_original_area_risco: { fonte: "rostering_csv", arquivo: data.arquivoNome, id_servico: linha.idServico, valor: "Sim" },
            area_risco_detectado_em: new Date().toISOString(),
          }).eq("id", rota.id)),
        );
      } else {
        confirmadasSemRisco++;
        if (rota.codigo_area_risco === "rostering_csv") {
          atualizacoes.push(
            Promise.resolve(supabaseAdmin.from("meli_rotas").update({
              rota_area_risco: false, motivo_area_risco: null, codigo_area_risco: null,
              origem_area_risco: null, valor_original_area_risco: null, area_risco_detectado_em: null,
            }).eq("id", rota.id)),
          );
        }
      }
    }

    const resultados = await Promise.all(atualizacoes);
    const falha = resultados.find((r: any) => r?.error) as any;
    if (falha?.error) throw new Error(falha.error.message);
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId, acao: "area_risco.csv_importado", entidade: "meli_rotas",
      detalhes: { arquivo: data.arquivoNome, processadas: data.linhas.length, encontradas: data.linhas.length - naoEncontradas.length, marcadas_risco: marcadasRisco, confirmadas_sem_risco: confirmadasSemRisco, nao_encontradas: naoEncontradas.length },
    });
    return { processadas: data.linhas.length, encontradas: data.linhas.length - naoEncontradas.length, marcadasRisco, confirmadasSemRisco, naoEncontradas: naoEncontradas.slice(0, 100) };
  });
