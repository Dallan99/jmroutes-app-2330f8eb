CREATE OR REPLACE FUNCTION public.meli_piloto_ingerir_lote(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  c jsonb := p->'ciclo';
  v_ciclo uuid := (c->>'id')::uuid;
  v_base uuid;
  v_cod text := upper(c->>'base_codigo');
  v_agora timestamptz := coalesce((p->>'coletado_em')::timestamptz, now());
  v_rotas int := 0; v_pacotes int := 0; v_staging int := 0;
BEGIN
  IF coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF v_ciclo IS NULL THEN RAISE EXCEPTION 'ciclo.id obrigatório'; END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.bases b
    JOIN public.meli_piloto_estacoes e ON e.base_id = b.id
    WHERE b.codigo = v_cod
      AND b.ativa
      AND e.confirmada
      AND e.ativa_no_piloto
  ) THEN
    RAISE EXCEPTION 'Base fora do piloto ou estação não confirmada: %', v_cod;
  END IF;
  IF coalesce((c->>'dry_run')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'Piloto aceita somente DRY_RUN=true'; END IF;
  SELECT id INTO v_base FROM public.bases WHERE codigo = v_cod AND ativa;
  IF v_base IS NULL THEN RAISE EXCEPTION 'Base % não cadastrada/ativa', v_cod; END IF;
  PERFORM public.meli_piloto_validar_estacao(v_base, c->>'service_center');

  INSERT INTO public.meli_piloto_ciclos AS t (id, base_id, base_codigo, service_center, instancia, versao_worker, dry_run, status, iniciado_em,
    finalizado_em, paginas_esperadas, rotas_esperadas, pacotes_esperados, erro)
  VALUES (v_ciclo, v_base, v_cod, upper(c->>'service_center'), c->>'instancia', c->>'versao_worker', true,
    coalesce(c->>'status','em_andamento'), (c->>'iniciado_em')::timestamptz, (c->>'finalizado_em')::timestamptz,
    (c->>'paginas_esperadas')::int, (c->>'rotas_esperadas')::int, (c->>'pacotes_esperados')::int, c->>'erro')
  ON CONFLICT (id) DO UPDATE SET
    status = EXCLUDED.status,
    finalizado_em = coalesce(EXCLUDED.finalizado_em, t.finalizado_em),
    paginas_esperadas = coalesce(EXCLUDED.paginas_esperadas, t.paginas_esperadas),
    rotas_esperadas = coalesce(EXCLUDED.rotas_esperadas, t.rotas_esperadas),
    pacotes_esperados = coalesce(EXCLUDED.pacotes_esperados, t.pacotes_esperados),
    erro = coalesce(EXCLUDED.erro, t.erro)
  WHERE t.base_id = EXCLUDED.base_id;

  IF p ? 'pagina' AND jsonb_typeof(p->'pagina') = 'object' THEN
    INSERT INTO public.meli_piloto_paginas (ciclo_id, base_id, recurso, numero, offset_inicial, total_informado, itens_recebidos, payload_hash, status, coletado_em)
    VALUES (v_ciclo, v_base, coalesce(p->'pagina'->>'recurso','rotas'), (p->'pagina'->>'numero')::int, (p->'pagina'->>'offset')::int,
      (p->'pagina'->>'total_informado')::int, (p->'pagina'->>'itens')::int, p->'pagina'->>'hash',
      coalesce(p->'pagina'->>'status','ok'), v_agora)
    ON CONFLICT (ciclo_id, recurso, numero) DO UPDATE SET itens_recebidos = EXCLUDED.itens_recebidos,
      payload_hash = EXCLUDED.payload_hash, status = EXCLUDED.status, total_informado = EXCLUDED.total_informado;
    IF p->'pagina' ? 'payload' THEN
      INSERT INTO public.meli_piloto_staging (ciclo_id, base_id, recurso, pagina, payload_hash, payload, coletado_em)
      VALUES (v_ciclo, v_base, coalesce(p->'pagina'->>'recurso','rotas'), (p->'pagina'->>'numero')::int, p->'pagina'->>'hash', p->'pagina'->'payload', v_agora)
      ON CONFLICT (ciclo_id, payload_hash) DO NOTHING;
      GET DIAGNOSTICS v_staging = ROW_COUNT;
    END IF;
  END IF;

  INSERT INTO public.meli_piloto_rotas AS t (base_id, base_codigo, data_rota, route_id, driver_id, motorista_nome, placa,
    total_pedidos, total_entregue, payload, coletado_em, primeiro_ciclo_id, ultimo_ciclo_id)
  SELECT v_base, v_cod, (r->>'data_rota')::date, r->>'route_id', r->>'driver_id', r->>'motorista_nome',
    nullif(upper(regexp_replace(coalesce(r->>'placa',''), '[^A-Za-z0-9]', '', 'g')), ''),
    (r->>'total_pedidos')::int, (r->>'total_entregue')::int, coalesce(r->'payload','{}'::jsonb), v_agora, v_ciclo, v_ciclo
  FROM jsonb_array_elements(coalesce(p->'rotas','[]'::jsonb)) r
  WHERE coalesce(r->>'route_id','') <> '' AND r->>'data_rota' IS NOT NULL
  ON CONFLICT (route_id, data_rota) DO UPDATE SET
    driver_id = EXCLUDED.driver_id, motorista_nome = EXCLUDED.motorista_nome, placa = EXCLUDED.placa,
    total_pedidos = EXCLUDED.total_pedidos, total_entregue = EXCLUDED.total_entregue, payload = EXCLUDED.payload,
    coletado_em = EXCLUDED.coletado_em, ultimo_ciclo_id = EXCLUDED.ultimo_ciclo_id
  WHERE t.base_id = EXCLUDED.base_id;
  GET DIAGNOSTICS v_rotas = ROW_COUNT;

  INSERT INTO public.meli_piloto_pacotes AS t (base_id, route_id, shipment_id, status, payload, coletado_em, ultimo_ciclo_id)
  SELECT v_base, k->>'route_id', k->>'shipment_id', k->>'status', coalesce(k->'payload','{}'::jsonb), v_agora, v_ciclo
  FROM jsonb_array_elements(coalesce(p->'pacotes','[]'::jsonb)) k
  WHERE coalesce(k->>'shipment_id','') <> '' AND coalesce(k->>'route_id','') <> ''
  ON CONFLICT (shipment_id, route_id) DO UPDATE SET status = EXCLUDED.status, payload = EXCLUDED.payload,
    coletado_em = EXCLUDED.coletado_em, ultimo_ciclo_id = EXCLUDED.ultimo_ciclo_id
  WHERE t.base_id = EXCLUDED.base_id
    AND (t.status IS DISTINCT FROM EXCLUDED.status OR t.payload IS DISTINCT FROM EXCLUDED.payload);
  GET DIAGNOSTICS v_pacotes = ROW_COUNT;

  INSERT INTO public.meli_piloto_erros (ciclo_id, base_id, etapa, codigo, mensagem, detalhe)
  SELECT v_ciclo, v_base, coalesce(e->>'etapa','desconhecida'), e->>'codigo', left(coalesce(e->>'mensagem','(sem mensagem)'), 2000), e->'detalhe'
  FROM jsonb_array_elements(coalesce(p->'erros','[]'::jsonb)) e;

  UPDATE public.meli_piloto_ciclos SET
    paginas_lidas = (SELECT count(*) FROM public.meli_piloto_paginas WHERE ciclo_id = v_ciclo AND recurso = 'rotas' AND status = 'ok'),
    rotas_recebidas = (SELECT count(*) FROM public.meli_piloto_rotas WHERE ultimo_ciclo_id = v_ciclo),
    pacotes_recebidos = (SELECT count(*) FROM public.meli_piloto_pacotes k
                         JOIN public.meli_piloto_rotas r ON r.base_id = k.base_id AND r.route_id = k.route_id
                         WHERE r.ultimo_ciclo_id = v_ciclo)
  WHERE id = v_ciclo;

  RETURN jsonb_build_object('ciclo_id', v_ciclo, 'rotas', v_rotas, 'pacotes', v_pacotes, 'staging_novos', v_staging);
END $function$;

CREATE OR REPLACE FUNCTION public.meli_piloto_publicar_recebimento(p_base_codigo text, p_data date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_codigo text := upper(trim(p_base_codigo));
  v_base uuid;
  v_importacao uuid;
  v_arquivo text;
  v_versao integer;
  v_inseridos integer := 0;
  v_total integer := 0;
  v_rotas integer := 0;
  v_motoristas integer := 0;
begin
  if coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     and session_user <> 'postgres' then
    raise exception 'Acesso negado' using errcode = '42501';
  end if;

  if p_data is null then
    raise exception 'data operacional obrigatória';
  end if;

  select b.id into v_base
  from public.bases b
  join public.meli_piloto_estacoes e on e.base_id = b.id
  where b.codigo = v_codigo
    and b.ativa
    and e.confirmada
    and e.ativa_no_piloto
  limit 1;

  if v_base is null then
    raise exception 'Base % não confirmada/ativa no piloto', v_codigo;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_base::text || ':' || p_data::text, 0));

  select i.id, i.arquivo_nome
    into v_importacao, v_arquivo
  from public.importacoes_escala i
  where i.base_id = v_base
    and i.data_operacional = p_data
    and i.ativa
  order by i.versao desc
  limit 1;

  if v_importacao is not null
     and coalesce(v_arquivo, '') <> 'meli_piloto_auto' then
    raise exception 'Existe importação manual ativa para % em %', v_codigo, p_data;
  end if;

  if v_importacao is null then
    select coalesce(max(i.versao), 0) + 1
      into v_versao
    from public.importacoes_escala i
    where i.base_id = v_base and i.data_operacional = p_data;

    insert into public.importacoes_escala (
      base_id, data_operacional, versao, ativa, arquivo_nome,
      total_linhas, total_pacotes, total_motoristas, total_rotas
    )
    values (
      v_base, p_data, v_versao, true, 'meli_piloto_auto',
      0, 0, 0, 0
    )
    returning id into v_importacao;
  end if;

  insert into public.escalas as e (
    base_id,
    data_referencia,
    planejada,
    otimizada,
    pacotes,
    placa,
    driver,
    importacao_id,
    facility_id,
    shipment,
    nro_rota,
    cluster,
    meli_pacote_id
  )
  select
    v_base,
    p_data,
    r.route_id,
    r.route_id,
    1,
    r.placa,
    r.motorista_nome,
    v_importacao,
    v_codigo,
    p.shipment_id,
    r.route_id,
    r.route_id,
    p.id
  from public.meli_piloto_pacotes p
  join public.meli_piloto_rotas r
    on r.base_id = p.base_id
   and r.route_id = p.route_id
   and r.data_rota = p_data
  where p.base_id = v_base
  on conflict (importacao_id, meli_pacote_id)
    where meli_pacote_id is not null
  do update set
    base_id = excluded.base_id,
    data_referencia = excluded.data_referencia,
    planejada = excluded.planejada,
    otimizada = excluded.otimizada,
    pacotes = excluded.pacotes,
    placa = excluded.placa,
    driver = excluded.driver,
    facility_id = excluded.facility_id,
    shipment = excluded.shipment,
    nro_rota = excluded.nro_rota,
    cluster = excluded.cluster
  where (e.base_id, e.data_referencia, e.planejada, e.otimizada, e.pacotes, e.placa, e.driver,
         e.facility_id, e.shipment, e.nro_rota, e.cluster)
    is distinct from
        (excluded.base_id, excluded.data_referencia, excluded.planejada, excluded.otimizada, excluded.pacotes, excluded.placa, excluded.driver,
         excluded.facility_id, excluded.shipment, excluded.nro_rota, excluded.cluster);

  get diagnostics v_inseridos = row_count;

  select
    count(*)::integer,
    count(distinct coalesce(nullif(e.otimizada, ''), nullif(e.planejada, '')))::integer,
    count(distinct nullif(e.driver, ''))::integer
  into v_total, v_rotas, v_motoristas
  from public.escalas e
  where e.importacao_id = v_importacao
    and e.meli_pacote_id is not null;

  update public.importacoes_escala
  set total_linhas = v_total,
      total_pacotes = v_total,
      total_rotas = v_rotas,
      total_motoristas = v_motoristas,
      updated_at = now()
  where id = v_importacao;

  return jsonb_build_object(
    'importacao_id', v_importacao,
    'base_codigo', v_codigo,
    'data_operacional', p_data,
    'linhas_processadas', v_inseridos,
    'total_pacotes', v_total,
    'total_rotas', v_rotas,
    'total_motoristas', v_motoristas
  );
end
$function$;
