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
