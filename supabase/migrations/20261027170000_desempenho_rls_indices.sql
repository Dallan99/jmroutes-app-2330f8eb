-- Desempenho do banco (27/10/2026): RLS barata, índices do dashboard/piloto e
-- Realtime fora das tabelas que o coletor do Meli grava em massa.
--
-- Nenhuma regra de acesso muda: as policies continuam permitindo exatamente as
-- mesmas linhas. Só a forma de avaliar fica mais barata.

-- 1) Funções de permissão como SECURITY DEFINER (padrão Supabase/Lovable).
--    Como INVOKER, cada chamada consultava user_roles/profiles/user_bases com
--    RLS, e essas policies chamam has_role de novo: RLS aninhada, por linha.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    _base_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'admin')
      OR public.has_role(_user_id, 'gerente')
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
      OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id)
    );
$$;
REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) TO authenticated, service_role;

-- Bases permitidas do usuário, calculadas uma vez por consulta (initPlan) em vez
-- de uma chamada de has_base_access para cada linha.
CREATE OR REPLACE FUNCTION public.bases_permitidas_atual()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(array_agg(b.id), '{}'::uuid[])
  FROM public.bases b
  WHERE public.has_base_access(auth.uid(), b.id);
$$;
REVOKE EXECUTE ON FUNCTION public.bases_permitidas_atual() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bases_permitidas_atual() TO authenticated, service_role;

-- 2) Policies de leitura das tabelas quentes, reescritas com (SELECT ...) para
--    o Postgres avaliar uma vez por consulta. Cada uma só é recriada se já
--    existir, com o mesmo nome e o mesmo alvo, para não ampliar acesso.
DO $pol$
DECLARE
  r record;
  alvo text;
BEGIN
  -- Piloto Meli: leitura por base.
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('meli_piloto_ciclos','meli_piloto_paginas','meli_piloto_staging','meli_piloto_rotas','meli_piloto_pacotes','meli_piloto_erros')
      AND policyname = tablename || '_leitura_base'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (base_id = ANY ((SELECT public.bases_permitidas_atual())::uuid[]))', r.policyname, r.tablename);
  END LOOP;

  -- rotas
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rotas' AND policyname='base access rotas select') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='rotas' AND policyname='base access rotas select';
    DROP POLICY "base access rotas select" ON public.rotas;
    EXECUTE format('CREATE POLICY "base access rotas select" ON public.rotas FOR SELECT TO %s USING (base_id = ANY ((SELECT public.bases_permitidas_atual())::uuid[]))', alvo);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='rotas' AND policyname='staff read rotas') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='rotas' AND policyname='staff read rotas';
    DROP POLICY "staff read rotas" ON public.rotas;
    EXECUTE format($q$CREATE POLICY "staff read rotas" ON public.rotas FOR SELECT TO %s USING (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'gerente'::app_role))
      OR base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()))
      OR base_origem_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()))
    )$q$, alvo);
  END IF;

  -- volumes
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='volumes' AND policyname='base access volumes select') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='volumes' AND policyname='base access volumes select';
    DROP POLICY "base access volumes select" ON public.volumes;
    EXECUTE format($q$CREATE POLICY "base access volumes select" ON public.volumes FOR SELECT TO %s USING (
      rota_id IN (SELECT r.id FROM public.rotas r WHERE r.base_id = ANY ((SELECT public.bases_permitidas_atual())::uuid[]))
    )$q$, alvo);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='volumes' AND policyname='staff read volumes in own base') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='volumes' AND policyname='staff read volumes in own base';
    DROP POLICY "staff read volumes in own base" ON public.volumes;
    EXECUTE format($q$CREATE POLICY "staff read volumes in own base" ON public.volumes FOR SELECT TO %s USING (
      (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'gerente'::app_role))
      OR rota_id IN (
        SELECT r.id FROM public.rotas r
        WHERE r.base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()))
           OR r.base_origem_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = (SELECT auth.uid()))
      )
    )$q$, alvo);
  END IF;

  -- recebimentos
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' AND policyname='base access recebimentos select') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' AND policyname='base access recebimentos select';
    DROP POLICY "base access recebimentos select" ON public.recebimentos;
    EXECUTE format($q$CREATE POLICY "base access recebimentos select" ON public.recebimentos FOR SELECT TO %s USING (
      operador_id = (SELECT auth.uid()) OR base_id = ANY ((SELECT public.bases_permitidas_atual())::uuid[])
    )$q$, alvo);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' AND policyname='operador le proprio') THEN
    SELECT array_to_string(roles, ', ') INTO alvo FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' AND policyname='operador le proprio';
    DROP POLICY "operador le proprio" ON public.recebimentos;
    EXECUTE format($q$CREATE POLICY "operador le proprio" ON public.recebimentos FOR SELECT TO %s USING (
      operador_id = (SELECT auth.uid())
      OR (SELECT public.has_role((SELECT auth.uid()), 'supervisor'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'gerente'::app_role))
    )$q$, alvo);
  END IF;
END
$pol$;

-- 3) Índices das consultas do dashboard, painel operacional e piloto.
DO $idx$
BEGIN
  IF to_regclass('public.meli_piloto_ciclos') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS meli_piloto_ciclos_iniciado_idx ON public.meli_piloto_ciclos (iniciado_em DESC)'; END IF;
  IF to_regclass('public.meli_piloto_rotas') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS meli_piloto_rotas_data_idx ON public.meli_piloto_rotas (data_rota)'; END IF;
  IF to_regclass('public.rotas') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS rotas_data_expedicao_idx ON public.rotas (data_expedicao)'; END IF;
  IF to_regclass('public.rotas') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS rotas_base_id_idx ON public.rotas (base_id)'; END IF;
  IF to_regclass('public.recebimentos') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS recebimentos_base_created_idx ON public.recebimentos (base_id, created_at DESC)'; END IF;
  IF to_regclass('public.user_roles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS user_roles_user_role_idx ON public.user_roles (user_id, role)'; END IF;
  IF to_regclass('public.user_bases') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS user_bases_user_base_idx ON public.user_bases (user_id, base_id)'; END IF;
  IF to_regclass('public.profiles') IS NOT NULL THEN EXECUTE 'CREATE INDEX IF NOT EXISTS profiles_base_id_idx ON public.profiles (base_id)'; END IF;
END
$idx$;

-- 4) Realtime: o coletor grava milhares de linhas em rotas/recebimentos por
--    ciclo; o app não assina mais essas tabelas.
DO $rt$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'recebimentos') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.recebimentos;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rotas') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.rotas;
  END IF;
END
$rt$;

DO $ana$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meli_piloto_ciclos','meli_piloto_rotas','rotas','volumes','recebimentos'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN EXECUTE format('ANALYZE public.%I', t); END IF;
  END LOOP;
END
$ana$;
