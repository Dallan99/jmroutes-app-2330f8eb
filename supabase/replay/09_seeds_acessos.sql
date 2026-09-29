-- =============================================================================
-- SEED 2/2 — ACESSOS: PERFIL, PAPEL E BASE DE CADA PESSOA
-- Executar DEPOIS de criar os 23 usuarios em Auth (Add user / Invite user).
-- O pareamento e por E-MAIL, porque no banco novo cada usuario recebe um
-- identificador novo. Quem ainda nao existir fica de fora e pode ser incluido
-- rodando este arquivo de novo (ele nao duplica nada).
-- =============================================================================

begin;

-- O gatilho que protege o papel de administrador so aceita escrita feita por
-- servico. Estas duas linhas dizem ao gatilho que esta execucao e de confianca
-- (migração), e valem apenas dentro desta transacao.
set local request.jwt.claims = '{"role":"service_role"}';

do $$
declare
  v_reg  record;
  v_uid  uuid;
  v_bID  uuid;
begin
  for v_reg in
    select * from (values
      -- administrador
      ('adan.lopes@jmdistribuicao.com.br',       'admin',      null::text,   'adan.lopes@jmdistribuicao.com.br'),
      ('ciro.gomes@jmdistribuicao.com.br',       'admin',      null::text,   'Ciro Gomes'),
      ('dallan.zanini@jmdistribuicao.com.br',    'admin',      null::text,   'Dallan Zanini'),
      ('diogo.santos@jmdistribuicao.com.br',     'admin',      'ESP17',      'Diogo Santos'),
      ('larissa.santos@jmdistribuicao.com.br',   'admin',      null::text,   'Larissa Santos'),
      ('marcos.soares@jmdistribuicao.com.br',    'admin',      null::text,   'Marcos Soares'),
      ('marcos.souza@jmdistribuicao.com.br',     'admin',      null::text,   'Marcos Roberto Maciel de Souza'),
      ('mauro.moris@jmdistribuicao.com.br',      'admin',      null::text,   'MAURO'),
      ('moacir.benkendorf@jmdistribuicao.com.br','admin',      'ESP17',      'Moacir Benkendorf'),
      ('niquelle.goncalves@jmdistribuicao.com.br','admin',     'ESP16',      'Niquelle Gonçalves'),
      ('rene.mendes@jmdistribuicao.com.br',      'admin',      null::text,   'Renê Mendes'),
      ('sergio.nemeth@jmdistribuicao.com.br',    'admin',      null::text,   'Sergio Nemeth'),
      ('viviane.pires@jmdistribuicao.com.br',    'admin',      'ESP17',      'Viviane Cetto Pires'),
      ('worker.meli.esp16@jmroutes.local',       'admin',      null::text,   'Worker Meli'),
      -- supervisor
      ('lincoln.silva@jmdistribuicao.com.br',    'supervisor', 'ESP16',      'lincoln silva'),
      ('matheus.soares@jmdistribuicao.com.br',   'supervisor', 'ESP16',      'matheus soares'),
      -- operador
      ('ana.rodrigues@jmdistribuicao.com.br',    'operador',   'ESP16',      'Ana Ketrellyn Rodrigues'),
      ('andre.machado@jmdistribuicao.com.br',    'operador',   'ESP16',      'Andre Machado freitas'),
      ('josue.mendes@jmdistribuicao.com.br',     'operador',   'ESP16',      'Josue Matheus Nicolas da Silva'),
      ('leonardo.jacobre@jmdistribuicao.com.br', 'operador',   'ESP17',      'Leonardo Jacobe'),
      ('taina.francisco@jmdistribuicao.com.br',  'operador',   'ESP17',      'Taina'),
      ('wellington.silva@jmdistribuicao.com.br', 'operador',   'ESP16',      'Welligton'),
      -- motorista sem papel de sistema (login do coletor de motorista)
      ('pastor@motoristas.jmroutes.local',       null::text,   'ESP17',      'Agatha Nielly Pereira Lima Alves')
    ) as t(email, papel, base_codigo, nome)
  loop
    select u.id into v_uid from auth.users u where u.email = v_reg.email;
    if v_uid is null then
      raise notice 'ainda nao criado: %', v_reg.email;
      continue;
    end if;

    v_bID := null;
    if v_reg.base_codigo is not null then
      select b.id into v_bID from public.bases b where b.codigo = v_reg.base_codigo;
    end if;

    insert into public.profiles (id, nome, email, base_id, ativo)
    values (v_uid, v_reg.nome, v_reg.email, v_bID, true)
    on conflict (id) do update
      set nome = coalesce(nullif(btrim(excluded.nome), ''), public.profiles.nome),
          base_id = coalesce(excluded.base_id, public.profiles.base_id),
          ativo = true;

    if v_reg.papel is not null then
      insert into public.user_roles (user_id, role)
      values (v_uid, v_reg.papel::public.app_role)
      on conflict do nothing;
    end if;

    -- motorista cadastrado (placa e codigo do Meli) volta a apontar para o login
    update public.motoristas
       set auth_user_id = v_uid
     where auth_user_id is null
       and (nome = v_reg.nome or meli_driver_id = '4499570')
       and v_reg.email = 'pastor@motoristas.jmroutes.local';
  end loop;
end
$$;

-- Conferencia rapida depois de rodar:
--   select u.email, string_agg(r.role::text, ',') as papeis, count(p.id) as tem_perfil
--     from auth.users u
--     left join public.user_roles r on r.user_id = u.id
--     left join public.profiles p on p.id = u.id
--    group by u.email order by u.email;

commit;
