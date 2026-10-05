UPDATE auth.users
SET encrypted_password = crypt(gen_random_uuid()::text /* senha historica removida */, gen_salt('bf')),
    updated_at = now()
WHERE email = 'dallan.zanini@jmdistribuicao.com.br';