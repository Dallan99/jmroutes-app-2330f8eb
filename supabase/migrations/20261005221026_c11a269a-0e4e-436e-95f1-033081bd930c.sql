BEGIN;

-- =====================================================================
-- Fundação mínima Meli — piloto isolado (DRY_RUN)
-- Nenhuma FK/trigger para tabelas operacionais (rotas, escalas,
-- recebimentos, pagamentos). Única referência: cadastro public.bases.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.meli_piloto_ciclos (
  id uuid PRIMARY KEY,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  base_codigo text NOT NULL,
  service_center text NOT NULL,
  instancia text NOT NULL,
  versao_worker text,
  dry_run boolean NOT NULL,
  status text NOT NULL DEFAULT 'em_andamento',
  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz,
  paginas_esperadas integer,
  paginas_lidas integer NOT NULL DEFAULT 0,
  rotas_esperadas integer,
  rotas_recebidas integer NOT NULL DEFAULT 0,
  pacotes_esperados integer,
  pacotes_recebidos integer NOT NULL DEFAULT 0,
  erro text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_ciclos_status_chk CHECK (status IN ('em_andamento','concluido','erro','parcial')),
  CONSTRAINT meli_piloto_ciclos_dry_run_chk CHECK (dry_run = true)
);
CREATE INDEX IF NOT EXISTS meli_piloto_ciclos_base_idx ON public.meli_piloto_ciclos (base_id, iniciado_em DESC);

CREATE TABLE IF NOT EXISTS public.meli_piloto_paginas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id uuid NOT NULL REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  recurso text NOT NULL DEFAULT 'rotas',
  numero integer NOT NULL,
  offset_inicial integer,
  total_informado integer,
  itens_recebidos integer NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ok',
  coletado_em timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_paginas_uk UNIQUE (ciclo_id, recurso, numero),
  CONSTRAINT meli_piloto_paginas_status_chk CHECK (status IN ('ok','erro'))
);

CREATE TABLE IF NOT EXISTS public.meli_piloto_staging (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id uuid NOT NULL REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  recurso text NOT NULL,
  pagina integer,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL,
  coletado_em timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_staging_uk UNIQUE (ciclo_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS meli_piloto_staging_coletado_idx ON public.meli_piloto_staging (coletado_em);

CREATE TABLE IF NOT EXISTS public.meli_piloto_rotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  base_codigo text NOT NULL,
  data_rota date NOT NULL,
  route_id text NOT NULL,
  driver_id text,
  motorista_nome text,
  placa text,
  total_pedidos integer,
  total_entregue integer,
  payload jsonb NOT NULL,
  coletado_em timestamptz NOT NULL,
  primeiro_ciclo_id uuid NOT NULL REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  ultimo_ciclo_id uuid NOT NULL REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_rotas_uk UNIQUE (route_id, data_rota),
  CONSTRAINT meli_piloto_rotas_totais_chk CHECK (coalesce(total_pedidos,0) >= 0 AND coalesce(total_entregue,0) >= 0)
);
CREATE INDEX IF NOT EXISTS meli_piloto_rotas_base_data_idx ON public.meli_piloto_rotas (base_id, data_rota);
CREATE INDEX IF NOT EXISTS meli_piloto_rotas_ciclo_idx ON public.meli_piloto_rotas (ultimo_ciclo_id);

CREATE TABLE IF NOT EXISTS public.meli_piloto_pacotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  route_id text NOT NULL,
  shipment_id text NOT NULL,
  status text,
  payload jsonb NOT NULL,
  coletado_em timestamptz NOT NULL,
  ultimo_ciclo_id uuid NOT NULL REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_pacotes_uk UNIQUE (shipment_id, route_id)
);
CREATE INDEX IF NOT EXISTS meli_piloto_pacotes_rota_idx ON public.meli_piloto_pacotes (route_id);
CREATE INDEX IF NOT EXISTS meli_piloto_pacotes_ciclo_idx ON public.meli_piloto_pacotes (ultimo_ciclo_id);

CREATE TABLE IF NOT EXISTS public.meli_piloto_erros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ciclo_id uuid REFERENCES public.meli_piloto_ciclos(id) ON DELETE RESTRICT,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  etapa text NOT NULL,
  codigo text,
  mensagem text NOT NULL,
  detalhe jsonb,
  ocorrido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meli_piloto_erros_ciclo_idx ON public.meli_piloto_erros (ciclo_id);

CREATE TABLE IF NOT EXISTS public.meli_piloto_heartbeat (
  instancia text PRIMARY KEY,
  bases text[] NOT NULL,
  host text,
  regiao text,
  ambiente text,
  versao_worker text,
  dry_run boolean NOT NULL,
  sessao_adminml text NOT NULL,
  sessao_verificada_em timestamptz,
  ultimo_sinal_em timestamptz NOT NULL,
  ultimo_ciclo_id uuid,
  detalhe jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_piloto_heartbeat_sessao_chk CHECK (sessao_adminml IN ('valida','expirada','ausente','desconhecida'))
);

-- Grants: leitura para usuários autenticados (filtrada por RLS); escrita só service_role
DO $g$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meli_piloto_ciclos','meli_piloto_paginas','meli_piloto_staging','meli_piloto_rotas','meli_piloto_pacotes','meli_piloto_erros','meli_piloto_heartbeat'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $g$;

-- RLS: leitura por base (has_base_access já cobre admin e gerente)
DO $p$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meli_piloto_ciclos','meli_piloto_paginas','meli_piloto_staging','meli_piloto_rotas','meli_piloto_pacotes','meli_piloto_erros'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_leitura_base', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_base_access(auth.uid(), base_id))', t||'_leitura_base', t);
  END LOOP;
END $p$;
DROP POLICY IF EXISTS meli_piloto_heartbeat_leitura_gestao ON public.meli_piloto_heartbeat;
CREATE POLICY meli_piloto_heartbeat_leitura_gestao ON public.meli_piloto_heartbeat FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'gerente') OR public.has_role(auth.uid(),'supervisor'));

DROP TRIGGER IF EXISTS trg_meli_piloto_ciclos_touch ON public.meli_piloto_ciclos;
CREATE TRIGGER trg_meli_piloto_ciclos_touch BEFORE UPDATE ON public.meli_piloto_ciclos FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
DROP TRIGGER IF EXISTS trg_meli_piloto_rotas_touch ON public.meli_piloto_rotas;
CREATE TRIGGER trg_meli_piloto_rotas_touch BEFORE UPDATE ON public.meli_piloto_rotas FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
DROP TRIGGER IF EXISTS trg_meli_piloto_pacotes_touch ON public.meli_piloto_pacotes;
CREATE TRIGGER trg_meli_piloto_pacotes_touch BEFORE UPDATE ON public.meli_piloto_pacotes FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- =====================================================================
-- Ingestão idempotente (SECURITY INVOKER; só service_role executa)
-- =====================================================================
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

  INSERT INTO public.meli_piloto_ciclos AS t (id, base_id, base_codigo, service_center, instancia, versao_worker, dry_run, status, iniciado_em,
    finalizado_em, paginas_esperadas, rotas_esperadas, pacotes_esperados, erro)
  VALUES (v_ciclo, v_base, v_cod, c->>'service_center', c->>'instancia', c->>'versao_worker', true,
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
    upper(regexp_replace(coalesce(r->>'placa',''), '[^A-Za-z0-9]', '', 'g')),
    (r->>'total_pedidos')::int, (r->>'total_entregue')::int, coalesce(r->'payload','{}'::jsonb), v_agora, v_ciclo, v_ciclo
  FROM jsonb_array_elements(coalesce(p->'rotas','[]'::jsonb)) r
  WHERE coalesce(r->>'route_id','') <> '' AND r->>'data_rota' IS NOT NULL
  ON CONFLICT (route_id, data_rota) DO UPDATE SET
    driver_id = EXCLUDED.driver_id, motorista_nome = EXCLUDED.motorista_nome, placa = nullif(EXCLUDED.placa,''),
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

CREATE OR REPLACE FUNCTION public.meli_piloto_registrar_heartbeat(p jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $f$
BEGIN
  IF coalesce(auth.role(), current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE = '42501';
  END IF;
  IF coalesce((p->>'dry_run')::boolean, false) IS NOT TRUE THEN RAISE EXCEPTION 'Piloto aceita somente DRY_RUN=true'; END IF;
  INSERT INTO public.meli_piloto_heartbeat AS t (instancia, bases, host, regiao, ambiente, versao_worker, dry_run, sessao_adminml,
    sessao_verificada_em, ultimo_sinal_em, ultimo_ciclo_id, detalhe)
  VALUES (p->>'instancia', ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'bases','[]'::jsonb))), p->>'host', p->>'regiao',
    p->>'ambiente', p->>'versao_worker', true, coalesce(p->>'sessao_adminml','desconhecida'),
    (p->>'sessao_verificada_em')::timestamptz, now(), (p->>'ultimo_ciclo_id')::uuid, p->'detalhe')
  ON CONFLICT (instancia) DO UPDATE SET bases = EXCLUDED.bases, host = EXCLUDED.host, regiao = EXCLUDED.regiao,
    ambiente = EXCLUDED.ambiente, versao_worker = EXCLUDED.versao_worker, sessao_adminml = EXCLUDED.sessao_adminml,
    sessao_verificada_em = coalesce(EXCLUDED.sessao_verificada_em, t.sessao_verificada_em), ultimo_sinal_em = now(),
    ultimo_ciclo_id = coalesce(EXCLUDED.ultimo_ciclo_id, t.ultimo_ciclo_id), detalhe = EXCLUDED.detalhe;
END $f$;

REVOKE ALL ON FUNCTION public.meli_piloto_ingerir_lote(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meli_piloto_registrar_heartbeat(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meli_piloto_ingerir_lote(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.meli_piloto_registrar_heartbeat(jsonb) TO service_role;

-- Verificação final: nada executável por PUBLIC/anon/authenticated
DO $v$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc pr JOIN pg_namespace ns ON ns.oid = pr.pronamespace,
       LATERAL aclexplode(COALESCE(pr.proacl, acldefault('f', pr.proowner))) a
  WHERE ns.nspname = 'public' AND pr.proname IN ('meli_piloto_ingerir_lote','meli_piloto_registrar_heartbeat')
    AND a.privilege_type = 'EXECUTE'
    AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated')));
  IF n > 0 THEN RAISE EXCEPTION 'Funções do piloto executáveis por PUBLIC/anon/authenticated'; END IF;
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
  WHERE ns.nspname='public' AND c.relname LIKE 'meli_piloto_%' AND c.relkind='r' AND NOT c.relrowsecurity;
  IF n > 0 THEN RAISE EXCEPTION 'Tabela do piloto sem RLS'; END IF;
END $v$;

COMMIT;