-- Replay da estrutura do JMRoutes (homologacao) — lote 4 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260804122729_c0321573-c50d-4114-93f6-ef157717b0d2.sql ====
CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(
  p_data date DEFAULT NULL::date,
  p_base_id uuid DEFAULT NULL::uuid,
  p_motorista text DEFAULT NULL::text,
  p_rota text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_transportadora text DEFAULT NULL::text,
  p_risco text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH perm AS (SELECT public.meli_pode_operar() AS ok),
dia AS (SELECT coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS v),
pac AS (
  SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
         b.nome AS base_nome, b.meli_service_center_id AS service_center,
         r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco,
         coalesce(p.motivo_area_risco, r.motivo_area_risco) AS motivo_area_risco,
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
         p.occurrence_code, p.substatus, p.status
    FROM public.meli_rotas r
    CROSS JOIN dia
    LEFT JOIN public.bases b ON b.id = r.base_id
    JOIN public.meli_pacotes p ON p.rota_id = r.id
   WHERE (SELECT ok FROM perm)
     AND r.data_rota = dia.v
     AND (p_base_id IS NULL OR r.base_id = p_base_id)
     AND (p_motorista IS NULL OR r.driver_name ILIKE '%'||p_motorista||'%')
     AND (p_rota IS NULL OR r.route_id ILIKE '%'||p_rota||'%' OR coalesce(r.cluster,'') ILIKE '%'||p_rota||'%')
     AND (p_transportadora IS NULL OR r.carrier ILIKE '%'||p_transportadora||'%')
     AND (p_risco IS NULL
          OR (p_risco = 'qualquer' AND (r.rota_area_risco OR r.area_risco_parcial))
          OR (p_risco = 'integral' AND r.rota_area_risco)
          OR (p_risco = 'parcial'  AND r.area_risco_parcial))
     AND (p_status IS NULL
          OR public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = p_status)
),
cards AS (
  SELECT jsonb_build_object(
    'total',        count(*),
    'nao_iniciado', count(*) FILTER (WHERE situacao = 'nao_iniciado'),
    'em_rota',      count(*) FILTER (WHERE situacao = 'em_rota'),
    'entregue',     count(*) FILTER (WHERE situacao = 'entregue'),
    'insucesso',    count(*) FILTER (WHERE situacao = 'insucesso'),
    'cancelado',    count(*) FILTER (WHERE situacao = 'cancelado'),
    'desconhecido', count(*) FILTER (WHERE situacao = 'desconhecido'),
    'area_risco_pacotes', count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'elegiveis',    count(*) FILTER (WHERE situacao <> 'cancelado'),
    'perc_entrega', CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                         THEN round(100.0 * count(*) FILTER (WHERE situacao = 'entregue')
                              / count(*) FILTER (WHERE situacao <> 'cancelado'), 1)
                         ELSE 0 END,
    'rotas',        count(DISTINCT route_id),
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)
  ) AS j FROM pac
),
motivos AS (
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'total')::int DESC), '[]'::jsonb) AS j
  FROM (
    SELECT jsonb_build_object(
             'codigo', s.k,
             'descricao', coalesce(c.descricao, s.k),
             'cadastrado', c.codigo IS NOT NULL,
             'total', s.t
           ) AS x
    FROM (
      SELECT coalesce(nullif(occurrence_code,''), nullif(substatus,''), nullif(status,''), 'sem_codigo') AS k,
             count(*)::int AS t
        FROM pac WHERE situacao = 'insucesso' GROUP BY 1
    ) s
    LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = s.k
  ) y
),
rotas AS (
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.insucesso DESC, r.perc_entrega ASC, r.em_rota DESC, r.pacotes_risco DESC), '[]'::jsonb) AS j
  FROM (
    SELECT rota_id, route_id,
           coalesce(nullif(btrim(cluster),''), route_id) AS nome_operacional,
           cluster, base_id, base_codigo, base_nome, service_center,
           driver_name, vehicle_license, carrier, data_rota, max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           count(*)::int AS total,
           count(*) FILTER (WHERE situacao='nao_iniciado')::int AS nao_iniciado,
           count(*) FILTER (WHERE situacao='em_rota')::int      AS em_rota,
           count(*) FILTER (WHERE situacao='entregue')::int     AS entregue,
           count(*) FILTER (WHERE situacao='insucesso')::int    AS insucesso,
           count(*) FILTER (WHERE situacao='cancelado')::int    AS cancelado,
           count(*) FILTER (WHERE pacote_area_risco)::int       AS pacotes_risco,
           CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                     / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
      FROM pac
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome, service_center,
              driver_name, vehicle_license, carrier, data_rota
  ) r
),
bases_agg AS (
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb) AS j
  FROM (
    SELECT base_id, base_codigo, base_nome, service_center,
           count(DISTINCT route_id)::int AS rotas,
           count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)::int AS rotas_risco,
           count(DISTINCT route_id) FILTER (WHERE rota_area_risco)::int AS rotas_risco_integral,
           count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco)::int AS rotas_risco_parcial,
           count(*)::int AS total,
           count(*) FILTER (WHERE pacote_area_risco)::int AS pacotes_risco,
           count(*) FILTER (WHERE situacao='entregue')::int AS entregue,
           count(*) FILTER (WHERE situacao='em_rota')::int AS em_rota,
           count(*) FILTER (WHERE situacao='insucesso')::int AS insucesso,
           CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                     / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
      FROM pac
     GROUP BY base_id, base_codigo, base_nome, service_center
  ) b
),
risco AS (
  SELECT jsonb_build_object(
    'rotas',      count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial),
    'integrais',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco),
    'parciais',   count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco),
    'pacotes',    count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'entregue',   count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue'),
    'em_rota',    count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='em_rota'),
    'insucesso',  count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='insucesso'),
    'perc_conclusao', CASE WHEN count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco) > 0
      THEN round(100.0 * count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue')
           / count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco), 1) ELSE 0 END
  ) AS j FROM pac
),
sync AS (
  SELECT max(r.last_synced_at) AS v
    FROM public.meli_rotas r CROSS JOIN dia
   WHERE (SELECT ok FROM perm) AND r.data_rota = dia.v
),
sync_bases AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', base_id, 'base_codigo', base_codigo,
           'last_synced_at', ls) ORDER BY ls NULLS FIRST), '[]'::jsonb) AS j
  FROM (SELECT base_id, base_codigo, max(last_synced_at) AS ls FROM pac GROUP BY 1,2) s
)
SELECT CASE WHEN NOT (SELECT ok FROM perm)
  THEN jsonb_build_object('status','erro','erro','sem_permissao')
  ELSE jsonb_build_object(
    'status','ok',
    'data_operacional', (SELECT v FROM dia),
    'server_time', now(),
    'cards', (SELECT j FROM cards),
    'motivos_insucesso', (SELECT j FROM motivos),
    'rotas', (SELECT j FROM rotas),
    'bases', (SELECT j FROM bases_agg),
    'area_risco', (SELECT j FROM risco),
    'ultima_sincronizacao', (SELECT v FROM sync),
    'sincronizacao_por_base', (SELECT j FROM sync_bases)
  ) END;
$function$;
-- ==== fim 20260804122729_c0321573-c50d-4114-93f6-ef157717b0d2.sql ====

-- ==== inicio 20260807162805_546a4542-c18c-4870-8ce3-72f6dbd48270.sql ====
-- 1) Tabela de execuções do worker
CREATE TABLE IF NOT EXISTS public.meli_worker_execucoes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  origem text NOT NULL DEFAULT 'worker'
    CHECK (origem = 'worker'),
  worker_versao text,
  sync_batch_id uuid,
  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz,
  duracao_ms integer NOT NULL DEFAULT 0,
  rotas_encontradas integer NOT NULL DEFAULT 0,
  rotas_processadas integer NOT NULL DEFAULT 0,
  pacotes_enviados integer NOT NULL DEFAULT 0,
  erros integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN (
    'sucesso', 'sucesso_parcial', 'erro', 'rate_limit',
    'circuito_pausado', 'sessao_expirada', 'aguardando_autenticacao',
    'jmroutes_sem_sessao'
  )),
  sessao_status text NOT NULL DEFAULT 'ok'
    CHECK (sessao_status IN ('ok', 'expirada', 'ausente')),
  mensagem_segura text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- 2) GRANTs — leitura gerencial via Data API; gravação exclusivamente via RPC SECURITY DEFINER.
GRANT SELECT ON public.meli_worker_execucoes TO authenticated;

-- 3) RLS
ALTER TABLE public.meli_worker_execucoes ENABLE ROW LEVEL SECURITY;

-- 4) Policies — somente SELECT.
DROP POLICY IF EXISTS "meli_worker_execucoes_select" ON public.meli_worker_execucoes;
CREATE POLICY "meli_worker_execucoes_select"
  ON public.meli_worker_execucoes
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_base_access(auth.uid(), base_id)
  );

CREATE INDEX IF NOT EXISTS idx_meli_worker_exec_base_data
  ON public.meli_worker_execucoes (base_id, iniciado_em DESC);

-- 5) RPC de registro. Contrato fechado.
CREATE OR REPLACE FUNCTION public.meli_worker_registrar_execucao(
  p_base_code text,
  p_worker_versao text,
  p_sync_batch_id uuid,
  p_iniciado_em timestamptz,
  p_finalizado_em timestamptz,
  p_rotas_encontradas integer,
  p_rotas_processadas integer,
  p_pacotes_enviados integer,
  p_erros integer,
  p_status text,
  p_sessao_status text,
  p_mensagem_segura text DEFAULT NULL,
  p_origem text DEFAULT 'worker'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_id uuid;
  v_id uuid;
  v_duracao_ms integer;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'nao_autenticado');
  END IF;

  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sem_permissao');
  END IF;

  IF upper(btrim(coalesce(p_base_code, ''))) <> 'ESP16' THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'base_fora_do_piloto');
  END IF;

  IF coalesce(p_origem, 'worker') <> 'worker' THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'origem_invalida');
  END IF;

  SELECT id INTO v_base_id
  FROM public.bases
  WHERE upper(codigo) = upper(btrim(coalesce(p_base_code, '')))
  LIMIT 1;

  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'base_nao_encontrada');
  END IF;

  IF coalesce(p_status, '') NOT IN (
    'sucesso', 'sucesso_parcial', 'erro', 'rate_limit',
    'circuito_pausado', 'sessao_expirada', 'aguardando_autenticacao',
    'jmroutes_sem_sessao'
  ) THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'status_invalido');
  END IF;

  IF coalesce(p_sessao_status, 'ok') NOT IN ('ok', 'expirada', 'ausente') THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sessao_status_invalido');
  END IF;

  IF NOT (
    public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'gerente')
    OR public.has_base_access(v_uid, v_base_id)
  ) THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'sem_acesso_a_base');
  END IF;

  IF coalesce(p_rotas_encontradas, 0) < 0
     OR coalesce(p_rotas_processadas, 0) < 0
     OR coalesce(p_pacotes_enviados, 0) < 0
     OR coalesce(p_erros, 0) < 0 THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'telemetria_invalida');
  END IF;

  v_duracao_ms := (
    EXTRACT(EPOCH FROM (coalesce(p_finalizado_em, now()) - coalesce(p_iniciado_em, now()))) * 1000
  )::int;

  IF v_duracao_ms IS NULL OR v_duracao_ms < 0 THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'telemetria_invalida');
  END IF;

  INSERT INTO public.meli_worker_execucoes (
    base_id, origem, worker_versao, sync_batch_id,
    iniciado_em, finalizado_em, duracao_ms,
    rotas_encontradas, rotas_processadas, pacotes_enviados, erros,
    status, sessao_status, mensagem_segura
  ) VALUES (
    v_base_id,
    'worker',
    left(coalesce(p_worker_versao, ''), 40),
    p_sync_batch_id,
    coalesce(p_iniciado_em, now()),
    p_finalizado_em,
    v_duracao_ms,
    coalesce(p_rotas_encontradas, 0),
    coalesce(p_rotas_processadas, 0),
    coalesce(p_pacotes_enviados, 0),
    coalesce(p_erros, 0),
    p_status,
    coalesce(p_sessao_status, 'ok'),
    left(coalesce(p_mensagem_segura, ''), 240)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('status', 'ok', 'execucao_id', v_id, 'base_id', v_base_id);
END;
$$;

REVOKE ALL ON FUNCTION public.meli_worker_registrar_execucao(
  text, text, uuid, timestamptz, timestamptz, integer, integer, integer, integer,
  text, text, text, text
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_worker_registrar_execucao(
  text, text, uuid, timestamptz, timestamptz, integer, integer, integer, integer,
  text, text, text, text
) TO authenticated;
-- ==== fim 20260807162805_546a4542-c18c-4870-8ce3-72f6dbd48270.sql ====

-- ==== inicio 20260807163729_4de5fd45-eff4-4c68-9ec6-61ce25dc80af.sql ====
REVOKE ALL ON TABLE public.meli_worker_execucoes FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.meli_worker_execucoes TO authenticated;
-- ==== fim 20260807163729_4de5fd45-eff4-4c68-9ec6-61ce25dc80af.sql ====

-- ==== inicio 20260813235419_e943fe5c-291c-486b-ab00-542b474ae9cb.sql ====
CREATE OR REPLACE FUNCTION public.meli_sync_status_bases()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  WITH b AS (
    SELECT id, codigo, nome FROM public.bases WHERE ativa = true
  ),
  ult AS (
    SELECT r.base_id,
           max(r.last_synced_at) AS ultimo_sucesso_em,
           max(r.data_rota)      AS data_rota
    FROM public.meli_rotas r
    WHERE r.base_id IS NOT NULL
    GROUP BY r.base_id
  ),
  cnt AS (
    SELECT r.base_id,
           count(*)::int AS rotas,
           coalesce(sum(r.total_pacotes),0)::int AS pacotes
    FROM public.meli_rotas r
    JOIN ult u ON u.base_id = r.base_id AND r.data_rota = u.data_rota
    GROUP BY r.base_id
  ),
  exec AS (
    SELECT DISTINCT ON (e.base_id)
           e.base_id, e.status, e.sessao_status, e.mensagem_segura,
           e.iniciado_em, e.finalizado_em, e.rotas_encontradas, e.pacotes_enviados, e.erros
    FROM public.meli_worker_execucoes e
    ORDER BY e.base_id, e.iniciado_em DESC
  )
  SELECT jsonb_agg(
           jsonb_build_object(
             'base_id',            b.id,
             'base_codigo',        b.codigo,
             'base_nome',          b.nome,
             'ultimo_sucesso_em',  u.ultimo_sucesso_em,
             'ultima_tentativa_em', greatest(coalesce(x.finalizado_em, x.iniciado_em), u.ultimo_sucesso_em),
             'status',             x.status,
             'sessao_status',      x.sessao_status,
             'mensagem_segura',    left(coalesce(x.mensagem_segura,''), 300),
             'rotas_encontradas',  coalesce(c.rotas, x.rotas_encontradas, 0),
             'pacotes_encontrados', coalesce(c.pacotes, x.pacotes_enviados, 0),
             'erros',              coalesce(x.erros, 0),
             'data_rota',          u.data_rota
           ) ORDER BY b.codigo
         )
    INTO v_out
  FROM b
  LEFT JOIN ult  u ON u.base_id = b.id
  LEFT JOIN cnt  c ON c.base_id = b.id
  LEFT JOIN exec x ON x.base_id = b.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'bases', coalesce(v_out, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO service_role;
-- ==== fim 20260813235419_e943fe5c-291c-486b-ab00-542b474ae9cb.sql ====

-- ==== inicio 20260814010500_122519a3-5403-4157-88bf-78d718d5f062.sql ====
-- ══════════════════════════════════════════════════════════════════════════
-- Módulo 1: visão de rotas em área de risco (somente leitura, dados reais)
-- Módulo 2: controle de devoluções Meli (retorno físico à base em 3 dias)
-- ══════════════════════════════════════════════════════════════════════════

-- ─────────────── PARTE 1: rotas em área de risco ───────────────
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(
  p_data date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_rota text DEFAULT NULL,
  p_motorista text DEFAULT NULL,
  p_transportadora text DEFAULT NULL,
  p_risco text DEFAULT NULL,
  p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH pac AS (
    SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
           b.nome AS base_nome, r.driver_name, r.vehicle_license, r.carrier,
           r.data_rota, r.last_synced_at,
           r.rota_area_risco, r.area_risco_parcial,
           coalesce(r.motivo_area_risco, '') AS motivo_area_risco,
           coalesce(r.codigo_area_risco, '') AS codigo_area_risco,
           coalesce(r.origem_area_risco, '') AS origem_area_risco,
           p.pacote_area_risco,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_rotas r
      JOIN public.meli_pacotes p ON p.rota_id = r.id
      LEFT JOIN public.bases b ON b.id = r.base_id
     WHERE (r.rota_area_risco OR r.area_risco_parcial OR p.pacote_area_risco)
       AND (r.base_id IS NOT NULL AND public.has_base_access(v_uid, r.base_id))
       AND (p_base_id IS NULL OR r.base_id = p_base_id)
       AND (r.data_rota = v_data)
       AND (p_rota IS NULL OR r.route_id ILIKE '%' || p_rota || '%' OR coalesce(r.cluster, '') ILIKE '%' || p_rota || '%')
       AND (p_motorista IS NULL OR coalesce(r.driver_name, '') ILIKE '%' || p_motorista || '%')
       AND (p_transportadora IS NULL OR coalesce(r.carrier, '') ILIKE '%' || p_transportadora || '%')
       AND (p_risco IS NULL OR p_risco = 'qualquer'
            OR (p_risco = 'integral' AND r.rota_area_risco)
            OR (p_risco = 'parcial' AND r.area_risco_parcial AND NOT r.rota_area_risco))
  ), pac_f AS (
    SELECT * FROM pac WHERE p_status IS NULL OR situacao = p_status
  ), rotas AS (
    SELECT rota_id, route_id, cluster, base_id, base_codigo, base_nome,
           driver_name, vehicle_license, carrier, data_rota,
           max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           max(motivo_area_risco) AS motivo_area_risco,
           max(codigo_area_risco) AS codigo_area_risco,
           max(origem_area_risco) AS origem_area_risco,
           count(*)::int AS total,
           count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco)::int AS pacotes_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'entregue')::int AS entregue_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao IN ('nao_iniciado','em_rota','desconhecido'))::int AS pendente_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'insucesso')::int AS insucesso_risco
      FROM pac_f
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome,
              driver_name, vehicle_license, carrier, data_rota
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_operacional', v_data,
    'server_time', now(),
    'cards', (
      SELECT jsonb_build_object(
        'rotas', coalesce(count(*), 0),
        'rotas_integrais', coalesce(count(*) FILTER (WHERE rota_area_risco), 0),
        'rotas_parciais', coalesce(count(*) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco), 0),
        'pacotes', coalesce(sum(pacotes_risco), 0),
        'entregue', coalesce(sum(entregue_risco), 0),
        'pendente', coalesce(sum(pendente_risco), 0),
        'insucesso', coalesce(sum(insucesso_risco), 0),
        'perc_conclusao', CASE WHEN coalesce(sum(pacotes_risco), 0) > 0
          THEN round(100.0 * sum(entregue_risco) / sum(pacotes_risco), 1) ELSE 0 END,
        'ultima_sincronizacao', max(last_synced_at)
      ) FROM rotas
    ),
    'rotas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rota_id', rota_id,
        'route_id', route_id,
        'cluster', cluster,
        'base_id', base_id,
        'base_codigo', base_codigo,
        'base_nome', base_nome,
        'driver_name', driver_name,
        'vehicle_license', vehicle_license,
        'carrier', carrier,
        'data_rota', data_rota,
        'last_synced_at', last_synced_at,
        'rota_area_risco', rota_area_risco,
        'area_risco_parcial', area_risco_parcial,
        'motivo_area_risco', nullif(motivo_area_risco, ''),
        'codigo_area_risco', nullif(codigo_area_risco, ''),
        'origem_area_risco', nullif(origem_area_risco, ''),
        'total', total,
        'pacotes_risco', pacotes_risco,
        'entregue_risco', entregue_risco,
        'pendente_risco', pendente_risco,
        'insucesso_risco', insucesso_risco,
        'perc_conclusao', CASE WHEN pacotes_risco > 0
          THEN round(100.0 * entregue_risco / pacotes_risco, 1) ELSE 0 END
      ) ORDER BY rota_area_risco DESC, pacotes_risco DESC)
      FROM rotas
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_rotas_area_risco(date, uuid, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(date, uuid, text, text, text, text, text) TO authenticated, service_role;

-- ─────────────── PARTE 2: devoluções Meli ───────────────
CREATE TABLE IF NOT EXISTS public.meli_devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_id text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  rota_id uuid REFERENCES public.meli_rotas(id) ON DELETE SET NULL,
  route_id text,
  cluster text,
  motorista text,
  transportadora text,
  occurrence_code text NOT NULL,
  meli_status text,
  meli_substatus text,
  situacao_meli text,
  ocorrido_em timestamptz NOT NULL,
  prazo_retorno_em timestamptz NOT NULL,
  last_synced_at timestamptz,
  estado text NOT NULL DEFAULT 'aguardando_retorno'
    CHECK (estado IN ('aguardando_retorno','recebido_na_base','em_investigacao',
                      'transferido','divergencia_delivered','revisao_necessaria','encerrado')),
  recebido_em timestamptz,
  recebido_por uuid REFERENCES auth.users(id),
  recebido_base_id uuid REFERENCES public.bases(id),
  metodo_confirmacao text,
  observacao_recebimento text,
  divergencia_delivered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_devolucoes_tracking_unico UNIQUE (tracking_id)
);

CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_tracking ON public.meli_devolucoes (tracking_id);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_base ON public.meli_devolucoes (base_id);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_occurrence ON public.meli_devolucoes (occurrence_code);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_estado ON public.meli_devolucoes (estado);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_prazo ON public.meli_devolucoes (prazo_retorno_em);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_ocorrido ON public.meli_devolucoes (ocorrido_em);

GRANT SELECT ON public.meli_devolucoes TO authenticated;
GRANT ALL ON public.meli_devolucoes TO service_role;
ALTER TABLE public.meli_devolucoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Devolucoes Meli visiveis por base permitida" ON public.meli_devolucoes;
CREATE POLICY "Devolucoes Meli visiveis por base permitida"
  ON public.meli_devolucoes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE TABLE IF NOT EXISTS public.meli_devolucoes_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  devolucao_id uuid REFERENCES public.meli_devolucoes(id) ON DELETE CASCADE,
  tracking_id text NOT NULL,
  base_id uuid REFERENCES public.bases(id),
  tipo text NOT NULL,
  estado_anterior text,
  estado_novo text,
  detalhes jsonb,
  registrado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meli_dev_eventos_dev ON public.meli_devolucoes_eventos (devolucao_id);
CREATE INDEX IF NOT EXISTS idx_meli_dev_eventos_tracking ON public.meli_devolucoes_eventos (tracking_id);

GRANT SELECT ON public.meli_devolucoes_eventos TO authenticated;
GRANT ALL ON public.meli_devolucoes_eventos TO service_role;
ALTER TABLE public.meli_devolucoes_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Historico devolucoes Meli por base permitida" ON public.meli_devolucoes_eventos;
CREATE POLICY "Historico devolucoes Meli por base permitida"
  ON public.meli_devolucoes_eventos FOR SELECT TO authenticated
  USING (base_id IS NOT NULL AND public.has_base_access(auth.uid(), base_id));

DROP TRIGGER IF EXISTS trg_meli_devolucoes_updated_at ON public.meli_devolucoes;
CREATE TRIGGER trg_meli_devolucoes_updated_at
  BEFORE UPDATE ON public.meli_devolucoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Sincroniza devoluções a partir das ocorrências de rua já importadas.
CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 7);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_eleg text[] := ARRAY['buyer_rejected','buyer_absent','business_closed','unvisited_address',
                         'damaged','bad_address','missrouted','blocked_by_keyword'];
  v_criadas int := 0;
  v_atualizadas int := 0;
  v_revisao int := 0;
  r record;
  v_estado text;
  v_atual public.meli_devolucoes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  FOR r IN
    SELECT p.tracking_id,
           lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) AS codigo,
           p.status, p.substatus, p.occurrence_code,
           coalesce(p.last_synced_at, p.updated_at) AS ocorrido_em,
           p.last_synced_at,
           ro.id AS rota_id, ro.route_id, ro.cluster, ro.base_id,
           ro.driver_name, ro.carrier,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_pacotes p
      JOIN public.meli_rotas ro ON ro.id = p.rota_id
     WHERE ro.base_id IS NOT NULL
       AND public.has_base_access(v_uid, ro.base_id)
       AND (p_base_id IS NULL OR ro.base_id = p_base_id)
       AND ro.data_rota BETWEEN v_de AND v_ate
       AND public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = 'insucesso'
  LOOP
    IF r.codigo = ANY (v_eleg) THEN
      v_estado := 'aguardando_retorno';
    ELSIF r.codigo IN ('missing','lost','stolen') THEN
      v_estado := 'em_investigacao';
    ELSIF r.codigo = 'transferred' THEN
      v_estado := 'transferido';
    ELSE
      v_estado := 'revisao_necessaria';
      v_revisao := v_revisao + 1;
    END IF;

    SELECT * INTO v_atual FROM public.meli_devolucoes WHERE tracking_id = r.tracking_id;

    IF v_atual.id IS NULL THEN
      INSERT INTO public.meli_devolucoes (
        tracking_id, base_id, rota_id, route_id, cluster, motorista, transportadora,
        occurrence_code, meli_status, meli_substatus, situacao_meli,
        ocorrido_em, prazo_retorno_em, last_synced_at, estado
      ) VALUES (
        r.tracking_id, r.base_id, r.rota_id, r.route_id, r.cluster, r.driver_name, r.carrier,
        coalesce(nullif(r.codigo, ''), 'desconhecido'), r.status, r.substatus, r.situacao,
        r.ocorrido_em, r.ocorrido_em + interval '3 days', r.last_synced_at, v_estado
      );
      v_criadas := v_criadas + 1;

      INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_novo, detalhes, registrado_por)
      SELECT d.id, d.tracking_id, d.base_id, 'criada', d.estado,
             jsonb_build_object('occurrence_code', d.occurrence_code, 'origem', 'sincronizacao'), v_uid
        FROM public.meli_devolucoes d WHERE d.tracking_id = r.tracking_id;
    ELSE
      -- Nunca sobrescreve estados finais/físicos; apenas atualiza dados do Meli.
      UPDATE public.meli_devolucoes d
         SET meli_status = r.status,
             meli_substatus = r.substatus,
             situacao_meli = r.situacao,
             last_synced_at = r.last_synced_at,
             rota_id = coalesce(r.rota_id, d.rota_id),
             route_id = coalesce(r.route_id, d.route_id),
             cluster = coalesce(r.cluster, d.cluster),
             motorista = coalesce(r.driver_name, d.motorista),
             transportadora = coalesce(r.carrier, d.transportadora),
             occurrence_code = CASE WHEN r.codigo <> '' THEN r.codigo ELSE d.occurrence_code END,
             ocorrido_em = CASE WHEN r.codigo <> '' AND r.codigo <> d.occurrence_code
                                THEN r.ocorrido_em ELSE d.ocorrido_em END,
             prazo_retorno_em = CASE WHEN r.codigo <> '' AND r.codigo <> d.occurrence_code
                                THEN r.ocorrido_em + interval '3 days' ELSE d.prazo_retorno_em END,
             estado = CASE
               WHEN d.estado IN ('recebido_na_base','divergencia_delivered','encerrado') THEN d.estado
               ELSE v_estado END
       WHERE d.id = v_atual.id
         AND (d.meli_status IS DISTINCT FROM r.status
              OR d.meli_substatus IS DISTINCT FROM r.substatus
              OR d.occurrence_code IS DISTINCT FROM nullif(r.codigo, '')
              OR d.last_synced_at IS DISTINCT FROM r.last_synced_at);

      IF FOUND THEN
        v_atualizadas := v_atualizadas + 1;
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
        VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'atualizacao_meli', v_atual.estado,
                (SELECT estado FROM public.meli_devolucoes WHERE id = v_atual.id),
                jsonb_build_object('occurrence_code', r.codigo, 'meli_status', r.status, 'meli_substatus', r.substatus), v_uid);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'criadas', v_criadas,
    'atualizadas', v_atualizadas, 'revisao_necessaria', v_revisao,
    'data_de', v_de, 'data_ate', v_ate, 'server_time', now());
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid) TO authenticated, service_role;

-- Painel de devoluções (cards + linhas), respeitando bases permitidas.
CREATE OR REPLACE FUNCTION public.meli_devolucoes_painel(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_estado text DEFAULT NULL,
  p_occurrence text DEFAULT NULL,
  p_busca text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 30);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH base AS (
    SELECT d.*, b.codigo AS base_codigo, b.nome AS base_nome,
           (d.prazo_retorno_em - now()) AS restante,
           greatest(0, floor(extract(epoch FROM (coalesce(d.recebido_em, now()) - d.ocorrido_em)) / 86400))::int AS dias_corridos,
           CASE
             WHEN d.estado = 'divergencia_delivered' THEN 'divergencia_delivered'
             WHEN d.estado = 'recebido_na_base' THEN 'recebido_na_base'
             WHEN d.estado IN ('em_investigacao','transferido','revisao_necessaria','encerrado') THEN d.estado
             WHEN d.prazo_retorno_em < now() THEN 'atrasado'
             WHEN d.prazo_retorno_em < now() + interval '1 day' THEN 'proximo_do_prazo'
             ELSE 'aguardando_retorno'
           END AS estado_visual
      FROM public.meli_devolucoes d
      LEFT JOIN public.bases b ON b.id = d.base_id
     WHERE public.has_base_access(v_uid, d.base_id)
       AND d.ocorrido_em >= (v_de::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND d.ocorrido_em < ((v_ate + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
       AND (p_base_id IS NULL OR d.base_id = p_base_id)
       AND (p_occurrence IS NULL OR d.occurrence_code = p_occurrence)
       AND (p_busca IS NULL OR d.tracking_id ILIKE '%' || p_busca || '%'
            OR coalesce(d.route_id, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.cluster, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.motorista, '') ILIKE '%' || p_busca || '%'
            OR coalesce(d.transportadora, '') ILIKE '%' || p_busca || '%')
  ), filtrado AS (
    SELECT * FROM base WHERE p_estado IS NULL OR estado_visual = p_estado
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_de', v_de,
    'data_ate', v_ate,
    'server_time', now(),
    'cards', (SELECT jsonb_build_object(
        'total', count(*),
        'aguardando_retorno', count(*) FILTER (WHERE estado_visual = 'aguardando_retorno'),
        'proximo_do_prazo', count(*) FILTER (WHERE estado_visual = 'proximo_do_prazo'),
        'atrasado', count(*) FILTER (WHERE estado_visual = 'atrasado'),
        'recebido_na_base', count(*) FILTER (WHERE estado_visual = 'recebido_na_base'),
        'em_investigacao', count(*) FILTER (WHERE estado_visual = 'em_investigacao'),
        'transferido', count(*) FILTER (WHERE estado_visual = 'transferido'),
        'divergencia_delivered', count(*) FILTER (WHERE estado_visual = 'divergencia_delivered'),
        'revisao_necessaria', count(*) FILTER (WHERE estado_visual = 'revisao_necessaria'),
        'perc_sla', CASE WHEN count(*) FILTER (WHERE recebido_em IS NOT NULL) > 0
          THEN round(100.0 * count(*) FILTER (WHERE recebido_em IS NOT NULL AND recebido_em <= prazo_retorno_em)
               / count(*) FILTER (WHERE recebido_em IS NOT NULL), 1) ELSE 0 END,
        'envelhecimento', jsonb_build_object(
          'd0_1', count(*) FILTER (WHERE dias_corridos <= 1),
          'd2', count(*) FILTER (WHERE dias_corridos = 2),
          'd3', count(*) FILTER (WHERE dias_corridos = 3),
          'd4_mais', count(*) FILTER (WHERE dias_corridos > 3)
        )
      ) FROM base),
    'linhas', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'tracking_id', tracking_id, 'base_id', base_id,
        'base_codigo', base_codigo, 'base_nome', base_nome,
        'route_id', route_id, 'cluster', cluster, 'motorista', motorista,
        'transportadora', transportadora, 'occurrence_code', occurrence_code,
        'meli_status', meli_status, 'meli_substatus', meli_substatus,
        'situacao_meli', situacao_meli, 'ocorrido_em', ocorrido_em,
        'prazo_retorno_em', prazo_retorno_em, 'last_synced_at', last_synced_at,
        'estado', estado, 'estado_visual', estado_visual, 'dias_corridos', dias_corridos,
        'recebido_em', recebido_em, 'recebido_base_id', recebido_base_id,
        'metodo_confirmacao', metodo_confirmacao,
        'observacao_recebimento', observacao_recebimento,
        'divergencia_delivered', divergencia_delivered
      ) ORDER BY prazo_retorno_em ASC) FROM filtrado), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucoes_painel(date, date, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_painel(date, date, uuid, text, text, text) TO authenticated, service_role;

-- Recebimento físico na base.
CREATE OR REPLACE FUNCTION public.meli_devolucao_receber(
  p_tracking text,
  p_base_id uuid,
  p_metodo text DEFAULT 'scanner',
  p_observacao text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tracking text := upper(btrim(coalesce(p_tracking, '')));
  v_d public.meli_devolucoes;
  v_delivered boolean;
  v_estado_novo text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_autenticado', 'mensagem', 'Não autenticado.');
  END IF;
  IF v_tracking = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'invalido', 'mensagem', 'Informe o código de rastreio.');
  END IF;
  IF p_base_id IS NULL OR NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base', 'mensagem', 'Sem acesso à base informada.');
  END IF;

  SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = v_tracking;

  IF v_d.id IS NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_tracking, p_base_id, 'recebimento_sem_devolucao',
            jsonb_build_object('metodo', p_metodo), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrada',
      'mensagem', 'Nenhuma devolução Meli pendente para este rastreio.');
  END IF;

  IF NOT public.has_base_access(v_uid, v_d.base_id) THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'sem_acesso_base',
      'mensagem', 'Sem acesso à base de origem deste pacote.');
  END IF;

  IF v_d.recebido_em IS NOT NULL THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_duplicado', v_d.estado, v_d.estado,
            jsonb_build_object('metodo', p_metodo, 'recebido_em_original', v_d.recebido_em), v_uid);
    RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado',
      'mensagem', 'Este pacote já foi recebido na base.',
      'devolucao', to_jsonb(v_d));
  END IF;

  IF v_d.base_id <> p_base_id THEN
    INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, detalhes, registrado_por)
    VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_base_divergente', v_d.estado,
            jsonb_build_object('base_informada', p_base_id, 'base_esperada', v_d.base_id), v_uid);
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente',
      'mensagem', 'Base receptora diferente da base de origem esperada.',
      'base_esperada', (SELECT codigo FROM public.bases WHERE id = v_d.base_id));
  END IF;

  v_delivered := coalesce(v_d.situacao_meli, '') = 'entregue';

  IF v_delivered AND coalesce(btrim(coalesce(p_observacao, '')), '') = '' THEN
    RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria',
      'mensagem', 'Pacote consta como entregue no Meli. Observação do operador é obrigatória.');
  END IF;

  v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

  UPDATE public.meli_devolucoes
     SET estado = v_estado_novo,
         recebido_em = now(),
         recebido_por = v_uid,
         recebido_base_id = p_base_id,
         metodo_confirmacao = coalesce(nullif(btrim(p_metodo), ''), 'scanner'),
         observacao_recebimento = nullif(btrim(coalesce(p_observacao, '')), ''),
         divergencia_delivered = v_delivered
   WHERE id = v_d.id;

  INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
  VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_fisico', v_d.estado, v_estado_novo,
          jsonb_build_object('metodo', p_metodo, 'observacao', nullif(btrim(coalesce(p_observacao, '')), ''),
                             'situacao_meli', v_d.situacao_meli), v_uid);

  RETURN jsonb_build_object('status', 'ok', 'codigo', v_estado_novo,
    'divergencia_delivered', v_delivered,
    'no_prazo', now() <= v_d.prazo_retorno_em,
    'mensagem', CASE WHEN v_delivered
      THEN 'ALERTA CRÍTICO: pacote recebido fisicamente, porém consta ENTREGUE no Meli. Encaminhe para prevenção de perdas.'
      ELSE 'Retorno registrado na base.' END,
    'devolucao', (SELECT to_jsonb(d) FROM public.meli_devolucoes d WHERE d.id = v_d.id));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text) TO authenticated, service_role;
-- ==== fim 20260814010500_122519a3-5403-4157-88bf-78d718d5f062.sql ====

-- ==== inicio 20260814012911_e70292da-8d59-42ca-b554-86454ca4d9da.sql ====
-- 1) Tabelas Meli: remover qualquer privilégio de anon e de PUBLIC
REVOKE ALL ON TABLE public.meli_devolucoes FROM anon;
REVOKE ALL ON TABLE public.meli_devolucoes FROM PUBLIC;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM anon;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM PUBLIC;

-- authenticated: somente leitura (escrita apenas via RPCs SECURITY DEFINER)
REVOKE ALL ON TABLE public.meli_devolucoes FROM authenticated;
REVOKE ALL ON TABLE public.meli_devolucoes_eventos FROM authenticated;
GRANT SELECT ON TABLE public.meli_devolucoes TO authenticated;
GRANT SELECT ON TABLE public.meli_devolucoes_eventos TO authenticated;

-- service_role mantém acesso completo
GRANT ALL ON TABLE public.meli_devolucoes TO service_role;
GRANT ALL ON TABLE public.meli_devolucoes_eventos TO service_role;

-- 2) Funções Meli: revogar EXECUTE de anon e PUBLIC, manter authenticated/service_role
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(p_data date, p_base_id uuid, p_rota text, p_motorista text, p_transportadora text, p_risco text, p_status text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(p_data_de date, p_data_ate date, p_base_id uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_painel(p_data_de date, p_data_ate date, p_base_id uuid, p_estado text, p_occurrence text, p_busca text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) FROM anon;
REVOKE ALL ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(p_tracking text, p_base_id uuid, p_metodo text, p_observacao text) TO authenticated, service_role;

-- 3) DEFAULT PRIVILEGES da role proprietária das migrations (postgres):
--    novos objetos em public não devem conceder privilégios automáticos a anon.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
-- ==== fim 20260814012911_e70292da-8d59-42ca-b554-86454ca4d9da.sql ====

-- ==== inicio 20260814013934_296838e0-23f3-42df-a1c8-4f369625a98a.sql ====
-- ─────────────────────────────────────────────────────────────────────────────
-- Regra central: rotas PM da ESP16 ficam fora dos indicadores SOMENTE enquanto
-- estiverem "não iniciadas". PM em andamento ou finalizada entra na conta do dia.
-- Nenhuma alteração de dados, RLS ou ingestão.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Marcador PM no nome operacional da rota (cluster ou route_id)
CREATE OR REPLACE FUNCTION public.meli_rota_pm(p_nome text, p_route_id text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT upper(coalesce(p_nome, '') || ' ' || coalesce(p_route_id, ''))
         ~ '(^|[^A-Z0-9])PM[0-9]*([^A-Z0-9]|$)';
$$;

-- 2) Estado operacional real da rota (precedência: evidência dos pacotes > substatus > status)
CREATE OR REPLACE FUNCTION public.meli_rota_estado_operacional(p_rota_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_st text; v_sub text;
  v_total int := 0; v_term int := 0; v_andamento int := 0;
BEGIN
  SELECT lower(coalesce(r.route_status, '')), lower(coalesce(r.route_substatus, ''))
    INTO v_st, v_sub
    FROM public.meli_rotas r WHERE r.id = p_rota_id;
  IF NOT FOUND THEN RETURN 'nao_iniciada'; END IF;

  SELECT count(*)::int,
         count(*) FILTER (WHERE s IN ('entregue','insucesso','cancelado'))::int,
         count(*) FILTER (WHERE s IN ('entregue','insucesso','em_rota'))::int
    INTO v_total, v_term, v_andamento
    FROM (
      SELECT public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS s
        FROM public.meli_pacotes p WHERE p.rota_id = p_rota_id
    ) x;

  -- finalizada: todos os pacotes em estado terminal ou status Meli de conclusão
  IF v_total > 0 AND v_term = v_total THEN RETURN 'finalizada'; END IF;
  IF v_st IN ('finished','finalized','closed','completed','done')
     AND v_sub NOT IN ('on_way_destination_facility','planned','pending') THEN
    RETURN 'finalizada';
  END IF;

  -- em andamento: evidência operacional nos pacotes
  IF v_andamento > 0 THEN RETURN 'em_andamento'; END IF;

  -- em andamento: substatus/status da rota indicando início real
  IF v_sub IN ('started','in_route','on_route','out_for_delivery','picked_up','delivering','in_progress') THEN
    RETURN 'em_andamento';
  END IF;
  IF v_st IN ('active','in_route','on_route','started','in_progress','close')
     AND v_sub NOT IN ('on_way_destination_facility','planned','pending','created','not_started') THEN
    RETURN 'em_andamento';
  END IF;

  RETURN 'nao_iniciada';
END;
$$;

-- 3) Regra única de exclusão dos indicadores
CREATE OR REPLACE FUNCTION public.meli_rota_pm_excluida(p_rota_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT b.codigo = 'ESP16'
            AND public.meli_rota_pm(r.cluster, r.route_id)
            AND public.meli_rota_estado_operacional(r.id) = 'nao_iniciada'
       FROM public.meli_rotas r
       LEFT JOIN public.bases b ON b.id = r.base_id
      WHERE r.id = p_rota_id),
  false);
$$;

REVOKE ALL ON FUNCTION public.meli_rota_pm(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_pm(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_pm(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_rota_estado_operacional(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_estado_operacional(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_estado_operacional(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.meli_rota_pm_excluida(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_rota_pm_excluida(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_pm_excluida(uuid) TO authenticated, service_role;

-- 4) Dashboard operacional: exclui PM não iniciadas e devolve a lista separada
CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(p_data date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid, p_motorista text DEFAULT NULL::text, p_rota text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_transportadora text DEFAULT NULL::text, p_risco text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH perm AS (SELECT public.meli_pode_operar() AS ok),
dia AS (SELECT coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS v),
rotas_dia AS (
  SELECT r.id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo, b.nome AS base_nome,
         b.meli_service_center_id AS service_center, r.driver_name, r.vehicle_license, r.carrier,
         r.data_rota, r.last_synced_at, r.rota_area_risco, r.area_risco_parcial,
         r.motivo_area_risco, public.meli_rota_pm_excluida(r.id) AS pm_excluida
    FROM public.meli_rotas r
    CROSS JOIN dia
    LEFT JOIN public.bases b ON b.id = r.base_id
   WHERE (SELECT ok FROM perm)
     AND r.data_rota = dia.v
     AND (p_base_id IS NULL OR r.base_id = p_base_id)
     AND (p_motorista IS NULL OR r.driver_name ILIKE '%'||p_motorista||'%')
     AND (p_rota IS NULL OR r.route_id ILIKE '%'||p_rota||'%' OR coalesce(r.cluster,'') ILIKE '%'||p_rota||'%')
     AND (p_transportadora IS NULL OR r.carrier ILIKE '%'||p_transportadora||'%')
     AND (p_risco IS NULL
          OR (p_risco = 'qualquer' AND (r.rota_area_risco OR r.area_risco_parcial))
          OR (p_risco = 'integral' AND r.rota_area_risco)
          OR (p_risco = 'parcial'  AND r.area_risco_parcial))
),
pac AS (
  SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, r.base_codigo, r.base_nome,
         r.service_center, r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco,
         coalesce(p.motivo_area_risco, r.motivo_area_risco) AS motivo_area_risco,
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
         p.occurrence_code, p.substatus, p.status
    FROM rotas_dia r
    JOIN public.meli_pacotes p ON p.rota_id = r.id
   WHERE NOT r.pm_excluida
     AND (p_status IS NULL
          OR public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) = p_status)
),
pm AS (
  SELECT r.id AS rota_id, r.route_id,
         coalesce(nullif(btrim(r.cluster),''), r.route_id) AS nome_operacional,
         r.cluster, r.base_id, r.base_codigo, r.base_nome, r.driver_name, r.vehicle_license,
         r.data_rota, r.last_synced_at,
         (SELECT count(*)::int FROM public.meli_pacotes p WHERE p.rota_id = r.id) AS total
    FROM rotas_dia r
   WHERE r.pm_excluida
),
pm_json AS (
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.nome_operacional), '[]'::jsonb) AS j,
         count(*)::int AS rotas, coalesce(sum(total), 0)::int AS pacotes
    FROM pm x
),
cards AS (
  SELECT jsonb_build_object(
    'total',        count(*),
    'nao_iniciado', count(*) FILTER (WHERE situacao = 'nao_iniciado'),
    'em_rota',      count(*) FILTER (WHERE situacao = 'em_rota'),
    'entregue',     count(*) FILTER (WHERE situacao = 'entregue'),
    'insucesso',    count(*) FILTER (WHERE situacao = 'insucesso'),
    'cancelado',    count(*) FILTER (WHERE situacao = 'cancelado'),
    'desconhecido', count(*) FILTER (WHERE situacao = 'desconhecido'),
    'area_risco_pacotes', count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'elegiveis',    count(*) FILTER (WHERE situacao <> 'cancelado'),
    'perc_entrega', CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                         THEN round(100.0 * count(*) FILTER (WHERE situacao = 'entregue')
                              / count(*) FILTER (WHERE situacao <> 'cancelado'), 1)
                         ELSE 0 END,
    'rotas',        count(DISTINCT route_id),
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial),
    'pm_nao_iniciadas', (SELECT rotas FROM pm_json),
    'pm_pacotes_fora',  (SELECT pacotes FROM pm_json)
  ) AS j FROM pac
),
motivos AS (
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'total')::int DESC), '[]'::jsonb) AS j
  FROM (
    SELECT jsonb_build_object(
             'codigo', s.k,
             'descricao', coalesce(c.descricao, s.k),
             'cadastrado', c.codigo IS NOT NULL,
             'total', s.t
           ) AS x
    FROM (
      SELECT coalesce(nullif(occurrence_code,''), nullif(substatus,''), nullif(status,''), 'sem_codigo') AS k,
             count(*)::int AS t
        FROM pac WHERE situacao = 'insucesso' GROUP BY 1
    ) s
    LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = s.k
  ) y
),
rotas AS (
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.insucesso DESC, r.perc_entrega ASC, r.em_rota DESC, r.pacotes_risco DESC), '[]'::jsonb) AS j
  FROM (
    SELECT rota_id, route_id,
           coalesce(nullif(btrim(cluster),''), route_id) AS nome_operacional,
           cluster, base_id, base_codigo, base_nome, service_center,
           driver_name, vehicle_license, carrier, data_rota, max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           count(*)::int AS total,
           count(*) FILTER (WHERE situacao='nao_iniciado')::int AS nao_iniciado,
           count(*) FILTER (WHERE situacao='em_rota')::int      AS em_rota,
           count(*) FILTER (WHERE situacao='entregue')::int     AS entregue,
           count(*) FILTER (WHERE situacao='insucesso')::int    AS insucesso,
           count(*) FILTER (WHERE situacao='cancelado')::int    AS cancelado,
           count(*) FILTER (WHERE pacote_area_risco)::int       AS pacotes_risco,
           CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                     / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
      FROM pac
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome, service_center,
              driver_name, vehicle_license, carrier, data_rota
  ) r
),
pm_por_base AS (
  SELECT base_id, base_codigo, count(*)::int AS rotas, coalesce(sum(total),0)::int AS pacotes
    FROM pm GROUP BY 1,2
),
bases_agg AS (
  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb) AS j
  FROM (
    SELECT s.base_id, s.base_codigo, s.base_nome, s.service_center, s.rotas, s.rotas_risco,
           s.rotas_risco_integral, s.rotas_risco_parcial, s.total, s.pacotes_risco,
           s.entregue, s.em_rota, s.insucesso, s.perc_entrega,
           coalesce(pb.rotas, 0) AS pm_nao_iniciadas,
           coalesce(pb.pacotes, 0) AS pm_pacotes_fora
      FROM (
        SELECT base_id, base_codigo, base_nome, service_center,
               count(DISTINCT route_id)::int AS rotas,
               count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)::int AS rotas_risco,
               count(DISTINCT route_id) FILTER (WHERE rota_area_risco)::int AS rotas_risco_integral,
               count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco)::int AS rotas_risco_parcial,
               count(*)::int AS total,
               count(*) FILTER (WHERE pacote_area_risco)::int AS pacotes_risco,
               count(*) FILTER (WHERE situacao='entregue')::int AS entregue,
               count(*) FILTER (WHERE situacao='em_rota')::int AS em_rota,
               count(*) FILTER (WHERE situacao='insucesso')::int AS insucesso,
               CASE WHEN count(*) FILTER (WHERE situacao <> 'cancelado') > 0
                    THEN round(100.0 * count(*) FILTER (WHERE situacao='entregue')
                         / count(*) FILTER (WHERE situacao <> 'cancelado'), 1) ELSE 0 END AS perc_entrega
          FROM pac
         GROUP BY base_id, base_codigo, base_nome, service_center
      ) s
      LEFT JOIN pm_por_base pb
        ON coalesce(pb.base_id::text, pb.base_codigo, '') = coalesce(s.base_id::text, s.base_codigo, '')
  ) b
),
risco AS (
  SELECT jsonb_build_object(
    'rotas',      count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial),
    'integrais',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco),
    'parciais',   count(DISTINCT route_id) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco),
    'pacotes',    count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco),
    'entregue',   count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue'),
    'em_rota',    count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='em_rota'),
    'insucesso',  count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='insucesso'),
    'perc_conclusao', CASE WHEN count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco) > 0
      THEN round(100.0 * count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao='entregue')
           / count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco), 1) ELSE 0 END
  ) AS j FROM pac
),
sync AS (
  SELECT max(r.last_synced_at) AS v
    FROM public.meli_rotas r CROSS JOIN dia
   WHERE (SELECT ok FROM perm) AND r.data_rota = dia.v
),
sync_bases AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', base_id, 'base_codigo', base_codigo,
           'last_synced_at', ls) ORDER BY ls NULLS FIRST), '[]'::jsonb) AS j
  FROM (SELECT base_id, base_codigo, max(last_synced_at) AS ls FROM pac GROUP BY 1,2) s
)
SELECT CASE WHEN NOT (SELECT ok FROM perm)
  THEN jsonb_build_object('status','erro','erro','sem_permissao')
  ELSE jsonb_build_object(
    'status','ok',
    'data_operacional', (SELECT v FROM dia),
    'server_time', now(),
    'cards', (SELECT j FROM cards),
    'motivos_insucesso', (SELECT j FROM motivos),
    'rotas', (SELECT j FROM rotas),
    'bases', (SELECT j FROM bases_agg),
    'area_risco', (SELECT j FROM risco),
    'pm_programadas', (SELECT j FROM pm_json),
    'ultima_sincronizacao', (SELECT v FROM sync),
    'sincronizacao_por_base', (SELECT j FROM sync_bases)
  ) END;
$function$;

-- 5) Área de risco: aplica a mesma regra central
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(p_data date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid, p_rota text DEFAULT NULL::text, p_motorista text DEFAULT NULL::text, p_transportadora text DEFAULT NULL::text, p_risco text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH pac AS (
    SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
           b.nome AS base_nome, r.driver_name, r.vehicle_license, r.carrier,
           r.data_rota, r.last_synced_at,
           r.rota_area_risco, r.area_risco_parcial,
           coalesce(r.motivo_area_risco, '') AS motivo_area_risco,
           coalesce(r.codigo_area_risco, '') AS codigo_area_risco,
           coalesce(r.origem_area_risco, '') AS origem_area_risco,
           p.pacote_area_risco,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_rotas r
      JOIN public.meli_pacotes p ON p.rota_id = r.id
      LEFT JOIN public.bases b ON b.id = r.base_id
     WHERE (r.rota_area_risco OR r.area_risco_parcial OR p.pacote_area_risco)
       AND (r.base_id IS NOT NULL AND public.has_base_access(v_uid, r.base_id))
       AND (p_base_id IS NULL OR r.base_id = p_base_id)
       AND (r.data_rota = v_data)
       AND NOT public.meli_rota_pm_excluida(r.id)
       AND (p_rota IS NULL OR r.route_id ILIKE '%' || p_rota || '%' OR coalesce(r.cluster, '') ILIKE '%' || p_rota || '%')
       AND (p_motorista IS NULL OR coalesce(r.driver_name, '') ILIKE '%' || p_motorista || '%')
       AND (p_transportadora IS NULL OR coalesce(r.carrier, '') ILIKE '%' || p_transportadora || '%')
       AND (p_risco IS NULL OR p_risco = 'qualquer'
            OR (p_risco = 'integral' AND r.rota_area_risco)
            OR (p_risco = 'parcial' AND r.area_risco_parcial AND NOT r.rota_area_risco))
  ), pac_f AS (
    SELECT * FROM pac WHERE p_status IS NULL OR situacao = p_status
  ), rotas AS (
    SELECT rota_id, route_id, cluster, base_id, base_codigo, base_nome,
           driver_name, vehicle_license, carrier, data_rota,
           max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           max(motivo_area_risco) AS motivo_area_risco,
           max(codigo_area_risco) AS codigo_area_risco,
           max(origem_area_risco) AS origem_area_risco,
           count(*)::int AS total,
           count(*) FILTER (WHERE pacote_area_risco OR rota_area_risco)::int AS pacotes_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'entregue')::int AS entregue_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao IN ('nao_iniciado','em_rota','desconhecido'))::int AS pendente_risco,
           count(*) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'insucesso')::int AS insucesso_risco
      FROM pac_f
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome,
              driver_name, vehicle_license, carrier, data_rota
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_operacional', v_data,
    'server_time', now(),
    'cards', (
      SELECT jsonb_build_object(
        'rotas', coalesce(count(*), 0),
        'rotas_integrais', coalesce(count(*) FILTER (WHERE rota_area_risco), 0),
        'rotas_parciais', coalesce(count(*) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco), 0),
        'pacotes', coalesce(sum(pacotes_risco), 0),
        'entregue', coalesce(sum(entregue_risco), 0),
        'pendente', coalesce(sum(pendente_risco), 0),
        'insucesso', coalesce(sum(insucesso_risco), 0),
        'perc_conclusao', CASE WHEN coalesce(sum(pacotes_risco), 0) > 0
          THEN round(100.0 * sum(entregue_risco) / sum(pacotes_risco), 1) ELSE 0 END,
        'ultima_sincronizacao', max(last_synced_at)
      ) FROM rotas
    ),
    'rotas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rota_id', rota_id,
        'route_id', route_id,
        'cluster', cluster,
        'base_id', base_id,
        'base_codigo', base_codigo,
        'base_nome', base_nome,
        'driver_name', driver_name,
        'vehicle_license', vehicle_license,
        'carrier', carrier,
        'data_rota', data_rota,
        'last_synced_at', last_synced_at,
        'rota_area_risco', rota_area_risco,
        'area_risco_parcial', area_risco_parcial,
        'motivo_area_risco', nullif(motivo_area_risco, ''),
        'codigo_area_risco', nullif(codigo_area_risco, ''),
        'origem_area_risco', nullif(origem_area_risco, ''),
        'total', total,
        'pacotes_risco', pacotes_risco,
        'entregue_risco', entregue_risco,
        'pendente_risco', pendente_risco,
        'insucesso_risco', insucesso_risco,
        'perc_conclusao', CASE WHEN pacotes_risco > 0
          THEN round(100.0 * entregue_risco / pacotes_risco, 1) ELSE 0 END
      ) ORDER BY pacotes_risco DESC, route_id)
      FROM rotas
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;
-- ==== fim 20260814013934_296838e0-23f3-42df-a1c8-4f369625a98a.sql ====

-- ==== inicio 20260814134052_a046d399-9b84-440a-aa69-562bb0c3e6ac.sql ====
-- ─────────────────────────────────────────────────────────────────────────────
-- Lotes de devolução automáticos + motivo real do Meli
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.devolucao_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nome_exibicao text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  sequencia integer NOT NULL,
  estado text NOT NULL DEFAULT 'aberta',
  criado_por uuid NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_por uuid,
  finalizado_em timestamptz,
  reaberto_por uuid,
  reaberto_em timestamptz,
  reabertura_justificativa text,
  total_pacotes integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devolucao_lotes_estado_chk CHECK (estado IN ('aberta','finalizada')),
  CONSTRAINT devolucao_lotes_seq_uk UNIQUE (base_id, data_operacional, sequencia),
  CONSTRAINT devolucao_lotes_codigo_uk UNIQUE (codigo)
);

GRANT SELECT ON public.devolucao_lotes TO authenticated;
GRANT ALL ON public.devolucao_lotes TO service_role;
REVOKE ALL ON public.devolucao_lotes FROM anon;
REVOKE ALL ON public.devolucao_lotes FROM PUBLIC;

ALTER TABLE public.devolucao_lotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "lotes visiveis por base permitida" ON public.devolucao_lotes;
CREATE POLICY "lotes visiveis por base permitida"
  ON public.devolucao_lotes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

DROP TRIGGER IF EXISTS trg_devolucao_lotes_updated_at ON public.devolucao_lotes;
CREATE TRIGGER trg_devolucao_lotes_updated_at
  BEFORE UPDATE ON public.devolucao_lotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Devoluções: vínculo com lote + ocorrência real do Meli + correção manual
ALTER TABLE public.devolucoes
  ADD COLUMN IF NOT EXISTS lote_id uuid REFERENCES public.devolucao_lotes(id),
  ADD COLUMN IF NOT EXISTS occurrence_code text,
  ADD COLUMN IF NOT EXISTS meli_status text,
  ADD COLUMN IF NOT EXISTS meli_substatus text,
  ADD COLUMN IF NOT EXISTS motivo_descricao text,
  ADD COLUMN IF NOT EXISTS tratamento text,
  ADD COLUMN IF NOT EXISTS divergencia_delivered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_original motivo_devolucao,
  ADD COLUMN IF NOT EXISTS motivo_corrigido motivo_devolucao,
  ADD COLUMN IF NOT EXISTS correcao_justificativa text,
  ADD COLUMN IF NOT EXISTS corrigido_por uuid,
  ADD COLUMN IF NOT EXISTS corrigido_em timestamptz;

CREATE INDEX IF NOT EXISTS devolucoes_lote_id_idx ON public.devolucoes(lote_id);

-- Mapa ocorrência Meli -> motivo/tratamento/descrição
CREATE OR REPLACE FUNCTION public.devolucao_motivo_do_meli(p_codigo text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(coalesce(trim(p_codigo), ''))
    WHEN 'buyer_absent' THEN jsonb_build_object('motivo','cliente_ausente','descricao','Cliente ausente','tratamento','retorno_obrigatorio')
    WHEN 'buyer_rejected' THEN jsonb_build_object('motivo','recusado','descricao','Recusado pelo cliente','tratamento','retorno_obrigatorio')
    WHEN 'business_closed' THEN jsonb_build_object('motivo','comercio_fechado','descricao','Comércio fechado','tratamento','retorno_obrigatorio')
    WHEN 'unvisited_address' THEN jsonb_build_object('motivo','endereco_nao_localizado','descricao','Endereço não visitado','tratamento','retorno_obrigatorio')
    WHEN 'damaged' THEN jsonb_build_object('motivo','avaria','descricao','Pacote avariado','tratamento','retorno_obrigatorio')
    WHEN 'bad_address' THEN jsonb_build_object('motivo','endereco_nao_localizado','descricao','Endereço incorreto/incompleto','tratamento','retorno_obrigatorio')
    WHEN 'missrouted' THEN jsonb_build_object('motivo','outros','descricao','Fora da região','tratamento','retorno_obrigatorio')
    WHEN 'blocked_by_keyword' THEN jsonb_build_object('motivo','zona_de_risco','descricao','Bloqueio operacional','tratamento','retorno_obrigatorio')
    WHEN 'missing' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação','tratamento','investigacao')
    WHEN 'lost' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação','tratamento','investigacao')
    WHEN 'stolen' THEN jsonb_build_object('motivo','outros','descricao','Extravio em investigação (roubo)','tratamento','investigacao')
    WHEN 'transferred' THEN jsonb_build_object('motivo','outros','descricao','Transferido','tratamento','transferencia')
    ELSE jsonb_build_object('motivo','outros','descricao','Revisão necessária — ocorrência não reconhecida','tratamento','revisao_necessaria')
  END
$$;

REVOKE ALL ON FUNCTION public.devolucao_motivo_do_meli(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.devolucao_motivo_do_meli(text) TO authenticated, service_role;

-- Criar lote com sequência atômica por base + data
CREATE OR REPLACE FUNCTION public.devolucao_lote_criar(p_base_id uuid, p_data_operacional date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_base_codigo text;
  v_seq integer;
  v_nome text;
  v_codigo text;
  v_aberto public.devolucao_lotes;
  v_novo public.devolucao_lotes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  IF NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso a esta base.');
  END IF;

  SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
  IF v_base_codigo IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Base não encontrada.');
  END IF;

  SELECT * INTO v_aberto FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional AND estado = 'aberta'
   ORDER BY sequencia DESC LIMIT 1;
  IF v_aberto.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','ja_aberto','lote', to_jsonb(v_aberto));
  END IF;

  -- Bloqueio contra concorrência: serializa a geração por base + data
  PERFORM pg_advisory_xact_lock(hashtext(p_base_id::text || '|' || p_data_operacional::text));

  SELECT coalesce(max(sequencia), 0) + 1 INTO v_seq
    FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional;

  v_nome := 'EXP - REC ' || to_char(p_data_operacional, 'DD/MM/YYYY') || ' ' || v_base_codigo
            || ' - ' || lpad(v_seq::text, 3, '0');
  v_codigo := 'EXPREC' || to_char(p_data_operacional, 'YYYYMMDD') || v_base_codigo
            || lpad(v_seq::text, 3, '0');

  INSERT INTO public.devolucao_lotes (codigo, nome_exibicao, base_id, data_operacional, sequencia, estado, criado_por)
  VALUES (v_codigo, v_nome, p_base_id, p_data_operacional, v_seq, 'aberta', v_uid)
  RETURNING * INTO v_novo;

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_novo));
END;
$$;

-- Lote aberto atual
CREATE OR REPLACE FUNCTION public.devolucao_lote_aberto(p_base_id uuid, p_data_operacional date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_criador text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_base_access(v_uid, p_base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso a esta base.');
  END IF;

  SELECT * INTO v_lote FROM public.devolucao_lotes
   WHERE base_id = p_base_id AND data_operacional = p_data_operacional AND estado = 'aberta'
   ORDER BY sequencia DESC LIMIT 1;

  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','sem_lote');
  END IF;

  SELECT nome INTO v_criador FROM public.profiles WHERE id = v_lote.criado_por;
  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote) || jsonb_build_object('criado_por_nome', v_criador));
END;
$$;

-- Bipagem no lote com motivo automático do Meli
CREATE OR REPLACE FUNCTION public.devolucao_lote_bipar(p_lote_id uuid, p_codigo text, p_observacao text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_cod text := upper(trim(coalesce(p_codigo, '')));
  v_pac record;
  v_map jsonb;
  v_motivo motivo_devolucao;
  v_tratamento text;
  v_descricao text;
  v_diverg boolean := false;
  v_existente record;
  v_base_certa text;
  v_ins public.devolucoes;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  IF v_cod = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Informe o tracking do pacote.');
  END IF;

  SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado.');
  END IF;
  IF NOT public.has_base_access(v_uid, v_lote.base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Sem acesso à base do lote.');
  END IF;
  IF v_lote.estado <> 'aberta' THEN
    RETURN jsonb_build_object('status','lote_finalizado','mensagem','Este lote já foi finalizado. Crie uma nova devolução.');
  END IF;

  -- Duplicidade na base (independente do lote)
  SELECT d.id, d.devolvido_em, d.lote_id INTO v_existente
    FROM public.devolucoes d
   WHERE upper(d.shipment_codigo) = v_cod AND d.base_id = v_lote.base_id AND d.cancelado = false
   ORDER BY d.devolvido_em DESC LIMIT 1;
  IF v_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicado','mensagem','Pacote ' || v_cod || ' já recebido nesta base.',
                              'devolvido_em', v_existente.devolvido_em);
  END IF;

  -- Pacote importado do Meli (última atualização vence)
  SELECT p.occurrence_code, p.status, p.substatus, r.base_id AS rota_base_id,
         r.route_id, r.driver_name
    INTO v_pac
    FROM public.meli_pacotes p
    JOIN public.meli_rotas r ON r.id = p.rota_id
   WHERE upper(p.tracking_id) = v_cod OR upper(coalesce(p.shipment_id,'')) = v_cod
   ORDER BY p.updated_at DESC NULLS LAST
   LIMIT 1;

  IF v_pac IS NOT NULL AND v_pac.rota_base_id IS NOT NULL AND v_pac.rota_base_id <> v_lote.base_id THEN
    SELECT codigo INTO v_base_certa FROM public.bases WHERE id = v_pac.rota_base_id;
    RETURN jsonb_build_object('status','base_divergente',
      'mensagem','Pacote pertence à base ' || coalesce(v_base_certa,'?') || '. Receba na base correta.',
      'base_correta', v_base_certa);
  END IF;

  v_map := public.devolucao_motivo_do_meli(v_pac.occurrence_code);
  v_motivo := (v_map->>'motivo')::motivo_devolucao;
  v_descricao := v_map->>'descricao';
  v_tratamento := v_map->>'tratamento';

  IF v_pac IS NULL THEN
    v_tratamento := 'revisao_necessaria';
    v_descricao := 'Pacote sem ocorrência Meli elegível — revisão necessária';
  ELSIF coalesce(v_pac.occurrence_code,'') = '' THEN
    v_tratamento := 'revisao_necessaria';
    v_descricao := 'Pacote sem ocorrência Meli elegível — revisão necessária';
  END IF;

  IF lower(coalesce(v_pac.status,'')) = 'delivered' THEN
    v_diverg := true;
    IF coalesce(trim(p_observacao), '') = '' THEN
      RETURN jsonb_build_object('status','observacao_obrigatoria',
        'mensagem','ALERTA CRÍTICO: o Meli marca este pacote como ENTREGUE. Informe uma observação para registrar a divergência.',
        'motivo', v_motivo, 'motivo_descricao', v_descricao, 'occurrence_code', v_pac.occurrence_code);
    END IF;
  END IF;

  INSERT INTO public.devolucoes (
    base_id, lote_id, shipment_codigo, rota, motorista, motivo, motivo_original,
    observacao, devolvido_por, occurrence_code, meli_status, meli_substatus,
    motivo_descricao, tratamento, divergencia_delivered
  ) VALUES (
    v_lote.base_id, v_lote.id, v_cod, v_pac.route_id, v_pac.driver_name, v_motivo, v_motivo,
    nullif(trim(coalesce(p_observacao,'')), ''), v_uid, v_pac.occurrence_code, v_pac.status,
    v_pac.substatus, v_descricao, v_tratamento, v_diverg
  ) RETURNING * INTO v_ins;

  UPDATE public.devolucao_lotes
     SET total_pacotes = (SELECT count(*) FROM public.devolucoes WHERE lote_id = v_lote.id AND cancelado = false)
   WHERE id = v_lote.id;

  RETURN jsonb_build_object('status','ok',
    'mensagem','Pacote ' || v_cod || ' registrado — ' || v_descricao,
    'devolucao', to_jsonb(v_ins),
    'total_pacotes', (SELECT total_pacotes FROM public.devolucao_lotes WHERE id = v_lote.id));
END;
$$;

-- Finalizar lote com resumo por ocorrência
CREATE OR REPLACE FUNCTION public.devolucao_lote_finalizar(p_lote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
  v_resumo jsonb;
  v_trackings jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Não autenticado.');
  END IF;
  SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  IF v_lote.id IS NULL OR NOT public.has_base_access(v_uid, v_lote.base_id) THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado ou sem acesso.');
  END IF;

  UPDATE public.devolucao_lotes
     SET estado = 'finalizada', finalizado_por = v_uid, finalizado_em = now(),
         total_pacotes = (SELECT count(*) FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false)
   WHERE id = p_lote_id AND estado = 'aberta'
   RETURNING * INTO v_lote;

  IF v_lote.id IS NULL THEN
    SELECT * INTO v_lote FROM public.devolucao_lotes WHERE id = p_lote_id;
  END IF;

  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_resumo FROM (
    SELECT jsonb_build_object('occurrence_code', coalesce(occurrence_code,'—'),
                              'motivo_descricao', coalesce(motivo_descricao,'—'),
                              'total', count(*)) AS x
      FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false
     GROUP BY 1,2 ORDER BY 1
  ) s;

  SELECT coalesce(jsonb_agg(shipment_codigo ORDER BY devolvido_em), '[]'::jsonb) INTO v_trackings
    FROM public.devolucoes WHERE lote_id = p_lote_id AND cancelado = false;

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote), 'resumo', v_resumo, 'trackings', v_trackings);
END;
$$;

-- Reabrir lote: somente administrador, com justificativa
CREATE OR REPLACE FUNCTION public.devolucao_lote_reabrir(p_lote_id uuid, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_lote public.devolucao_lotes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('status','erro','mensagem','Somente administrador pode reabrir um lote.');
  END IF;
  IF coalesce(trim(p_justificativa), '') = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Justificativa obrigatória.');
  END IF;

  UPDATE public.devolucao_lotes
     SET estado = 'aberta', reaberto_por = v_uid, reaberto_em = now(),
         reabertura_justificativa = trim(p_justificativa)
   WHERE id = p_lote_id
   RETURNING * INTO v_lote;

  IF v_lote.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Lote não encontrado.');
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'devolucao_lote_reaberto', 'devolucao_lotes', p_lote_id::text,
          jsonb_build_object('justificativa', trim(p_justificativa)));

  RETURN jsonb_build_object('status','ok','lote', to_jsonb(v_lote));
END;
$$;

-- Correção manual do motivo: somente administrador, preserva o original do Meli
CREATE OR REPLACE FUNCTION public.devolucao_corrigir_motivo(p_devolucao_id uuid, p_motivo text, p_justificativa text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_dev public.devolucoes;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin') THEN
    RETURN jsonb_build_object('status','erro','mensagem','Somente administrador pode corrigir o motivo.');
  END IF;
  IF coalesce(trim(p_justificativa), '') = '' THEN
    RETURN jsonb_build_object('status','erro','mensagem','Justificativa obrigatória.');
  END IF;

  UPDATE public.devolucoes
     SET motivo_original = coalesce(motivo_original, motivo),
         motivo_corrigido = p_motivo::motivo_devolucao,
         motivo = p_motivo::motivo_devolucao,
         correcao_justificativa = trim(p_justificativa),
         corrigido_por = v_uid,
         corrigido_em = now()
   WHERE id = p_devolucao_id
   RETURNING * INTO v_dev;

  IF v_dev.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','mensagem','Devolução não encontrada.');
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'devolucao_motivo_corrigido', 'devolucoes', p_devolucao_id::text,
          jsonb_build_object('motivo_original', v_dev.motivo_original,
                             'motivo_corrigido', v_dev.motivo_corrigido,
                             'occurrence_code', v_dev.occurrence_code,
                             'justificativa', trim(p_justificativa)));

  RETURN jsonb_build_object('status','ok','devolucao', to_jsonb(v_dev));
END;
$$;

REVOKE ALL ON FUNCTION public.devolucao_lote_criar(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_aberto(uuid, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_bipar(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_finalizar(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_reabrir(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_corrigir_motivo(uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.devolucao_lote_criar(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_aberto(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_bipar(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_finalizar(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_reabrir(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_corrigir_motivo(uuid, text, text) TO authenticated, service_role;
-- ==== fim 20260814134052_a046d399-9b84-440a-aa69-562bb0c3e6ac.sql ====
