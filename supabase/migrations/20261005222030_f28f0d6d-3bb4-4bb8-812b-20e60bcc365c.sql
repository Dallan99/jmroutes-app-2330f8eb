CREATE TEMP TABLE _r (teste text, resultado text) ON COMMIT DROP;
DO $$
DECLARE
  cid uuid := gen_random_uuid();
  lote jsonb;
  r text[] := array[]::text[];
  n int; m int;
BEGIN
  BEGIN
    lote := jsonb_build_object(
      'ciclo', jsonb_build_object('id', cid, 'base_codigo','ESP16','service_center','SSP15','instancia','teste-rollback','dry_run',true,'iniciado_em', now()),
      'pagina', jsonb_build_object('numero',1,'itens',2,'hash', repeat('a',64),'payload', '{"x":1}'::jsonb),
      'rotas', jsonb_build_array(
         jsonb_build_object('route_id','R1','data_rota','2026-10-05','motorista_nome','M','placa','abc-1d23','total_pedidos',10,'total_entregue',9),
         jsonb_build_object('route_id','R2','data_rota','2026-10-05','total_pedidos',5,'total_entregue',5)),
      'pacotes', jsonb_build_array(jsonb_build_object('route_id','R1','shipment_id','S1'), jsonb_build_object('route_id','R1','shipment_id','S2')));
    PERFORM public.meli_piloto_ingerir_lote(lote);
    PERFORM public.meli_piloto_ingerir_lote(lote);  -- reenvio idêntico
    SELECT count(*) INTO n FROM public.meli_piloto_rotas WHERE ultimo_ciclo_id = cid;
    SELECT count(*) INTO m FROM public.meli_piloto_pacotes WHERE ultimo_ciclo_id = cid;
    r := r || ('Reenvio do mesmo lote|rotas='||n||' pacotes='||m||CASE WHEN n=2 AND m=2 THEN ' OK sem duplicidade' ELSE ' FALHA' END);
    SELECT count(*) INTO n FROM public.meli_piloto_staging WHERE ciclo_id=cid;
    r := r || ('Staging bruto|'||n||' linha(s)'||CASE WHEN n=1 THEN ' OK' ELSE ' FALHA' END);
    SELECT paginas_lidas, rotas_recebidas INTO n, m FROM public.meli_piloto_ciclos WHERE id=cid;
    r := r || ('Controle do ciclo|páginas='||n||' rotas='||m);
    SELECT count(*) INTO n FROM public.meli_piloto_rotas WHERE ultimo_ciclo_id=cid AND placa='ABC1D23';
    r := r || ('Placa normalizada|'||CASE WHEN n=1 THEN 'OK ABC1D23' ELSE 'FALHA' END);
    BEGIN PERFORM public.meli_piloto_ingerir_lote(jsonb_set(lote,'{ciclo,dry_run}','false')); r := r || 'Lote sem DRY_RUN|FALHA aceito'::text;
    EXCEPTION WHEN others THEN r := r || ('Lote sem DRY_RUN|OK recusado: '||SQLERRM); END;
    BEGIN PERFORM public.meli_piloto_ingerir_lote(jsonb_set(lote,'{ciclo,base_codigo}','"SSP3"')); r := r || 'Base fora do piloto|FALHA aceita'::text;
    EXCEPTION WHEN others THEN r := r || ('Base fora do piloto|OK recusada: '||SQLERRM); END;
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', '{"sub":"ad2405f0-9af2-42ca-babc-dd6d1cc8b036","role":"authenticated"}', true);
    BEGIN PERFORM public.meli_piloto_ingerir_lote(lote); r := r || 'Usuário logado chamar ingestão|FALHA permitido'::text;
    EXCEPTION WHEN others THEN r := r || ('Usuário logado chamar ingestão|OK bloqueado: '||SQLERRM); END;
    BEGIN INSERT INTO public.meli_piloto_rotas(base_id,base_codigo,data_rota,route_id,payload,coletado_em,primeiro_ciclo_id,ultimo_ciclo_id)
      SELECT id,'ESP16',current_date,'X','{}',now(),cid,cid FROM public.bases WHERE codigo='ESP16'; r := r || 'Gravar rota direto pelo app|FALHA'::text;
    EXCEPTION WHEN others THEN r := r || ('Gravar rota direto pelo app|OK bloqueado: '||SQLERRM); END;
    SELECT count(*) INTO n FROM public.meli_piloto_rotas WHERE ultimo_ciclo_id=cid;
    r := r || ('Admin lê rotas do piloto|'||n||' linha(s)');
    RAISE EXCEPTION 'desfazer_teste';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'desfazer_teste' THEN r := r || ('Erro na preparação|'||SQLERRM); END IF;
  END;
  INSERT INTO _r SELECT split_part(v,'|',1), split_part(v,'|',2) FROM unnest(r) v;
END $$;
SELECT * FROM _r;