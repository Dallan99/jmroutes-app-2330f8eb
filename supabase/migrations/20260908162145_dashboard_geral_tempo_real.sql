-- Dashboard Geral em tempo real, baseado na unidade operacional real (facilityId).

INSERT INTO public.bases (codigo, nome, cidade, uf, ativa) VALUES
('SSP3',  'Campinas',          'Campinas',         'SP', true),
('SSP38', 'Itupeva',           'Itupeva',          'SP', true),
('ESP15', 'XPT Ibiúna',        'Ibiúna',           'SP', true),
('SSP5',  'Mega Barueri',      'Barueri',          'SP', true),
('SSP20', 'Sorocaba',          'Sorocaba',         'SP', true),
('ESP17', 'XPT São Lourenço',  'São Lourenço',     'SP', true),
('ESP16', 'XPT Guarujá',       'Guarujá',          'SP', true),
('SSP17', 'ABC',               'Santo André',      'SP', true),
('ESP18', 'XPT Franco da Rocha','Franco da Rocha', 'SP', true),
('SSP6',  'Mauá',              'Mauá',             'SP', true),
('SSP45', 'Itaquera',          'São Paulo',        'SP', true),
('SSP15', 'Santos',            'Santos',           'SP', true),
('SSP37', 'Campinas',          'Campinas',         'SP', true),
('SSP23', 'Suzano',            'Suzano',           'SP', true),
('SSC2',  'Biguaçu',           'Biguaçu',          'SC', true),
('SSP4',  'Cravinhos',         'Cravinhos',        'SP', true),
('SSP7',  'Lapa',              'São Paulo',        'SP', true)
ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome, cidade = EXCLUDED.cidade, uf = EXCLUDED.uf, ativa = true;

-- A partir desta versão, meli_service_center_id representa a unidade real,
-- e não o Service pai usado apenas como filtro da consulta AdminML.
UPDATE public.bases SET meli_service_center_id = NULL
WHERE codigo IN ('SSP3','SSP38','ESP15','SSP5','SSP20','ESP17','ESP16','SSP17','ESP18',
                 'SSP6','SSP45','SSP15','SSP37','SSP23','SSC2','SSP4','SSP7');
UPDATE public.bases SET meli_service_center_id = codigo
WHERE codigo IN ('SSP3','SSP38','ESP15','SSP5','SSP20','ESP17','ESP16','SSP17','ESP18',
                 'SSP6','SSP45','SSP15','SSP37','SSP23','SSC2','SSP4','SSP7');

UPDATE public.meli_unidades_operacionais SET ativo = false
WHERE codigo NOT IN ('SSP3','SSP38','ESP15','SSP5','SSP20','ESP17','ESP16','SSP17','ESP18',
                     'SSP6','SSP45','SSP15','SSP37','SSP23','SSC2','SSP4','SSP7');

INSERT INTO public.meli_unidades_operacionais
  (codigo, nome, cidade, uf, tipo, service_center_id, ativo, ordem) VALUES
('SSP3',  'Campinas',           'Campinas',         'SP', 'SERVICE', 'SSP3',  true,  10),
('SSP38', 'Itupeva',            'Itupeva',          'SP', 'SERVICE', 'SSP38', true,  20),
('ESP15', 'XPT Ibiúna',         'Ibiúna',           'SP', 'XPT',     'SSP20', true,  30),
('SSP5',  'Mega Barueri',       'Barueri',          'SP', 'SERVICE', 'SSP5',  true,  40),
('SSP20', 'Sorocaba',           'Sorocaba',         'SP', 'SERVICE', 'SSP20', true,  50),
('ESP17', 'XPT São Lourenço',   'São Lourenço',     'SP', 'XPT',     'SSP56', true,  60),
('ESP16', 'XPT Guarujá',        'Guarujá',          'SP', 'XPT',     'SSP15', true,  70),
('SSP17', 'ABC',                'Santo André',      'SP', 'SERVICE', 'SSP17', true,  80),
('ESP18', 'XPT Franco da Rocha','Franco da Rocha', 'SP', 'XPT',     'SSP25', true,  90),
('SSP6',  'Mauá',               'Mauá',             'SP', 'SERVICE', 'SSP6',  true, 100),
('SSP45', 'Itaquera',           'São Paulo',        'SP', 'SERVICE', 'SSP45', true, 110),
('SSP15', 'Santos',             'Santos',           'SP', 'SERVICE', 'SSP15', true, 120),
('SSP37', 'Campinas',           'Campinas',         'SP', 'SERVICE', 'SSP37', true, 130),
('SSP23', 'Suzano',             'Suzano',           'SP', 'SERVICE', 'SSP23', true, 140),
('SSC2',  'Biguaçu',            'Biguaçu',          'SC', 'SERVICE', 'SSC2',  true, 150),
('SSP4',  'Cravinhos',          'Cravinhos',        'SP', 'SERVICE', 'SSP4',  true, 160),
('SSP7',  'Lapa',               'São Paulo',        'SP', 'SERVICE', 'SSP7',  true, 170)
ON CONFLICT (codigo) DO UPDATE SET
  nome=EXCLUDED.nome, cidade=EXCLUDED.cidade, uf=EXCLUDED.uf, tipo=EXCLUDED.tipo,
  service_center_id=EXCLUDED.service_center_id, ativo=true, ordem=EXCLUDED.ordem, updated_at=now();

CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
WITH perm AS (
  -- Chamadas internas do cron/service_role não possuem auth.uid(). A função
  -- continua inacessível a anon porque EXECUTE foi revogado explicitamente.
  SELECT (auth.uid() IS NULL OR public.meli_pode_operar()) AS ok
),
ref AS (SELECT COALESCE(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS dia),
pacotes_live AS (
  SELECT u.id AS unidade_id, r.id AS rota_id, r.last_synced_at, p.id AS pacote_id,
         public.meli_status_normalizado(p.status,p.substatus,p.occurrence_code) AS situacao,
         lower(coalesce(p.occurrence_code,'')) AS ocorrencia
    FROM public.meli_unidades_operacionais u
    JOIN public.bases b ON b.codigo=u.codigo
    JOIN public.meli_rotas_ativas r ON r.base_id=b.id
    CROSS JOIN ref
    LEFT JOIN public.meli_pacotes p ON p.rota_id=r.id
   WHERE u.ativo AND r.data_rota=ref.dia AND NOT public.meli_rota_pm_excluida(r.id)
), live AS (
  SELECT unidade_id,
         count(DISTINCT rota_id)::int AS veiculos,
         count(pacote_id)::int AS pacotes,
         count(pacote_id) FILTER (WHERE situacao='entregue')::int AS entregues,
         count(pacote_id) FILTER (WHERE situacao='cancelado')::int AS dc_cancelado,
         count(pacote_id) FILTER (WHERE ocorrencia IN ('damaged','lost','stolen'))::int AS sinistros,
         count(pacote_id) FILTER (WHERE ocorrencia IN ('pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received'))::int AS pnr,
         count(pacote_id) FILTER (
           WHERE situacao='insucesso'
             AND ocorrencia NOT IN ('damaged','lost','stolen','pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received')
         )::int AS insucessos,
         max(last_synced_at) AS source_updated_at
    FROM pacotes_live GROUP BY unidade_id
), linhas AS (
  SELECT u.id,u.codigo,u.nome,u.cidade,u.uf,u.tipo,u.ordem,
         COALESCE(m.veiculos,l.veiculos) AS veiculos,
         COALESCE(m.pacotes,l.pacotes) AS pacotes,
         COALESCE(m.entregues,l.entregues) AS entregues,
         COALESCE(m.dc_cancelado,l.dc_cancelado) AS dc_cancelado,
         COALESCE(m.sinistros,l.sinistros) AS sinistros,
         COALESCE(m.insucessos,l.insucessos) AS insucessos,
         COALESCE(m.pnr,l.pnr) AS pnr,
         CASE WHEN m.id IS NOT NULL THEN m.origem WHEN l.unidade_id IS NOT NULL THEN 'adminml_tempo_real' END AS origem,
         COALESCE(m.source_updated_at,l.source_updated_at) AS source_updated_at,
         CASE WHEN m.id IS NOT NULL OR l.unidade_id IS NOT NULL THEN 'ok' ELSE 'sem_dados' END AS status
    FROM public.meli_unidades_operacionais u CROSS JOIN ref
    LEFT JOIN live l ON l.unidade_id=u.id
    LEFT JOIN public.meli_performance_diaria m ON m.unidade_id=u.id AND m.data_operacional=ref.dia
   WHERE u.ativo AND (SELECT ok FROM perm)
), calculadas AS (
  SELECT *,
    CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END AS performance_logistics,
    CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END AS performance_sem_dc,
    CASE WHEN COALESCE(pacotes,0)=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END AS performance_sem_dc_sinistro
  FROM linhas
), totais AS (
  SELECT COALESCE(sum(veiculos),0)::int veiculos,COALESCE(sum(pacotes),0)::int pacotes,
    COALESCE(sum(entregues),0)::int entregues,COALESCE(sum(dc_cancelado),0)::int dc_cancelado,
    COALESCE(sum(sinistros),0)::int sinistros,COALESCE(sum(insucessos),0)::int insucessos,
    COALESCE(sum(pnr),0)::int pnr,count(*) FILTER(WHERE status='ok')::int bases_com_dados
  FROM calculadas
)
SELECT CASE WHEN NOT (SELECT ok FROM perm) THEN jsonb_build_object('status','erro','erro','sem_permissao')
ELSE jsonb_build_object(
  'status','ok','data',(SELECT dia FROM ref),
  'bases',COALESCE((SELECT jsonb_agg(to_jsonb(c)-'ordem' ORDER BY ordem) FROM calculadas c),'[]'::jsonb),
  'totais',(SELECT to_jsonb(t)||jsonb_build_object(
    'performance_logistics',CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END,
    'performance_sem_dc',CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END,
    'performance_sem_dc_sinistro',CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END
  ) FROM totais t)
) END;
$$;

REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated, service_role;

-- Fecha o dia encerrado exatamente à meia-noite de São Paulo (03:00 UTC).
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
DO $$
DECLARE v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname='jmroutes-dashboard-geral-fechamento';
  IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
  PERFORM cron.schedule(
    'jmroutes-dashboard-geral-fechamento',
    '0 3 * * *',
    $job$SELECT public.meli_fechar_dashboard_geral(NULL);$job$
  );
END $$;
