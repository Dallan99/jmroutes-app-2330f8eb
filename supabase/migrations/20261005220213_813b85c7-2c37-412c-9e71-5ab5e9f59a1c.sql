CREATE TEMP TABLE _t (ordem int, teste text, resultado text) ON COMMIT DROP;
DO $$
DECLARE
  u uuid := gen_random_uuid();
  adm uuid := 'ad2405f0-9af2-42ca-babc-dd6d1cc8b036';
  b15 uuid := (SELECT id FROM public.bases WHERE codigo='ESP15');
  b16 uuid := (SELECT id FROM public.bases WHERE codigo='ESP16');
  rec uuid; aud uuid; c uuid;
  r text[] := array[]::text[];
  x text; n int;
BEGIN
  BEGIN
    -- Preparação feita em nome do administrador real (tudo desfeito no final)
    PERFORM set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
    INSERT INTO auth.users(id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    VALUES (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'teste-rollback-'||u||'@invalid', now(), '{}', '{}', now(), now());
    UPDATE public.profiles SET ativo = true, base_id = b15 WHERE id = u;
    INSERT INTO public.user_roles(user_id, role) VALUES (u, 'operador');
    INSERT INTO public.recebimentos(codigo_bipado, operador_id, resultado, base_id, stage) VALUES ('TESTE-ROLLBACK', u, 'ok', b15, 'recebimento') RETURNING id INTO rec;
    INSERT INTO public.audit_logs(user_id, acao, entidade, entidade_id, detalhes) VALUES (u, 'teste_rollback', 'teste', 'x', '{}') RETURNING id INTO aud;
    INSERT INTO public.contagens(base_id, data_operacional, usuario_id) VALUES (b15, current_date, u) RETURNING id INTO c;

    -- A partir daqui age como o operador comum
    EXECUTE 'SET LOCAL ROLE authenticated';
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

    BEGIN INSERT INTO public.user_roles(user_id, role) VALUES (u, 'admin'); x := 'FALHA: conseguiu virar admin';
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('1|Autopromoção a admin|'||x);
    BEGIN UPDATE public.user_roles SET role='admin' WHERE user_id=u; GET DIAGNOSTICS n = ROW_COUNT; x := CASE WHEN n=0 THEN 'OK nenhuma linha alterada' ELSE 'FALHA: alterou papel' END;
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('2|Trocar o próprio papel|'||x);
    BEGIN INSERT INTO public.user_bases(user_id, base_id) VALUES (u, b16); x := 'FALHA: adicionou base a si mesmo';
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('3|Adicionar base a si mesmo|'||x);
    BEGIN UPDATE public.profiles SET base_id=b16 WHERE id=u;
      x := CASE WHEN (SELECT base_id FROM public.profiles WHERE id=u)=b15 THEN 'OK base mantida' ELSE 'FALHA: trocou a própria base' END;
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('4|Trocar a própria base no perfil|'||x);
    x := (CASE WHEN public.has_base_access(u, b15) THEN 'acessa ESP15' ELSE 'NÃO acessa ESP15' END)||' / '||(CASE WHEN public.has_base_access(u, b16) THEN 'FALHA: acessa ESP16' ELSE 'OK não acessa ESP16' END);
    r := r || ('5|Isolamento por base|'||x);
    BEGIN INSERT INTO public.contagens(base_id, data_operacional, usuario_id) VALUES (b16, current_date, u); x := 'FALHA: gravou em outra base';
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('6|Gravar contagem em outra base|'||x);
    SELECT count(*) INTO n FROM public.contagens WHERE base_id=b15; r := r || ('7|Ler contagem da própria base|'||n||' linha(s) visível(is)');
    BEGIN INSERT INTO public.audit_logs(user_id, acao, entidade) VALUES (u,'x','y'); x := 'FALHA: escreveu auditoria direto';
    EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('8|Escrever auditoria direto pelo app|'||x);

    EXECUTE 'RESET ROLE';
    BEGIN UPDATE public.recebimentos SET mensagem='alterado' WHERE id=rec; x := 'FALHA: alterou'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('9|Alterar recebimento|'||x);
    BEGIN DELETE FROM public.recebimentos WHERE id=rec; x := 'FALHA: apagou'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('10|Apagar recebimento|'||x);
    BEGIN UPDATE public.audit_logs SET acao='y' WHERE id=aud; x := 'FALHA: alterou'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('11|Alterar auditoria|'||x);
    BEGIN DELETE FROM public.audit_logs WHERE id=aud; x := 'FALHA: apagou'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('12|Apagar auditoria|'||x);
    BEGIN DELETE FROM public.bases WHERE id=b15; x := 'FALHA: apagou base com histórico'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('13|Excluir base com histórico|'||x);
    BEGIN DELETE FROM public.profiles WHERE id=u; x := 'FALHA: apagou perfil com histórico'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('14|Excluir perfil com histórico|'||x);
    BEGIN DELETE FROM auth.users WHERE id=u; x := 'FALHA: apagou usuário com histórico'; EXCEPTION WHEN others THEN x := 'OK bloqueado: '||SQLERRM; END; r := r || ('15|Excluir usuário com histórico|'||x);

    RAISE EXCEPTION 'desfazer_teste';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'desfazer_teste' THEN r := r || ('0|Erro na preparação|'||SQLERRM); END IF;
  END;
  INSERT INTO _t SELECT row_number() over (), split_part(v,'|',2), split_part(v,'|',3) FROM unnest(r) v;
END $$;
SELECT * FROM _t ORDER BY ordem;