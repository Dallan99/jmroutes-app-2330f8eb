// Configuração fechada das bases JM. Mantida em um único ponto para evitar
// divergência entre a extensão, o worker local e futuros deploys.
export const WORKER_VERSAO = "0.4.0-dashboard-geral";
export const STORAGE_STATE_AAD = "meli-storage-state:v1";

export const BASES_JM = [
  { baseCode: "SSP3", serviceCenterId: "SSP3", siteId: "MLB", nome: "Campinas" },
  { baseCode: "SSP38", serviceCenterId: "SSP38", siteId: "MLB", nome: "Itupeva" },
  { baseCode: "ESP15", serviceCenterId: "SSP20", siteId: "MLB", nome: "Ibiúna" },
  { baseCode: "SSP5", serviceCenterId: "SSP5", siteId: "MLB", nome: "Mega Barueri" },
  { baseCode: "SSP20", serviceCenterId: "SSP20", siteId: "MLB", nome: "Sorocaba" },
  { baseCode: "ESP17", serviceCenterId: "SSP56", siteId: "MLB", nome: "São Lourenço" },
  { baseCode: "ESP16", serviceCenterId: "SSP15", siteId: "MLB", nome: "Guarujá" },
  { baseCode: "SSP17", serviceCenterId: "SSP17", siteId: "MLB", nome: "ABC" },
  { baseCode: "ESP18", serviceCenterId: "SSP25", siteId: "MLB", nome: "Franco da Rocha" },
  { baseCode: "SSP6", serviceCenterId: "SSP6", siteId: "MLB", nome: "Mauá" },
  { baseCode: "SSP45", serviceCenterId: "SSP45", siteId: "MLB", nome: "Itaquera" },
  { baseCode: "SSP15", serviceCenterId: "SSP15", siteId: "MLB", nome: "Santos" },
  { baseCode: "SSP37", serviceCenterId: "SSP37", siteId: "MLB", nome: "Campinas" },
  { baseCode: "SSP23", serviceCenterId: "SSP23", siteId: "MLB", nome: "Suzano" },
  { baseCode: "SSC2", serviceCenterId: "SSC2", siteId: "MLB", nome: "Biguaçu" },
  { baseCode: "SSP4", serviceCenterId: "SSP4", siteId: "MLB", nome: "Cravinhos" },
  { baseCode: "SSP7", serviceCenterId: "SSP7", siteId: "MLB", nome: "Lapa" },
] as const;

export const PILOTO = { BASE_CODE: "ESP16", SERVICE_CENTER_ID: "SSP15", SITE_ID: "MLB", NOME: "Guarujá" } as const;
export type BaseJm = (typeof BASES_JM)[number];

export const ADMINML = {
  HOST: "envios.adminml.com",
  LIST_URL: "https://envios.adminml.com/logistics/api/monitoring/get-routes-list",
  DETAIL_URL: "https://envios.adminml.com/logistics/api/monitoring-route/route-detail",
  PAGE_SIZE: 50,
  MAX_PAGINAS: 40,
  TIMEOUT_MS: 30_000,
  JITTER_MS: 500,
  CONCORRENCIA: 1,
} as const;

export type WorkerConfig = {
  bases: readonly BaseJm[];
  writeBaseCodes: string[];
  baseCode: string;
  serviceCenterId: string;
  siteId: string;
  jmrBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  workerEmail: string;
  workerPassword: string;
  sessionKeyBase64: string;
  sessionFilePath: string;
  jmrSessionFilePath: string;
  syncIntervalSeconds: number;
  /** DRY_RUN=true: consulta o AdminML, mas NÃO envia ao JMRoutes e NÃO grava telemetria. */
  dryRun: boolean;
  /**
   * Feature flag do protocolo de lotes (staging + promoção atômica).
   * DESLIGADA por padrão: com ela off o worker mantém exatamente o fluxo atual,
   * compatível com o banco antes da migration.
   */
  protocoloLotes: boolean;
};

export class ConfigError extends Error {}

function req(env: Record<string, string | undefined>, name: string): string {
  const v = (env[name] ?? "").trim();
  if (!v) throw new ConfigError(`Variável obrigatória ausente: ${name}`);
  return v;
}

/**
 * Lê e valida a configuração. Recusa qualquer base fora da lista fechada.
 * Nunca registra senha/chave — apenas valida presença.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): WorkerConfig {
  const codigos = (env["BASE_CODES"] ?? env["BASE_CODE"] ?? BASES_JM.map((b) => b.baseCode).join(","))
    .toUpperCase().split(",").map((v) => v.trim()).filter(Boolean);
  const bases = Array.from(new Set(codigos)).map((codigo) => BASES_JM.find((b) => b.baseCode === codigo));
  const invalida = codigos.find((_, i) => !bases[i]);
  if (invalida) throw new ConfigError(`Base Meli não permitida: ${invalida}`);
  const selecionadas = bases as BaseJm[];
  const primeira = selecionadas[0];
  if (!primeira) throw new ConfigError("Nenhuma base configurada em BASE_CODES.");

  const sessionKeyBase64 = req(env, "WORKER_SESSION_KEY");
  const keyBytes = Buffer.from(sessionKeyBase64, "base64");
  if (keyBytes.length !== 32) {
    throw new ConfigError("WORKER_SESSION_KEY deve ser 32 bytes em base64 (AES-256-GCM).");
  }

  const dryRun = (env["DRY_RUN"] ?? "").trim().toLowerCase() === "true";
  const protocoloLotes = (env["SYNC_PROTOCOL_LOTES"] ?? "").trim().toLowerCase() === "true";
  const passwordBase64 = (env["WORKER_PASSWORD_BASE64"] ?? "").trim();
  const workerPassword = passwordBase64
    ? Buffer.from(passwordBase64, "base64").toString("utf8")
    : (env["WORKER_PASSWORD"] ?? "").trim();
  const writeBaseCodes = dryRun
    ? []
    : (env["WRITE_BASE_CODES"] ?? selecionadas.map((b) => b.baseCode).join(","))
        .toUpperCase().split(",").map((v) => v.trim()).filter(Boolean);
  const escritaInvalida = writeBaseCodes.find((codigo) => !selecionadas.some((b) => b.baseCode === codigo));
  if (escritaInvalida) throw new ConfigError(`WRITE_BASE_CODES contém base não selecionada: ${escritaInvalida}`);

  const intervalRaw = Number(env["SYNC_INTERVAL_SECONDS"] ?? 60);
  const syncIntervalSeconds =
    Number.isFinite(intervalRaw) && intervalRaw >= 15 ? Math.floor(intervalRaw) : 60;

  return {
    bases: selecionadas,
    writeBaseCodes,
    baseCode: primeira.baseCode,
    serviceCenterId: primeira.serviceCenterId,
    siteId: primeira.siteId,
    jmrBaseUrl: req(env, "JMR_BASE_URL").replace(/\/+$/, ""),
    supabaseUrl: req(env, "SUPABASE_URL").replace(/\/+$/, ""),
    supabaseAnonKey: req(env, "SUPABASE_ANON_KEY"),
    // Em DRY_RUN não há chamada ao JMRoutes; credenciais do usuário técnico
    // deixam de ser obrigatórias justamente para permitir teste sem usuário criado.
    workerEmail: dryRun ? (env["WORKER_EMAIL"] ?? "").trim() : req(env, "WORKER_EMAIL"),
    workerPassword,
    sessionKeyBase64,
    sessionFilePath: (env["SESSION_FILE_PATH"] ?? "/data/adminml-session.enc").trim(),
    jmrSessionFilePath: (env["JMR_SESSION_FILE_PATH"] ?? "./data/jmr-session.enc").trim(),
    syncIntervalSeconds,
    dryRun,
    protocoloLotes,
  };
}

export function configParaBase(cfg: WorkerConfig, base: BaseJm): WorkerConfig {
  return { ...cfg, bases: [base], baseCode: base.baseCode, serviceCenterId: base.serviceCenterId, siteId: base.siteId };
}
