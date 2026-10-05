BEGIN;

CREATE TABLE IF NOT EXISTS public.meli_piloto_estacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  base_codigo text NOT NULL,
  estacao_externa text,
  confirmada boolean NOT NULL DEFAULT false,
  ativa_no_piloto boolean NOT NULL DEFAULT false,
  confirmada_em timestamptz,
  observacao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_estacoes_base_uk UNIQUE (base_id),
  CONSTRAINT meli_piloto_estacoes_ativa_chk CHECK (NOT ativa_no_piloto OR (confirmada AND estacao_externa IS NOT NULL))
);
REVOKE ALL ON public.meli_piloto_estacoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meli_piloto_estacoes TO authenticated;
GRANT ALL ON public.meli_piloto_estacoes TO service_role;
ALTER TABLE public.meli_piloto_estacoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS meli_piloto_estacoes_leitura_base ON public.meli_piloto_estacoes;
CREATE POLICY meli_piloto_estacoes_leitura_base ON public.meli_piloto_estacoes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));
DROP TRIGGER IF EXISTS trg_meli_piloto_estacoes_touch ON public.meli_piloto_estacoes;
CREATE TRIGGER trg_meli_piloto_estacoes_touch BEFORE UPDATE ON public.meli_piloto_estacoes FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Base interna (bases) x estação externa AdminML. ESP18 aguarda confirmação com rota real.
INSERT INTO public.meli_piloto_estacoes (base_id, base_codigo, estacao_externa, confirmada, ativa_no_piloto, confirmada_em, observacao)
SELECT b.id, b.codigo, v.est, v.conf, v.conf, CASE WHEN v.conf THEN now() END, v.obs
FROM (VALUES
  ('ESP15','SSP20', true,  'Estação usada pelo worker; validar na primeira coleta.'),
  ('ESP16','SSP15', true,  'Estação usada pelo worker; validar na primeira coleta.'),
  ('ESP17','SSP56', true,  'Estação usada pelo worker; validar na primeira coleta.'),
  ('ESP18', NULL,   false, 'Aguardando confirmação da estação com rota real no AdminML. Base interna: Franco da Rocha.')
) AS v(cod, est, conf, obs)
JOIN public.bases b ON b.codigo = v.cod
ON CONFLICT (base_id) DO NOTHING;

-- Ingestão passa a exigir estação confirmada e ativa para a base
CREATE OR REPLACE FUNCTION public.meli_piloto_validar_estacao(_base uuid, _estacao text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $f$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.meli_piloto_estacoes e
                 WHERE e.base_id = _base AND e.ativa_no_piloto AND e.confirmada AND e.estacao_externa = upper(_estacao)) THEN
    RAISE EXCEPTION 'Estação % não confirmada/ativa para esta base no piloto', _estacao;
  END IF;
END $f$;
REVOKE ALL ON FUNCTION public.meli_piloto_validar_estacao(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meli_piloto_validar_estacao(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.meli_piloto_ingerir_lote(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $f$
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
  IF v_cod NOT IN ('ESP15','ESP16','ESP17','ESP18') THEN RAISE EXCEPTION 'Base fora do piloto: %', v_cod; END IF;
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
  WHERE t.base_id = EXCLUDED.base_id;
  GET DIAGNOSTICS v_pacotes = ROW_COUNT;

  INSERT INTO public.meli_piloto_erros (ciclo_id, base_id, etapa, codigo, mensagem, detalhe)
  SELECT v_ciclo, v_base, coalesce(e->>'etapa','desconhecida'), e->>'codigo', left(coalesce(e->>'mensagem','(sem mensagem)'), 2000), e->'detalhe'
  FROM jsonb_array_elements(coalesce(p->'erros','[]'::jsonb)) e;

  UPDATE public.meli_piloto_ciclos SET
    paginas_lidas = (SELECT count(*) FROM public.meli_piloto_paginas WHERE ciclo_id = v_ciclo AND recurso = 'rotas' AND status = 'ok'),
    rotas_recebidas = (SELECT count(*) FROM public.meli_piloto_rotas WHERE ultimo_ciclo_id = v_ciclo),
    pacotes_recebidos = (SELECT count(*) FROM public.meli_piloto_pacotes WHERE ultimo_ciclo_id = v_ciclo)
  WHERE id = v_ciclo;

  RETURN jsonb_build_object('ciclo_id', v_ciclo, 'rotas', v_rotas, 'pacotes', v_pacotes, 'staging_novos', v_staging);
END $f$;
REVOKE ALL ON FUNCTION public.meli_piloto_ingerir_lote(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meli_piloto_ingerir_lote(jsonb) TO service_role;

COMMIT;