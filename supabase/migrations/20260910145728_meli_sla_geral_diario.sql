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
