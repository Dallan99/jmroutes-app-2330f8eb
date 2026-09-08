-- Contadores do quadro "Monitoramento Last Mile" do AdminML.
-- Uma linha representa a leitura mais recente de uma unidade no dia operacional.
CREATE TABLE IF NOT EXISTS public.meli_monitoramento_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_operacional date NOT NULL,
  base_codigo text NOT NULL REFERENCES public.meli_unidades_operacionais(codigo),
  facility_id text NOT NULL,
  service_center_id text NOT NULL,
  rotas_totais integer NOT NULL DEFAULT 0 CHECK (rotas_totais >= 0),
  rotas_entrega integer NOT NULL DEFAULT 0 CHECK (rotas_entrega >= 0),
  rotas_coleta integer NOT NULL DEFAULT 0 CHECK (rotas_coleta >= 0),
  rotas_mistas integer NOT NULL DEFAULT 0 CHECK (rotas_mistas >= 0),
  rotas_em_andamento integer NOT NULL DEFAULT 0 CHECK (rotas_em_andamento >= 0),
  pacotes integer NOT NULL DEFAULT 0 CHECK (pacotes >= 0),
  sacas integer NOT NULL DEFAULT 0 CHECK (sacas >= 0),
  pendentes integer NOT NULL DEFAULT 0 CHECK (pendentes >= 0),
  com_falhas integer NOT NULL DEFAULT 0 CHECK (com_falhas >= 0),
  bem_sucedidos integer NOT NULL DEFAULT 0 CHECK (bem_sucedidos >= 0),
  coletado_em timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_codigo, data_operacional),
  CHECK (upper(base_codigo) = upper(facility_id)),
  CHECK ((base_codigo LIKE 'ESP%' AND facility_id LIKE 'ESP%') OR (base_codigo !~ '^ESP'))
);

CREATE INDEX IF NOT EXISTS meli_monitoramento_data_idx ON public.meli_monitoramento_snapshots (data_operacional DESC);
CREATE INDEX IF NOT EXISTS meli_monitoramento_facility_idx ON public.meli_monitoramento_snapshots (facility_id, coletado_em DESC);

ALTER TABLE public.meli_monitoramento_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gestao_le_monitoramento_meli" ON public.meli_monitoramento_snapshots
FOR SELECT TO authenticated USING (public.meli_pode_operar());
GRANT SELECT ON public.meli_monitoramento_snapshots TO authenticated;
GRANT ALL ON public.meli_monitoramento_snapshots TO service_role;

-- Corrige somente o catálogo atual; a migration histórica permanece intacta.
UPDATE public.meli_unidades_operacionais SET ativo=false
WHERE codigo NOT IN ('SSP3','SSP38','ESP15','SSP5','SSP20','ESP17','ESP16','SSP17','ESP18','SSP6','SSP45','SSP15','SSP37','SSP23','SSC2','SSP4','SSP7');
UPDATE public.meli_unidades_operacionais
SET tipo=CASE WHEN codigo LIKE 'ESP%' THEN 'XPT' ELSE 'SERVICE' END, updated_at=now()
WHERE ativo;

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
