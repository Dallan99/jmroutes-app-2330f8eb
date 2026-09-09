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
