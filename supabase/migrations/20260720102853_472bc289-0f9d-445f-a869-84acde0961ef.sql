
-- Reset senha do admin
UPDATE auth.users
SET encrypted_password = crypt(gen_random_uuid()::text /* senha historica removida */, gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email = 'dallan.zanini@jmdistribuicao.com.br';

ALTER TABLE public.user_roles DISABLE TRIGGER USER;

DO $$
DECLARE
  v_user record;
  v_id uuid;
  v_base_esp16 uuid := 'a5ae8637-1e33-40e3-8fdb-d1a464628ab9';
  v_base_esp17 uuid := 'e4e9b675-6cff-4d6b-b7db-684573f58294';
  v_pwd text := crypt(gen_random_uuid()::text /* senha historica removida */, gen_salt('bf'));
BEGIN
  FOR v_user IN
    SELECT * FROM (VALUES
      ('lincoln.silva@jmdistribuicao.com.br','lincoln silva','supervisor'::app_role, v_base_esp16),
      ('matheus.soares@jmdistribuicao.com.br','matheus soares','supervisor'::app_role, v_base_esp16),
      ('marcos.soares@jmdistribuicao.com.br','Marcos Soares','admin'::app_role, NULL),
      ('larissa.santos@jmdistribuicao.com.br','Larissa Santos','admin'::app_role, NULL),
      ('marcos.souza@jmdistribuicao.com.br','Marcos Roberto Maciel de Souza','admin'::app_role, NULL),
      ('ciro.gomes@jmdistribuicao.com.br','Ciro Gomes','admin'::app_role, NULL),
      ('diogo.santos@jmdistribuicao.com.br','Diogo Santos','operador'::app_role, v_base_esp17),
      ('moacir.benkendorf@jmdistribuicao.com.br','Moacir Benkendorf','admin'::app_role, NULL),
      ('ana.rodrigues@jmdistribuicao.com.br','Ana Ketrellyn Rodrigues','operador'::app_role, v_base_esp16),
      ('niquelle.goncalves@jmdistribuicao.com.br','Niquelle Gonçalves','admin'::app_role, NULL),
      ('andre.machado@jmdistribuicao.com.br','Andre Machado freitas','operador'::app_role, v_base_esp16),
      ('leonardo.jacobre@jmdistribuicao.com.br','Leonardo Jacobe','operador'::app_role, v_base_esp17),
      ('viviane.pires@jmdistribuicao.com.br','Viviane Cetto Pires','admin'::app_role, NULL),
      ('sergio.nemeth@jmdistribuicao.com.br','Sergio Nemeth','admin'::app_role, NULL),
      ('rene.mendes@jmdistribuicao.com.br','Renê Mendes','admin'::app_role, NULL)
    ) AS t(email, nome, role, base_id)
  LOOP
    SELECT id INTO v_id FROM auth.users WHERE email = v_user.email;
    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        v_user.email, v_pwd, now(),
        jsonb_build_object('provider','email','providers',ARRAY['email']),
        jsonb_build_object('nome', v_user.nome),
        now(), now(), '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), v_id, v_user.email,
        jsonb_build_object('sub', v_id::text, 'email', v_user.email, 'email_verified', true),
        'email', now(), now(), now());
    END IF;

    INSERT INTO public.profiles (id, nome, email, base_id, ativo)
    VALUES (v_id, v_user.nome, v_user.email, v_user.base_id, true)
    ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email, base_id=EXCLUDED.base_id, ativo=true;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_id, v_user.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.user_roles ENABLE TRIGGER USER;
