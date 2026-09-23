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
