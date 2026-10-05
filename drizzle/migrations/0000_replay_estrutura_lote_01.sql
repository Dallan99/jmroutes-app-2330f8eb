-- Replay da estrutura do JMRoutes (homologacao) — lote 1

-- ============ Enums ============
CREATE TYPE public.app_role AS ENUM ('admin', 'supervisor', 'operador');
CREATE TYPE public.rota_status AS ENUM ('pendente', 'em_recebimento', 'recebida_parcial', 'recebida_completa', 'cancelada', 'encerrada');
CREATE TYPE public.recebimento_resultado AS ENUM ('ok', 'duplicado', 'inexistente', 'outra_rota', 'outra_base', 'cancelada', 'encerrada', 'volume_repetido');

-- ============ Bases ============
CREATE TABLE public.bases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  nome TEXT NOT NULL,
  cidade TEXT NOT NULL,
  uf TEXT NOT NULL,
  ativa BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases TO authenticated;
GRANT ALL ON public.bases TO service_role;
ALTER TABLE public.bases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read bases" ON public.bases FOR SELECT TO authenticated USING (true);

-- ============ Motoristas ============
CREATE TABLE public.motoristas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cpf TEXT,
  cnh TEXT,
  placa TEXT,
  transportadora TEXT,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.motoristas TO authenticated;
GRANT ALL ON public.motoristas TO service_role;
ALTER TABLE public.motoristas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read motoristas" ON public.motoristas FOR SELECT TO authenticated USING (true);

-- ============ Profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  matricula TEXT,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- ============ User roles ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "supervisors read all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage profiles" ON public.profiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "supervisors read all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'supervisor') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ Rotas ============
CREATE TABLE public.rotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL UNIQUE,
  motorista_id UUID REFERENCES public.motoristas(id) ON DELETE SET NULL,
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  cidade TEXT NOT NULL,
  transportadora TEXT,
  data_expedicao DATE NOT NULL DEFAULT CURRENT_DATE,
  quantidade_prevista INT NOT NULL DEFAULT 0,
  status public.rota_status NOT NULL DEFAULT 'pendente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rotas TO authenticated;
GRANT ALL ON public.rotas TO service_role;
ALTER TABLE public.rotas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read rotas" ON public.rotas FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update rotas" ON public.rotas FOR UPDATE TO authenticated USING (true);
CREATE POLICY "admins insert rotas" ON public.rotas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

-- ============ Volumes ============
CREATE TABLE public.volumes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id UUID NOT NULL REFERENCES public.rotas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  sequencia INT NOT NULL,
  total INT NOT NULL,
  recebido BOOLEAN NOT NULL DEFAULT false,
  recebido_em TIMESTAMPTZ,
  recebido_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX volumes_rota_idx ON public.volumes(rota_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.volumes TO authenticated;
GRANT ALL ON public.volumes TO service_role;
ALTER TABLE public.volumes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read volumes" ON public.volumes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth update volumes" ON public.volumes FOR UPDATE TO authenticated USING (true);

-- ============ Recebimentos ============
CREATE TABLE public.recebimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo_bipado TEXT NOT NULL,
  rota_id UUID REFERENCES public.rotas(id) ON DELETE SET NULL,
  volume_id UUID REFERENCES public.volumes(id) ON DELETE SET NULL,
  base_id UUID REFERENCES public.bases(id) ON DELETE SET NULL,
  operador_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  resultado public.recebimento_resultado NOT NULL,
  mensagem TEXT,
  ip TEXT,
  user_agent TEXT,
  tempo_desde_ultima_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX recebimentos_created_idx ON public.recebimentos(created_at DESC);
CREATE INDEX recebimentos_operador_idx ON public.recebimentos(operador_id);
CREATE INDEX recebimentos_rota_idx ON public.recebimentos(rota_id);
GRANT SELECT, INSERT ON public.recebimentos TO authenticated;
GRANT ALL ON public.recebimentos TO service_role;
ALTER TABLE public.recebimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operador insere proprio" ON public.recebimentos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = operador_id);
CREATE POLICY "operador le proprio" ON public.recebimentos FOR SELECT TO authenticated
  USING (auth.uid() = operador_id OR public.has_role(auth.uid(),'supervisor') OR public.has_role(auth.uid(),'admin'));

-- ============ Audit log ============
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id TEXT,
  detalhes JSONB,
  ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));
CREATE POLICY "auth insert audit" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============ Trigger: cria profile + role 'operador' no signup ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'operador');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ Realtime ============
ALTER PUBLICATION supabase_realtime ADD TABLE public.recebimentos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.volumes;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rotas;

-- Restringe UPDATEs amplos
DROP POLICY "auth update rotas" ON public.rotas;
CREATE POLICY "users with role update rotas" ON public.rotas FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

DROP POLICY "auth update volumes" ON public.volumes;
CREATE POLICY "users with role update volumes" ON public.volumes FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Limpa dados fictícios anteriores
DELETE FROM public.recebimentos;
DELETE FROM public.volumes;
DELETE FROM public.rotas;

ALTER TABLE public.rotas
  ADD COLUMN IF NOT EXISTS base_origem_id uuid REFERENCES public.bases(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS pack_id text,
  ADD COLUMN IF NOT EXISTS nf text,
  ADD COLUMN IF NOT EXISTS rota_final text,
  ADD COLUMN IF NOT EXISTS destinatario_nome text,
  ADD COLUMN IF NOT EXISTS destinatario_cep text,
  ADD COLUMN IF NOT EXISTS destinatario_endereco text,
  ADD COLUMN IF NOT EXISTS destinatario_complemento text,
  ADD COLUMN IF NOT EXISTS data_prevista date,
  ADD COLUMN IF NOT EXISTS janela_despacho text;

CREATE INDEX IF NOT EXISTS rotas_base_origem_idx ON public.rotas (base_origem_id);
CREATE INDEX IF NOT EXISTS rotas_pack_id_idx ON public.rotas (pack_id);
CREATE INDEX IF NOT EXISTS volumes_codigo_idx ON public.volumes (codigo);

DROP POLICY IF EXISTS "auth read motoristas" ON public.motoristas;
CREATE POLICY "staff read motoristas" ON public.motoristas FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "auth read rotas" ON public.rotas;
CREATE POLICY "staff read rotas" ON public.rotas FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'supervisor'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
  OR base_origem_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- Cria as 4 bases ESP
INSERT INTO public.bases (codigo, nome, cidade, uf) VALUES
  ('ESP15', 'Base Ibiúna', 'Ibiúna', 'SP'),
  ('ESP16', 'Base Guarujá', 'Guarujá', 'SP'),
  ('ESP17', 'Base Embu Guaçu', 'Embu Guaçu', 'SP'),
  ('ESP18', 'Base Franco da Rocha', 'Franco da Rocha', 'SP')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.escalas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_referencia date NOT NULL DEFAULT CURRENT_DATE,
  planejada text,
  otimizada text,
  pacotes integer,
  paradas integer,
  modal text,
  bairro text,
  cidade text,
  giro text,
  vaga text,
  tipo text,
  roteiro text,
  placa text,
  driver text,
  placa_troca text,
  importado_por uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS escalas_base_data_idx ON public.escalas(base_id, data_referencia DESC);
CREATE INDEX IF NOT EXISTS escalas_planejada_idx ON public.escalas(planejada);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escalas TO authenticated;
GRANT ALL ON public.escalas TO service_role;

ALTER TABLE public.escalas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados leem escalas"
  ON public.escalas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admin/Supervisor inserem escalas"
  ON public.escalas FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

CREATE POLICY "Admin/Supervisor deletam escalas"
  ON public.escalas FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'supervisor'));

DROP POLICY IF EXISTS "users with role update rotas" ON public.rotas;
CREATE POLICY "staff update rotas in own base"
ON public.rotas FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "users with role update volumes" ON public.volumes;
CREATE POLICY "staff update volumes in own base"
ON public.volumes FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND EXISTS (SELECT 1 FROM public.rotas r
                  WHERE r.id = volumes.rota_id
                    AND r.base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())))
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR (has_role(auth.uid(), 'supervisor'::app_role)
      AND EXISTS (SELECT 1 FROM public.rotas r
                  WHERE r.id = volumes.rota_id
                    AND r.base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())))
);

DROP POLICY IF EXISTS "staff read motoristas" ON public.motoristas;
CREATE POLICY "admins read motoristas full"
ON public.motoristas FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
);

CREATE OR REPLACE VIEW public.motoristas_safe
WITH (security_invoker = true) AS
SELECT id, nome, placa, transportadora, base_id, ativo, created_at
FROM public.motoristas
WHERE base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
   OR has_role(auth.uid(), 'admin'::app_role)
   OR has_role(auth.uid(), 'supervisor'::app_role);

GRANT SELECT ON public.motoristas_safe TO authenticated;

DROP POLICY IF EXISTS "Admin/Supervisor inserem escalas" ON public.escalas;
DROP POLICY IF EXISTS "Admin/Supervisor deletam escalas" ON public.escalas;

CREATE POLICY "Autenticados inserem escalas"
ON public.escalas FOR INSERT TO authenticated
WITH CHECK (importado_por = auth.uid());

CREATE POLICY "Autenticados deletam escalas"
ON public.escalas FOR DELETE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Autenticados deletam escalas" ON public.escalas;

CREATE POLICY "Staff deletam escalas da propria base"
ON public.escalas FOR DELETE TO authenticated
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR base_id = (SELECT base_id FROM public.profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Autenticados leem escalas" ON public.escalas;
CREATE POLICY "Staff leem escalas da propria base"
ON public.escalas
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR importado_por = auth.uid()
  OR base_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
);

DROP POLICY IF EXISTS "auth read volumes" ON public.volumes;
CREATE POLICY "staff read volumes in own base"
ON public.volumes
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.rotas r
    WHERE r.id = volumes.rota_id
      AND (
        r.base_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
        OR r.base_origem_id = (SELECT profiles.base_id FROM public.profiles WHERE profiles.id = auth.uid())
      )
  )
);

CREATE OR REPLACE FUNCTION public.prevent_admin_role_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' AND NEW.role = 'admin'::app_role THEN
    RAISE EXCEPTION 'Admin role can only be granted via service_role/migration';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.role = 'admin'::app_role OR OLD.role = 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role changes can only be made via service_role/migration';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.role = 'admin'::app_role THEN
    RAISE EXCEPTION 'Admin role removals can only be made via service_role/migration';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_admin_role_grant ON public.user_roles;
CREATE TRIGGER trg_prevent_admin_role_grant
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.prevent_admin_role_grant();

REVOKE EXECUTE ON FUNCTION public.prevent_admin_role_grant() FROM PUBLIC, anon, authenticated;

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gerente';

DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit" ON public.audit_logs FOR SELECT
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "Staff leem escalas da propria base" ON public.escalas;
CREATE POLICY "Staff leem escalas da propria base" ON public.escalas FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR importado_por = auth.uid()
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "Staff deletam escalas da propria base" ON public.escalas;
CREATE POLICY "Staff deletam escalas da propria base" ON public.escalas FOR DELETE
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente')
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full" ON public.motoristas FOR SELECT
USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "supervisors read all profiles" ON public.profiles;
CREATE POLICY "supervisors read all profiles" ON public.profiles FOR SELECT
USING (has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes manage profiles" ON public.profiles FOR UPDATE
USING (has_role(auth.uid(),'gerente'))
WITH CHECK (has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes insert profiles" ON public.profiles FOR INSERT
WITH CHECK (has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "operador le proprio" ON public.recebimentos;
CREATE POLICY "operador le proprio" ON public.recebimentos FOR SELECT
USING (
  auth.uid() = operador_id
  OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente')
);

DROP POLICY IF EXISTS "staff read rotas" ON public.rotas;
CREATE POLICY "staff read rotas" ON public.rotas FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
  OR base_origem_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
);

DROP POLICY IF EXISTS "admins insert rotas" ON public.rotas;
CREATE POLICY "admins insert rotas" ON public.rotas FOR INSERT
WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "staff update rotas in own base" ON public.rotas;
CREATE POLICY "staff update rotas in own base" ON public.rotas FOR UPDATE
USING (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND base_id = (SELECT base_id FROM profiles WHERE id = auth.uid()))
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND base_id = (SELECT base_id FROM profiles WHERE id = auth.uid()))
);

DROP POLICY IF EXISTS "supervisors read all roles" ON public.user_roles;
CREATE POLICY "supervisors read all roles" ON public.user_roles FOR SELECT
USING (has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'gerente'));

CREATE POLICY "gerentes assign non-admin roles" ON public.user_roles FOR INSERT
WITH CHECK (has_role(auth.uid(),'gerente') AND role <> 'admin');

CREATE POLICY "gerentes update non-admin roles" ON public.user_roles FOR UPDATE
USING (has_role(auth.uid(),'gerente') AND role <> 'admin')
WITH CHECK (has_role(auth.uid(),'gerente') AND role <> 'admin');

CREATE POLICY "gerentes delete non-admin roles" ON public.user_roles FOR DELETE
USING (has_role(auth.uid(),'gerente') AND role <> 'admin');

DROP POLICY IF EXISTS "staff read volumes in own base" ON public.volumes;
CREATE POLICY "staff read volumes in own base" ON public.volumes FOR SELECT
USING (
  has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente')
  OR EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
             AND (r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())
               OR r.base_origem_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
);

DROP POLICY IF EXISTS "staff update volumes in own base" ON public.volumes;
CREATE POLICY "staff update volumes in own base" ON public.volumes FOR UPDATE
USING (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
                  AND r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
)
WITH CHECK (
  has_role(auth.uid(),'admin')
  OR ((has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'))
      AND EXISTS (SELECT 1 FROM rotas r WHERE r.id = volumes.rota_id
                  AND r.base_id = (SELECT base_id FROM profiles WHERE id = auth.uid())))
);

DO $$
DECLARE
  new_uid uuid := gen_random_uuid();
  existing_uid uuid;
BEGIN
  SELECT id INTO existing_uid FROM auth.users WHERE email = 'dallan.zanini@jmdistribuicao.com.br';
  IF existing_uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      new_uid, 'authenticated', 'authenticated',
      'dallan.zanini@jmdistribuicao.com.br',
      crypt(gen_random_uuid()::text /* senha historica removida */, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nome','Dallan Zanini'),
      now(), now(), '', '', '', ''
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), new_uid,
      jsonb_build_object('sub', new_uid::text, 'email', 'dallan.zanini@jmdistribuicao.com.br', 'email_verified', true),
      'email', new_uid::text, now(), now(), now());
    existing_uid := new_uid;
  END IF;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (existing_uid, 'admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  DELETE FROM public.user_roles
   WHERE user_id = existing_uid AND role = 'operador'::app_role;
END $$;

ALTER TABLE public.volumes
  ADD COLUMN IF NOT EXISTS triado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS triado_em timestamptz,
  ADD COLUMN IF NOT EXISTS triado_por uuid REFERENCES auth.users(id);

DO $$ BEGIN
  CREATE TYPE public.bip_stage AS ENUM ('recebimento','triagem');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS stage public.bip_stage NOT NULL DEFAULT 'recebimento';

DO $$ BEGIN
  ALTER TYPE public.rota_status ADD VALUE IF NOT EXISTS 'em_triagem';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.base_status AS ENUM ('aguardando', 'ativa', 'arquivada', 'erro');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.bases_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_operacional date NOT NULL,
  status public.base_status NOT NULL DEFAULT 'aguardando',
  facility text,
  transportadora text,
  escala_jm_nome text,
  escala_jm_hora timestamptz,
  escala_jm_rotas integer DEFAULT 0,
  escala_jm_pacotes integer DEFAULT 0,
  escala_xpt_nome text,
  escala_xpt_hora timestamptz,
  escala_xpt_shipments integer DEFAULT 0,
  escala_xpt_rotas integer DEFAULT 0,
  total_rotas integer DEFAULT 0,
  total_shipments integer DEFAULT 0,
  total_motoristas integer DEFAULT 0,
  total_veiculos integer DEFAULT 0,
  total_bairros integer DEFAULT 0,
  total_cidades integer DEFAULT 0,
  total_pacotes integer DEFAULT 0,
  importado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ativada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (data_operacional)
);

CREATE UNIQUE INDEX IF NOT EXISTS bases_operacionais_uma_ativa
  ON public.bases_operacionais ((status))
  WHERE status = 'ativa';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases_operacionais TO authenticated;
GRANT ALL ON public.bases_operacionais TO service_role;

ALTER TABLE public.bases_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth ver bases" ON public.bases_operacionais
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth criar bases" ON public.bases_operacionais
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth atualizar bases" ON public.bases_operacionais
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "admin remove bases" ON public.bases_operacionais
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_operacional_id uuid NOT NULL REFERENCES public.bases_operacionais(id) ON DELETE CASCADE,
  shipment_id text NOT NULL,
  rota text,
  motorista text,
  placa text,
  bairro text,
  cidade text,
  pacotes integer DEFAULT 0,
  status text DEFAULT 'pendente',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_operacional_id, shipment_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipments TO authenticated;
GRANT ALL ON public.shipments TO service_role;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth ver shipments" ON public.shipments
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth criar shipments" ON public.shipments
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth atualizar shipments" ON public.shipments
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth remover shipments" ON public.shipments
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS base_operacional_id uuid REFERENCES public.bases_operacionais(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_base_op ON public.escalas(base_operacional_id);
CREATE INDEX IF NOT EXISTS idx_shipments_base_op ON public.shipments(base_operacional_id);

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_bases_op_updated ON public.bases_operacionais;
CREATE TRIGGER trg_bases_op_updated BEFORE UPDATE ON public.bases_operacionais
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_shipments_updated ON public.shipments;
CREATE TRIGGER trg_shipments_updated BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.escalas ALTER COLUMN base_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS public.importacoes_escala (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_operacional DATE NOT NULL,
  versao INTEGER NOT NULL DEFAULT 1,
  ativa BOOLEAN NOT NULL DEFAULT true,
  importado_por UUID REFERENCES public.profiles(id),
  importado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  arquivada_em TIMESTAMPTZ,
  arquivada_por UUID REFERENCES public.profiles(id),
  arquivo_nome TEXT,
  total_linhas INTEGER NOT NULL DEFAULT 0,
  total_pacotes INTEGER NOT NULL DEFAULT 0,
  total_motoristas INTEGER NOT NULL DEFAULT 0,
  total_rotas INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional, versao)
);
CREATE INDEX IF NOT EXISTS idx_imp_escala_base_dia ON public.importacoes_escala(base_id, data_operacional);
CREATE INDEX IF NOT EXISTS idx_imp_escala_ativa ON public.importacoes_escala(base_id, data_operacional) WHERE ativa;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.importacoes_escala TO authenticated;
GRANT ALL ON public.importacoes_escala TO service_role;
ALTER TABLE public.importacoes_escala ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados inserem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados atualizam importacoes" ON public.importacoes_escala;
CREATE POLICY "Autenticados leem importacoes"
  ON public.importacoes_escala FOR SELECT TO authenticated USING (true);
CREATE POLICY "Autenticados inserem importacoes"
  ON public.importacoes_escala FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid());
CREATE POLICY "Autenticados atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_imp_escala_touch ON public.importacoes_escala;
CREATE TRIGGER trg_imp_escala_touch
  BEFORE UPDATE ON public.importacoes_escala
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS importacao_id UUID REFERENCES public.importacoes_escala(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_escalas_importacao ON public.escalas(importacao_id);

CREATE TABLE IF NOT EXISTS public.contagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  data_operacional DATE NOT NULL,
  usuario_id UUID NOT NULL REFERENCES public.profiles(id),
  iniciada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_em TIMESTAMPTZ,
  total_esperado INTEGER NOT NULL DEFAULT 0,
  total_contado INTEGER NOT NULL DEFAULT 0,
  divergencia INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contagens_base_dia ON public.contagens(base_id, data_operacional);
CREATE INDEX IF NOT EXISTS idx_contagens_usuario ON public.contagens(usuario_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contagens TO authenticated;
GRANT ALL ON public.contagens TO service_role;
ALTER TABLE public.contagens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Autenticados leem contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario cria proprias contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario atualiza proprias contagens ou admin/gerente" ON public.contagens;
CREATE POLICY "Autenticados leem contagens"
  ON public.contagens FOR SELECT TO authenticated USING (true);
CREATE POLICY "Usuario cria proprias contagens"
  ON public.contagens FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());
CREATE POLICY "Usuario atualiza proprias contagens ou admin/gerente"
  ON public.contagens FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (usuario_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

DROP TRIGGER IF EXISTS trg_contagens_touch ON public.contagens;
CREATE TRIGGER trg_contagens_touch
  BEFORE UPDATE ON public.contagens
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.volumes
  ADD COLUMN IF NOT EXISTS contagem_id UUID REFERENCES public.contagens(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS base_id UUID REFERENCES public.bases(id),
  ADD COLUMN IF NOT EXISTS data_operacional DATE;
CREATE INDEX IF NOT EXISTS idx_volumes_contagem ON public.volumes(contagem_id);
CREATE INDEX IF NOT EXISTS idx_volumes_base_dia ON public.volumes(base_id, data_operacional);

ALTER TABLE public.recebimentos
  ADD COLUMN IF NOT EXISTS data_operacional DATE;
CREATE INDEX IF NOT EXISTS idx_recebimentos_base_dia ON public.recebimentos(base_id, data_operacional);

DROP POLICY IF EXISTS "Autenticados atualizam importacoes" ON public.importacoes_escala;
CREATE POLICY "Dono ou admin/gerente atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated
  USING (importado_por = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'))
  WITH CHECK (importado_por = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'gerente'));

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS facility_id text,
  ADD COLUMN IF NOT EXISTS shipment text,
  ADD COLUMN IF NOT EXISTS nro_rota text,
  ADD COLUMN IF NOT EXISTS ordem integer,
  ADD COLUMN IF NOT EXISTS rua text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS referencias text,
  ADD COLUMN IF NOT EXISTS duracao numeric,
  ADD COLUMN IF NOT EXISTS distancia numeric,
  ADD COLUMN IF NOT EXISTS order_id_veiculo text,
  ADD COLUMN IF NOT EXISTS ocupacao numeric,
  ADD COLUMN IF NOT EXISTS spr numeric,
  ADD COLUMN IF NOT EXISTS parada text,
  ADD COLUMN IF NOT EXISTS cluster text,
  ADD COLUMN IF NOT EXISTS transportadora text;

CREATE INDEX IF NOT EXISTS idx_escalas_importacao_shipment
  ON public.escalas (importacao_id, shipment);
CREATE INDEX IF NOT EXISTS idx_escalas_importacao_planejada
  ON public.escalas (importacao_id, planejada);

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS triado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS triado_em timestamptz,
  ADD COLUMN IF NOT EXISTS triado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS recebido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recebido_em timestamptz,
  ADD COLUMN IF NOT EXISTS recebido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_shipment_lookup
  ON public.escalas (base_id, importacao_id, shipment)
  WHERE shipment IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_escalas_triado
  ON public.escalas (importacao_id, triado);

DROP POLICY IF EXISTS "auth ver bases" ON public.bases_operacionais;
DROP POLICY IF EXISTS "auth criar bases" ON public.bases_operacionais;
DROP POLICY IF EXISTS "auth atualizar bases" ON public.bases_operacionais;

CREATE POLICY "staff ver bases operacionais" ON public.bases_operacionais
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR importado_por = auth.uid()
  OR status = 'ativa'::base_status
);

CREATE POLICY "staff criar bases operacionais" ON public.bases_operacionais
FOR INSERT TO authenticated
WITH CHECK (
  (has_role(auth.uid(), 'admin'::app_role)
   OR has_role(auth.uid(), 'supervisor'::app_role)
   OR has_role(auth.uid(), 'gerente'::app_role))
  AND importado_por = auth.uid()
);

CREATE POLICY "staff atualizar bases operacionais" ON public.bases_operacionais
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

DROP POLICY IF EXISTS "auth ver shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth criar shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth atualizar shipments" ON public.shipments;
DROP POLICY IF EXISTS "auth remover shipments" ON public.shipments;

CREATE POLICY "staff ver shipments" ON public.shipments
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.bases_operacionais bo
    WHERE bo.id = shipments.base_operacional_id
      AND bo.status = 'ativa'::base_status
  )
);

CREATE POLICY "staff criar shipments" ON public.shipments
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

CREATE POLICY "staff atualizar shipments" ON public.shipments
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

CREATE POLICY "staff remover shipments" ON public.shipments
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
);

DROP POLICY IF EXISTS "Autenticados leem contagens" ON public.contagens;

CREATE POLICY "Staff ou dono leem contagens" ON public.contagens
FOR SELECT TO authenticated
USING (
  usuario_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = auth.uid())
);

DROP POLICY IF EXISTS "Autenticados leem importacoes" ON public.importacoes_escala;

CREATE POLICY "Staff ou base leem importacoes" ON public.importacoes_escala
FOR SELECT TO authenticated
USING (
  importado_por = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'supervisor'::app_role)
  OR has_role(auth.uid(), 'gerente'::app_role)
  OR base_id = (SELECT p.base_id FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE TABLE IF NOT EXISTS public.user_bases (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, base_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bases TO authenticated;
GRANT ALL ON public.user_bases TO service_role;

ALTER TABLE public.user_bases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_bases dono ou admin veem"
  ON public.user_bases FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE POLICY "user_bases admin gerente escrevem"
  ON public.user_bases FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _base_id IS NULL
    OR public.has_role(_user_id, 'admin')
    OR public.has_role(_user_id, 'gerente')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
    OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id);
$$;

CREATE OR REPLACE FUNCTION public.get_allowed_bases(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.bases WHERE public.has_base_access(_user_id, id);
$$;

DROP POLICY IF EXISTS "staff ver bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "staff criar bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "staff atualizar bases operacionais" ON public.bases_operacionais;
DROP POLICY IF EXISTS "admin remove bases" ON public.bases_operacionais;

CREATE POLICY "base access ver bases operacionais"
  ON public.bases_operacionais FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )) OR importado_por = auth.uid());

CREATE POLICY "base access criar bases operacionais"
  ON public.bases_operacionais FOR INSERT TO authenticated
  WITH CHECK (
    importado_por = auth.uid()
    AND public.has_base_access(auth.uid(), (
      SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
    ))
  );

CREATE POLICY "base access atualizar bases operacionais"
  ON public.bases_operacionais FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )))
  WITH CHECK (public.has_base_access(auth.uid(), (
    SELECT b.id FROM public.bases b WHERE b.codigo = bases_operacionais.facility LIMIT 1
  )));

CREATE POLICY "admin remove bases operacionais"
  ON public.bases_operacionais FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'));

DO $$
DECLARE
  has_base_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='base_operacional_id'
  ) INTO has_base_id;

  EXECUTE 'DROP POLICY IF EXISTS "staff ver shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff criar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff atualizar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "staff deletar shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "public read shipments" ON public.shipments';
  EXECUTE 'DROP POLICY IF EXISTS "public write shipments" ON public.shipments';

  IF has_base_id THEN
    EXECUTE $p$
      CREATE POLICY "base access ver shipments"
        ON public.shipments FOR SELECT TO authenticated
        USING (public.has_base_access(auth.uid(), (
          SELECT bo.id FROM public.bases b JOIN public.bases_operacionais bo ON bo.facility = b.codigo
          WHERE bo.id = shipments.base_operacional_id LIMIT 1
        )) OR has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'))
    $p$;
  ELSE
    EXECUTE 'CREATE POLICY "base access ver shipments" ON public.shipments FOR SELECT TO authenticated USING (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''gerente'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''operador''))';
  END IF;

  EXECUTE 'CREATE POLICY "staff escreve shipments" ON public.shipments FOR ALL TO authenticated USING (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''gerente'')) WITH CHECK (has_role(auth.uid(), ''admin'') OR has_role(auth.uid(), ''supervisor'') OR has_role(auth.uid(), ''gerente''))';
END $$;

DROP POLICY IF EXISTS "Staff ou base leem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Autenticados inserem importacoes" ON public.importacoes_escala;
DROP POLICY IF EXISTS "Dono ou admin/gerente atualizam importacoes" ON public.importacoes_escala;

CREATE POLICY "base access leem importacoes"
  ON public.importacoes_escala FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR importado_por = auth.uid());

CREATE POLICY "base access inserem importacoes"
  ON public.importacoes_escala FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualizam importacoes"
  ON public.importacoes_escala FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

DROP POLICY IF EXISTS "Staff leem escalas da propria base" ON public.escalas;
DROP POLICY IF EXISTS "Autenticados inserem escalas" ON public.escalas;
DROP POLICY IF EXISTS "Staff deletam escalas da propria base" ON public.escalas;

CREATE POLICY "base access leem escalas"
  ON public.escalas FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR importado_por = auth.uid());

CREATE POLICY "base access inserem escalas"
  ON public.escalas FOR INSERT TO authenticated
  WITH CHECK (importado_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualizam escalas"
  ON public.escalas FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access deletam escalas"
  ON public.escalas FOR DELETE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

DROP POLICY IF EXISTS "Staff ou dono leem contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario cria proprias contagens" ON public.contagens;
DROP POLICY IF EXISTS "Usuario atualiza proprias contagens ou admin/gerente" ON public.contagens;

CREATE POLICY "base access leem contagens"
  ON public.contagens FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access cria contagens"
  ON public.contagens FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access atualiza contagens"
  ON public.contagens FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id))
  WITH CHECK (usuario_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='rotas' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.rotas', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='volumes' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.volumes', pol.policyname);
  END LOOP;
  FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='recebimentos' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.recebimentos', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "base access rotas select"
  ON public.rotas FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access rotas write"
  ON public.rotas FOR ALL TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access volumes select"
  ON public.volumes FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)));

CREATE POLICY "base access volumes write"
  ON public.volumes FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.rotas r WHERE r.id = volumes.rota_id AND public.has_base_access(auth.uid(), r.base_id)));

CREATE POLICY "base access recebimentos select"
  ON public.recebimentos FOR SELECT TO authenticated
  USING (operador_id = auth.uid() OR public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access recebimentos insert"
  ON public.recebimentos FOR INSERT TO authenticated
  WITH CHECK (operador_id = auth.uid());

DO $$ BEGIN
  CREATE TYPE public.motivo_devolucao AS ENUM (
    'cliente_ausente',
    'endereco_nao_localizado',
    'recusado',
    'avaria',
    'zona_de_risco',
    'outros'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.devolucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid REFERENCES public.bases(id),
  base_operacional_id uuid REFERENCES public.bases_operacionais(id),
  escala_id uuid REFERENCES public.escalas(id) ON DELETE SET NULL,
  shipment_codigo text NOT NULL,
  rota text,
  motorista text,
  motivo public.motivo_devolucao NOT NULL,
  observacao text,
  devolvido_por uuid NOT NULL DEFAULT auth.uid(),
  devolvido_em timestamptz NOT NULL DEFAULT now(),
  cancelado boolean NOT NULL DEFAULT false,
  cancelado_em timestamptz,
  cancelado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devolucoes_base_dia_idx ON public.devolucoes (base_id, devolvido_em DESC);
CREATE INDEX IF NOT EXISTS devolucoes_shipment_idx ON public.devolucoes (shipment_codigo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.devolucoes TO authenticated;
GRANT ALL ON public.devolucoes TO service_role;

ALTER TABLE public.devolucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "base access devolucoes select"
  ON public.devolucoes FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id) OR devolvido_por = auth.uid());

CREATE POLICY "base access devolucoes insert"
  ON public.devolucoes FOR INSERT TO authenticated
  WITH CHECK (devolvido_por = auth.uid() AND public.has_base_access(auth.uid(), base_id));

CREATE POLICY "base access devolucoes update"
  ON public.devolucoes FOR UPDATE TO authenticated
  USING (public.has_base_access(auth.uid(), base_id))
  WITH CHECK (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "admin gerente devolucoes delete"
  ON public.devolucoes FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'gerente'));

CREATE TRIGGER tg_devolucoes_updated
BEFORE UPDATE ON public.devolucoes
FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

ALTER TABLE public.escalas
  ADD COLUMN IF NOT EXISTS devolvido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS devolvido_em timestamptz,
  ADD COLUMN IF NOT EXISTS devolvido_motivo public.motivo_devolucao;

REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_allowed_bases(uuid) TO authenticated, service_role;

CREATE TABLE public.contagens_rotas_lock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  base_id UUID NOT NULL REFERENCES public.bases(id) ON DELETE CASCADE,
  data_operacional DATE NOT NULL,
  nome TEXT NOT NULL,
  previsto INTEGER,
  motorista TEXT,
  criado_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contagens_rotas_lock TO authenticated;
GRANT ALL ON public.contagens_rotas_lock TO service_role;

ALTER TABLE public.contagens_rotas_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver locks das bases acessíveis"
  ON public.contagens_rotas_lock FOR SELECT TO authenticated
  USING (public.has_base_access(auth.uid(), base_id));

CREATE POLICY "Criar locks nas bases acessíveis"
  ON public.contagens_rotas_lock FOR INSERT TO authenticated
  WITH CHECK (public.has_base_access(auth.uid(), base_id) AND criado_por = auth.uid());

CREATE POLICY "Dono ou admin/gerente pode apagar"
  ON public.contagens_rotas_lock FOR DELETE TO authenticated
  USING (
    criado_por = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );

CREATE POLICY "Dono ou admin/gerente pode atualizar"
  ON public.contagens_rotas_lock FOR UPDATE TO authenticated
  USING (
    criado_por = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
  );

ALTER TYPE public.motivo_devolucao ADD VALUE IF NOT EXISTS 'comercio_fechado';

DROP POLICY IF EXISTS "gerentes insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "gerentes manage profiles" ON public.profiles;
DROP POLICY IF EXISTS "supervisors read all profiles" ON public.profiles;

CREATE POLICY "gerentes insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "gerentes manage profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "supervisors read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
  );

DROP POLICY IF EXISTS "gerentes assign non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "gerentes update non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "gerentes delete non-admin roles" ON public.user_roles;
DROP POLICY IF EXISTS "supervisors read all roles" ON public.user_roles;

CREATE POLICY "gerentes assign non-admin roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "gerentes update non-admin roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "gerentes delete non-admin roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    role <> 'admin'::app_role
    AND (has_role(auth.uid(), 'gerente'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "supervisors read all roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'gerente'::app_role)
    OR has_role(auth.uid(), 'supervisor'::app_role)
  );

CREATE POLICY "base staff read motoristas" ON public.motoristas
  FOR SELECT TO authenticated
  USING (base_id IS NOT NULL AND has_base_access(auth.uid(), base_id));

CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT
    _base_id IS NULL
    OR public.has_role(_user_id, 'admin')
    OR public.has_role(_user_id, 'gerente')
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user_id AND p.base_id = _base_id)
    OR EXISTS (SELECT 1 FROM public.user_bases ub WHERE ub.user_id = _user_id AND ub.base_id = _base_id);
$$;

CREATE OR REPLACE FUNCTION public.get_allowed_bases(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT id FROM public.bases WHERE public.has_base_access(_user_id, id);
$$;

REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_allowed_bases(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
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

DROP POLICY IF EXISTS "auth read bases" ON public.bases;
CREATE POLICY "auth read bases"
ON public.bases
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'gerente')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_base_access(auth.uid(), id)
);

DROP POLICY IF EXISTS "auth insert audit" ON public.audit_logs;

DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'gerente')
);

DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full"
ON public.motoristas
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'supervisor')
  OR public.has_role(auth.uid(), 'gerente')
);

CREATE POLICY "recebimentos deny update"
ON public.recebimentos
FOR UPDATE
TO authenticated, anon
USING (false)
WITH CHECK (false);

CREATE POLICY "recebimentos deny delete"
ON public.recebimentos
FOR DELETE
TO authenticated, anon
USING (false);

REVOKE SELECT ON public.motoristas FROM authenticated;
GRANT SELECT (
  id, nome, placa, transportadora, base_id, ativo, created_at
) ON public.motoristas TO authenticated;

GRANT INSERT, UPDATE, DELETE ON public.motoristas TO authenticated;
GRANT ALL ON public.motoristas TO service_role;

DROP POLICY IF EXISTS "admins read audit" ON public.audit_logs;
CREATE POLICY "admins read audit" ON public.audit_logs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

DROP POLICY IF EXISTS "admins read motoristas full" ON public.motoristas;
CREATE POLICY "admins read motoristas full" ON public.motoristas
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'supervisor') OR has_role(auth.uid(),'gerente'));

REVOKE SELECT (cpf, cnh) ON public.motoristas FROM authenticated;
REVOKE SELECT (cpf, cnh) ON public.motoristas FROM anon;