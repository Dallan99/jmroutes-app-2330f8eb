-- Permite o fechamento interno via service_role/cron, sem abrir acesso anônimo.
CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
WITH ref AS (SELECT COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date) dia),
linhas AS (
 SELECT u.id,u.codigo,u.nome,u.cidade,u.uf,u.tipo,u.ordem,
   s.rotas_totais,s.rotas_entrega,s.rotas_coleta,s.rotas_mistas,s.rotas_em_andamento,
   s.pacotes,s.sacas,s.pendentes,s.com_falhas,s.bem_sucedidos,s.coletado_em AS source_updated_at,
   CASE WHEN s.id IS NULL THEN 'sem_dados' ELSE 'ok' END status
 FROM public.meli_unidades_operacionais u CROSS JOIN ref
 LEFT JOIN public.meli_monitoramento_snapshots s ON s.base_codigo=u.codigo AND s.data_operacional=ref.dia
 WHERE u.ativo AND (auth.uid() IS NULL OR public.meli_pode_operar())
), totais AS (
 SELECT COALESCE(sum(rotas_totais),0)::int rotas_totais,COALESCE(sum(rotas_entrega),0)::int rotas_entrega,
 COALESCE(sum(rotas_coleta),0)::int rotas_coleta,COALESCE(sum(rotas_mistas),0)::int rotas_mistas,
 COALESCE(sum(rotas_em_andamento),0)::int rotas_em_andamento,COALESCE(sum(pacotes),0)::int pacotes,
 COALESCE(sum(sacas),0)::int sacas,COALESCE(sum(pendentes),0)::int pendentes,
 COALESCE(sum(com_falhas),0)::int com_falhas,COALESCE(sum(bem_sucedidos),0)::int bem_sucedidos,
 count(*) FILTER(WHERE status='ok')::int bases_com_dados FROM linhas
)
SELECT jsonb_build_object('status','ok','data',(SELECT dia FROM ref),
 'bases',COALESCE((SELECT jsonb_agg(to_jsonb(l)-'ordem' ORDER BY ordem) FROM linhas l),'[]'::jsonb),
 'totais',(SELECT to_jsonb(t) FROM totais t));
$$;
REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated,service_role;
