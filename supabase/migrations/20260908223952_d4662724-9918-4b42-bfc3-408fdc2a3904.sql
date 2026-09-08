CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
WITH ref AS (SELECT COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date) dia),
rotas_dia AS MATERIALIZED (
 SELECT r.id, b.codigo
 FROM public.bases b
 JOIN public.meli_rotas_ativas r ON r.base_id=b.id
 CROSS JOIN ref
 WHERE r.data_rota=ref.dia
),
rotas_validas AS MATERIALIZED (
 SELECT id, codigo FROM rotas_dia WHERE NOT public.meli_rota_pm_excluida(id)
),
ocorrencias AS (
 SELECT rv.codigo,
   count(p.id) FILTER (WHERE public.meli_status_normalizado(p.status,p.substatus,p.occurrence_code)='cancelado')::int dc_cancelado,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('damaged','lost','stolen'))::int sinistros,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received'))::int pnr
 FROM rotas_validas rv
 LEFT JOIN public.meli_pacotes p ON p.rota_id=rv.id
 GROUP BY rv.codigo
), linhas_base AS (
 SELECT u.id,u.codigo,u.nome,u.cidade,u.uf,u.tipo,u.ordem,
   s.rotas_totais AS veiculos,s.pacotes,s.bem_sucedidos AS entregues,
   COALESCE(o.dc_cancelado,0) dc_cancelado,COALESCE(o.sinistros,0) sinistros,
   CASE WHEN s.id IS NULL THEN NULL ELSE greatest(s.com_falhas-COALESCE(o.dc_cancelado,0)-COALESCE(o.sinistros,0),0) END::int insucessos,
   COALESCE(o.pnr,0) pnr,s.coletado_em AS source_updated_at,
   CASE WHEN s.id IS NULL THEN 'sem_dados' ELSE 'ok' END status
 FROM public.meli_unidades_operacionais u CROSS JOIN ref
 LEFT JOIN public.meli_monitoramento_snapshots s ON s.base_codigo=u.codigo AND s.data_operacional=ref.dia
 LEFT JOIN ocorrencias o ON o.codigo=u.codigo
 WHERE u.ativo AND (auth.uid() IS NULL OR public.meli_pode_operar())
), linhas AS (
 SELECT *,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM linhas_base
), totais_base AS (
 SELECT COALESCE(sum(veiculos),0)::int veiculos,COALESCE(sum(pacotes),0)::int pacotes,
 COALESCE(sum(entregues),0)::int entregues,COALESCE(sum(dc_cancelado),0)::int dc_cancelado,
 COALESCE(sum(sinistros),0)::int sinistros,COALESCE(sum(insucessos),0)::int insucessos,
 COALESCE(sum(pnr),0)::int pnr,count(*) FILTER(WHERE status='ok')::int bases_com_dados FROM linhas
), totais AS (
 SELECT *,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END performance_logistics,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END performance_sem_dc,
   CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END performance_sem_dc_sinistro
 FROM totais_base
)
SELECT jsonb_build_object('status','ok','data',(SELECT dia FROM ref),
 'bases',COALESCE((SELECT jsonb_agg(to_jsonb(l)-'ordem' ORDER BY ordem) FROM linhas l),'[]'::jsonb),
 'totais',(SELECT to_jsonb(t) FROM totais t));
$function$;