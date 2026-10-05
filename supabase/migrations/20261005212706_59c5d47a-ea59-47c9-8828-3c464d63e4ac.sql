-- =====================================================================
-- Gate de segurança da parte 1 — JM novo (zfmwojloamwggahjxlyt)
-- PROPOSTA. Não executar sem aprovação explícita.
-- Repetível: pode rodar mais de uma vez sem efeito colateral.
-- Transação única: qualquer exceção antes do COMMIT desfaz tudo.
--
-- Como conceder o primeiro administrador (depois do convite aceito):
--   SQL Editor do Supabase (sessão postgres), em transação própria:
--     SELECT privado.conceder_admin_inicial('dallanr@gmail.com');
--   O schema privado não é exposto pela API; não usar supabase.rpc().
-- Não cria usuários, senhas, sessões, convites nem dados de teste.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Pré-validações (abortam e desfazem tudo se o banco divergir do esperado)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- audit_logs.entidade_id precisa ser texto (compatível com length())
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema='public' AND table_name='audit_logs' AND column_name='entidade_id')
     NOT IN ('text','character varying') THEN
    RAISE EXCEPTION 'Pré-validação: audit_logs.entidade_id não é texto.';
  END IF;
  -- audit_logs.user_id precisa aceitar NULL (registros feitos pelo servidor)
  IF (SELECT is_nullable FROM information_schema.columns
       WHERE table_schema='public' AND table_name='audit_logs' AND column_name='user_id') <> 'YES' THEN
    RAISE EXCEPTION 'Pré-validação: audit_logs.user_id não aceita NULL.';
  END IF;
  -- user_roles precisa ter índice único exatamente em (user_id, role)
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.user_roles'::regclass AND i.indisunique
       AND (SELECT array_agg(a.attname::text ORDER BY k.ord)
              FROM unnest(i.indkey) WITH ORDINALITY k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum)
           = ARRAY['user_id','role']
  ) THEN
    RAISE EXCEPTION 'Pré-validação: user_roles sem índice único (user_id, role).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 0) Schema privado para funções privilegiadas
--    Não exposto pela API; nenhum papel de cliente tem USAGE.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS privado;
REVOKE ALL ON SCHEMA privado FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA privado TO service_role;
-- Funções criadas no futuro neste schema não nascem executáveis por PUBLIC.
ALTER DEFAULT PRIVILEGES IN SCHEMA privado REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 1) Funções usadas pelas RLS
--    Ficam em public porque as 50 políticas as referenciam por nome.
--    SECURITY DEFINER evita recursão de RLS em user_roles/profiles.
--    search_path vazio; todos os nomes qualificados.
--    EXECUTE preservado explicitamente apenas para authenticated e service_role.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id AND p.ativo
    WHERE ur.user_id = _user_id AND ur.role = _role
  )
$$;

CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT _base_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.ativo)
    AND (
      public.has_role(_user_id, 'admin'::public.app_role)
      OR public.has_role(_user_id, 'gerente'::public.app_role)
      OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
      OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id)
    )
$$;

CREATE OR REPLACE FUNCTION public.get_allowed_bases(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT b.id FROM public.bases b WHERE public.has_base_access(_user_id, b.id)
$$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid)          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)  TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.has_base_access(uuid, uuid)      TO authenticated, service_role;
GRANT  EXECUTE ON FUNCTION public.get_allowed_bases(uuid)          TO authenticated, service_role;

-- Helper: chamada feita pelo servidor (service_role)?
CREATE OR REPLACE FUNCTION privado.eh_servidor()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role'
$$;

-- ---------------------------------------------------------------------
-- 2) Novos usuários: perfil pendente (inativo), sem papel e sem base
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION privado.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email, ativo, base_id)
  VALUES (NEW.id,
          COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
          NEW.email, false, NULL)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION privado.handle_new_user();
DROP FUNCTION IF EXISTS public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3) Proteção do papel admin (move para privado)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION privado.prevent_admin_role_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF privado.eh_servidor() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF (TG_OP IN ('INSERT','UPDATE') AND NEW.role = 'admin'::public.app_role)
     OR (TG_OP IN ('UPDATE','DELETE') AND OLD.role = 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Papel administrador só pode ser alterado pela rotina protegida do servidor.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_prevent_admin_role_grant ON public.user_roles;
CREATE TRIGGER trg_prevent_admin_role_grant BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION privado.prevent_admin_role_grant();
DROP FUNCTION IF EXISTS public.prevent_admin_role_grant();

-- ---------------------------------------------------------------------
-- 4) Ninguém altera os próprios papéis, bases ou situação
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION privado.bloquear_autoprivilegio()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF privado.eh_servidor() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF auth.uid() IS NULL
     OR (TG_OP <> 'DELETE' AND NEW.user_id = auth.uid())
     OR (TG_OP <> 'INSERT' AND OLD.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'Não é permitido alterar os próprios papéis ou bases.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
DROP TRIGGER IF EXISTS trg_bloquear_autoprivilegio_roles ON public.user_roles;
CREATE TRIGGER trg_bloquear_autoprivilegio_roles BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION privado.bloquear_autoprivilegio();
DROP TRIGGER IF EXISTS trg_bloquear_autoprivilegio_bases ON public.user_bases;
CREATE TRIGGER trg_bloquear_autoprivilegio_bases BEFORE INSERT OR UPDATE OR DELETE ON public.user_bases
  FOR EACH ROW EXECUTE FUNCTION privado.bloquear_autoprivilegio();

CREATE OR REPLACE FUNCTION privado.proteger_campos_perfil()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF privado.eh_servidor() THEN RETURN NEW; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Identificador e e-mail do perfil não podem ser alterados.' USING ERRCODE = '42501';
  END IF;
  IF NEW.base_id IS DISTINCT FROM OLD.base_id OR NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    IF auth.uid() = OLD.id THEN
      RAISE EXCEPTION 'Não é permitido alterar a própria base ou situação.' USING ERRCODE = '42501';
    END IF;
    IF NOT (public.has_role(auth.uid(), 'admin'::public.app_role)
            OR public.has_role(auth.uid(), 'gerente'::public.app_role)) THEN
      RAISE EXCEPTION 'Somente administrador ou gerente altera base e situação.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_campos_perfil ON public.profiles;
CREATE TRIGGER trg_proteger_campos_perfil BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION privado.proteger_campos_perfil();

DROP POLICY IF EXISTS "gerentes insert profiles" ON public.profiles;
CREATE POLICY "gerentes insert profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id <> auth.uid()
    AND (public.has_role(auth.uid(), 'gerente'::public.app_role)
         OR public.has_role(auth.uid(), 'admin'::public.app_role)));

-- ---------------------------------------------------------------------
-- 5) Auditoria: sem inserção direta pelo app, tipos validados, imutável
--    Gravação somente pelo servidor (service_role) ou rotinas privadas.
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM authenticated, anon;
DROP POLICY IF EXISTS "auth insert audit" ON public.audit_logs;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_acao_valida;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_acao_valida
  CHECK (acao ~ '^[a-z0-9_.:-]{3,80}$');
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entidade_valida;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_entidade_valida
  CHECK (entidade IS NULL OR entidade ~ '^[a-z0-9_]{2,63}$');
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_entidade_id_valida;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_entidade_id_valida
  CHECK (entidade_id IS NULL OR length(entidade_id) BETWEEN 1 AND 200);
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_detalhes_objeto;
ALTER TABLE public.audit_logs ADD CONSTRAINT audit_logs_detalhes_objeto
  CHECK (detalhes IS NULL OR jsonb_typeof(detalhes) = 'object');

-- ---------------------------------------------------------------------
-- 6) Imutabilidade por trigger (vale até para service_role)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION privado.bloquear_alteracao_historico()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Registro histórico imutável: % não permitido em %.', TG_OP, TG_TABLE_NAME
    USING ERRCODE = '42501';
END;
$$;
REVOKE UPDATE, DELETE, TRUNCATE ON public.recebimentos FROM authenticated, anon;

DROP TRIGGER IF EXISTS trg_recebimentos_imutavel ON public.recebimentos;
CREATE TRIGGER trg_recebimentos_imutavel BEFORE UPDATE OR DELETE ON public.recebimentos
  FOR EACH ROW EXECUTE FUNCTION privado.bloquear_alteracao_historico();
DROP TRIGGER IF EXISTS trg_recebimentos_sem_truncate ON public.recebimentos;
CREATE TRIGGER trg_recebimentos_sem_truncate BEFORE TRUNCATE ON public.recebimentos
  FOR EACH STATEMENT EXECUTE FUNCTION privado.bloquear_alteracao_historico();

DROP TRIGGER IF EXISTS trg_audit_logs_imutavel ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_imutavel BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION privado.bloquear_alteracao_historico();
DROP TRIGGER IF EXISTS trg_audit_logs_sem_truncate ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_sem_truncate BEFORE TRUNCATE ON public.audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION privado.bloquear_alteracao_historico();

-- ---------------------------------------------------------------------
-- 7) Primeiro administrador — somente servidor, uma única vez, com trava
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION privado.conceder_admin_inicial(_email text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  uid uuid;
BEGIN
  -- Autorizado somente: (a) JWT com role=service_role, ou
  -- (b) execução administrativa direta, quando a sessão foi aberta como postgres.
  -- current_user não é usado: em SECURITY DEFINER ele é sempre o dono da função.
  IF NOT (privado.eh_servidor() OR session_user = 'postgres') THEN
    RAISE EXCEPTION 'Somente o servidor pode conceder o administrador inicial.' USING ERRCODE = '42501';
  END IF;
  -- Serializa chamadas concorrentes (trava da transação).
  PERFORM pg_advisory_xact_lock(hashtext('jmroutes:conceder_admin_inicial'));
  LOCK TABLE public.user_roles IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Já existe administrador; use o fluxo normal de gestão de usuários.';
  END IF;
  SELECT u.id INTO uid FROM auth.users u
   WHERE lower(u.email) = lower(trim(_email)) AND u.invited_at IS NOT NULL;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Usuário convidado não encontrado.';
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.profiles SET ativo = true WHERE id = uid;
  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (NULL, 'conceder_admin_inicial', 'user_roles', uid::text,
          jsonb_build_object('origem', 'rotina protegida do servidor'));
  RETURN uid;
END;
$$;
REVOKE ALL ON FUNCTION privado.conceder_admin_inicial(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION privado.conceder_admin_inicial(text) TO service_role;

-- Remoção explícita das versões públicas antigas (se existirem).
DROP FUNCTION IF EXISTS public.bloquear_autoprivilegio();
DROP FUNCTION IF EXISTS public.proteger_campos_perfil();
DROP FUNCTION IF EXISTS public.conceder_admin_inicial(text);

-- Funções privadas: ninguém além do servidor executa diretamente.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA privado FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION privado.eh_servidor() TO service_role;

-- Gatilho de data de alteração: sem privilégio, search_path vazio.
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) FKs: histórico operacional não é apagado em cascata
--    Tabela declarativa + verificação final que aborta se divergir.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  r record;
  atual text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('motoristas','motoristas_base_id_fkey','base_id','public.bases(id)'),
    ('profiles','profiles_base_id_fkey','base_id','public.bases(id)'),
    ('rotas','rotas_motorista_id_fkey','motorista_id','public.motoristas(id)'),
    ('volumes','volumes_rota_id_fkey','rota_id','public.rotas(id)'),
    ('volumes','volumes_contagem_id_fkey','contagem_id','public.contagens(id)'),
    ('recebimentos','recebimentos_volume_id_fkey','volume_id','public.volumes(id)'),
    ('recebimentos','recebimentos_rota_id_fkey','rota_id','public.rotas(id)'),
    ('recebimentos','recebimentos_base_id_fkey','base_id','public.bases(id)'),
    ('escalas','escalas_base_id_fkey','base_id','public.bases(id)'),
    ('escalas','escalas_base_operacional_id_fkey','base_operacional_id','public.bases_operacionais(id)'),
    ('escalas','escalas_importacao_id_fkey','importacao_id','public.importacoes_escala(id)'),
    ('shipments','shipments_base_operacional_id_fkey','base_operacional_id','public.bases_operacionais(id)'),
    ('importacoes_escala','importacoes_escala_base_id_fkey','base_id','public.bases(id)'),
    ('contagens_rotas_lock','contagens_rotas_lock_base_id_fkey','base_id','public.bases(id)'),
    ('devolucoes','devolucoes_escala_id_fkey','escala_id','public.escalas(id)')
  ) AS t(tabela, nome, coluna, referencia)
  LOOP
    SELECT pg_get_constraintdef(c.oid) INTO atual
      FROM pg_constraint c
     WHERE c.conname = r.nome AND c.conrelid = ('public.' || r.tabela)::regclass;
    IF atual IS NULL OR atual !~ 'ON DELETE RESTRICT' THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', r.tabela, r.nome);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %s ON DELETE RESTRICT',
                     r.tabela, r.nome, r.coluna, r.referencia);
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 9) Verificações finais — abortam toda a migration se algo divergir
-- ---------------------------------------------------------------------
DO $$
DECLARE n int;
BEGIN
  -- Nenhuma FK entre tabelas operacionais com CASCADE/SET NULL (exceto vínculos de acesso a usuário)
  SELECT count(*) INTO n FROM pg_constraint c
   WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
     AND pg_get_constraintdef(c.oid) ~ 'REFERENCES public\.|REFERENCES (bases|rotas|volumes|motoristas|escalas|contagens|importacoes_escala|bases_operacionais)\('
     AND pg_get_constraintdef(c.oid) ~ 'ON DELETE (CASCADE|SET NULL)'
     AND c.conname NOT IN ('user_bases_base_id_fkey');
  IF n > 0 THEN RAISE EXCEPTION 'Verificação de FKs falhou: % FK(s) ainda em cascata.', n; END IF;

  -- Nenhuma função SECURITY DEFINER executável por PUBLIC ou anon
  -- ACL efetiva: grantee = 0 significa PUBLIC.
  SELECT count(*) INTO n FROM pg_proc p
   CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
   WHERE p.pronamespace IN ('public'::regnamespace, 'privado'::regnamespace)
     AND p.prosecdef
     AND acl.privilege_type = 'EXECUTE'
     AND (acl.grantee = 0 OR acl.grantee = 'anon'::regrole);
  IF n > 0 THEN RAISE EXCEPTION 'Verificação falhou: % função(ões) privilegiada(s) acessível(is) a PUBLIC/anon.', n; END IF;

  -- Funções das RLS continuam executáveis por usuários autenticados
  IF NOT has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.has_base_access(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Verificação falhou: funções usadas pelas RLS sem EXECUTE para authenticated.';
  END IF;

  -- Toda função SECURITY DEFINER com search_path vazio
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace IN ('public'::regnamespace, 'privado'::regnamespace)
     AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) cfg WHERE cfg IN ('search_path=""', 'search_path='));
  IF n > 0 THEN RAISE EXCEPTION 'Verificação falhou: % função(ões) privilegiada(s) sem search_path vazio.', n; END IF;

  -- Dono do schema privado e das funções privilegiadas deve ser postgres
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'privado') <> 'postgres' THEN
    RAISE EXCEPTION 'Verificação falhou: schema privado não pertence a postgres.';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace IN ('public'::regnamespace, 'privado'::regnamespace)
     AND p.prosecdef AND p.proowner::regrole::text <> 'postgres';
  IF n > 0 THEN RAISE EXCEPTION 'Verificação falhou: % função(ões) privilegiada(s) com dono diferente de postgres.', n; END IF;

  -- Nenhuma versão pública antiga sobrou
  SELECT count(*) INTO n FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('handle_new_user','prevent_admin_role_grant','bloquear_autoprivilegio',
                       'proteger_campos_perfil','conceder_admin_inicial');
  IF n > 0 THEN RAISE EXCEPTION 'Verificação falhou: % função(ões) antiga(s) ainda em public.', n; END IF;

  -- RLS ligada em todas as tabelas públicas
  SELECT count(*) INTO n FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
  IF n > 0 THEN RAISE EXCEPTION 'Verificação falhou: % tabela(s) sem RLS.', n; END IF;
END $$;

COMMIT;