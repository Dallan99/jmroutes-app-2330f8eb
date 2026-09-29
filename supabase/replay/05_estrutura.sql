-- Replay da estrutura do JMRoutes (homologacao) — lote 5 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260814151822_6ff2731c-3c36-49a9-9277-9a0d1baceb41.sql ====
-- Sincronização Meli — staging isolado + promoção atômica por base/dia.
CREATE TABLE IF NOT EXISTS public.meli_sync_ciclos (
  sync_batch_id uuid PRIMARY KEY,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  origem text NOT NULL DEFAULT 'worker',
  estado text NOT NULL DEFAULT 'em_processamento',
  rotas_esperadas integer,
  rotas_recebidas integer NOT NULL DEFAULT 0,
  pacotes_recebidos integer NOT NULL DEFAULT 0,
  ativo boolean NOT NULL DEFAULT false,
  mensagem text,
  iniciado_por uuid,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_sync_ciclos_estado_chk
    CHECK (estado IN ('em_processamento','concluido','parcial','erro','abandonado'))
);

CREATE UNIQUE INDEX IF NOT EXISTS meli_sync_ciclos_ativo_uniq
  ON public.meli_sync_ciclos (base_id, data_operacional) WHERE ativo;
CREATE INDEX IF NOT EXISTS meli_sync_ciclos_base_data_idx
  ON public.meli_sync_ciclos (base_id, data_operacional, estado);

GRANT SELECT ON public.meli_sync_ciclos TO authenticated;
GRANT ALL ON public.meli_sync_ciclos TO service_role;
REVOKE ALL ON public.meli_sync_ciclos FROM anon;
REVOKE ALL ON public.meli_sync_ciclos FROM PUBLIC;
ALTER TABLE public.meli_sync_ciclos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "meli_sync_ciclos_select" ON public.meli_sync_ciclos;
CREATE POLICY "meli_sync_ciclos_select" ON public.meli_sync_ciclos
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), base_id));

CREATE TABLE IF NOT EXISTS public.meli_sync_rotas_staging (
  sync_batch_id uuid NOT NULL
    REFERENCES public.meli_sync_ciclos(sync_batch_id) ON DELETE CASCADE,
  route_id text NOT NULL,
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_rota date,
  payload_normalizado jsonb NOT NULL,
  total_pacotes integer NOT NULL DEFAULT 0,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, route_id)
);

CREATE TABLE IF NOT EXISTS public.meli_sync_pacotes_staging (
  sync_batch_id uuid NOT NULL,
  route_id text NOT NULL,
  tracking_id text NOT NULL,
  ordem integer,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sync_batch_id, tracking_id),
  FOREIGN KEY (sync_batch_id, route_id)
    REFERENCES public.meli_sync_rotas_staging (sync_batch_id, route_id) ON DELETE CASCADE
);

-- Staging é estritamente service_role: sem SELECT para authenticated/anon/PUBLIC.
GRANT ALL ON public.meli_sync_rotas_staging TO service_role;
GRANT ALL ON public.meli_sync_pacotes_staging TO service_role;
REVOKE ALL ON public.meli_sync_rotas_staging FROM authenticated;
REVOKE ALL ON public.meli_sync_pacotes_staging FROM authenticated;
REVOKE ALL ON public.meli_sync_rotas_staging FROM anon;
REVOKE ALL ON public.meli_sync_pacotes_staging FROM anon;
REVOKE ALL ON public.meli_sync_rotas_staging FROM PUBLIC;
REVOKE ALL ON public.meli_sync_pacotes_staging FROM PUBLIC;

ALTER TABLE public.meli_sync_rotas_staging ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_sync_pacotes_staging ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.meli_rotas ADD COLUMN IF NOT EXISTS sync_batch_id uuid;
CREATE INDEX IF NOT EXISTS meli_rotas_sync_batch_idx ON public.meli_rotas (sync_batch_id);

DROP VIEW IF EXISTS public.meli_rotas_ativas;
CREATE VIEW public.meli_rotas_ativas WITH (security_invoker = true) AS
SELECT r.*
  FROM public.meli_rotas r
  LEFT JOIN public.meli_sync_ciclos c
    ON c.ativo
   AND c.estado = 'concluido'
   AND c.base_id = r.base_id
   AND c.data_operacional = r.data_rota
 WHERE (c.sync_batch_id IS NOT NULL AND r.sync_batch_id = c.sync_batch_id)
    OR (c.sync_batch_id IS NULL AND r.sync_batch_id IS NULL);

GRANT SELECT ON public.meli_rotas_ativas TO authenticated;
GRANT SELECT ON public.meli_rotas_ativas TO service_role;
REVOKE ALL ON public.meli_rotas_ativas FROM anon;
REVOKE ALL ON public.meli_rotas_ativas FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_iniciar(
  p_sync_batch_id uuid,
  p_base_codigo text,
  p_data_operacional date DEFAULT NULL,
  p_origem text DEFAULT 'worker',
  p_rotas_esperadas integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_base_id uuid;
  v_data date := coalesce(p_data_operacional, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_origem text := coalesce(nullif(btrim(p_origem), ''), 'worker');
  v_atual public.meli_sync_ciclos;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  IF p_sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','sync_batch_id_obrigatorio');
  END IF;

  SELECT id INTO v_base_id FROM public.bases WHERE upper(codigo) = upper(btrim(p_base_codigo));
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_encontrada');
  END IF;
  IF NOT public.has_base_access(v_uid, v_base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;

  SELECT * INTO v_atual FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_atual.sync_batch_id IS NOT NULL THEN
    IF v_atual.base_id <> v_base_id
       OR v_atual.data_operacional <> v_data
       OR v_atual.origem <> v_origem THEN
      RETURN jsonb_build_object('status','erro','erro','uuid_reutilizado_divergente');
    END IF;
    IF v_atual.estado <> 'em_processamento' THEN
      RETURN jsonb_build_object('status','erro','erro','ciclo_encerrado','estado',v_atual.estado);
    END IF;
    RETURN jsonb_build_object('status','ok','idempotente',true,
      'sync_batch_id',p_sync_batch_id,'base_id',v_base_id,'data_operacional',v_data);
  END IF;

  INSERT INTO public.meli_sync_ciclos (
    sync_batch_id, base_id, data_operacional, origem, estado, rotas_esperadas, iniciado_por
  ) VALUES (
    p_sync_batch_id, v_base_id, v_data, v_origem, 'em_processamento', p_rotas_esperadas, v_uid
  );

  RETURN jsonb_build_object('status','ok','idempotente',false,
    'sync_batch_id',p_sync_batch_id,'base_id',v_base_id,'data_operacional',v_data);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_rota_staging(
  p_sync_batch_id uuid,
  p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ciclo public.meli_sync_ciclos;
  v_route_id text;
  v_facility text;
  v_base_id uuid;
  v_data_rota date;
  v_pacotes jsonb;
  v_rotas int;
  v_pac int;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT * INTO v_ciclo FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_ciclo.sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','ciclo_desconhecido');
  END IF;
  IF v_ciclo.estado <> 'em_processamento' THEN
    RETURN jsonb_build_object('status','erro','erro','ciclo_nao_em_processamento','estado',v_ciclo.estado);
  END IF;
  IF NOT public.has_base_access(v_uid, v_ciclo.base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  v_facility := nullif(btrim(coalesce(
    p_payload->>'facility', p_payload->>'serviceCenterId',
    p_payload->>'service_center_id', p_payload->>'service_center')), '');
  IF v_facility IS NOT NULL THEN
    SELECT id INTO v_base_id FROM public.bases WHERE meli_service_center_id = v_facility LIMIT 1;
  END IF;
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_da_rota_indeterminada');
  END IF;
  IF v_base_id <> v_ciclo.base_id THEN
    RETURN jsonb_build_object('status','erro','erro','base_da_rota_divergente');
  END IF;

  v_data_rota := nullif(btrim(coalesce(p_payload->>'data_rota', p_payload->>'route_date')), '')::date;
  IF v_data_rota IS NOT NULL AND v_data_rota <> v_ciclo.data_operacional THEN
    RETURN jsonb_build_object('status','erro','erro','data_da_rota_divergente');
  END IF;

  v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages', '[]'::jsonb);
  IF jsonb_typeof(v_pacotes) <> 'array' THEN
    RETURN jsonb_build_object('status','erro','erro','pacotes_deve_ser_array');
  END IF;

  INSERT INTO public.meli_sync_rotas_staging (
    sync_batch_id, route_id, base_id, data_rota, payload_normalizado, total_pacotes, recebido_em
  ) VALUES (
    p_sync_batch_id, v_route_id, v_base_id, coalesce(v_data_rota, v_ciclo.data_operacional),
    p_payload, jsonb_array_length(v_pacotes), now()
  )
  ON CONFLICT (sync_batch_id, route_id) DO UPDATE
    SET base_id = EXCLUDED.base_id,
        data_rota = EXCLUDED.data_rota,
        payload_normalizado = EXCLUDED.payload_normalizado,
        total_pacotes = EXCLUDED.total_pacotes,
        recebido_em = now();

  DELETE FROM public.meli_sync_pacotes_staging
   WHERE sync_batch_id = p_sync_batch_id AND route_id = v_route_id;

  INSERT INTO public.meli_sync_pacotes_staging (sync_batch_id, route_id, tracking_id, ordem)
  SELECT p_sync_batch_id, v_route_id, t.tracking_id, min(t.ordem)
    FROM (
      SELECT nullif(btrim(coalesce(x->>'tracking_id', x->>'trackingId')), '') AS tracking_id,
             public._meli_safe_int(coalesce(x->>'ordem', x->>'order')) AS ordem
        FROM jsonb_array_elements(v_pacotes) x
    ) t
   WHERE t.tracking_id IS NOT NULL
   GROUP BY t.tracking_id
  ON CONFLICT (sync_batch_id, tracking_id) DO UPDATE
    SET route_id = EXCLUDED.route_id, ordem = EXCLUDED.ordem, recebido_em = now();

  SELECT count(DISTINCT route_id)::int INTO v_rotas
    FROM public.meli_sync_rotas_staging WHERE sync_batch_id = p_sync_batch_id;
  SELECT count(DISTINCT tracking_id)::int INTO v_pac
    FROM public.meli_sync_pacotes_staging WHERE sync_batch_id = p_sync_batch_id;

  UPDATE public.meli_sync_ciclos
     SET rotas_recebidas = v_rotas, pacotes_recebidos = v_pac, updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id;

  RETURN jsonb_build_object('status','ok','route_id',v_route_id,
    'rotas_no_lote',v_rotas,'pacotes_no_lote',v_pac);
END;
$function$;

CREATE OR REPLACE FUNCTION public._meli_sync_marcar(
  p_sync_batch_id uuid, p_estado text, p_motivo text, p_mensagem text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_lote uuid;
BEGIN
  UPDATE public.meli_sync_ciclos
     SET estado = p_estado, ativo = false,
         mensagem = left(coalesce(nullif(btrim(coalesce(p_mensagem,'')),''), p_motivo), 300),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id
     AND estado = 'em_processamento';

  SELECT c.sync_batch_id INTO v_lote
    FROM public.meli_sync_ciclos c
    JOIN public.meli_sync_ciclos alvo ON alvo.sync_batch_id = p_sync_batch_id
   WHERE c.base_id = alvo.base_id AND c.data_operacional = alvo.data_operacional
     AND c.ativo AND c.estado = 'concluido';

  RETURN jsonb_build_object('status','ignorado','motivo',p_motivo,
    'estado',p_estado,'lote_ativo',v_lote);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_finalizar(
  p_sync_batch_id uuid,
  p_base_codigo text,
  p_data_operacional date DEFAULT NULL,
  p_rotas integer DEFAULT NULL,
  p_pacotes integer DEFAULT NULL,
  p_estado text DEFAULT 'concluido',
  p_mensagem text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_ciclo public.meli_sync_ciclos;
  v_base_id uuid;
  v_data date := coalesce(p_data_operacional, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_estado_worker text := coalesce(nullif(btrim(p_estado), ''), 'concluido');
  v_rotas int;
  v_pacotes int;
  r record;
  v_imp jsonb;
  v_rota_id uuid;
  v_promovidas int := 0;
BEGIN
  IF v_uid IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT id INTO v_base_id FROM public.bases WHERE upper(codigo) = upper(btrim(p_base_codigo));
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_encontrada');
  END IF;
  IF NOT public.has_base_access(v_uid, v_base_id) THEN
    RETURN jsonb_build_object('status','erro','erro','sem_acesso_a_base');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('meli_sync_' || v_base_id::text || '_' || v_data::text));

  SELECT * INTO v_ciclo FROM public.meli_sync_ciclos WHERE sync_batch_id = p_sync_batch_id;
  IF v_ciclo.sync_batch_id IS NULL THEN
    RETURN jsonb_build_object('status','ignorado','motivo','ciclo_desconhecido');
  END IF;

  IF v_ciclo.estado = 'concluido' THEN
    RETURN jsonb_build_object('status','ok','idempotente',true,
      'lote_ativo',v_ciclo.sync_batch_id,
      'rotas',v_ciclo.rotas_recebidas,'pacotes',v_ciclo.pacotes_recebidos);
  END IF;

  SELECT count(DISTINCT route_id)::int INTO v_rotas
    FROM public.meli_sync_rotas_staging WHERE sync_batch_id = p_sync_batch_id;
  SELECT count(DISTINCT tracking_id)::int INTO v_pacotes
    FROM public.meli_sync_pacotes_staging WHERE sync_batch_id = p_sync_batch_id;

  IF v_ciclo.estado <> 'em_processamento' THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, v_ciclo.estado, 'ciclo_encerrado', p_mensagem);
  END IF;
  IF v_ciclo.base_id <> v_base_id THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'erro', 'base_divergente', p_mensagem);
  END IF;
  IF v_ciclo.data_operacional <> v_data THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'erro', 'data_divergente', p_mensagem);
  END IF;
  IF v_estado_worker <> 'concluido' THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id,
      CASE WHEN v_estado_worker = 'parcial' THEN 'parcial' ELSE 'erro' END,
      'ciclo_com_erro', p_mensagem);
  END IF;
  IF v_rotas <= 0 THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'sem_rotas_no_ciclo', p_mensagem);
  END IF;
  IF p_rotas IS NOT NULL AND p_rotas <> v_rotas THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'quantidade_rotas_divergente', p_mensagem);
  END IF;
  IF p_pacotes IS NOT NULL AND p_pacotes <> v_pacotes THEN
    RETURN public._meli_sync_marcar(p_sync_batch_id, 'parcial', 'quantidade_pacotes_divergente', p_mensagem);
  END IF;

  FOR r IN
    SELECT route_id, payload_normalizado, data_rota
      FROM public.meli_sync_rotas_staging
     WHERE sync_batch_id = p_sync_batch_id
     ORDER BY route_id
  LOOP
    v_imp := public.meli_importar_rota(r.payload_normalizado, 'sync:' || p_sync_batch_id::text);
    IF coalesce(v_imp->>'status','') <> 'ok' THEN
      RAISE EXCEPTION 'falha_na_promocao_%: %', r.route_id, coalesce(v_imp->>'erro','desconhecido');
    END IF;
    v_rota_id := nullif(v_imp->>'rota_id','')::uuid;
    IF v_rota_id IS NOT NULL THEN
      UPDATE public.meli_rotas SET sync_batch_id = p_sync_batch_id WHERE id = v_rota_id;

      UPDATE public.escalas e
         SET meli_pacote_id = NULL
       WHERE e.meli_pacote_id IN (
               SELECT p.id FROM public.meli_pacotes p
                WHERE p.rota_id = v_rota_id
                  AND NOT EXISTS (
                    SELECT 1 FROM public.meli_sync_pacotes_staging s
                     WHERE s.sync_batch_id = p_sync_batch_id
                       AND s.route_id = r.route_id
                       AND s.tracking_id = p.tracking_id)
             )
         AND e.recebido = false
         AND e.triado = false;

      DELETE FROM public.meli_pacotes p
       WHERE p.rota_id = v_rota_id
         AND NOT EXISTS (
           SELECT 1 FROM public.meli_sync_pacotes_staging s
            WHERE s.sync_batch_id = p_sync_batch_id
              AND s.route_id = r.route_id
              AND s.tracking_id = p.tracking_id)
         AND NOT EXISTS (
           SELECT 1 FROM public.escalas e WHERE e.meli_pacote_id = p.id);

      PERFORM public.meli_publicar_rota_operacional(v_rota_id, r.data_rota);
    END IF;
    v_promovidas := v_promovidas + 1;
  END LOOP;

  UPDATE public.meli_sync_ciclos
     SET ativo = false, updated_at = now()
   WHERE base_id = v_base_id AND data_operacional = v_data AND ativo
     AND sync_batch_id <> p_sync_batch_id;

  UPDATE public.meli_sync_ciclos
     SET estado = 'concluido', ativo = true, rotas_recebidas = v_rotas,
         pacotes_recebidos = v_pacotes, mensagem = nullif(btrim(coalesce(p_mensagem,'')),''),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id;

  RETURN jsonb_build_object('status','ok','idempotente',false,
    'lote_ativo',p_sync_batch_id,'rotas',v_rotas,'pacotes',v_pacotes,
    'rotas_promovidas',v_promovidas);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_ciclo_abandonar(p_sync_batch_id uuid, p_mensagem text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  UPDATE public.meli_sync_ciclos
     SET estado = 'abandonado', ativo = false,
         mensagem = left(coalesce(p_mensagem,'abandonado'),300),
         finalizado_em = now(), updated_at = now()
   WHERE sync_batch_id = p_sync_batch_id AND estado = 'em_processamento';
  RETURN jsonb_build_object('status','ok','sync_batch_id',p_sync_batch_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_staging_limpar(p_dias integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_dias int := GREATEST(coalesce(p_dias,3),1); v_rem int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  WITH alvo AS (
    SELECT sync_batch_id FROM public.meli_sync_ciclos
     WHERE estado <> 'concluido' AND iniciado_em < now() - make_interval(days => v_dias)
  ), del AS (
    DELETE FROM public.meli_sync_rotas_staging s
     USING alvo a WHERE a.sync_batch_id = s.sync_batch_id
     RETURNING 1
  )
  SELECT count(*)::int INTO v_rem FROM del;
  RETURN jsonb_build_object('status','ok','rotas_staging_removidas',v_rem);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_lotes_status(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', b.id,
           'base_codigo', b.codigo,
           'data_operacional', v_data,
           'lote_ativo', a.sync_batch_id,
           'lote_ativo_em', a.finalizado_em,
           'rotas_publicadas', coalesce(a.rotas_recebidas, 0),
           'pacotes_publicados', coalesce(a.pacotes_recebidos, 0),
           'sincronizando', p.sync_batch_id IS NOT NULL,
           'sincronizando_desde', p.iniciado_em,
           'rotas_em_construcao', coalesce(p.rotas_recebidas, 0),
           'ultimo_estado', coalesce(u.estado, a.estado)
         ) ORDER BY b.codigo), '[]'::jsonb)
    INTO v_out
  FROM public.bases b
  LEFT JOIN public.meli_sync_ciclos a
    ON a.base_id = b.id AND a.data_operacional = v_data AND a.ativo AND a.estado = 'concluido'
  LEFT JOIN LATERAL (
    SELECT c.* FROM public.meli_sync_ciclos c
     WHERE c.base_id = b.id AND c.data_operacional = v_data AND c.estado = 'em_processamento'
     ORDER BY c.iniciado_em DESC LIMIT 1
  ) p ON true
  LEFT JOIN LATERAL (
    SELECT c.estado FROM public.meli_sync_ciclos c
     WHERE c.base_id = b.id AND c.data_operacional = v_data
     ORDER BY c.iniciado_em DESC LIMIT 1
  ) u ON true
  WHERE b.ativa AND (public.has_role(v_uid,'admin') OR public.has_base_access(v_uid, b.id));

  RETURN jsonb_build_object('status','ok','server_time',now(),
    'data_operacional',v_data,'bases',v_out);
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_sync_ciclo_iniciar(uuid,text,date,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_rota_staging(uuid,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_ciclo_finalizar(uuid,text,date,integer,integer,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._meli_sync_marcar(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meli_sync_ciclo_abandonar(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_staging_limpar(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_lotes_status(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_iniciar(uuid,text,date,text,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_rota_staging(uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_finalizar(uuid,text,date,integer,integer,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._meli_sync_marcar(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_ciclo_abandonar(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_staging_limpar(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_lotes_status(date) TO authenticated, service_role;
-- ==== fim 20260814151822_6ff2731c-3c36-49a9-9277-9a0d1baceb41.sql ====

-- ==== inicio 20260814152906_eba18983-b1f1-4298-8d2b-ee351e75a8c8.sql ====
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
    FROM public.meli_rotas_ativas r
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
    FROM public.meli_rotas_ativas r CROSS JOIN dia
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

CREATE OR REPLACE FUNCTION public.meli_dashboard_pacotes_rota(p_rota_id uuid, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit,500),1),2000);
  v_rows jsonb := '[]'::jsonb;
  v_rota jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT jsonb_build_object(
           'id', r.id, 'route_id', r.route_id, 'cluster', r.cluster,
           'nome_operacional', coalesce(nullif(btrim(r.cluster),''), r.route_id),
           'base_codigo', b.codigo, 'base_nome', b.nome,
           'driver_name', r.driver_name, 'vehicle_license', r.vehicle_license,
           'data_rota', r.data_rota, 'last_synced_at', r.last_synced_at,
           'rota_area_risco', r.rota_area_risco, 'area_risco_parcial', r.area_risco_parcial,
           'motivo_area_risco', r.motivo_area_risco, 'origem_area_risco', r.origem_area_risco,
           'dia_anterior', r.data_rota < (now() AT TIME ZONE 'America/Sao_Paulo')::date)
    INTO v_rota
    FROM public.meli_rotas_ativas r LEFT JOIN public.bases b ON b.id = r.base_id
   WHERE r.id = p_rota_id;

  IF v_rota IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.ordem NULLS LAST, x.tracking_id), '[]'::jsonb)
    INTO v_rows
  FROM (
    SELECT p.tracking_id, p.shipment_id, p.stop_id, p.ordem,
           p.status, p.substatus, p.occurrence_code,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao,
           coalesce(c.descricao, p.occurrence_code, p.substatus, p.status) AS descricao_ocorrencia,
           p.pacote_area_risco, p.motivo_area_risco, p.origem_area_risco,
           coalesce(p.last_synced_at, p.updated_at) AS ultima_atualizacao_meli,
           e.recebido AS jm_recebido, e.recebido_em AS jm_recebido_em,
           e.triado AS jm_triado, e.triado_em AS jm_triado_em
      FROM public.meli_pacotes p
      LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = p.occurrence_code
      LEFT JOIN public.escalas e ON e.meli_pacote_id = p.id
     WHERE p.rota_id = p_rota_id
     LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('status','ok','rota',v_rota,'pacotes',v_rows);
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_detalhar_rota(p_rota_id uuid, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 100), 1), 500);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_rota jsonb;
  v_imp jsonb;
  v_total bigint := 0;
  v_pacotes jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT to_jsonb(r) INTO v_rota FROM public.meli_rotas_ativas r WHERE r.id = p_rota_id;
  IF v_rota IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  SELECT to_jsonb(i) INTO v_imp
  FROM public.meli_importacoes i
  WHERE i.id = (v_rota->>'origem_importacao')::uuid;

  WITH pag AS (
    SELECT p.id, p.rota_id, p.tracking_id, p.shipment_id, p.destinatario,
           p.endereco, p.bairro, p.cidade, p.uf, p.cep, p.status,
           p.printed_label, p.ordem, p.created_at, p.updated_at,
           count(*) OVER() AS total_full
    FROM public.meli_pacotes p
    WHERE p.rota_id = p_rota_id
    ORDER BY p.ordem NULLS LAST, p.tracking_id
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(pag) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_pacotes
  FROM pag;

  RETURN jsonb_build_object(
    'status','ok',
    'rota', v_rota,
    'importacao', v_imp,
    'pacotes', v_pacotes,
    'total_pacotes', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_listar_rotas(p_cluster text DEFAULT NULL::text, p_data_de date DEFAULT NULL::date, p_data_ate date DEFAULT NULL::date, p_busca text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit int := LEAST(GREATEST(coalesce(p_limit, 50), 1), 200);
  v_offset int := GREATEST(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  WITH filtered AS (
    SELECT r.id, r.route_id, r.cluster, r.carrier, r.facility, r.data_rota,
           r.total_pacotes, r.total_impressos, r.origem_importacao,
           r.created_at, r.updated_at,
           i.iniciado_em AS ultima_importacao_em,
           count(*) OVER() AS total_full
    FROM public.meli_rotas_ativas r
    LEFT JOIN public.meli_importacoes i ON i.id = r.origem_importacao
    WHERE (p_cluster IS NULL OR r.cluster = p_cluster)
      AND (p_data_de IS NULL OR r.data_rota >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_rota <= p_data_ate)
      AND (
        p_busca IS NULL
        OR r.route_id ILIKE '%'||p_busca||'%'
        OR coalesce(r.facility,'') ILIKE '%'||p_busca||'%'
      )
    ORDER BY r.data_rota DESC NULLS LAST, r.created_at DESC
    LIMIT v_limit OFFSET v_offset
  )
  SELECT coalesce(max(total_full), 0),
         coalesce(jsonb_agg(to_jsonb(filtered) - 'total_full'), '[]'::jsonb)
    INTO v_total, v_rows
  FROM filtered;

  RETURN jsonb_build_object(
    'status','ok',
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'rotas', v_rows
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.meli_sync_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_latest timestamptz;
  v_imp    jsonb;
  v_erros  bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT max(last_synced_at) INTO v_latest FROM public.meli_rotas_ativas;

  SELECT to_jsonb(i) INTO v_imp
  FROM public.meli_importacoes i
  ORDER BY i.iniciado_em DESC
  LIMIT 1;

  SELECT count(*) INTO v_erros
  FROM public.meli_importacoes
  WHERE status = 'erro'
    AND iniciado_em >= now() - interval '24 hours';

  RETURN jsonb_build_object(
    'status',            'ok',
    'latest_synced_at',  v_latest,
    'server_time',       now(),
    'running',           null,
    'next_sync_at',      null,
    'last_result',       CASE WHEN v_imp IS NULL THEN null
                              ELSE v_imp->>'status' END,
    'ultima_importacao', v_imp,
    'erros_24h',         v_erros,
    'fonte_running',     'indisponivel_no_backend',
    'observacao',        'running/next_sync_at requerem heartbeat da extensão ou fila server-side; ainda não implementados.'
  );
END;
$function$;

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
    FROM public.meli_rotas_ativas r
    WHERE r.base_id IS NOT NULL
    GROUP BY r.base_id
  ),
  cnt AS (
    SELECT r.base_id,
           count(*)::int AS rotas,
           coalesce(sum(r.total_pacotes),0)::int AS pacotes
    FROM public.meli_rotas_ativas r
    JOIN ult u ON u.base_id = r.base_id AND r.data_rota = u.data_rota
    GROUP BY r.base_id
  ),
  exec AS (
    SELECT DISTINCT ON (e.base_id)
           e.base_id, e.status, e.sessao_status, e.mensagem_segura,
           e.iniciado_em, e.finalizado_em, e.rotas_encontradas, e.pacotes_enviados, e.erros
    FROM public.meli_worker_execucoes e
    ORDER BY e.base_id, e.iniciado_em DESC
  ),
  ciclo AS (
    SELECT c.base_id, bool_or(c.estado = 'em_processamento') AS sincronizando
    FROM public.meli_sync_ciclos c
    WHERE c.data_operacional >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 1
    GROUP BY c.base_id
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
             'data_rota',          u.data_rota,
             'sincronizando',      coalesce(s.sincronizando, false)
           ) ORDER BY b.codigo
         )
    INTO v_out
  FROM b
  LEFT JOIN ult  u ON u.base_id = b.id
  LEFT JOIN cnt  c ON c.base_id = b.id
  LEFT JOIN exec x ON x.base_id = b.id
  LEFT JOIN ciclo s ON s.base_id = b.id;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_time', now(),
    'bases', coalesce(v_out, '[]'::jsonb)
  );
END;
$function$;

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
      FROM public.meli_rotas_ativas r
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

CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(p_data_de date DEFAULT NULL::date, p_data_ate date DEFAULT NULL::date, p_base_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      JOIN public.meli_rotas_ativas ro ON ro.id = p.rota_id
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
$function$;

CREATE OR REPLACE FUNCTION public.devolucao_lote_bipar(p_lote_id uuid, p_codigo text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  SELECT d.id, d.devolvido_em, d.lote_id INTO v_existente
    FROM public.devolucoes d
   WHERE upper(d.shipment_codigo) = v_cod AND d.base_id = v_lote.base_id AND d.cancelado = false
   ORDER BY d.devolvido_em DESC LIMIT 1;
  IF v_existente.id IS NOT NULL THEN
    RETURN jsonb_build_object('status','duplicado','mensagem','Pacote ' || v_cod || ' já recebido nesta base.',
                              'devolvido_em', v_existente.devolvido_em);
  END IF;

  SELECT p.occurrence_code, p.status, p.substatus, r.base_id AS rota_base_id,
         r.route_id, r.driver_name
    INTO v_pac
    FROM public.meli_pacotes p
    JOIN public.meli_rotas_ativas r ON r.id = p.rota_id
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
$function$;

REVOKE ALL ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_sync_status_bases() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_rotas_area_risco(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(date,date,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.devolucao_lote_bipar(uuid,text,text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_detalhar_rota(uuid,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_listar_rotas(text,date,date,text,integer,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_sync_status_bases() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_rotas_area_risco(date,uuid,text,text,text,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.devolucao_lote_bipar(uuid,text,text) TO authenticated, service_role;
-- ==== fim 20260814152906_eba18983-b1f1-4298-8d2b-ee351e75a8c8.sql ====

-- ==== inicio 20260814174249_a909a3c7-9c46-4c79-af53-0d3d708a7237.sql ====
-- Migração: Recebimento Automático em Devoluções
-- Adiciona a coluna recebimento_id e a função de geração de sequência.

ALTER TABLE public.meli_devolucoes ADD COLUMN IF NOT EXISTS recebimento_id text;
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_recebimento_id ON public.meli_devolucoes(recebimento_id);

-- Função para gerar o próximo ID de recebimento (ex: REC20260814001)
CREATE OR REPLACE FUNCTION public.gerar_sequencia_recebimento(p_base_id uuid, p_data date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_count int;
  v_rec_id text;
BEGIN
  v_prefix := 'REC' || to_char(p_data, 'YYYYMMDD');
  
  -- Conta quantos IDs de recebimento diferentes já foram gerados nesta base e dia
  SELECT count(DISTINCT recebimento_id) INTO v_count
  FROM public.meli_devolucoes
  WHERE base_id = p_base_id
    AND (recebido_em AT TIME ZONE 'America/Sao_Paulo')::date = p_data
    AND recebimento_id LIKE v_prefix || '%';

  v_rec_id := v_prefix || lpad((v_count + 1)::text, 3, '0');
  RETURN v_rec_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_sequencia_recebimento(uuid, date) TO authenticated, service_role;

-- Atualiza a RPC de recebimento para aceitar o p_recebimento_id
CREATE OR REPLACE FUNCTION public.meli_devolucao_receber(
  p_tracking text,
  p_base_id uuid,
  p_metodo text DEFAULT 'scanner',
  p_observacao text DEFAULT NULL,
  p_recebimento_id text DEFAULT NULL
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
      'mensagem', 'Nenhuma devolução pendente para este rastreio.');
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
      'mensagem', 'Pacote consta como entregue. Observação do operador é obrigatória.');
  END IF;

  v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

  UPDATE public.meli_devolucoes
     SET estado = v_estado_novo,
         recebido_em = now(),
         recebido_por = v_uid,
         recebido_base_id = p_base_id,
         recebimento_id = p_recebimento_id,
         metodo_confirmacao = coalesce(nullif(btrim(p_metodo), ''), 'scanner'),
         observacao_recebimento = nullif(btrim(coalesce(p_observacao, '')), ''),
         divergencia_delivered = v_delivered
   WHERE id = v_d.id;

  INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
  VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'recebimento_fisico', v_d.estado, v_estado_novo,
          jsonb_build_object('metodo', p_metodo, 'recebimento_id', p_recebimento_id, 'observacao', nullif(btrim(coalesce(p_observacao, '')), ''),
                             'situacao_meli', v_d.situacao_meli), v_uid);

  RETURN jsonb_build_object('status', 'ok', 'codigo', v_estado_novo,
    'divergencia_delivered', v_delivered,
    'no_prazo', now() <= v_d.prazo_retorno_em,
    'mensagem', CASE WHEN v_delivered
      THEN 'ALERTA CRÍTICO: pacote recebido fisicamente, porém consta ENTREGUE. Encaminhe para prevenção de perdas.'
      ELSE 'Retorno registrado na base.' END,
    'devolucao', (SELECT to_jsonb(d) FROM public.meli_devolucoes d WHERE d.id = v_d.id));
END;
$$;

GRANT EXECUTE ON FUNCTION public.meli_devolucao_receber(text, uuid, text, text, text) TO authenticated, service_role;
-- ==== fim 20260814174249_a909a3c7-9c46-4c79-af53-0d3d708a7237.sql ====

-- ==== inicio 20260814230736_romaneio_devolucao_meli_v3.sql ====
-- 1. Tipos e Tabelas
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meli_romaneio_status') THEN
        CREATE TYPE public.meli_romaneio_status AS ENUM ('em_andamento', 'concluido', 'cancelado');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.meli_devolucao_romaneios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE NOT NULL,
    base_id UUID NOT NULL REFERENCES public.bases(id),
    data_operacional DATE NOT NULL,
    sequencial INTEGER NOT NULL CHECK (sequencial > 0),
    status public.meli_romaneio_status NOT NULL DEFAULT 'em_andamento',
    route_id TEXT,
    motorista TEXT,
    observacao_inicial TEXT,
    aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    aberto_por UUID NOT NULL REFERENCES auth.users(id),
    concluido_em TIMESTAMPTZ,
    concluido_por UUID REFERENCES auth.users(id),
    cancelado_em TIMESTAMPTZ,
    cancelado_por UUID REFERENCES auth.users(id),
    justificativa_cancelamento TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meli_romaneio_sequencial_unico UNIQUE (base_id, data_operacional, sequencial),
    CONSTRAINT meli_romaneio_formato_codigo CHECK (codigo ~ '^EXP-REC-\d{8}-[A-Z0-9]+-\d{3}$'),
    CONSTRAINT meli_romaneio_coerencia_status CHECK (
        (status = 'em_andamento' AND concluido_em IS NULL AND concluido_por IS NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'concluido' AND concluido_em IS NOT NULL AND concluido_por IS NOT NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'cancelado' AND cancelado_em IS NOT NULL AND cancelado_por IS NOT NULL AND justificativa_cancelamento IS NOT NULL AND concluido_em IS NULL AND concluido_por IS NULL)
    )
);

ALTER TABLE public.meli_devolucoes 
ADD COLUMN IF NOT EXISTS romaneio_id UUID REFERENCES public.meli_devolucao_romaneios(id);

-- Índices
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_base_data_status ON public.meli_devolucao_romaneios(base_id, data_operacional, status);
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_codigo ON public.meli_devolucao_romaneios(codigo);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_romaneio_id ON public.meli_devolucoes(romaneio_id);

-- Trigger updated_at
CREATE TRIGGER trg_meli_devolucao_romaneios_updated_at
    BEFORE UPDATE ON public.meli_devolucao_romaneios
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 2. Segurança e RLS
ALTER TABLE public.meli_devolucao_romaneios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meli_devolucao_romaneios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meli_devolucao_romaneios TO authenticated;
GRANT ALL ON public.meli_devolucao_romaneios TO service_role;

CREATE POLICY "Romaneios visiveis por base ou admin" 
ON public.meli_devolucao_romaneios
FOR SELECT 
TO authenticated
USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR 
    public.has_base_access(auth.uid(), base_id)
);

-- 3. Função Interna de Recebimento (Encapsulada)
CREATE OR REPLACE FUNCTION public.internal_meli_devolucao_processar_bip(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT,
    p_usuario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r public.meli_devolucao_romaneios;
    v_d public.meli_devolucoes;
    v_delivered BOOLEAN;
    v_estado_novo TEXT;
BEGIN
    -- Lock no romaneio
    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_invalido', 'mensagem', 'Romaneio não encontrado.');
    END IF;

    IF v_r.status <> 'em_andamento' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_fechado', 'mensagem', 'Este romaneio não permite novas bipagens.');
    END IF;

    IF v_r.base_id <> p_base_id THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_invalida', 'mensagem', 'Base informada não coincide com a base do romaneio.');
    END IF;

    -- Lock no pacote
    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;

    IF v_d.id IS NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (upper(btrim(p_tracking_id)), p_base_id, 'pacote_desconhecido', jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrado', 'mensagem', 'Pacote não encontrado nos registros do Meli.');
    END IF;

    IF v_d.base_id <> p_base_id THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'base_divergente', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'base_lida', p_base_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente', 'mensagem', 'Este pacote pertence a outra base.');
    END IF;

    IF v_d.romaneio_id IS NOT NULL OR v_d.recebido_em IS NOT NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'bipagem_duplicada', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'romaneio_original', v_d.romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado', 'mensagem', 'Este pacote já foi recebido.');
    END IF;

    v_delivered := lower(coalesce(v_d.situacao_meli, '')) IN ('entregue', 'delivered');

    IF v_delivered AND coalesce(btrim(p_observacao), '') = '' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria', 'mensagem', 'Pacote consta como entregue. Observação obrigatória.');
    END IF;

    v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

    UPDATE public.meli_devolucoes
    SET romaneio_id = p_romaneio_id,
        estado = v_estado_novo,
        recebido_em = now(),
        recebido_por = p_usuario_id,
        recebido_base_id = p_base_id,
        metodo_confirmacao = 'scanner',
        divergencia_delivered = v_delivered,
        observacao_recebimento = nullif(btrim(p_observacao), '')
    WHERE id = v_d.id;

    INSERT INTO public.meli_devolucoes_eventos (
        devolucao_id, tracking_id, base_id, tipo, 
        estado_anterior, estado_novo, detalhes, registrado_por
    )
    VALUES (
        v_d.id, v_d.tracking_id, v_d.base_id, 
        CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'bipagem_ok' END,
        v_d.estado, v_estado_novo, jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id
    );

    RETURN jsonb_build_object('status', 'ok', 'tracking_id', v_d.tracking_id, 'divergencia_delivered', v_delivered);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_meli_devolucao_processar_bip FROM PUBLIC, anon, authenticated;

-- 4. RPCs Externas
CREATE OR REPLACE FUNCTION public.meli_romaneio_abrir_com_primeiro_pacote(
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_hoje DATE := timezone('America/Sao_Paulo', now())::date;
    v_base_codigo TEXT;
    v_sequencial INT;
    v_romaneio_id UUID;
    v_romaneio_codigo TEXT;
    v_d RECORD;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    -- Lock por base e data
    PERFORM pg_advisory_xact_lock(hashtext('meli_romaneio_seq_' || p_base_id::text || '_' || v_hoje::text));

    SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
    IF v_base_codigo IS NULL OR v_base_codigo = '' THEN RAISE EXCEPTION 'Código da base não encontrado'; END IF;

    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;
    IF v_d.id IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;

    SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_sequencial
    FROM public.meli_devolucao_romaneios
    WHERE base_id = p_base_id AND data_operacional = v_hoje;

    v_romaneio_codigo := 'EXP-REC-' || to_char(v_hoje, 'YYYYMMDD') || '-' || v_base_codigo || '-' || LPAD(v_sequencial::TEXT, 3, '0');

    INSERT INTO public.meli_devolucao_romaneios (
        codigo, base_id, data_operacional, sequencial, 
        route_id, motorista, aberto_por
    )
    VALUES (
        v_romaneio_codigo, p_base_id, v_hoje, v_sequencial,
        v_d.route_id, v_d.motorista, v_uid
    )
    RETURNING id INTO v_romaneio_id;

    v_res := public.internal_meli_devolucao_processar_bip(v_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
    
    IF v_res->>'status' = 'erro' THEN
        RAISE EXCEPTION '%', v_res->>'mensagem';
    END IF;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (p_base_id, 'romaneio_aberto', jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo', v_romaneio_codigo), v_uid);

    RETURN v_res || jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo_romaneio', v_romaneio_codigo);
END;
$$;

-- Aplicação de Permissões nas RPCs
DO $$ 
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_abrir_com_primeiro_pacote']; -- Adicionar outras conforme implementadas
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;

-- Continuação das RPCs Externas

CREATE OR REPLACE FUNCTION public.meli_romaneio_bipar(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    RETURN public.internal_meli_devolucao_processar_bip(p_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_finalizar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT public.has_base_access(v_uid, v_r.base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    IF v_r.status = 'concluido' THEN
        RETURN jsonb_build_object('status', 'ok', 'mensagem', 'Romaneio já estava concluído.');
    END IF;

    IF v_r.status = 'cancelado' THEN RAISE EXCEPTION 'Não é possível finalizar um romaneio cancelado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'concluido',
        concluido_em = now(),
        concluido_por = v_uid
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_finalizado', jsonb_build_object('romaneio_id', p_romaneio_id), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_cancelar(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'gerente')) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem cancelar romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'cancelado',
        cancelado_em = now(),
        cancelado_por = v_uid,
        justificativa_cancelamento = p_justificativa
    WHERE id = p_romaneio_id;

    -- Opcional: desvincular pacotes ou mantê-los vinculados ao romaneio cancelado?
    -- Decisão: Mantemos o vínculo para auditoria, mas o estado do pacote permanece 'recebido' 
    -- a menos que explicitamente revertido.

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_cancelado', jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

-- Permissões Adicionais
DO $$ 
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_bipar', 'meli_romaneio_finalizar', 'meli_romaneio_cancelar'];
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.meli_romaneios_listar(
    p_base_id UUID DEFAULT NULL,
    p_data_de DATE DEFAULT NULL,
    p_data_ate DATE DEFAULT NULL,
    p_status public.meli_romaneio_status DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    codigo TEXT,
    base_id UUID,
    base_codigo TEXT,
    data_operacional DATE,
    sequencial INTEGER,
    status public.meli_romaneio_status,
    route_id TEXT,
    motorista TEXT,
    aberto_em TIMESTAMPTZ,
    aberto_por_nome TEXT,
    total_pacotes BIGINT,
    concluido_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.codigo,
        r.base_id,
        b.codigo as base_codigo,
        r.data_operacional,
        r.sequencial,
        r.status,
        r.route_id,
        r.motorista,
        r.aberto_em,
        p.nome as aberto_por_nome,
        (SELECT count(*) FROM public.meli_devolucoes d WHERE d.romaneio_id = r.id) as total_pacotes,
        r.concluido_em
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    WHERE (p_base_id IS NULL OR r.base_id = p_base_id)
      AND (p_data_de IS NULL OR r.data_operacional >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_operacional <= p_data_ate)
      AND (p_status IS NULL OR r.status = p_status)
      AND (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), r.base_id))
    ORDER BY r.aberto_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_detalhar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r RECORD;
    v_pacotes JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT 
        r.*, 
        b.codigo as base_codigo, 
        p.nome as aberto_por_nome,
        pc.nome as concluido_por_nome
    INTO v_r
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    LEFT JOIN public.profiles pc ON pc.id = r.concluido_por
    WHERE r.id = p_romaneio_id;

    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), v_r.base_id)) THEN
        RAISE EXCEPTION 'Sem acesso a este romaneio';
    END IF;

    SELECT jsonb_agg(t) INTO v_pacotes
    FROM (
        SELECT 
            d.tracking_id, d.estado, d.recebido_em, d.divergencia_delivered, d.observacao_recebimento,
            d.meli_status, d.meli_substatus, d.occurrence_code
        FROM public.meli_devolucoes d
        WHERE d.romaneio_id = p_romaneio_id
        ORDER BY d.recebido_em DESC
    ) t;

    RETURN to_jsonb(v_r) || jsonb_build_object('pacotes', coalesce(v_pacotes, '[]'::jsonb));
END;
$$;

-- Permissões
REVOKE ALL ON FUNCTION public.meli_romaneios_listar FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_romaneios_listar TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.meli_romaneio_detalhar FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_romaneio_detalhar TO authenticated, service_role;
-- ==== fim 20260814230736_romaneio_devolucao_meli_v3.sql ====
