-- Retencao conservadora para manter o projeto dentro do plano gratuito.
-- Mantem cadastros, pagamentos, auditoria operacional, recebimentos,
-- devolucoes, LOST/faltantes, transferencias e escalas.
--
-- A exclusao e feita em lotes pequenos. meli_pacotes e meli_rotas_payload
-- sao removidos por ON DELETE CASCADE ao excluir a rota bruta correspondente.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

CREATE SCHEMA IF NOT EXISTS maintenance;
REVOKE ALL ON SCHEMA maintenance FROM PUBLIC;

CREATE TABLE IF NOT EXISTS maintenance.retention_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  executado_em timestamptz NOT NULL DEFAULT now(),
  corte date NOT NULL,
  rotas_removidas integer NOT NULL DEFAULT 0,
  importacoes_removidas integer NOT NULL DEFAULT 0,
  execucoes_worker_removidas integer NOT NULL DEFAULT 0,
  snapshots_removidos integer NOT NULL DEFAULT 0
);

REVOKE ALL ON maintenance.retention_runs FROM PUBLIC;

CREATE OR REPLACE FUNCTION maintenance.cleanup_15_days()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = pg_catalog, public, maintenance
AS $$
DECLARE
  v_cutoff date := current_date - 15;
  v_routes integer := 0;
  v_imports integer := 0;
  v_worker integer := 0;
  v_snapshots integer := 0;
BEGIN
  -- Evita espera longa e concorrencia com a operacao.
  PERFORM set_config('lock_timeout', '3s', true);
  PERFORM set_config('statement_timeout', '45s', true);

  WITH candidates AS (
    SELECT id
    FROM public.meli_rotas
    WHERE COALESCE(data_rota, created_at::date) < v_cutoff
    ORDER BY COALESCE(data_rota, created_at::date), id
    LIMIT 100
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.meli_rotas r
  USING candidates c
  WHERE r.id = c.id;
  GET DIAGNOSTICS v_routes = ROW_COUNT;

  WITH candidates AS (
    SELECT i.id
    FROM public.meli_importacoes i
    WHERE COALESCE(i.iniciado_em, i.created_at) < v_cutoff::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM public.meli_rotas r WHERE r.origem_importacao = i.id
      )
    ORDER BY COALESCE(i.iniciado_em, i.created_at), i.id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.meli_importacoes i
  USING candidates c
  WHERE i.id = c.id;
  GET DIAGNOSTICS v_imports = ROW_COUNT;

  WITH candidates AS (
    SELECT id
    FROM public.meli_worker_execucoes
    WHERE COALESCE(iniciado_em, criado_em) < v_cutoff::timestamptz
    ORDER BY COALESCE(iniciado_em, criado_em), id
    LIMIT 5000
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.meli_worker_execucoes w
  USING candidates c
  WHERE w.id = c.id;
  GET DIAGNOSTICS v_worker = ROW_COUNT;

  WITH candidates AS (
    SELECT id
    FROM public.meli_monitoramento_snapshots
    WHERE data_operacional < v_cutoff
    ORDER BY data_operacional, id
    LIMIT 1000
    FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.meli_monitoramento_snapshots s
  USING candidates c
  WHERE s.id = c.id;
  GET DIAGNOSTICS v_snapshots = ROW_COUNT;

  INSERT INTO maintenance.retention_runs (
    corte,
    rotas_removidas,
    importacoes_removidas,
    execucoes_worker_removidas,
    snapshots_removidos
  )
  VALUES (
    v_cutoff,
    v_routes,
    v_imports,
    v_worker,
    v_snapshots
  );

  -- O historico do proprio pg_cron tambem cresce se nao for limpo.
  DELETE FROM cron.job_run_details
  WHERE end_time IS NOT NULL
    AND end_time < now() - interval '15 days';

  -- Mantem apenas 90 dias do log resumido, que e pequeno.
  DELETE FROM maintenance.retention_runs
  WHERE executado_em < now() - interval '90 days';

  RETURN jsonb_build_object(
    'cutoff', v_cutoff,
    'routes_deleted', v_routes,
    'imports_deleted', v_imports,
    'worker_runs_deleted', v_worker,
    'snapshots_deleted', v_snapshots
  );
END;
$$;

REVOKE ALL ON FUNCTION maintenance.cleanup_15_days() FROM PUBLIC;

DO $$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid
  INTO v_job_id
  FROM cron.job
  WHERE jobname = 'jm-routes-retencao-15-dias';

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;

  -- 06:40 UTC = 03:40 em Sao Paulo.
  PERFORM cron.schedule(
    'jm-routes-retencao-15-dias',
    '40 6 * * *',
    $cron$SELECT maintenance.cleanup_15_days();$cron$
  );
END;
$$;

COMMENT ON FUNCTION maintenance.cleanup_15_days() IS
  'Remove em lotes dados tecnicos/brutos com mais de 15 dias, preservando dados operacionais e financeiros.';
