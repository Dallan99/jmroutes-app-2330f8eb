-- Diagnóstico de desempenho do banco (somente leitura). Rodar antes e depois
-- da migration 20261027170000_desempenho_rls_indices.sql e comparar.

-- 1) Conexões por estado e por aplicação (limite: SHOW max_connections)
SELECT current_setting('max_connections')::int AS max_conexoes,
       count(*) AS conexoes_abertas,
       count(*) FILTER (WHERE state = 'active') AS ativas,
       count(*) FILTER (WHERE state = 'idle in transaction') AS idle_em_transacao,
       count(*) FILTER (WHERE wait_event_type = 'Lock') AS esperando_lock
FROM pg_stat_activity;

SELECT usename, application_name, state, count(*)
FROM pg_stat_activity GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 15;

-- 2) Consultas em execução há mais de 5 s
SELECT pid, now() - query_start AS duracao, usename, state, wait_event_type, left(query, 200) AS consulta
FROM pg_stat_activity
WHERE state <> 'idle' AND now() - query_start > interval '5 seconds'
ORDER BY duracao DESC LIMIT 20;

-- 3) Consultas que mais consomem tempo no total (pg_stat_statements)
SELECT round(total_exec_time::numeric / 1000, 1) AS total_s,
       calls,
       round(mean_exec_time::numeric, 1) AS media_ms,
       round(max_exec_time::numeric, 1) AS max_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 220) AS consulta
FROM extensions.pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;

-- 4) Consultas mais frequentes
SELECT calls, round(mean_exec_time::numeric, 1) AS media_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 220) AS consulta
FROM extensions.pg_stat_statements
ORDER BY calls DESC LIMIT 20;

-- 5) Tamanho das tabelas e varreduras sequenciais (candidatas a índice)
SELECT relname AS tabela,
       pg_size_pretty(pg_total_relation_size(relid)) AS tamanho,
       n_live_tup AS linhas, n_dead_tup AS linhas_mortas,
       seq_scan, idx_scan, last_autovacuum
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;

-- 6) Policies de leitura das tabelas quentes (conferir chamadas por linha)
SELECT tablename, policyname, roles, left(qual, 220) AS regra
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('rotas','volumes','recebimentos','profiles','user_roles','bases',
                    'meli_piloto_ciclos','meli_piloto_rotas','meli_piloto_pacotes','meli_piloto_paginas')
ORDER BY tablename, policyname;

-- 7) Funções de permissão (security definer = true depois da migration)
SELECT proname, prosecdef AS security_definer, provolatile
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN ('has_role','has_base_access','get_allowed_bases','bases_permitidas_atual');

-- 8) Tabelas publicadas no Realtime
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 2;

-- 9) Volume do piloto nas últimas 24 h (pressão de escrita do coletor)
SELECT
  (SELECT count(*) FROM public.meli_piloto_ciclos  WHERE iniciado_em  > now() - interval '24 hours') AS ciclos_24h,
  (SELECT count(*) FROM public.meli_piloto_paginas WHERE created_at   > now() - interval '24 hours') AS paginas_24h,
  (SELECT count(*) FROM public.meli_piloto_ciclos  WHERE status = 'em_andamento' AND iniciado_em < now() - interval '1 hour') AS ciclos_presos;
