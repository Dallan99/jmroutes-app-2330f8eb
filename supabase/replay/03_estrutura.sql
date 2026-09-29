-- Replay da estrutura do JMRoutes (homologacao) — lote 3 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260723134421_3c516c3c-e85d-4ad9-b86c-9de6dbed9ce3.sql ====

-- =========================================================
-- FKs (idempotentes)
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_pacotes_rota_id_fkey') THEN
    ALTER TABLE public.meli_pacotes
      ADD CONSTRAINT meli_pacotes_rota_id_fkey
      FOREIGN KEY (rota_id) REFERENCES public.meli_rotas(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_rotas_payload_rota_id_fkey') THEN
    ALTER TABLE public.meli_rotas_payload
      ADD CONSTRAINT meli_rotas_payload_rota_id_fkey
      FOREIGN KEY (rota_id) REFERENCES public.meli_rotas(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_rotas_origem_importacao_fkey') THEN
    ALTER TABLE public.meli_rotas
      ADD CONSTRAINT meli_rotas_origem_importacao_fkey
      FOREIGN KEY (origem_importacao) REFERENCES public.meli_importacoes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='meli_importacoes_importado_por_fkey') THEN
    ALTER TABLE public.meli_importacoes
      ADD CONSTRAINT meli_importacoes_importado_por_fkey
      FOREIGN KEY (importado_por) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =========================================================
-- Triggers updated_at
-- =========================================================
DROP TRIGGER IF EXISTS trg_meli_rotas_updated ON public.meli_rotas;
CREATE TRIGGER trg_meli_rotas_updated BEFORE UPDATE ON public.meli_rotas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_pacotes_updated ON public.meli_pacotes;
CREATE TRIGGER trg_meli_pacotes_updated BEFORE UPDATE ON public.meli_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_importacoes_updated ON public.meli_importacoes;
CREATE TRIGGER trg_meli_importacoes_updated BEFORE UPDATE ON public.meli_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_meli_rotas_payload_updated ON public.meli_rotas_payload;
CREATE TRIGGER trg_meli_rotas_payload_updated BEFORE UPDATE ON public.meli_rotas_payload
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =========================================================
-- Helper de autorização (sem parâmetros; lê auth.uid() internamente)
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_pode_operar()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'gerente'::app_role) OR
    public.has_role(auth.uid(), 'supervisor'::app_role)
  );
$$;
REVOKE ALL ON FUNCTION public.meli_pode_operar() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_pode_operar() FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_pode_operar() TO authenticated;

-- =========================================================
-- Conversor seguro de int (privado; só chamado dentro das RPCs)
-- =========================================================
CREATE OR REPLACE FUNCTION public._meli_safe_int(p text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR p = '' THEN RETURN NULL; END IF;
  IF p !~ '^-?\d+$' THEN RETURN NULL; END IF;
  BEGIN
    RETURN p::int;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM anon;
REVOKE ALL ON FUNCTION public._meli_safe_int(text) FROM authenticated;

-- =========================================================
-- RPC: meli_importar_rota
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_importar_rota(
  p_payload jsonb,
  p_arquivo_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_importacao_id uuid;
  v_route_id text;
  v_rota_id uuid;
  v_pacotes jsonb;
  v_recebidos int := 0;
  v_unicos int := 0;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_inalterados int := 0;
  v_invalidos int := 0;
  v_duplicados int := 0;
  v_ordem_invalida int := 0;
  v_status text := 'ok';
  v_erro text := NULL;
  v_sqlstate text := NULL;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  -- Registro da tentativa (fora do bloco EXCEPTION; sobrevive à subtransação)
  INSERT INTO public.meli_importacoes (arquivo_nome, status, importado_por)
  VALUES (nullif(btrim(p_arquivo_nome), ''), 'processando', v_uid)
  RETURNING id INTO v_importacao_id;

  -- Subtransação: bloco BEGIN...EXCEPTION do PL/pgSQL cria savepoint implícito.
  BEGIN
    v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages');

    IF v_pacotes IS NOT NULL AND jsonb_typeof(v_pacotes) <> 'array' THEN
      RAISE EXCEPTION 'pacotes_deve_ser_array' USING ERRCODE = '22023';
    END IF;
    IF v_pacotes IS NULL THEN v_pacotes := '[]'::jsonb; END IF;

    -- UPSERT rota
    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao
    ) VALUES (
      v_route_id,
      nullif(btrim(p_payload->>'cluster'), ''),
      nullif(btrim(p_payload->>'carrier'), ''),
      nullif(btrim(p_payload->>'facility'), ''),
      nullif(btrim(p_payload->>'data_rota'), '')::date,
      v_importacao_id
    )
    ON CONFLICT (route_id) DO UPDATE SET
      cluster = COALESCE(EXCLUDED.cluster, public.meli_rotas.cluster),
      carrier = COALESCE(EXCLUDED.carrier, public.meli_rotas.carrier),
      facility = COALESCE(EXCLUDED.facility, public.meli_rotas.facility),
      data_rota = COALESCE(EXCLUDED.data_rota, public.meli_rotas.data_rota),
      origem_importacao = EXCLUDED.origem_importacao
    RETURNING id INTO v_rota_id;

    -- Bloqueio por rota para serializar importações concorrentes do mesmo route_id
    PERFORM 1 FROM public.meli_rotas WHERE id = v_rota_id FOR UPDATE;

    -- UPSERT payload
    INSERT INTO public.meli_rotas_payload (rota_id, raw_payload)
    VALUES (v_rota_id, p_payload)
    ON CONFLICT (rota_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;

    -- Processamento dos pacotes com dedup (última ocorrência) e contadores reais
    WITH raw AS (
      SELECT
        ord AS pos,
        nullif(btrim(elem->>'tracking_id'), '') AS tracking_id,
        nullif(btrim(elem->>'shipment_id'), '') AS shipment_id,
        nullif(btrim(elem->>'destinatario'), '') AS destinatario,
        nullif(btrim(elem->>'endereco'), '') AS endereco,
        nullif(btrim(elem->>'bairro'), '') AS bairro,
        nullif(btrim(elem->>'cidade'), '') AS cidade,
        nullif(btrim(elem->>'uf'), '') AS uf,
        nullif(btrim(elem->>'cep'), '') AS cep,
        nullif(btrim(elem->>'status'), '') AS status,
        nullif(btrim(elem->>'printed_label'), '') AS printed_label,
        elem->>'sequencia' AS sequencia_raw,
        public._meli_safe_int(elem->>'sequencia') AS ordem_int
      FROM jsonb_array_elements(v_pacotes) WITH ORDINALITY AS t(elem, ord)
    ),
    validos AS (
      SELECT * FROM raw WHERE tracking_id IS NOT NULL
    ),
    dedup AS (
      SELECT DISTINCT ON (tracking_id) *
      FROM validos
      ORDER BY tracking_id, pos DESC
    ),
    up AS (
      INSERT INTO public.meli_pacotes (
        rota_id, tracking_id, shipment_id, destinatario, endereco,
        bairro, cidade, uf, cep, status, printed_label, ordem
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, printed_label, ordem_int
      FROM dedup
      ON CONFLICT (rota_id, tracking_id) DO UPDATE SET
        shipment_id   = EXCLUDED.shipment_id,
        destinatario  = EXCLUDED.destinatario,
        endereco      = EXCLUDED.endereco,
        bairro        = EXCLUDED.bairro,
        cidade        = EXCLUDED.cidade,
        uf            = EXCLUDED.uf,
        cep           = EXCLUDED.cep,
        status        = EXCLUDED.status,
        printed_label = EXCLUDED.printed_label,
        ordem         = EXCLUDED.ordem
      WHERE
        public.meli_pacotes.shipment_id   IS DISTINCT FROM EXCLUDED.shipment_id   OR
        public.meli_pacotes.destinatario  IS DISTINCT FROM EXCLUDED.destinatario  OR
        public.meli_pacotes.endereco      IS DISTINCT FROM EXCLUDED.endereco      OR
        public.meli_pacotes.bairro        IS DISTINCT FROM EXCLUDED.bairro        OR
        public.meli_pacotes.cidade        IS DISTINCT FROM EXCLUDED.cidade        OR
        public.meli_pacotes.uf            IS DISTINCT FROM EXCLUDED.uf            OR
        public.meli_pacotes.cep           IS DISTINCT FROM EXCLUDED.cep           OR
        public.meli_pacotes.status        IS DISTINCT FROM EXCLUDED.status        OR
        public.meli_pacotes.printed_label IS DISTINCT FROM EXCLUDED.printed_label OR
        public.meli_pacotes.ordem         IS DISTINCT FROM EXCLUDED.ordem
      RETURNING (xmax = 0) AS inserted
    ),
    stats AS (
      SELECT
        (SELECT count(*) FROM raw)::int      AS recebidos,
        (SELECT count(*) FROM raw WHERE tracking_id IS NULL)::int AS invalidos,
        (SELECT count(*) FROM dedup)::int    AS unicos,
        ((SELECT count(*) FROM validos) - (SELECT count(*) FROM dedup))::int AS duplicados,
        (SELECT count(*) FROM raw
           WHERE tracking_id IS NOT NULL
             AND sequencia_raw IS NOT NULL
             AND sequencia_raw <> ''
             AND ordem_int IS NULL)::int     AS ordem_invalida,
        (SELECT count(*) FROM up WHERE inserted)::int      AS inseridos,
        (SELECT count(*) FROM up WHERE NOT inserted)::int  AS atualizados
    )
    SELECT recebidos, invalidos, unicos, duplicados, ordem_invalida, inseridos, atualizados
    INTO v_recebidos, v_invalidos, v_unicos, v_duplicados, v_ordem_invalida, v_inseridos, v_atualizados
    FROM stats;

    v_inalterados := v_unicos - v_inseridos - v_atualizados;

    -- Recontabiliza a rota
    UPDATE public.meli_rotas
    SET total_pacotes = (SELECT count(*) FROM public.meli_pacotes WHERE rota_id = v_rota_id),
        total_impressos = (SELECT count(*) FROM public.meli_pacotes
                            WHERE rota_id = v_rota_id
                              AND printed_label IS NOT NULL
                              AND printed_label <> '')
    WHERE id = v_rota_id;

    v_status := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_erro := SQLERRM;
    v_status := 'erro';
    -- Todas as escritas do bloco (rota, pacotes, payload) são revertidas
    -- pela subtransação implícita do BEGIN...EXCEPTION. Zeramos os contadores.
    v_recebidos := 0; v_unicos := 0; v_inseridos := 0; v_atualizados := 0;
    v_inalterados := 0; v_invalidos := 0; v_duplicados := 0; v_ordem_invalida := 0;
    v_rota_id := NULL;
  END;

  -- Log final (fora da subtransação; sobrevive ao rollback interno)
  UPDATE public.meli_importacoes
  SET status = v_status,
      total_rotas = CASE WHEN v_status = 'ok' THEN 1 ELSE 0 END,
      total_pacotes = v_inseridos + v_atualizados,
      total_erros = CASE WHEN v_status = 'erro' THEN 1 ELSE 0 END,
      mensagem_erro = v_erro,
      finalizado_em = now()
  WHERE id = v_importacao_id;

  IF v_status = 'erro' THEN
    RETURN jsonb_build_object(
      'status','erro',
      'erro', v_erro,
      'sqlstate', v_sqlstate,
      'importacao_id', v_importacao_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'importacao_id', v_importacao_id,
    'rota_id', v_rota_id,
    'route_id', v_route_id,
    'pacotes_recebidos', v_recebidos,
    'pacotes_unicos', v_unicos,
    'pacotes_inseridos', v_inseridos,
    'pacotes_atualizados', v_atualizados,
    'pacotes_inalterados', v_inalterados,
    'pacotes_invalidos', v_invalidos,
    'pacotes_duplicados_no_payload', v_duplicados,
    'pacotes_com_ordem_invalida', v_ordem_invalida
  );
END;
$fn$;
REVOKE ALL ON FUNCTION public.meli_importar_rota(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_importar_rota(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_importar_rota(jsonb, text) TO authenticated;

-- =========================================================
-- RPC: meli_listar_rotas
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_listar_rotas(
  p_cluster text DEFAULT NULL,
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_busca text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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
    FROM public.meli_rotas r
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
$fn$;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_listar_rotas(text,date,date,text,int,int) TO authenticated;

-- =========================================================
-- RPC: meli_detalhar_rota (sem raw_payload)
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_detalhar_rota(
  p_rota_id uuid,
  p_limit int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
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

  SELECT to_jsonb(r) INTO v_rota FROM public.meli_rotas r WHERE r.id = p_rota_id;
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
$fn$;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,int,int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_detalhar_rota(uuid,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_detalhar_rota(uuid,int,int) TO authenticated;
-- ==== fim 20260723134421_3c516c3c-e85d-4ad9-b86c-9de6dbed9ce3.sql ====

-- ==== inicio 20260723141044_a193c7c7-fa4c-4de9-8bf1-0c7d0665bd74.sql ====

DROP TABLE IF EXISTS public._meli_test_out;
CREATE TABLE public._meli_test_out (
  step text PRIMARY KEY,
  result jsonb,
  extra jsonb,
  created_at timestamptz DEFAULT now()
);

DO $test$
DECLARE
  v_admin uuid := '0742f108-771c-4a03-b10d-66dbcebe3b93';
  v_operador uuid := '158ef35a-a708-4afd-a56a-c4bea8f612c8';
  v_before int;
  v_after int;
  v_res jsonb;
  v_err text;
BEGIN
  -- Limpeza prévia idempotente
  DELETE FROM public.meli_rotas WHERE route_id LIKE 'TEST-%';
  DELETE FROM public.meli_importacoes WHERE arquivo_nome LIKE 'arquivo-%' OR arquivo_nome = 'x';

  -- T1: operador (sem permissão) → sem_permissao, sem log
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_operador, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_before FROM public.meli_importacoes;
  v_res := public.meli_importar_rota('{"meli_route_id":"TEST-NOP"}'::jsonb, 'x');
  SELECT count(*) INTO v_after FROM public.meli_importacoes;
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T1_sem_permissao', v_res,
     jsonb_build_object('delta_importacoes', v_after - v_before));

  -- T2: admin importa nova rota com 2 pacotes válidos
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","cluster":"ESP15","facility":"XPT-SP","data_rota":"2026-07-23","pacotes":[{"tracking_id":"TRK-A","destinatario":"Alice","sequencia":"1"},{"tracking_id":"TRK-B","destinatario":"Bob","sequencia":"2"}]}'::jsonb,
    'arquivo-1');
  INSERT INTO public._meli_test_out(step, result) VALUES ('T2_admin_import', v_res);

  -- T3: reimport idêntico → inalterados=2, inseridos=0, atualizados=0
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","cluster":"ESP15","facility":"XPT-SP","data_rota":"2026-07-23","pacotes":[{"tracking_id":"TRK-A","destinatario":"Alice","sequencia":"1"},{"tracking_id":"TRK-B","destinatario":"Bob","sequencia":"2"}]}'::jsonb,
    'arquivo-1-dup');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T3_reimport_identico', v_res,
     jsonb_build_object('total_pacotes_rota',
       (SELECT count(*) FROM public.meli_pacotes p
        JOIN public.meli_rotas r ON r.id=p.rota_id WHERE r.route_id='TEST-001')));

  -- T4: pacote duplicado no JSON — mantém última ocorrência (AliceV2)
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-001","pacotes":[{"tracking_id":"TRK-A","destinatario":"AliceV1"},{"tracking_id":"TRK-A","destinatario":"AliceV2"},{"tracking_id":"TRK-C","destinatario":"Carla"}]}'::jsonb,
    'arquivo-dup');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T4_dup_no_payload', v_res,
     jsonb_build_object(
       'trk_a_destinatario', (SELECT destinatario FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-001' AND p.tracking_id='TRK-A'),
       'total_pacotes_rota', (SELECT count(*) FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id WHERE r.route_id='TEST-001')
     ));

  -- T5: payload com pacotes não-array → erro; sem dados parciais; log gravado
  SELECT count(*) INTO v_before FROM public.meli_importacoes;
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-BAD","pacotes":"nao_e_array"}'::jsonb,
    'arquivo-bad');
  SELECT count(*) INTO v_after FROM public.meli_importacoes;
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T5_pacotes_nao_array', v_res,
     jsonb_build_object(
       'rota_test_bad_criada', (SELECT count(*) FROM public.meli_rotas WHERE route_id='TEST-BAD'),
       'payload_test_bad_criado', (SELECT count(*) FROM public.meli_rotas_payload rp
         JOIN public.meli_rotas r ON r.id=rp.rota_id WHERE r.route_id='TEST-BAD'),
       'log_status', (SELECT status FROM public.meli_importacoes WHERE arquivo_nome='arquivo-bad'),
       'log_msg', (SELECT mensagem_erro FROM public.meli_importacoes WHERE arquivo_nome='arquivo-bad'),
       'log_delta', v_after - v_before));

  -- T6: INSERT direto em meli_rotas como authenticated → bloqueado por RLS
  BEGIN
    SET LOCAL ROLE authenticated;
    BEGIN
      INSERT INTO public.meli_rotas(route_id) VALUES ('TEST-HACK-DIRECT');
      v_err := 'NAO_BLOQUEADO';
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLSTATE || ':' || SQLERRM;
    END;
  END;
  RESET ROLE;
  INSERT INTO public._meli_test_out(step, result) VALUES
    ('T6_insert_direto_authenticated',
     jsonb_build_object('resultado', v_err,
       'rota_criada', (SELECT count(*) FROM public.meli_rotas WHERE route_id='TEST-HACK-DIRECT')));

  -- T7: sequência inválida → pacote entra com ordem=NULL, contabilizado
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_res := public.meli_importar_rota(
    '{"meli_route_id":"TEST-SEQ","pacotes":[{"tracking_id":"TRK-X","sequencia":"ABC"},{"tracking_id":"TRK-Y","sequencia":"5"},{"tracking_id":"","sequencia":"6"}]}'::jsonb,
    'arquivo-seq');
  INSERT INTO public._meli_test_out(step, result, extra) VALUES
    ('T7_sequencia_invalida', v_res,
     jsonb_build_object(
       'trk_x_ordem', (SELECT ordem FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-SEQ' AND p.tracking_id='TRK-X'),
       'trk_y_ordem', (SELECT ordem FROM public.meli_pacotes p
         JOIN public.meli_rotas r ON r.id=p.rota_id
         WHERE r.route_id='TEST-SEQ' AND p.tracking_id='TRK-Y')));

  -- T8: listagem
  v_res := public.meli_listar_rotas(NULL, NULL, NULL, 'TEST-', 50, 0);
  INSERT INTO public._meli_test_out(step, result) VALUES ('T8_listar', v_res);

  -- T9: detalhamento (não retorna raw_payload)
  v_res := public.meli_detalhar_rota(
    (SELECT id FROM public.meli_rotas WHERE route_id='TEST-001'), 100, 0);
  INSERT INTO public._meli_test_out(step, result) VALUES
    ('T9_detalhar', v_res - 'pacotes'
      || jsonb_build_object(
           'qtd_pacotes_no_detalhe', jsonb_array_length(v_res->'pacotes'),
           'tem_raw_payload', v_res ? 'raw_payload'));
END $test$;
-- ==== fim 20260723141044_a193c7c7-fa4c-4de9-8bf1-0c7d0665bd74.sql ====

-- ==== inicio 20260723153834_a330ce8a-d4fb-4682-98d0-a4d543f1b618.sql ====
DROP TABLE IF EXISTS public._meli_test_out;
-- ==== fim 20260723153834_a330ce8a-d4fb-4682-98d0-a4d543f1b618.sql ====

-- ==== inicio 20260730130146_61c458c3-f254-4bfd-be01-61503284d9c3.sql ====
-- =========================================================
-- Fase 1 — Fundação Meli. Aditiva. Não altera dados existentes.
-- =========================================================

-- --- 1.1 bases: mapa ESP -> SSP -----------------------------------
ALTER TABLE public.bases
  ADD COLUMN IF NOT EXISTS meli_service_center_id text,
  ADD COLUMN IF NOT EXISTS meli_site_id text;

UPDATE public.bases SET meli_service_center_id = 'SSP20'
  WHERE codigo = 'ESP15' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP15'
  WHERE codigo = 'ESP16' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP34'
  WHERE codigo = 'ESP17' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_service_center_id = 'SSP25'
  WHERE codigo = 'ESP18' AND meli_service_center_id IS NULL;
UPDATE public.bases SET meli_site_id = 'MLB'
  WHERE meli_service_center_id IS NOT NULL AND meli_site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bases_meli_scid_uniq
  ON public.bases (meli_service_center_id)
  WHERE meli_service_center_id IS NOT NULL;

-- --- 1.2 meli_rotas: colunas normalizadas -------------------------
ALTER TABLE public.meli_rotas
  ADD COLUMN IF NOT EXISTS base_id           uuid REFERENCES public.bases(id),
  ADD COLUMN IF NOT EXISTS route_status      text,
  ADD COLUMN IF NOT EXISTS route_substatus   text,
  ADD COLUMN IF NOT EXISTS driver_name       text,
  ADD COLUMN IF NOT EXISTS driver_id         text,
  ADD COLUMN IF NOT EXISTS vehicle_license   text,
  ADD COLUMN IF NOT EXISTS delivered_total   integer,
  ADD COLUMN IF NOT EXISTS occurrence_total  integer,
  ADD COLUMN IF NOT EXISTS pending_total     integer,
  ADD COLUMN IF NOT EXISTS stops_total       integer,
  ADD COLUMN IF NOT EXISTS init_date         timestamptz,
  ADD COLUMN IF NOT EXISTS finish_date       timestamptz,
  ADD COLUMN IF NOT EXISTS executed_finish_date timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at    timestamptz;

CREATE INDEX IF NOT EXISTS meli_rotas_base_data_idx
  ON public.meli_rotas (base_id, data_rota);
CREATE INDEX IF NOT EXISTS meli_rotas_status_idx
  ON public.meli_rotas (route_status);
CREATE INDEX IF NOT EXISTS meli_rotas_synced_idx
  ON public.meli_rotas (last_synced_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS meli_rotas_driver_idx
  ON public.meli_rotas (driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_rotas_placa_idx
  ON public.meli_rotas (vehicle_license) WHERE vehicle_license IS NOT NULL;

-- --- 1.3 meli_pacotes: ocorrências e parada -----------------------
ALTER TABLE public.meli_pacotes
  ADD COLUMN IF NOT EXISTS substatus        text,
  ADD COLUMN IF NOT EXISTS occurrence_code  text,
  ADD COLUMN IF NOT EXISTS stop_id          text;

CREATE INDEX IF NOT EXISTS meli_pacotes_tracking_idx
  ON public.meli_pacotes (tracking_id);
CREATE INDEX IF NOT EXISTS meli_pacotes_shipment_idx
  ON public.meli_pacotes (shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_pacotes_occurrence_idx
  ON public.meli_pacotes (occurrence_code) WHERE occurrence_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS meli_pacotes_rota_status_idx
  ON public.meli_pacotes (rota_id, status);

-- --- 1.4 catálogo de ocorrências ----------------------------------
CREATE TABLE IF NOT EXISTS public.meli_ocorrencia_codigos (
  codigo           text PRIMARY KEY,
  descricao        text NOT NULL,
  peso             integer NOT NULL DEFAULT 1,
  responsabilidade text,
  ativo            boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_ocorrencia_codigos TO authenticated;
GRANT ALL    ON public.meli_ocorrencia_codigos TO service_role;

ALTER TABLE public.meli_ocorrencia_codigos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ocorrencia_codigos_read_authenticated"
  ON public.meli_ocorrencia_codigos;
CREATE POLICY "ocorrencia_codigos_read_authenticated"
  ON public.meli_ocorrencia_codigos FOR SELECT
  TO authenticated USING (true);

INSERT INTO public.meli_ocorrencia_codigos (codigo, descricao) VALUES
  ('transferred',          'Transferido'),
  ('buyer_rejected',       'O pacote foi recusado'),
  ('business_closed',      'Negócio fechado'),
  ('missing',              'O pacote foi perdido'),
  ('buyer_absent',         'Não havia ninguém no endereço'),
  ('unvisited_address',    'Endereço não visitado'),
  ('missrouted',           'O pacote não pertence à minha região'),
  ('inaccessible_address', 'Fica em uma área inacessível'),
  ('bad_address',          'Faltam dados do endereço'),
  ('damaged',              'O pacote está avariado')
ON CONFLICT (codigo) DO NOTHING;

-- --- 1.5 policy: payload bruto restrito a admin -------------------
ALTER TABLE public.meli_rotas_payload ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payload_admin_only_select"
  ON public.meli_rotas_payload;
CREATE POLICY "payload_admin_only_select"
  ON public.meli_rotas_payload FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- --- 1.6 RPC: status leve de sincronização ------------------------
CREATE OR REPLACE FUNCTION public.meli_sync_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_latest timestamptz;
  v_imp    jsonb;
  v_erros  bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','nao_autenticado');
  END IF;

  SELECT max(last_synced_at) INTO v_latest FROM public.meli_rotas;

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
$$;

REVOKE ALL ON FUNCTION public.meli_sync_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_sync_status() TO authenticated;

-- =========================================================
-- 2. Patch aditivo em meli_importar_rota
-- =========================================================
CREATE OR REPLACE FUNCTION public.meli_importar_rota(
  p_payload jsonb,
  p_arquivo_nome text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_importacao_id uuid;
  v_route_id text;
  v_rota_id uuid;
  v_pacotes jsonb;

  v_facility text;
  v_base_id uuid;
  v_route_status text;
  v_route_substatus text;
  v_driver_name text;
  v_driver_id text;
  v_vehicle text;
  v_delivered int;
  v_occurrence int;
  v_pending int;
  v_stops int;
  v_init_date timestamptz;
  v_finish_date timestamptz;
  v_exec_finish timestamptz;
  v_data_rota date;

  v_recebidos int := 0;
  v_unicos int := 0;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_inalterados int := 0;
  v_invalidos int := 0;
  v_duplicados int := 0;
  v_ordem_invalida int := 0;
  v_status text := 'ok';
  v_erro text := NULL;
  v_sqlstate text := NULL;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  INSERT INTO public.meli_importacoes (arquivo_nome, status, importado_por)
  VALUES (nullif(btrim(p_arquivo_nome), ''), 'processando', v_uid)
  RETURNING id INTO v_importacao_id;

  BEGIN
    v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages');
    IF v_pacotes IS NOT NULL AND jsonb_typeof(v_pacotes) <> 'array' THEN
      RAISE EXCEPTION 'pacotes_deve_ser_array' USING ERRCODE = '22023';
    END IF;
    IF v_pacotes IS NULL THEN v_pacotes := '[]'::jsonb; END IF;

    v_facility := nullif(btrim(coalesce(
      p_payload->>'facility',
      p_payload->>'serviceCenterId',
      p_payload->>'service_center_id',
      p_payload->>'service_center'
    )), '');

    IF v_facility IS NOT NULL THEN
      SELECT id INTO v_base_id
      FROM public.bases
      WHERE meli_service_center_id = v_facility
      LIMIT 1;
    END IF;

    v_route_status    := nullif(btrim(p_payload->>'status'), '');
    v_route_substatus := nullif(btrim(p_payload->>'substatus'), '');
    v_driver_name     := nullif(btrim(coalesce(
                          p_payload->>'driver_name',
                          p_payload->'driver'->>'name',
                          p_payload->'driver'->>'nickname')), '');
    v_driver_id       := nullif(btrim(coalesce(
                          p_payload->>'driver_id',
                          p_payload->'driver'->>'id',
                          p_payload->'driver'->>'user_id')), '');
    v_vehicle         := nullif(upper(btrim(coalesce(
                          p_payload->>'vehicle_license',
                          p_payload->>'plate',
                          p_payload->'vehicle'->>'license_plate'))), '');

    v_delivered  := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'delivered',
                      p_payload->>'delivered_total'));
    v_occurrence := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'notDelivered',
                      p_payload->'counters'->>'notDeliveredTotal',
                      p_payload->'counters'->>'occurrences',
                      p_payload->>'occurrence_total'));
    v_pending    := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'pending',
                      p_payload->>'pending_total'));
    v_stops      := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'stops',
                      p_payload->'counters'->>'totalStops',
                      p_payload->>'stops_total',
                      p_payload->>'totalStops'));
    IF v_stops IS NULL AND jsonb_typeof(p_payload->'stops') = 'array' THEN
      v_stops := jsonb_array_length(p_payload->'stops');
      IF v_stops = 0 THEN v_stops := NULL; END IF;
    END IF;

    v_init_date := CASE
      WHEN p_payload ? 'initDate' AND (p_payload->>'initDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'initDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'initDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'initDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'initDate')::bigint) END
      WHEN p_payload ? 'init_date' THEN nullif(p_payload->>'init_date','')::timestamptz
      ELSE NULL END;

    v_finish_date := CASE
      WHEN p_payload ? 'finishDate' AND (p_payload->>'finishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'finishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'finishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'finishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'finishDate')::bigint) END
      WHEN p_payload ? 'finish_date' THEN nullif(p_payload->>'finish_date','')::timestamptz
      ELSE NULL END;

    v_exec_finish := CASE
      WHEN p_payload ? 'executedFinishDate' AND (p_payload->>'executedFinishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'executedFinishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'executedFinishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'executedFinishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'executedFinishDate')::bigint) END
      ELSE NULL END;

    -- data_rota: parsing seguro (aceita apenas YYYY-MM-DD; erro -> NULL)
    BEGIN
      v_data_rota := CASE
        WHEN nullif(btrim(p_payload->>'data_rota'), '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN to_date(btrim(p_payload->>'data_rota'), 'YYYY-MM-DD')
        ELSE NULL
      END;
    EXCEPTION WHEN OTHERS THEN
      v_data_rota := NULL;
    END;

    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao,
      base_id, route_status, route_substatus,
      driver_name, driver_id, vehicle_license,
      delivered_total, occurrence_total, pending_total, stops_total,
      init_date, finish_date, executed_finish_date, last_synced_at
    ) VALUES (
      v_route_id,
      nullif(btrim(p_payload->>'cluster'), ''),
      nullif(btrim(p_payload->>'carrier'), ''),
      v_facility,
      v_data_rota,
      v_importacao_id,
      v_base_id, v_route_status, v_route_substatus,
      v_driver_name, v_driver_id, v_vehicle,
      v_delivered, v_occurrence, v_pending, v_stops,
      v_init_date, v_finish_date, v_exec_finish, now()
    )
    ON CONFLICT (route_id) DO UPDATE SET
      cluster              = COALESCE(EXCLUDED.cluster, public.meli_rotas.cluster),
      carrier              = COALESCE(EXCLUDED.carrier, public.meli_rotas.carrier),
      facility             = COALESCE(EXCLUDED.facility, public.meli_rotas.facility),
      data_rota            = COALESCE(EXCLUDED.data_rota, public.meli_rotas.data_rota),
      origem_importacao    = EXCLUDED.origem_importacao,
      base_id              = COALESCE(EXCLUDED.base_id, public.meli_rotas.base_id),
      route_status         = COALESCE(EXCLUDED.route_status, public.meli_rotas.route_status),
      route_substatus      = COALESCE(EXCLUDED.route_substatus, public.meli_rotas.route_substatus),
      driver_name          = COALESCE(EXCLUDED.driver_name, public.meli_rotas.driver_name),
      driver_id            = COALESCE(EXCLUDED.driver_id, public.meli_rotas.driver_id),
      vehicle_license      = COALESCE(EXCLUDED.vehicle_license, public.meli_rotas.vehicle_license),
      delivered_total      = COALESCE(EXCLUDED.delivered_total, public.meli_rotas.delivered_total),
      occurrence_total     = COALESCE(EXCLUDED.occurrence_total, public.meli_rotas.occurrence_total),
      pending_total        = COALESCE(EXCLUDED.pending_total, public.meli_rotas.pending_total),
      stops_total          = COALESCE(EXCLUDED.stops_total, public.meli_rotas.stops_total),
      init_date            = COALESCE(EXCLUDED.init_date, public.meli_rotas.init_date),
      finish_date          = COALESCE(EXCLUDED.finish_date, public.meli_rotas.finish_date),
      executed_finish_date = COALESCE(EXCLUDED.executed_finish_date, public.meli_rotas.executed_finish_date),
      last_synced_at       = now()
    RETURNING id INTO v_rota_id;

    PERFORM 1 FROM public.meli_rotas WHERE id = v_rota_id FOR UPDATE;

    INSERT INTO public.meli_rotas_payload (rota_id, raw_payload)
    VALUES (v_rota_id, p_payload)
    ON CONFLICT (rota_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;

    WITH raw AS (
      SELECT
        ord AS pos,
        nullif(btrim(elem->>'tracking_id'), '') AS tracking_id,
        nullif(btrim(elem->>'shipment_id'), '') AS shipment_id,
        nullif(btrim(elem->>'destinatario'), '') AS destinatario,
        nullif(btrim(elem->>'endereco'), '') AS endereco,
        nullif(btrim(elem->>'bairro'), '') AS bairro,
        nullif(btrim(elem->>'cidade'), '') AS cidade,
        nullif(btrim(elem->>'uf'), '') AS uf,
        nullif(btrim(elem->>'cep'), '') AS cep,
        nullif(btrim(elem->>'status'), '') AS status,
        nullif(btrim(elem->>'substatus'), '') AS substatus,
        nullif(btrim(coalesce(elem->>'occurrence_code', elem->>'occurrenceCode')), '') AS occurrence_code,
        nullif(btrim(coalesce(elem->>'stop_id', elem->>'stopId')), '') AS stop_id,
        nullif(btrim(elem->>'printed_label'), '') AS printed_label,
        elem->>'sequencia' AS sequencia_raw,
        public._meli_safe_int(elem->>'sequencia') AS ordem_int
      FROM jsonb_array_elements(v_pacotes) WITH ORDINALITY AS t(elem, ord)
    ),
    validos AS (SELECT * FROM raw WHERE tracking_id IS NOT NULL),
    dedup AS (
      SELECT DISTINCT ON (tracking_id) *
      FROM validos
      ORDER BY tracking_id, pos DESC
    ),
    up AS (
      INSERT INTO public.meli_pacotes (
        rota_id, tracking_id, shipment_id, destinatario, endereco,
        bairro, cidade, uf, cep, status, substatus, occurrence_code,
        stop_id, printed_label, ordem
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, substatus, occurrence_code,
             stop_id, printed_label, ordem_int
      FROM dedup
      ON CONFLICT (rota_id, tracking_id) DO UPDATE SET
        shipment_id     = EXCLUDED.shipment_id,
        destinatario    = EXCLUDED.destinatario,
        endereco        = EXCLUDED.endereco,
        bairro          = EXCLUDED.bairro,
        cidade          = EXCLUDED.cidade,
        uf              = EXCLUDED.uf,
        cep             = EXCLUDED.cep,
        status          = EXCLUDED.status,
        substatus       = EXCLUDED.substatus,
        occurrence_code = EXCLUDED.occurrence_code,
        stop_id         = EXCLUDED.stop_id,
        printed_label   = EXCLUDED.printed_label,
        ordem           = EXCLUDED.ordem
      WHERE
        public.meli_pacotes.shipment_id     IS DISTINCT FROM EXCLUDED.shipment_id     OR
        public.meli_pacotes.destinatario    IS DISTINCT FROM EXCLUDED.destinatario    OR
        public.meli_pacotes.endereco        IS DISTINCT FROM EXCLUDED.endereco        OR
        public.meli_pacotes.bairro          IS DISTINCT FROM EXCLUDED.bairro          OR
        public.meli_pacotes.cidade          IS DISTINCT FROM EXCLUDED.cidade          OR
        public.meli_pacotes.uf              IS DISTINCT FROM EXCLUDED.uf              OR
        public.meli_pacotes.cep             IS DISTINCT FROM EXCLUDED.cep             OR
        public.meli_pacotes.status          IS DISTINCT FROM EXCLUDED.status          OR
        public.meli_pacotes.substatus       IS DISTINCT FROM EXCLUDED.substatus       OR
        public.meli_pacotes.occurrence_code IS DISTINCT FROM EXCLUDED.occurrence_code OR
        public.meli_pacotes.stop_id         IS DISTINCT FROM EXCLUDED.stop_id         OR
        public.meli_pacotes.printed_label   IS DISTINCT FROM EXCLUDED.printed_label   OR
        public.meli_pacotes.ordem           IS DISTINCT FROM EXCLUDED.ordem
      RETURNING (xmax = 0) AS inserted
    ),
    stats AS (
      SELECT
        (SELECT count(*) FROM raw)::int      AS recebidos,
        (SELECT count(*) FROM raw WHERE tracking_id IS NULL)::int AS invalidos,
        (SELECT count(*) FROM dedup)::int    AS unicos,
        ((SELECT count(*) FROM validos) - (SELECT count(*) FROM dedup))::int AS duplicados,
        (SELECT count(*) FROM raw
           WHERE tracking_id IS NOT NULL
             AND sequencia_raw IS NOT NULL AND sequencia_raw <> ''
             AND ordem_int IS NULL)::int     AS ordem_invalida,
        (SELECT count(*) FROM up WHERE inserted)::int      AS inseridos,
        (SELECT count(*) FROM up WHERE NOT inserted)::int  AS atualizados
    )
    SELECT recebidos, invalidos, unicos, duplicados, ordem_invalida, inseridos, atualizados
    INTO v_recebidos, v_invalidos, v_unicos, v_duplicados, v_ordem_invalida, v_inseridos, v_atualizados
    FROM stats;

    v_inalterados := v_unicos - v_inseridos - v_atualizados;

    UPDATE public.meli_rotas
    SET total_pacotes = (SELECT count(*) FROM public.meli_pacotes WHERE rota_id = v_rota_id),
        total_impressos = (SELECT count(*) FROM public.meli_pacotes
                            WHERE rota_id = v_rota_id
                              AND printed_label IS NOT NULL AND printed_label <> '')
    WHERE id = v_rota_id;

    v_status := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_erro := SQLERRM;
    v_status := 'erro';
    v_recebidos := 0; v_unicos := 0; v_inseridos := 0; v_atualizados := 0;
    v_inalterados := 0; v_invalidos := 0; v_duplicados := 0; v_ordem_invalida := 0;
    v_rota_id := NULL;
  END;

  UPDATE public.meli_importacoes
  SET status = v_status,
      total_rotas = CASE WHEN v_status = 'ok' THEN 1 ELSE 0 END,
      total_pacotes = v_inseridos + v_atualizados,
      total_erros = CASE WHEN v_status = 'erro' THEN 1 ELSE 0 END,
      mensagem_erro = v_erro,
      finalizado_em = now()
  WHERE id = v_importacao_id;

  IF v_status = 'erro' THEN
    RETURN jsonb_build_object(
      'status','erro','erro',v_erro,'sqlstate',v_sqlstate,
      'importacao_id',v_importacao_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'importacao_id', v_importacao_id,
    'rota_id', v_rota_id,
    'route_id', v_route_id,
    'pacotes_recebidos', v_recebidos,
    'pacotes_unicos', v_unicos,
    'pacotes_inseridos', v_inseridos,
    'pacotes_atualizados', v_atualizados,
    'pacotes_inalterados', v_inalterados,
    'pacotes_invalidos', v_invalidos,
    'pacotes_duplicados_no_payload', v_duplicados,
    'pacotes_com_ordem_invalida', v_ordem_invalida
  );
END;
$function$;
-- ==== fim 20260730130146_61c458c3-f254-4bfd-be01-61503284d9c3.sql ====

-- ==== inicio 20260731142807_62017130-5c14-4100-bf4e-d762a361c920.sql ====
ALTER TABLE public.escalas ADD COLUMN IF NOT EXISTS meli_pacote_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS escalas_importacao_meli_pacote_uidx
  ON public.escalas (importacao_id, meli_pacote_id)
  WHERE meli_pacote_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.meli_publicar_rota_operacional(
  p_rota_id uuid,
  p_data_operacional date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rota          public.meli_rotas;
  v_base_id       uuid;
  v_dia           date;
  v_importacao_id uuid;
  v_inseridos     integer := 0;
  v_atualizados   integer := 0;
  v_total         integer := 0;
  v_rotas         integer := 0;
  v_motoristas    integer := 0;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT * INTO v_rota FROM public.meli_rotas WHERE id = p_rota_id;
  IF v_rota.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  v_base_id := v_rota.base_id;
  IF v_base_id IS NULL AND v_rota.facility IS NOT NULL THEN
    SELECT b.id INTO v_base_id
      FROM public.bases b
     WHERE b.meli_service_center_id = v_rota.facility
     LIMIT 1;
  END IF;
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_mapeada','facility',v_rota.facility);
  END IF;

  v_dia := COALESCE(p_data_operacional, v_rota.data_rota, (now() AT TIME ZONE 'America/Sao_Paulo')::date);

  SELECT i.id INTO v_importacao_id
    FROM public.importacoes_escala i
   WHERE i.base_id = v_base_id
     AND i.data_operacional = v_dia
     AND i.ativa = true
   ORDER BY i.importado_em DESC
   LIMIT 1;

  IF v_importacao_id IS NULL THEN
    INSERT INTO public.importacoes_escala (
      base_id, data_operacional, versao, ativa, importado_por,
      arquivo_nome, total_linhas, total_pacotes, total_motoristas, total_rotas
    ) VALUES (
      v_base_id, v_dia,
      COALESCE((SELECT MAX(versao) FROM public.importacoes_escala
                 WHERE base_id = v_base_id AND data_operacional = v_dia), 0) + 1,
      true, auth.uid(),
      'meli:' || v_rota.route_id, 0, 0, 0, 0
    ) RETURNING id INTO v_importacao_id;
  END IF;

  -- Atualiza apenas dados descritivos de linhas já existentes.
  -- Nunca toca em triado/recebido/devolvido nem em seus metadados.
  WITH upd AS (
    UPDATE public.escalas e
       SET otimizada     = v_rota.route_id,
           planejada     = COALESCE(e.planejada, v_rota.route_id),
           cidade        = COALESCE(p.cidade, e.cidade),
           bairro        = COALESCE(p.bairro, e.bairro),
           cep           = COALESCE(p.cep, e.cep),
           rua           = COALESCE(p.endereco, e.rua),
           driver        = COALESCE(v_rota.driver_name, e.driver),
           placa         = COALESCE(v_rota.vehicle_license, e.placa),
           facility_id   = COALESCE(v_rota.facility, e.facility_id),
           transportadora= COALESCE(v_rota.carrier, e.transportadora),
           ordem         = COALESCE(p.ordem, e.ordem)
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND e.importacao_id = v_importacao_id
       AND (e.meli_pacote_id = p.id OR e.shipment = p.tracking_id)
    RETURNING e.id
  )
  SELECT count(*) INTO v_atualizados FROM upd;

  -- Vincula linhas casadas por shipment que ainda não tinham o vínculo.
  UPDATE public.escalas e
     SET meli_pacote_id = p.id
    FROM public.meli_pacotes p
   WHERE p.rota_id = v_rota.id
     AND e.importacao_id = v_importacao_id
     AND e.meli_pacote_id IS NULL
     AND e.shipment = p.tracking_id;

  -- Insere os pacotes que ainda não existem como carga esperada.
  WITH ins AS (
    INSERT INTO public.escalas (
      base_id, data_referencia, importacao_id, meli_pacote_id,
      shipment, planejada, otimizada, nro_rota,
      cidade, bairro, cep, rua, ordem,
      driver, placa, facility_id, transportadora,
      importado_por, triado, recebido, devolvido
    )
    SELECT v_base_id, v_dia, v_importacao_id, p.id,
           p.tracking_id, v_rota.route_id, v_rota.route_id, v_rota.route_id,
           p.cidade, p.bairro, p.cep, p.endereco, p.ordem,
           v_rota.driver_name, v_rota.vehicle_license, v_rota.facility, v_rota.carrier,
           auth.uid(), false, false, false
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND p.tracking_id IS NOT NULL
       AND p.tracking_id <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.escalas e2
          WHERE e2.importacao_id = v_importacao_id
            AND (e2.meli_pacote_id = p.id OR e2.shipment = p.tracking_id)
       )
    RETURNING id
  )
  SELECT count(*) INTO v_inseridos FROM ins;

  SELECT count(*), count(DISTINCT COALESCE(NULLIF(otimizada,''), planejada)), count(DISTINCT driver)
    INTO v_total, v_rotas, v_motoristas
    FROM public.escalas
   WHERE importacao_id = v_importacao_id;

  UPDATE public.importacoes_escala
     SET total_linhas = v_total,
         total_pacotes = v_total,
         total_rotas = v_rotas,
         total_motoristas = v_motoristas,
         updated_at = now()
   WHERE id = v_importacao_id;

  RETURN jsonb_build_object(
    'status','ok',
    'rota_id', v_rota.id,
    'route_id', v_rota.route_id,
    'base_id', v_base_id,
    'data_operacional', v_dia,
    'importacao_id', v_importacao_id,
    'esperados_inseridos', v_inseridos,
    'esperados_atualizados', v_atualizados,
    'total_importacao', v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','erro','erro', SQLERRM, 'sqlstate', SQLSTATE);
END;
$$;

REVOKE ALL ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meli_publicar_rota_operacional(uuid, date) TO service_role;
-- ==== fim 20260731142807_62017130-5c14-4100-bf4e-d762a361c920.sql ====

-- ==== inicio 20260801154616_e55955cf-3471-48e3-8aa2-a126b279fbba.sql ====
-- ============ Fase 3 (aditiva) — colunas de área de risco + sync por pacote ============
ALTER TABLE public.meli_rotas
  ADD COLUMN IF NOT EXISTS rota_area_risco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS area_risco_parcial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_area_risco text,
  ADD COLUMN IF NOT EXISTS codigo_area_risco text,
  ADD COLUMN IF NOT EXISTS origem_area_risco text,
  ADD COLUMN IF NOT EXISTS valor_original_area_risco jsonb,
  ADD COLUMN IF NOT EXISTS area_risco_detectado_em timestamptz;

ALTER TABLE public.meli_pacotes
  ADD COLUMN IF NOT EXISTS pacote_area_risco boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS motivo_area_risco text,
  ADD COLUMN IF NOT EXISTS codigo_area_risco text,
  ADD COLUMN IF NOT EXISTS origem_area_risco text,
  ADD COLUMN IF NOT EXISTS valor_original_area_risco jsonb,
  ADD COLUMN IF NOT EXISTS area_risco_detectado_em timestamptz,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meli_rotas_origem_area_risco_chk') THEN
    ALTER TABLE public.meli_rotas ADD CONSTRAINT meli_rotas_origem_area_risco_chk
      CHECK (origem_area_risco IS NULL OR origem_area_risco IN ('rota','parada','pacote','ocorrencia'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meli_pacotes_origem_area_risco_chk') THEN
    ALTER TABLE public.meli_pacotes ADD CONSTRAINT meli_pacotes_origem_area_risco_chk
      CHECK (origem_area_risco IS NULL OR origem_area_risco IN ('rota','parada','pacote','ocorrencia'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS meli_rotas_dia_base_idx ON public.meli_rotas (data_rota, base_id);
CREATE INDEX IF NOT EXISTS meli_rotas_risco_idx ON public.meli_rotas (data_rota) WHERE rota_area_risco OR area_risco_parcial;
CREATE INDEX IF NOT EXISTS meli_pacotes_rota_status_idx ON public.meli_pacotes (rota_id, status);
CREATE INDEX IF NOT EXISTS meli_pacotes_risco_idx ON public.meli_pacotes (rota_id) WHERE pacote_area_risco;

-- ============ Normalização central de status (fonte única, também usada no TS) ============
CREATE OR REPLACE FUNCTION public.meli_status_normalizado(p_status text, p_substatus text, p_occurrence_code text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  WITH v AS (
    SELECT lower(btrim(coalesce(p_occurrence_code,''))) AS oc,
           lower(btrim(coalesce(p_substatus,'')))       AS sub,
           lower(btrim(coalesce(p_status,'')))          AS st
  ), c AS (
    SELECT CASE WHEN oc <> '' THEN oc WHEN sub <> '' THEN sub ELSE st END AS chave, st FROM v
  )
  SELECT CASE
    WHEN chave = '' THEN 'desconhecido'
    WHEN chave IN ('delivered','entregue','delivered_to_buyer') THEN 'entregue'
    WHEN chave IN ('cancelled','canceled','cancelado') THEN 'cancelado'
    WHEN chave IN ('pending','planned','ready_to_deliver','to_be_delivered','not_started','created') THEN 'nao_iniciado'
    WHEN chave IN ('picked_up','in_route','out_for_delivery','active','on_route','shipped','in_transit') THEN 'em_rota'
    WHEN chave IN ('buyer_absent','buyer_rejected','buyer_moved','business_closed','bad_address',
                   'unvisited_address','inaccessible_address','missrouted','missing','damaged',
                   'blocked','blocked_by_keyword','risk_area','dangerous_area','return_to_station',
                   'not_delivered','refused','lost','stolen','vehicle_issue') THEN 'insucesso'
    ELSE 'desconhecido'
  END
  FROM c;
$$;

REVOKE ALL ON FUNCTION public.meli_status_normalizado(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_status_normalizado(text,text,text) TO authenticated, service_role;

-- ============ RPC do Dashboard Meli em tempo real ============
CREATE OR REPLACE FUNCTION public.meli_dashboard_operacional(
  p_data date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL,
  p_motorista text DEFAULT NULL,
  p_rota text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_transportadora text DEFAULT NULL,
  p_risco text DEFAULT NULL   -- null | qualquer | integral | parcial
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_dia date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_rotas jsonb := '[]'::jsonb;
  v_cards jsonb;
  v_motivos jsonb := '[]'::jsonb;
  v_bases jsonb := '[]'::jsonb;
  v_risco jsonb;
  v_sync timestamptz;
  v_sync_bases jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _dash_pac (
    rota_id uuid, route_id text, cluster text, base_id uuid, base_codigo text,
    base_nome text, service_center text, driver_name text, vehicle_license text,
    carrier text, data_rota date, last_synced_at timestamptz,
    rota_area_risco boolean, area_risco_parcial boolean,
    pacote_area_risco boolean, motivo_area_risco text,
    situacao text, occurrence_code text, substatus text, status text
  ) ON COMMIT DROP;
  DELETE FROM _dash_pac;

  INSERT INTO _dash_pac
  SELECT r.id, r.route_id, r.cluster, r.base_id, b.codigo, b.nome, b.meli_service_center_id,
         r.driver_name, r.vehicle_license, r.carrier, r.data_rota, r.last_synced_at,
         r.rota_area_risco, r.area_risco_parcial,
         p.pacote_area_risco, coalesce(p.motivo_area_risco, r.motivo_area_risco),
         public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code),
         p.occurrence_code, p.substatus, p.status
    FROM public.meli_rotas r
    LEFT JOIN public.bases b ON b.id = r.base_id
    JOIN public.meli_pacotes p ON p.rota_id = r.id
   WHERE r.data_rota = v_dia
     AND (p_base_id IS NULL OR r.base_id = p_base_id)
     AND (p_motorista IS NULL OR r.driver_name ILIKE '%'||p_motorista||'%')
     AND (p_rota IS NULL OR r.route_id ILIKE '%'||p_rota||'%' OR coalesce(r.cluster,'') ILIKE '%'||p_rota||'%')
     AND (p_transportadora IS NULL OR r.carrier ILIKE '%'||p_transportadora||'%')
     AND (p_risco IS NULL
          OR (p_risco = 'qualquer'  AND (r.rota_area_risco OR r.area_risco_parcial))
          OR (p_risco = 'integral'  AND r.rota_area_risco)
          OR (p_risco = 'parcial'   AND r.area_risco_parcial));

  IF p_status IS NOT NULL THEN
    DELETE FROM _dash_pac WHERE situacao <> p_status;
  END IF;

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
    'rotas_risco',  count(DISTINCT route_id) FILTER (WHERE rota_area_risco OR area_risco_parcial)
  ) INTO v_cards FROM _dash_pac;

  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'total')::int DESC), '[]'::jsonb) INTO v_motivos
  FROM (
    SELECT jsonb_build_object(
             'codigo', k,
             'descricao', coalesce(c.descricao, k),
             'cadastrado', c.codigo IS NOT NULL,
             'total', t
           ) AS x
    FROM (
      SELECT coalesce(nullif(occurrence_code,''), nullif(substatus,''), nullif(status,''), 'sem_codigo') AS k,
             count(*)::int AS t
        FROM _dash_pac WHERE situacao = 'insucesso' GROUP BY 1
    ) s
    LEFT JOIN public.meli_ocorrencia_codigos c ON c.codigo = s.k
  ) y;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.insucesso DESC, r.perc_entrega ASC, r.em_rota DESC, r.pacotes_risco DESC), '[]'::jsonb)
    INTO v_rotas
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
      FROM _dash_pac
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome, service_center,
              driver_name, vehicle_license, carrier, data_rota
  ) r;

  SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.rotas_risco DESC NULLS LAST, b.base_codigo), '[]'::jsonb)
    INTO v_bases
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
      FROM _dash_pac
     GROUP BY base_id, base_codigo, base_nome, service_center
  ) b;

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
  ) INTO v_risco FROM _dash_pac;

  SELECT max(last_synced_at) INTO v_sync FROM public.meli_rotas WHERE data_rota = v_dia;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'base_id', base_id, 'base_codigo', base_codigo,
           'last_synced_at', ls) ORDER BY ls NULLS FIRST), '[]'::jsonb)
    INTO v_sync_bases
  FROM (SELECT base_id, base_codigo, max(last_synced_at) AS ls FROM _dash_pac GROUP BY 1,2) s;

  RETURN jsonb_build_object(
    'status','ok',
    'data_operacional', v_dia,
    'server_time', now(),
    'cards', v_cards,
    'motivos_insucesso', v_motivos,
    'rotas', v_rotas,
    'bases', v_bases,
    'area_risco', v_risco,
    'ultima_sincronizacao', v_sync,
    'sincronizacao_por_base', v_sync_bases
  );
END;
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_operacional(date,uuid,text,text,text,text,text) TO authenticated, service_role;

-- ============ Detalhe dos pacotes de uma rota (Meli + status físico JM) ============
CREATE OR REPLACE FUNCTION public.meli_dashboard_pacotes_rota(p_rota_id uuid, p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
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
    FROM public.meli_rotas r LEFT JOIN public.bases b ON b.id = r.base_id
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
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_pacotes_rota(uuid,integer) TO authenticated, service_role;
-- ==== fim 20260801154616_e55955cf-3471-48e3-8aa2-a126b279fbba.sql ====

-- ==== inicio 20260802153530_458f7175-9974-4d35-bf69-5bf9bd03f430.sql ====
CREATE OR REPLACE FUNCTION public.meli_importar_rota(p_payload jsonb, p_arquivo_nome text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_importacao_id uuid;
  v_route_id text;
  v_rota_id uuid;
  v_pacotes jsonb;

  v_facility text;
  v_base_id uuid;
  v_route_status text;
  v_route_substatus text;
  v_driver_name text;
  v_driver_id text;
  v_vehicle text;
  v_delivered int;
  v_occurrence int;
  v_pending int;
  v_stops int;
  v_init_date timestamptz;
  v_finish_date timestamptz;
  v_exec_finish timestamptz;
  v_data_rota date;

  v_rota_risco boolean;
  v_risco_parcial boolean;
  v_risco_motivo text;
  v_risco_codigo text;
  v_risco_origem text;
  v_risco_valor jsonb;

  v_recebidos int := 0;
  v_unicos int := 0;
  v_inseridos int := 0;
  v_atualizados int := 0;
  v_inalterados int := 0;
  v_invalidos int := 0;
  v_duplicados int := 0;
  v_ordem_invalida int := 0;
  v_status text := 'ok';
  v_erro text := NULL;
  v_sqlstate text := NULL;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('status','erro','erro','payload_invalido');
  END IF;

  v_route_id := nullif(btrim(coalesce(p_payload->>'meli_route_id', p_payload->>'route_id')), '');
  IF v_route_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','meli_route_id_obrigatorio');
  END IF;

  INSERT INTO public.meli_importacoes (arquivo_nome, status, importado_por)
  VALUES (nullif(btrim(p_arquivo_nome), ''), 'processando', v_uid)
  RETURNING id INTO v_importacao_id;

  BEGIN
    v_pacotes := coalesce(p_payload->'pacotes', p_payload->'packages');
    IF v_pacotes IS NOT NULL AND jsonb_typeof(v_pacotes) <> 'array' THEN
      RAISE EXCEPTION 'pacotes_deve_ser_array' USING ERRCODE = '22023';
    END IF;
    IF v_pacotes IS NULL THEN v_pacotes := '[]'::jsonb; END IF;

    v_facility := nullif(btrim(coalesce(
      p_payload->>'facility',
      p_payload->>'serviceCenterId',
      p_payload->>'service_center_id',
      p_payload->>'service_center'
    )), '');

    IF v_facility IS NOT NULL THEN
      SELECT id INTO v_base_id
      FROM public.bases
      WHERE meli_service_center_id = v_facility
      LIMIT 1;
    END IF;

    v_route_status    := nullif(btrim(p_payload->>'status'), '');
    v_route_substatus := nullif(btrim(p_payload->>'substatus'), '');
    v_driver_name     := nullif(btrim(coalesce(
                          p_payload->>'driver_name',
                          p_payload->'driver'->>'name',
                          p_payload->'driver'->>'nickname')), '');
    v_driver_id       := nullif(btrim(coalesce(
                          p_payload->>'driver_id',
                          p_payload->'driver'->>'id',
                          p_payload->'driver'->>'user_id')), '');
    v_vehicle         := nullif(upper(btrim(coalesce(
                          p_payload->>'vehicle_license',
                          p_payload->>'plate',
                          p_payload->'vehicle'->>'license_plate'))), '');

    v_delivered  := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'delivered',
                      p_payload->>'delivered_total'));
    v_occurrence := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'notDelivered',
                      p_payload->'counters'->>'notDeliveredTotal',
                      p_payload->'counters'->>'occurrences',
                      p_payload->>'occurrence_total'));
    v_pending    := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'pending',
                      p_payload->>'pending_total'));
    v_stops      := public._meli_safe_int(coalesce(
                      p_payload->'counters'->>'stops',
                      p_payload->'counters'->>'totalStops',
                      p_payload->>'stops_total',
                      p_payload->>'totalStops'));
    IF v_stops IS NULL AND jsonb_typeof(p_payload->'stops') = 'array' THEN
      v_stops := jsonb_array_length(p_payload->'stops');
      IF v_stops = 0 THEN v_stops := NULL; END IF;
    END IF;

    v_init_date := CASE
      WHEN p_payload ? 'initDate' AND (p_payload->>'initDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'initDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'initDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'initDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'initDate')::bigint) END
      WHEN p_payload ? 'init_date' THEN nullif(p_payload->>'init_date','')::timestamptz
      ELSE NULL END;

    v_finish_date := CASE
      WHEN p_payload ? 'finishDate' AND (p_payload->>'finishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'finishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'finishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'finishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'finishDate')::bigint) END
      WHEN p_payload ? 'finish_date' THEN nullif(p_payload->>'finish_date','')::timestamptz
      ELSE NULL END;

    v_exec_finish := CASE
      WHEN p_payload ? 'executedFinishDate' AND (p_payload->>'executedFinishDate') ~ '^[0-9]+$'
        THEN CASE WHEN (p_payload->>'executedFinishDate')::bigint = 0 THEN NULL
                  WHEN (p_payload->>'executedFinishDate')::bigint > 1000000000000
                    THEN to_timestamp((p_payload->>'executedFinishDate')::bigint / 1000.0)
                  ELSE to_timestamp((p_payload->>'executedFinishDate')::bigint) END
      ELSE NULL END;

    BEGIN
      v_data_rota := CASE
        WHEN nullif(btrim(p_payload->>'data_rota'), '') ~ '^\d{4}-\d{2}-\d{2}$'
          THEN to_date(btrim(p_payload->>'data_rota'), 'YYYY-MM-DD')
        ELSE NULL
      END;
    EXCEPTION WHEN OTHERS THEN
      v_data_rota := NULL;
    END;

    -- Área de risco no nível da rota (somente se o payload informar).
    v_rota_risco    := coalesce((p_payload->>'rota_area_risco')::boolean, false);
    v_risco_parcial := coalesce((p_payload->>'area_risco_parcial')::boolean, false);
    v_risco_motivo  := nullif(btrim(p_payload->>'motivo_area_risco'), '');
    v_risco_codigo  := nullif(btrim(p_payload->>'codigo_area_risco'), '');
    v_risco_origem  := nullif(btrim(p_payload->>'origem_area_risco'), '');
    IF v_risco_origem IS NOT NULL AND v_risco_origem NOT IN ('rota','parada','pacote','ocorrencia') THEN
      v_risco_origem := NULL;
    END IF;
    v_risco_valor := CASE WHEN p_payload ? 'valor_original_area_risco'
                          THEN p_payload->'valor_original_area_risco' ELSE NULL END;

    INSERT INTO public.meli_rotas (
      route_id, cluster, carrier, facility, data_rota, origem_importacao,
      base_id, route_status, route_substatus,
      driver_name, driver_id, vehicle_license,
      delivered_total, occurrence_total, pending_total, stops_total,
      init_date, finish_date, executed_finish_date, last_synced_at,
      rota_area_risco, area_risco_parcial, motivo_area_risco,
      codigo_area_risco, origem_area_risco, valor_original_area_risco,
      area_risco_detectado_em
    ) VALUES (
      v_route_id,
      nullif(btrim(p_payload->>'cluster'), ''),
      nullif(btrim(p_payload->>'carrier'), ''),
      v_facility,
      v_data_rota,
      v_importacao_id,
      v_base_id, v_route_status, v_route_substatus,
      v_driver_name, v_driver_id, v_vehicle,
      v_delivered, v_occurrence, v_pending, v_stops,
      v_init_date, v_finish_date, v_exec_finish, now(),
      v_rota_risco, v_risco_parcial, v_risco_motivo,
      v_risco_codigo, v_risco_origem, v_risco_valor,
      CASE WHEN v_rota_risco OR v_risco_parcial THEN now() ELSE NULL END
    )
    ON CONFLICT (route_id) DO UPDATE SET
      cluster              = COALESCE(EXCLUDED.cluster, public.meli_rotas.cluster),
      carrier              = COALESCE(EXCLUDED.carrier, public.meli_rotas.carrier),
      facility             = COALESCE(EXCLUDED.facility, public.meli_rotas.facility),
      data_rota            = COALESCE(EXCLUDED.data_rota, public.meli_rotas.data_rota),
      origem_importacao    = EXCLUDED.origem_importacao,
      base_id              = COALESCE(EXCLUDED.base_id, public.meli_rotas.base_id),
      route_status         = COALESCE(EXCLUDED.route_status, public.meli_rotas.route_status),
      route_substatus      = COALESCE(EXCLUDED.route_substatus, public.meli_rotas.route_substatus),
      driver_name          = COALESCE(EXCLUDED.driver_name, public.meli_rotas.driver_name),
      driver_id            = COALESCE(EXCLUDED.driver_id, public.meli_rotas.driver_id),
      vehicle_license      = COALESCE(EXCLUDED.vehicle_license, public.meli_rotas.vehicle_license),
      delivered_total      = COALESCE(EXCLUDED.delivered_total, public.meli_rotas.delivered_total),
      occurrence_total     = COALESCE(EXCLUDED.occurrence_total, public.meli_rotas.occurrence_total),
      pending_total        = COALESCE(EXCLUDED.pending_total, public.meli_rotas.pending_total),
      stops_total          = COALESCE(EXCLUDED.stops_total, public.meli_rotas.stops_total),
      init_date            = COALESCE(EXCLUDED.init_date, public.meli_rotas.init_date),
      finish_date          = COALESCE(EXCLUDED.finish_date, public.meli_rotas.finish_date),
      executed_finish_date = COALESCE(EXCLUDED.executed_finish_date, public.meli_rotas.executed_finish_date),
      last_synced_at       = now(),
      rota_area_risco      = public.meli_rotas.rota_area_risco OR EXCLUDED.rota_area_risco,
      area_risco_parcial   = public.meli_rotas.area_risco_parcial OR EXCLUDED.area_risco_parcial,
      motivo_area_risco    = COALESCE(EXCLUDED.motivo_area_risco, public.meli_rotas.motivo_area_risco),
      codigo_area_risco    = COALESCE(EXCLUDED.codigo_area_risco, public.meli_rotas.codigo_area_risco),
      origem_area_risco    = COALESCE(EXCLUDED.origem_area_risco, public.meli_rotas.origem_area_risco),
      valor_original_area_risco = COALESCE(EXCLUDED.valor_original_area_risco, public.meli_rotas.valor_original_area_risco),
      area_risco_detectado_em = COALESCE(public.meli_rotas.area_risco_detectado_em, EXCLUDED.area_risco_detectado_em)
    RETURNING id INTO v_rota_id;

    PERFORM 1 FROM public.meli_rotas WHERE id = v_rota_id FOR UPDATE;

    INSERT INTO public.meli_rotas_payload (rota_id, raw_payload)
    VALUES (v_rota_id, p_payload)
    ON CONFLICT (rota_id) DO UPDATE SET raw_payload = EXCLUDED.raw_payload;

    WITH raw AS (
      SELECT
        ord AS pos,
        nullif(btrim(elem->>'tracking_id'), '') AS tracking_id,
        nullif(btrim(elem->>'shipment_id'), '') AS shipment_id,
        nullif(btrim(elem->>'destinatario'), '') AS destinatario,
        nullif(btrim(elem->>'endereco'), '') AS endereco,
        nullif(btrim(elem->>'bairro'), '') AS bairro,
        nullif(btrim(elem->>'cidade'), '') AS cidade,
        nullif(btrim(elem->>'uf'), '') AS uf,
        nullif(btrim(elem->>'cep'), '') AS cep,
        nullif(btrim(elem->>'status'), '') AS status,
        nullif(btrim(elem->>'substatus'), '') AS substatus,
        nullif(btrim(coalesce(elem->>'occurrence_code', elem->>'occurrenceCode')), '') AS occurrence_code,
        nullif(btrim(coalesce(elem->>'stop_id', elem->>'stopId')), '') AS stop_id,
        nullif(btrim(elem->>'printed_label'), '') AS printed_label,
        coalesce((elem->>'area_risco')::boolean, (elem->>'pacote_area_risco')::boolean, false) AS area_risco,
        nullif(btrim(elem->>'motivo_area_risco'), '') AS motivo_area_risco,
        nullif(btrim(elem->>'codigo_area_risco'), '') AS codigo_area_risco,
        CASE WHEN nullif(btrim(elem->>'origem_area_risco'), '') IN ('rota','parada','pacote','ocorrencia')
             THEN btrim(elem->>'origem_area_risco') END AS origem_area_risco,
        CASE WHEN elem ? 'valor_original_area_risco' THEN elem->'valor_original_area_risco' END AS valor_original_area_risco,
        coalesce(elem->>'ordem', elem->>'sequencia') AS sequencia_raw,
        public._meli_safe_int(coalesce(elem->>'ordem', elem->>'sequencia')) AS ordem_int
      FROM jsonb_array_elements(v_pacotes) WITH ORDINALITY AS t(elem, ord)
    ),
    validos AS (SELECT * FROM raw WHERE tracking_id IS NOT NULL),
    dedup AS (
      SELECT DISTINCT ON (tracking_id) *
      FROM validos
      ORDER BY tracking_id, pos DESC
    ),
    up AS (
      INSERT INTO public.meli_pacotes (
        rota_id, tracking_id, shipment_id, destinatario, endereco,
        bairro, cidade, uf, cep, status, substatus, occurrence_code,
        stop_id, printed_label, ordem,
        pacote_area_risco, motivo_area_risco, codigo_area_risco,
        origem_area_risco, valor_original_area_risco, area_risco_detectado_em,
        last_synced_at
      )
      SELECT v_rota_id, tracking_id, shipment_id, destinatario, endereco,
             bairro, cidade, uf, cep, status, substatus, occurrence_code,
             stop_id, printed_label, ordem_int,
             area_risco, motivo_area_risco, codigo_area_risco,
             origem_area_risco, valor_original_area_risco,
             CASE WHEN area_risco THEN now() END,
             now()
      FROM dedup
      ON CONFLICT (rota_id, tracking_id) DO UPDATE SET
        shipment_id     = EXCLUDED.shipment_id,
        destinatario    = EXCLUDED.destinatario,
        endereco        = EXCLUDED.endereco,
        bairro          = EXCLUDED.bairro,
        cidade          = EXCLUDED.cidade,
        uf              = EXCLUDED.uf,
        cep             = EXCLUDED.cep,
        status          = EXCLUDED.status,
        substatus       = EXCLUDED.substatus,
        occurrence_code = EXCLUDED.occurrence_code,
        stop_id         = EXCLUDED.stop_id,
        printed_label   = EXCLUDED.printed_label,
        ordem           = EXCLUDED.ordem,
        pacote_area_risco = public.meli_pacotes.pacote_area_risco OR EXCLUDED.pacote_area_risco,
        motivo_area_risco = COALESCE(EXCLUDED.motivo_area_risco, public.meli_pacotes.motivo_area_risco),
        codigo_area_risco = COALESCE(EXCLUDED.codigo_area_risco, public.meli_pacotes.codigo_area_risco),
        origem_area_risco = COALESCE(EXCLUDED.origem_area_risco, public.meli_pacotes.origem_area_risco),
        valor_original_area_risco = COALESCE(EXCLUDED.valor_original_area_risco, public.meli_pacotes.valor_original_area_risco),
        area_risco_detectado_em = COALESCE(public.meli_pacotes.area_risco_detectado_em, EXCLUDED.area_risco_detectado_em),
        last_synced_at  = now()
      RETURNING (xmax = 0) AS inserted
    ),
    stats AS (
      SELECT
        (SELECT count(*) FROM raw)::int      AS recebidos,
        (SELECT count(*) FROM raw WHERE tracking_id IS NULL)::int AS invalidos,
        (SELECT count(*) FROM dedup)::int    AS unicos,
        ((SELECT count(*) FROM validos) - (SELECT count(*) FROM dedup))::int AS duplicados,
        (SELECT count(*) FROM raw
           WHERE tracking_id IS NOT NULL
             AND sequencia_raw IS NOT NULL AND sequencia_raw <> ''
             AND ordem_int IS NULL)::int     AS ordem_invalida,
        (SELECT count(*) FROM up WHERE inserted)::int      AS inseridos,
        (SELECT count(*) FROM up WHERE NOT inserted)::int  AS atualizados
    )
    SELECT recebidos, invalidos, unicos, duplicados, ordem_invalida, inseridos, atualizados
    INTO v_recebidos, v_invalidos, v_unicos, v_duplicados, v_ordem_invalida, v_inseridos, v_atualizados
    FROM stats;

    v_inalterados := v_unicos - v_inseridos - v_atualizados;

    UPDATE public.meli_rotas
    SET total_pacotes = (SELECT count(*) FROM public.meli_pacotes WHERE rota_id = v_rota_id),
        total_impressos = (SELECT count(*) FROM public.meli_pacotes
                            WHERE rota_id = v_rota_id
                              AND printed_label IS NOT NULL AND printed_label <> ''),
        area_risco_parcial = CASE
          WHEN rota_area_risco THEN false
          ELSE EXISTS (SELECT 1 FROM public.meli_pacotes
                        WHERE rota_id = v_rota_id AND pacote_area_risco)
        END
    WHERE id = v_rota_id;

    v_status := 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    v_erro := SQLERRM;
    v_status := 'erro';
    v_recebidos := 0; v_unicos := 0; v_inseridos := 0; v_atualizados := 0;
    v_inalterados := 0; v_invalidos := 0; v_duplicados := 0; v_ordem_invalida := 0;
    v_rota_id := NULL;
  END;

  UPDATE public.meli_importacoes
  SET status = v_status,
      total_rotas = CASE WHEN v_status = 'ok' THEN 1 ELSE 0 END,
      total_pacotes = v_inseridos + v_atualizados,
      total_erros = CASE WHEN v_status = 'erro' THEN 1 ELSE 0 END,
      mensagem_erro = v_erro,
      finalizado_em = now()
  WHERE id = v_importacao_id;

  IF v_status = 'erro' THEN
    RETURN jsonb_build_object(
      'status','erro','erro',v_erro,'sqlstate',v_sqlstate,
      'importacao_id',v_importacao_id
    );
  END IF;

  RETURN jsonb_build_object(
    'status','ok',
    'importacao_id', v_importacao_id,
    'rota_id', v_rota_id,
    'route_id', v_route_id,
    'pacotes_recebidos', v_recebidos,
    'pacotes_unicos', v_unicos,
    'pacotes_inseridos', v_inseridos,
    'pacotes_atualizados', v_atualizados,
    'pacotes_inalterados', v_inalterados,
    'pacotes_invalidos', v_invalidos,
    'pacotes_duplicados_no_payload', v_duplicados,
    'pacotes_com_ordem_invalida', v_ordem_invalida
  );
END;
$function$;

-- ── Publicação operacional: grava o nome operacional (cluster) em nro_rota.
-- planejada/otimizada continuam com route_id (identidade técnica usada na Triagem).
CREATE OR REPLACE FUNCTION public.meli_publicar_rota_operacional(p_rota_id uuid, p_data_operacional date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rota          public.meli_rotas;
  v_base_id       uuid;
  v_dia           date;
  v_importacao_id uuid;
  v_nome_op       text;
  v_inseridos     integer := 0;
  v_atualizados   integer := 0;
  v_total         integer := 0;
  v_rotas         integer := 0;
  v_motoristas    integer := 0;
BEGIN
  IF NOT public.meli_pode_operar() THEN
    RETURN jsonb_build_object('status','erro','erro','sem_permissao');
  END IF;

  SELECT * INTO v_rota FROM public.meli_rotas WHERE id = p_rota_id;
  IF v_rota.id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','rota_nao_encontrada');
  END IF;

  v_base_id := v_rota.base_id;
  IF v_base_id IS NULL AND v_rota.facility IS NOT NULL THEN
    SELECT b.id INTO v_base_id
      FROM public.bases b
     WHERE b.meli_service_center_id = v_rota.facility
     LIMIT 1;
  END IF;
  IF v_base_id IS NULL THEN
    RETURN jsonb_build_object('status','erro','erro','base_nao_mapeada','facility',v_rota.facility);
  END IF;

  -- Dia operacional da rota: NUNCA a data de finalização.
  v_dia := COALESCE(p_data_operacional, v_rota.data_rota,
                    (v_rota.init_date AT TIME ZONE 'America/Sao_Paulo')::date,
                    (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_nome_op := COALESCE(nullif(btrim(v_rota.cluster), ''), v_rota.route_id);

  SELECT i.id INTO v_importacao_id
    FROM public.importacoes_escala i
   WHERE i.base_id = v_base_id
     AND i.data_operacional = v_dia
     AND i.ativa = true
   ORDER BY i.importado_em DESC
   LIMIT 1;

  IF v_importacao_id IS NULL THEN
    INSERT INTO public.importacoes_escala (
      base_id, data_operacional, versao, ativa, importado_por,
      arquivo_nome, total_linhas, total_pacotes, total_motoristas, total_rotas
    ) VALUES (
      v_base_id, v_dia,
      COALESCE((SELECT MAX(versao) FROM public.importacoes_escala
                 WHERE base_id = v_base_id AND data_operacional = v_dia), 0) + 1,
      true, auth.uid(),
      'meli:' || v_rota.route_id, 0, 0, 0, 0
    ) RETURNING id INTO v_importacao_id;
  END IF;

  WITH upd AS (
    UPDATE public.escalas e
       SET otimizada     = v_rota.route_id,
           planejada     = COALESCE(e.planejada, v_rota.route_id),
           nro_rota      = v_nome_op,
           cidade        = COALESCE(p.cidade, e.cidade),
           bairro        = COALESCE(p.bairro, e.bairro),
           cep           = COALESCE(p.cep, e.cep),
           rua           = COALESCE(p.endereco, e.rua),
           driver        = COALESCE(v_rota.driver_name, e.driver),
           placa         = COALESCE(v_rota.vehicle_license, e.placa),
           facility_id   = COALESCE(v_rota.facility, e.facility_id),
           transportadora= COALESCE(v_rota.carrier, e.transportadora),
           cluster       = COALESCE(v_rota.cluster, e.cluster),
           ordem         = COALESCE(p.ordem, e.ordem)
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND e.importacao_id = v_importacao_id
       AND (e.meli_pacote_id = p.id OR e.shipment = p.tracking_id)
    RETURNING e.id
  )
  SELECT count(*) INTO v_atualizados FROM upd;

  UPDATE public.escalas e
     SET meli_pacote_id = p.id
    FROM public.meli_pacotes p
   WHERE p.rota_id = v_rota.id
     AND e.importacao_id = v_importacao_id
     AND e.meli_pacote_id IS NULL
     AND e.shipment = p.tracking_id;

  WITH ins AS (
    INSERT INTO public.escalas (
      base_id, data_referencia, importacao_id, meli_pacote_id,
      shipment, planejada, otimizada, nro_rota, cluster,
      cidade, bairro, cep, rua, ordem,
      driver, placa, facility_id, transportadora,
      importado_por, triado, recebido, devolvido
    )
    SELECT v_base_id, v_dia, v_importacao_id, p.id,
           p.tracking_id, v_rota.route_id, v_rota.route_id, v_nome_op, v_rota.cluster,
           p.cidade, p.bairro, p.cep, p.endereco, p.ordem,
           v_rota.driver_name, v_rota.vehicle_license, v_rota.facility, v_rota.carrier,
           auth.uid(), false, false, false
      FROM public.meli_pacotes p
     WHERE p.rota_id = v_rota.id
       AND p.tracking_id IS NOT NULL
       AND p.tracking_id <> ''
       AND NOT EXISTS (
         SELECT 1 FROM public.escalas e2
          WHERE e2.importacao_id = v_importacao_id
            AND (e2.meli_pacote_id = p.id OR e2.shipment = p.tracking_id)
       )
    RETURNING id
  )
  SELECT count(*) INTO v_inseridos FROM ins;

  SELECT count(*), count(DISTINCT COALESCE(NULLIF(otimizada,''), planejada)), count(DISTINCT driver)
    INTO v_total, v_rotas, v_motoristas
    FROM public.escalas
   WHERE importacao_id = v_importacao_id;

  UPDATE public.importacoes_escala
     SET total_linhas = v_total,
         total_pacotes = v_total,
         total_rotas = v_rotas,
         total_motoristas = v_motoristas,
         updated_at = now()
   WHERE id = v_importacao_id;

  RETURN jsonb_build_object(
    'status','ok',
    'rota_id', v_rota.id,
    'route_id', v_rota.route_id,
    'nome_operacional', v_nome_op,
    'base_id', v_base_id,
    'data_operacional', v_dia,
    'importacao_id', v_importacao_id,
    'esperados_inseridos', v_inseridos,
    'esperados_atualizados', v_atualizados,
    'total_importacao', v_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('status','erro','erro', SQLERRM, 'sqlstate', SQLSTATE);
END;
$function$;
-- ==== fim 20260802153530_458f7175-9974-4d35-bf69-5bf9bd03f430.sql ====
