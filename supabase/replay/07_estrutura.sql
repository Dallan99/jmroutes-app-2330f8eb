-- Replay da estrutura do JMRoutes (homologacao) — lote 7 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260908223952_d4662724-9918-4b42-bfc3-408fdc2a3904.sql ====
CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH ref AS (SELECT COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date) dia),
rotas_dia AS MATERIALIZED (
 SELECT r.id, b.codigo
 FROM public.bases b
 JOIN public.meli_rotas_ativas r ON r.base_id=b.id
 CROSS JOIN ref
 WHERE r.data_rota=ref.dia
),
rotas_validas AS MATERIALIZED (
 SELECT id, codigo FROM rotas_dia WHERE NOT public.meli_rota_pm_excluida(id)
),
ocorrencias AS (
 SELECT rv.codigo,
   count(p.id) FILTER (WHERE public.meli_status_normalizado(p.status,p.substatus,p.occurrence_code)='cancelado')::int dc_cancelado,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('damaged','lost','stolen'))::int sinistros,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received'))::int pnr
 FROM rotas_validas rv
 LEFT JOIN public.meli_pacotes p ON p.rota_id=rv.id
 GROUP BY rv.codigo
), linhas_base AS (
 SELECT u.id,u.codigo,u.nome,u.cidade,u.uf,u.tipo,u.ordem,
   s.rotas_totais AS veiculos,s.pacotes,s.bem_sucedidos AS entregues,
   COALESCE(o.dc_cancelado,0) dc_cancelado,COALESCE(o.sinistros,0) sinistros,
   CASE WHEN s.id IS NULL THEN NULL ELSE greatest(s.com_falhas-COALESCE(o.dc_cancelado,0)-COALESCE(o.sinistros,0),0) END::int insucessos,
   COALESCE(o.pnr,0) pnr,s.coletado_em AS source_updated_at,
   CASE WHEN s.id IS NULL THEN 'sem_dados' ELSE 'ok' END status
 FROM public.meli_unidades_operacionais u CROSS JOIN ref
 LEFT JOIN public.meli_monitoramento_snapshots s ON s.base_codigo=u.codigo AND s.data_operacional=ref.dia
 LEFT JOIN ocorrencias o ON o.codigo=u.codigo
 WHERE u.ativo AND (auth.uid() IS NULL OR public.meli_pode_operar())
), linhas AS (
 SELECT *,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM linhas_base
), totais_base AS (
 SELECT COALESCE(sum(veiculos),0)::int veiculos,COALESCE(sum(pacotes),0)::int pacotes,
 COALESCE(sum(entregues),0)::int entregues,COALESCE(sum(dc_cancelado),0)::int dc_cancelado,
 COALESCE(sum(sinistros),0)::int sinistros,COALESCE(sum(insucessos),0)::int insucessos,
 COALESCE(sum(pnr),0)::int pnr,count(*) FILTER(WHERE status='ok')::int bases_com_dados FROM linhas
), totais AS (
 SELECT *,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM totais_base
)
SELECT jsonb_build_object('status','ok','data',(SELECT dia FROM ref),
 'bases',COALESCE((SELECT jsonb_agg(to_jsonb(l)-'ordem' ORDER BY ordem) FROM linhas l),'[]'::jsonb),
 'totais',(SELECT to_jsonb(t) FROM totais t));
$function$;
-- ==== fim 20260908223952_d4662724-9918-4b42-bfc3-408fdc2a3904.sql ====

-- ==== inicio 20260908225050_166701ba-210c-418b-ac46-96abdc3e639b.sql ====
CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH ref AS (SELECT COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date) dia),
rotas_dia AS MATERIALIZED (
 SELECT r.id, b.codigo
 FROM public.bases b
 JOIN public.meli_rotas_ativas r ON r.base_id=b.id
 CROSS JOIN ref
 WHERE r.data_rota=ref.dia
),
rotas_validas AS MATERIALIZED (
 SELECT id, codigo FROM rotas_dia
 WHERE codigo <> 'ESP16' OR NOT public.meli_rota_pm_excluida(id)
),
ocorrencias AS (
 SELECT rv.codigo,
   count(p.id) FILTER (WHERE public.meli_status_normalizado(p.status,p.substatus,p.occurrence_code)='cancelado')::int dc_cancelado,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('damaged','lost','stolen'))::int sinistros,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received'))::int pnr
 FROM rotas_validas rv
 LEFT JOIN public.meli_pacotes p ON p.rota_id=rv.id
 GROUP BY rv.codigo
), linhas_base AS (
 SELECT u.id,u.codigo,u.nome,u.cidade,u.uf,u.tipo,u.ordem,
   s.rotas_totais AS veiculos,s.pacotes,s.bem_sucedidos AS entregues,
   COALESCE(o.dc_cancelado,0) dc_cancelado,COALESCE(o.sinistros,0) sinistros,
   CASE WHEN s.id IS NULL THEN NULL ELSE greatest(s.com_falhas-COALESCE(o.dc_cancelado,0)-COALESCE(o.sinistros,0),0) END::int insucessos,
   COALESCE(o.pnr,0) pnr,s.coletado_em AS source_updated_at,
   CASE WHEN s.id IS NULL THEN 'sem_dados' ELSE 'ok' END status
 FROM public.meli_unidades_operacionais u CROSS JOIN ref
 LEFT JOIN public.meli_monitoramento_snapshots s ON s.base_codigo=u.codigo AND s.data_operacional=ref.dia
 LEFT JOIN ocorrencias o ON o.codigo=u.codigo
 WHERE u.ativo AND (auth.uid() IS NULL OR public.meli_pode_operar())
), linhas AS (
 SELECT *,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM linhas_base
), totais_base AS (
 SELECT COALESCE(sum(veiculos),0)::int veiculos,COALESCE(sum(pacotes),0)::int pacotes,
 COALESCE(sum(entregues),0)::int entregues,COALESCE(sum(dc_cancelado),0)::int dc_cancelado,
 COALESCE(sum(sinistros),0)::int sinistros,COALESCE(sum(insucessos),0)::int insucessos,
 COALESCE(sum(pnr),0)::int pnr,count(*) FILTER(WHERE status='ok')::int bases_com_dados FROM linhas
), totais AS (
 SELECT *,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM totais_base
)
SELECT jsonb_build_object('status','ok','data',(SELECT dia FROM ref),
 'bases',COALESCE((SELECT jsonb_agg(to_jsonb(l)-'ordem' ORDER BY ordem) FROM linhas l),'[]'::jsonb),
 'totais',(SELECT to_jsonb(t) FROM totais t));
$function$;
-- ==== fim 20260908225050_166701ba-210c-418b-ac46-96abdc3e639b.sql ====

-- ==== inicio 20260909133057_monitoramento_monotonic_upsert.sql ====
-- Preserva a última evolução válida do dia. O Monitoramento Last Mile é
-- cumulativo: leituras atrasadas, parciais ou zeradas não podem regredir o painel.
ALTER TABLE public.meli_monitoramento_snapshots
  ADD COLUMN IF NOT EXISTS performance_logistics_max numeric,
  ADD COLUMN IF NOT EXISTS performance_sem_dc_max numeric,
  ADD COLUMN IF NOT EXISTS performance_sem_dc_sinistro_max numeric;

CREATE OR REPLACE FUNCTION public.meli_monitoramento_upsert(p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_codigo text := upper(trim(p_snapshot->>'base_codigo'));
DECLARE v_facility text := upper(trim(p_snapshot->>'facility_id'));
DECLARE v_data date := (p_snapshot->>'data_operacional')::date;
DECLARE v_row public.meli_monitoramento_snapshots;
DECLARE v_pacotes integer := greatest((p_snapshot->>'pacotes')::int,0);
DECLARE v_entregues integer := greatest((p_snapshot->>'bem_sucedidos')::int,0);
DECLARE v_performance numeric := CASE WHEN v_pacotes=0 THEN NULL ELSE round(100.0*v_entregues/v_pacotes,2) END;
BEGIN
  IF v_codigo IS NULL OR v_codigo='' OR v_codigo<>v_facility THEN
    RAISE EXCEPTION 'facility_divergente' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.meli_monitoramento_snapshots AS atual
    (data_operacional,base_codigo,facility_id,service_center_id,rotas_totais,rotas_entrega,
     rotas_coleta,rotas_mistas,rotas_em_andamento,pacotes,sacas,pendentes,com_falhas,
     bem_sucedidos,coletado_em,updated_at,performance_logistics_max,performance_sem_dc_max,performance_sem_dc_sinistro_max)
  VALUES
    (v_data,v_codigo,v_facility,upper(trim(p_snapshot->>'service_center_id')),
     greatest((p_snapshot->>'rotas_totais')::int,0),greatest((p_snapshot->>'rotas_entrega')::int,0),
     greatest((p_snapshot->>'rotas_coleta')::int,0),greatest((p_snapshot->>'rotas_mistas')::int,0),
     greatest((p_snapshot->>'rotas_em_andamento')::int,0),greatest((p_snapshot->>'pacotes')::int,0),
     greatest((p_snapshot->>'sacas')::int,0),greatest((p_snapshot->>'pendentes')::int,0),
     greatest((p_snapshot->>'com_falhas')::int,0),greatest((p_snapshot->>'bem_sucedidos')::int,0),
     (p_snapshot->>'coletado_em')::timestamptz,now(),v_performance,v_performance,v_performance)
  ON CONFLICT (base_codigo,data_operacional) DO UPDATE SET
    rotas_totais=greatest(atual.rotas_totais,excluded.rotas_totais),
    rotas_entrega=greatest(atual.rotas_entrega,excluded.rotas_entrega),
    rotas_coleta=greatest(atual.rotas_coleta,excluded.rotas_coleta),
    rotas_mistas=greatest(atual.rotas_mistas,excluded.rotas_mistas),
    rotas_em_andamento=greatest(atual.rotas_em_andamento,excluded.rotas_em_andamento),
    pacotes=greatest(atual.pacotes,excluded.pacotes),sacas=greatest(atual.sacas,excluded.sacas),
    pendentes=greatest(atual.pendentes,excluded.pendentes),
    com_falhas=greatest(atual.com_falhas,excluded.com_falhas),
    bem_sucedidos=greatest(atual.bem_sucedidos,excluded.bem_sucedidos),
    performance_logistics_max=greatest(atual.performance_logistics_max,excluded.performance_logistics_max),
    performance_sem_dc_max=greatest(atual.performance_sem_dc_max,excluded.performance_sem_dc_max),
    performance_sem_dc_sinistro_max=greatest(atual.performance_sem_dc_sinistro_max,excluded.performance_sem_dc_sinistro_max),
    coletado_em=greatest(atual.coletado_em,excluded.coletado_em),updated_at=now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok',true,'base_codigo',v_row.base_codigo,'data_operacional',v_row.data_operacional,'coletado_em',v_row.coletado_em);
END $$;
REVOKE ALL ON FUNCTION public.meli_monitoramento_upsert(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meli_monitoramento_upsert(jsonb) TO service_role;

-- A consulta calculada continua sendo a fonte dos números, enquanto este
-- invólucro aplica o maior percentual já confirmado no dia para cada base.
ALTER FUNCTION public.meli_dashboard_geral(date) RENAME TO meli_dashboard_geral_calculado;
CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_data date := COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date);
DECLARE v_resultado jsonb;
DECLARE v_bases jsonb;
BEGIN
  v_resultado := public.meli_dashboard_geral_calculado(v_data);
  SELECT COALESCE(jsonb_agg(
    base || jsonb_build_object(
      'performance_logistics',greatest((base->>'performance_logistics')::numeric,s.performance_logistics_max),
      'performance_sem_dc',greatest((base->>'performance_sem_dc')::numeric,s.performance_sem_dc_max),
      'performance_sem_dc_sinistro',greatest((base->>'performance_sem_dc_sinistro')::numeric,s.performance_sem_dc_sinistro_max)
    ) ORDER BY ord
  ),'[]'::jsonb) INTO v_bases
  FROM jsonb_array_elements(v_resultado->'bases') WITH ORDINALITY AS x(base,ord)
  LEFT JOIN public.meli_monitoramento_snapshots s ON s.base_codigo=base->>'codigo' AND s.data_operacional=v_data;
  RETURN jsonb_set(v_resultado,'{bases}',v_bases);
END $$;
REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated,service_role;
-- ==== fim 20260909133057_monitoramento_monotonic_upsert.sql ====

-- ==== inicio 20260909133532_monitoramento_chave_base_dia.sql ====
-- A tabela pode ter sido criada anteriormente por uma versão parcial. Remove
-- duplicatas preservando a leitura mais recente antes de garantir a chave.
DELETE FROM public.meli_monitoramento_snapshots antigo
USING public.meli_monitoramento_snapshots recente
WHERE antigo.base_codigo=recente.base_codigo
  AND antigo.data_operacional=recente.data_operacional
  AND (antigo.coletado_em<recente.coletado_em OR (antigo.coletado_em=recente.coletado_em AND antigo.id<recente.id));

CREATE UNIQUE INDEX IF NOT EXISTS meli_monitoramento_base_dia_uidx
  ON public.meli_monitoramento_snapshots(base_codigo,data_operacional);
-- ==== fim 20260909133532_monitoramento_chave_base_dia.sql ====

-- ==== inicio 20260909143000_dashboard_geral_snapshot_leve.sql ====
-- O Dashboard Geral já recebe um snapshot resumido por base a cada ciclo.
-- Não reabrir meli_rotas_ativas/meli_pacotes nesta consulta: além de ser
-- desnecessário para o quadro consolidado, isso causava timeout quando o
-- volume histórico crescia.
CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH ref AS (
  SELECT COALESCE(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS dia
),
linhas_base AS (
  SELECT
    u.id,
    u.codigo,
    u.nome,
    u.cidade,
    u.uf,
    u.tipo,
    u.ordem,
    s.rotas_totais AS veiculos,
    s.pacotes,
    s.bem_sucedidos AS entregues,
    0::int AS dc_cancelado,
    0::int AS sinistros,
    CASE WHEN s.id IS NULL THEN NULL ELSE s.com_falhas END::int AS insucessos,
    0::int AS pnr,
    s.coletado_em AS source_updated_at,
    CASE WHEN s.id IS NULL THEN 'sem_dados' ELSE 'ok' END AS status,
    s.performance_logistics_max,
    s.performance_sem_dc_max,
    s.performance_sem_dc_sinistro_max
  FROM public.meli_unidades_operacionais u
  CROSS JOIN ref
  LEFT JOIN public.meli_monitoramento_snapshots s
    ON s.base_codigo = u.codigo
   AND s.data_operacional = ref.dia
  WHERE u.ativo
    AND (auth.uid() IS NULL OR public.meli_pode_operar())
),
linhas AS (
  SELECT
    id,
    codigo,
    nome,
    cidade,
    uf,
    tipo,
    ordem,
    veiculos,
    pacotes,
    entregues,
    dc_cancelado,
    sinistros,
    insucessos,
    pnr,
    source_updated_at,
    status,
    COALESCE(
      performance_logistics_max,
      CASE WHEN COALESCE(pacotes, 0) = 0 THEN NULL
           ELSE round(100.0 * entregues / pacotes, 2)
      END
    ) AS performance_logistics,
    COALESCE(
      performance_sem_dc_max,
      CASE WHEN COALESCE(pacotes, 0) = 0 THEN NULL
           ELSE round(100.0 * (entregues + dc_cancelado) / pacotes, 2)
      END
    ) AS performance_sem_dc,
    COALESCE(
      performance_sem_dc_sinistro_max,
      CASE WHEN COALESCE(pacotes, 0) = 0 THEN NULL
           ELSE round(100.0 * (entregues + dc_cancelado + sinistros) / pacotes, 2)
      END
    ) AS performance_sem_dc_sinistro
  FROM linhas_base
),
totais_base AS (
  SELECT
    COALESCE(sum(veiculos), 0)::int AS veiculos,
    COALESCE(sum(pacotes), 0)::int AS pacotes,
    COALESCE(sum(entregues), 0)::int AS entregues,
    COALESCE(sum(dc_cancelado), 0)::int AS dc_cancelado,
    COALESCE(sum(sinistros), 0)::int AS sinistros,
    COALESCE(sum(insucessos), 0)::int AS insucessos,
    COALESCE(sum(pnr), 0)::int AS pnr,
    count(*) FILTER (WHERE status = 'ok')::int AS bases_com_dados
  FROM linhas
),
totais AS (
  SELECT
    *,
    CASE WHEN pacotes = 0 THEN NULL ELSE round(100.0 * entregues / pacotes, 2) END AS performance_logistics,
    CASE WHEN pacotes = 0 THEN NULL ELSE round(100.0 * (entregues + dc_cancelado) / pacotes, 2) END AS performance_sem_dc,
    CASE WHEN pacotes = 0 THEN NULL ELSE round(100.0 * (entregues + dc_cancelado + sinistros) / pacotes, 2) END AS performance_sem_dc_sinistro
  FROM totais_base
)
SELECT jsonb_build_object(
  'status', 'ok',
  'data', (SELECT dia FROM ref),
  'bases', COALESCE(
    (SELECT jsonb_agg(to_jsonb(l) - 'ordem' ORDER BY ordem) FROM linhas l),
    '[]'::jsonb
  ),
  'totais', (SELECT to_jsonb(t) FROM totais t)
);
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated, service_role;
-- ==== fim 20260909143000_dashboard_geral_snapshot_leve.sql ====

-- ==== inicio 20260909224304_739b079a-6d67-4e40-a3a7-c7eb78f53477.sql ====
CREATE OR REPLACE FUNCTION public.gerencial_rotas_por_base(p_importacao_ids uuid[])
RETURNS TABLE(
  importacao_id uuid,
  base_operacional_id uuid,
  nro_rota text,
  motorista text,
  placa text,
  total bigint,
  triado bigint,
  devolvido bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.importacao_id,
    e.base_operacional_id,
    COALESCE(NULLIF(btrim(e.nro_rota), ''), '—') AS nro_rota,
    (array_agg(e.driver) FILTER (WHERE e.driver IS NOT NULL))[1] AS motorista,
    (array_agg(e.placa) FILTER (WHERE e.placa IS NOT NULL))[1] AS placa,
    count(*) AS total,
    count(*) FILTER (WHERE e.triado) AS triado,
    count(*) FILTER (WHERE e.devolvido) AS devolvido
  FROM public.escalas e
  WHERE e.importacao_id = ANY(p_importacao_ids)
    AND auth.uid() IS NOT NULL
  GROUP BY 1, 2, 3
$$;

REVOKE ALL ON FUNCTION public.gerencial_rotas_por_base(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gerencial_rotas_por_base(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerencial_rotas_por_base(uuid[]) TO service_role;
-- ==== fim 20260909224304_739b079a-6d67-4e40-a3a7-c7eb78f53477.sql ====

-- ==== inicio 20260910145728_meli_sla_geral_diario.sql ====
CREATE TABLE IF NOT EXISTS public.meli_sla_diario (
  data_operacional date PRIMARY KEY,
  bases_total integer NOT NULL DEFAULT 0 CHECK (bases_total >= 0),
  rotas_total bigint NOT NULL DEFAULT 0 CHECK (rotas_total >= 0),
  pacotes_total bigint NOT NULL DEFAULT 0 CHECK (pacotes_total >= 0),
  entregues_total bigint NOT NULL DEFAULT 0 CHECK (entregues_total >= 0),
  pendentes_total bigint NOT NULL DEFAULT 0 CHECK (pendentes_total >= 0),
  insucessos_total bigint NOT NULL DEFAULT 0 CHECK (insucessos_total >= 0),
  sla_geral numeric(6,2) NOT NULL DEFAULT 0 CHECK (sla_geral BETWEEN 0 AND 100),
  ultima_coleta timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.meli_sla_diario IS
  'Consolidado diário persistido das operações Meli. SLA geral = entregues / pacotes, ponderado pelo volume.';

ALTER TABLE public.meli_sla_diario ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "autenticados leem sla meli diario" ON public.meli_sla_diario;
CREATE POLICY "autenticados leem sla meli diario"
  ON public.meli_sla_diario FOR SELECT TO authenticated USING (true);

GRANT SELECT ON public.meli_sla_diario TO authenticated;
GRANT ALL ON public.meli_sla_diario TO service_role;

CREATE OR REPLACE FUNCTION public.recalcular_meli_sla_diario(p_data date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  INSERT INTO public.meli_sla_diario (
    data_operacional, bases_total, rotas_total, pacotes_total, entregues_total,
    pendentes_total, insucessos_total, sla_geral, ultima_coleta, updated_at
  )
  SELECT
    p_data,
    count(*)::integer,
    coalesce(sum(rotas_totais), 0)::bigint,
    coalesce(sum(pacotes), 0)::bigint,
    coalesce(sum(bem_sucedidos), 0)::bigint,
    coalesce(sum(pendentes), 0)::bigint,
    coalesce(sum(com_falhas), 0)::bigint,
    CASE WHEN coalesce(sum(pacotes), 0) > 0
      THEN round(100.0 * coalesce(sum(bem_sucedidos), 0) / sum(pacotes), 2)
      ELSE 0
    END,
    max(coletado_em),
    now()
  FROM public.meli_monitoramento_snapshots
  WHERE data_operacional = p_data
  HAVING count(*) > 0
  ON CONFLICT (data_operacional) DO UPDATE SET
    bases_total = greatest(meli_sla_diario.bases_total, EXCLUDED.bases_total),
    rotas_total = greatest(meli_sla_diario.rotas_total, EXCLUDED.rotas_total),
    pacotes_total = greatest(meli_sla_diario.pacotes_total, EXCLUDED.pacotes_total),
    entregues_total = greatest(meli_sla_diario.entregues_total, EXCLUDED.entregues_total),
    pendentes_total = greatest(meli_sla_diario.pendentes_total, EXCLUDED.pendentes_total),
    insucessos_total = greatest(meli_sla_diario.insucessos_total, EXCLUDED.insucessos_total),
    sla_geral = greatest(
      meli_sla_diario.sla_geral,
      CASE WHEN greatest(meli_sla_diario.pacotes_total, EXCLUDED.pacotes_total) > 0
        THEN round(
          100.0 * greatest(meli_sla_diario.entregues_total, EXCLUDED.entregues_total) /
          greatest(meli_sla_diario.pacotes_total, EXCLUDED.pacotes_total), 2
        )
        ELSE 0
      END
    ),
    ultima_coleta = greatest(meli_sla_diario.ultima_coleta, EXCLUDED.ultima_coleta),
    updated_at = now();
$function$;

REVOKE ALL ON FUNCTION public.recalcular_meli_sla_diario(date) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_recalcular_meli_sla_diario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  PERFORM public.recalcular_meli_sla_diario(NEW.data_operacional);
  IF TG_OP = 'UPDATE' AND OLD.data_operacional IS DISTINCT FROM NEW.data_operacional THEN
    PERFORM public.recalcular_meli_sla_diario(OLD.data_operacional);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.trg_recalcular_meli_sla_diario() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_meli_monitoramento_atualiza_sla ON public.meli_monitoramento_snapshots;
CREATE TRIGGER trg_meli_monitoramento_atualiza_sla
AFTER INSERT OR UPDATE OF rotas_totais, pacotes, pendentes, com_falhas, bem_sucedidos, coletado_em, data_operacional
ON public.meli_monitoramento_snapshots
FOR EACH ROW EXECUTE FUNCTION public.trg_recalcular_meli_sla_diario();

DO $function$
DECLARE v_data date;
BEGIN
  FOR v_data IN SELECT DISTINCT data_operacional FROM public.meli_monitoramento_snapshots LOOP
    PERFORM public.recalcular_meli_sla_diario(v_data);
  END LOOP;
END;
$function$;
-- ==== fim 20260910145728_meli_sla_geral_diario.sql ====

-- ==== inicio 20260923173000_xpt_somente_am.sql ====
-- Os painéis das quatro XPTs representam somente a janela AM.
-- A versão do escopo permite substituir uma única vez o snapshot legado que
-- incluía PM; depois disso os acumulados AM continuam monotônicos durante o dia.
ALTER TABLE public.meli_monitoramento_snapshots
  ADD COLUMN IF NOT EXISTS escopo_rotas text;

CREATE OR REPLACE FUNCTION public.meli_rota_pm_excluida(p_rota_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT coalesce(
    (SELECT b.codigo IN ('ESP15','ESP16','ESP17','ESP18')
            AND public.meli_rota_pm(r.cluster, r.route_id)
       FROM public.meli_rotas r
       LEFT JOIN public.bases b ON b.id = r.base_id
      WHERE r.id = p_rota_id),
  false);
$$;

REVOKE ALL ON FUNCTION public.meli_rota_pm_excluida(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_rota_pm_excluida(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.meli_monitoramento_upsert(p_snapshot jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_codigo text := upper(trim(p_snapshot->>'base_codigo'));
DECLARE v_facility text := upper(trim(p_snapshot->>'facility_id'));
DECLARE v_data date := (p_snapshot->>'data_operacional')::date;
DECLARE v_escopo text := nullif(upper(trim(p_snapshot->>'escopo_rotas')), '');
DECLARE v_row public.meli_monitoramento_snapshots;
DECLARE v_pacotes integer := greatest((p_snapshot->>'pacotes')::int,0);
DECLARE v_entregues integer := greatest((p_snapshot->>'bem_sucedidos')::int,0);
DECLARE v_performance numeric := CASE WHEN v_pacotes=0 THEN NULL ELSE round(100.0*v_entregues/v_pacotes,2) END;
BEGIN
  IF v_codigo IS NULL OR v_codigo='' OR v_codigo<>v_facility THEN
    RAISE EXCEPTION 'facility_divergente' USING ERRCODE='22023';
  END IF;
  IF v_escopo IS NOT NULL AND v_escopo <> 'AM' THEN
    RAISE EXCEPTION 'escopo_invalido' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.meli_monitoramento_snapshots AS atual
    (data_operacional,base_codigo,facility_id,service_center_id,rotas_totais,rotas_entrega,
     rotas_coleta,rotas_mistas,rotas_em_andamento,pacotes,sacas,pendentes,com_falhas,
     bem_sucedidos,coletado_em,updated_at,performance_logistics_max,performance_sem_dc_max,
     performance_sem_dc_sinistro_max,escopo_rotas)
  VALUES
    (v_data,v_codigo,v_facility,upper(trim(p_snapshot->>'service_center_id')),
     greatest((p_snapshot->>'rotas_totais')::int,0),greatest((p_snapshot->>'rotas_entrega')::int,0),
     greatest((p_snapshot->>'rotas_coleta')::int,0),greatest((p_snapshot->>'rotas_mistas')::int,0),
     greatest((p_snapshot->>'rotas_em_andamento')::int,0),v_pacotes,
     greatest((p_snapshot->>'sacas')::int,0),greatest((p_snapshot->>'pendentes')::int,0),
     greatest((p_snapshot->>'com_falhas')::int,0),v_entregues,
     (p_snapshot->>'coletado_em')::timestamptz,now(),v_performance,v_performance,v_performance,v_escopo)
  ON CONFLICT (base_codigo,data_operacional) DO UPDATE SET
    rotas_totais=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.rotas_totais ELSE greatest(atual.rotas_totais,excluded.rotas_totais) END,
    rotas_entrega=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.rotas_entrega ELSE greatest(atual.rotas_entrega,excluded.rotas_entrega) END,
    rotas_coleta=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.rotas_coleta ELSE greatest(atual.rotas_coleta,excluded.rotas_coleta) END,
    rotas_mistas=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.rotas_mistas ELSE greatest(atual.rotas_mistas,excluded.rotas_mistas) END,
    rotas_em_andamento=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.rotas_em_andamento ELSE greatest(atual.rotas_em_andamento,excluded.rotas_em_andamento) END,
    pacotes=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.pacotes ELSE greatest(atual.pacotes,excluded.pacotes) END,
    sacas=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.sacas ELSE greatest(atual.sacas,excluded.sacas) END,
    pendentes=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.pendentes ELSE greatest(atual.pendentes,excluded.pendentes) END,
    com_falhas=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.com_falhas ELSE greatest(atual.com_falhas,excluded.com_falhas) END,
    bem_sucedidos=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.bem_sucedidos ELSE greatest(atual.bem_sucedidos,excluded.bem_sucedidos) END,
    performance_logistics_max=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.performance_logistics_max ELSE greatest(atual.performance_logistics_max,excluded.performance_logistics_max) END,
    performance_sem_dc_max=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.performance_sem_dc_max ELSE greatest(atual.performance_sem_dc_max,excluded.performance_sem_dc_max) END,
    performance_sem_dc_sinistro_max=CASE WHEN atual.escopo_rotas IS DISTINCT FROM excluded.escopo_rotas AND excluded.escopo_rotas='AM' THEN excluded.performance_sem_dc_sinistro_max ELSE greatest(atual.performance_sem_dc_sinistro_max,excluded.performance_sem_dc_sinistro_max) END,
    escopo_rotas=coalesce(excluded.escopo_rotas,atual.escopo_rotas),
    coletado_em=greatest(atual.coletado_em,excluded.coletado_em),updated_at=now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok',true,'base_codigo',v_row.base_codigo,'data_operacional',v_row.data_operacional,'coletado_em',v_row.coletado_em);
END $$;

REVOKE ALL ON FUNCTION public.meli_monitoramento_upsert(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meli_monitoramento_upsert(jsonb) TO service_role;
-- ==== fim 20260923173000_xpt_somente_am.sql ====
