-- Dashboard Geral: catálogo independente das bases atendidas e fechamento diário.
-- Não reutiliza bases.meli_service_center_id porque um Service Center também pode
-- alimentar uma operação XPT, o que tornaria o vínculo ambíguo.

CREATE TABLE public.meli_unidades_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  cidade text,
  uf char(2),
  tipo text NOT NULL CHECK (tipo IN ('SERVICE', 'XPT')),
  service_center_id text,
  ativo boolean NOT NULL DEFAULT true,
  ordem smallint NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.meli_performance_diaria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id uuid NOT NULL REFERENCES public.meli_unidades_operacionais(id),
  data_operacional date NOT NULL,
  veiculos integer NOT NULL DEFAULT 0 CHECK (veiculos >= 0),
  pacotes integer NOT NULL DEFAULT 0 CHECK (pacotes >= 0),
  entregues integer NOT NULL DEFAULT 0 CHECK (entregues >= 0),
  dc_cancelado integer NOT NULL DEFAULT 0 CHECK (dc_cancelado >= 0),
  sinistros integer NOT NULL DEFAULT 0 CHECK (sinistros >= 0),
  insucessos integer NOT NULL DEFAULT 0 CHECK (insucessos >= 0),
  pnr integer NOT NULL DEFAULT 0 CHECK (pnr >= 0),
  origem text NOT NULL DEFAULT 'adminml',
  source_updated_at timestamptz,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, data_operacional)
);

CREATE INDEX meli_performance_diaria_data_idx
  ON public.meli_performance_diaria (data_operacional DESC);

CREATE TABLE public.meli_performance_fechamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  data_operacional date NOT NULL UNIQUE,
  snapshot jsonb NOT NULL,
  fechado_at timestamptz NOT NULL DEFAULT now(),
  email_status text NOT NULL DEFAULT 'pendente' CHECK (email_status IN ('pendente', 'enviando', 'enviado', 'erro')),
  email_destinatarios text[] NOT NULL DEFAULT '{}',
  email_tentativas integer NOT NULL DEFAULT 0,
  email_resposta jsonb,
  email_enviado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meli_unidades_operacionais ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_performance_diaria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_performance_fechamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gestao_le_unidades_meli" ON public.meli_unidades_operacionais
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY "gestao_le_performance_meli" ON public.meli_performance_diaria
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY "gestao_le_fechamentos_meli" ON public.meli_performance_fechamentos
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);

INSERT INTO public.meli_unidades_operacionais (codigo, nome, cidade, uf, tipo, service_center_id, ativo, ordem) VALUES
('SSP3',  'Campinas',         'Campinas',         'SP', 'SERVICE', 'SSP3',  true,  10),
('SSP38', 'Itupeva',          'Itupeva',          'SP', 'SERVICE', 'SSP38', true,  20),
('ESP15', 'XPT Ibiúna',       'Ibiúna',           'SP', 'XPT',     'SSP20', true,  30),
('SSP5',  'Mega Barueri',     'Barueri',          'SP', 'SERVICE', 'SSP5',  true,  40),
('SSP20', 'Sorocaba',         'Sorocaba',         'SP', 'SERVICE', 'SSP20', true,  50),
('SSP56', 'XPT Embu Guaçu',   'Embu-Guaçu',       'SP', 'XPT',     'SSP56', true,  60),
('ESP16', 'XPT Guarujá',      'Guarujá',          'SP', 'XPT',     'SSP15', true,  70),
('SSP17', 'ABC',              'Santo André',      'SP', 'SERVICE', 'SSP17', true,  80),
('SSP6',  'Mauá',             'Mauá',             'SP', 'SERVICE', 'SSP6',  true,  90),
('SSP45', 'Itaquera',         'São Paulo',        'SP', 'SERVICE', 'SSP45', true, 100),
('SSP15', 'Santos',           'Santos',           'SP', 'SERVICE', 'SSP15', true, 110),
('SSP37', 'Campinas',         'Campinas',         'SP', 'SERVICE', 'SSP37', true, 120),
('SSP23', 'Suzano',           'Suzano',           'SP', 'SERVICE', 'SSP23', true, 130),
('SSC2',  'Biguaçu',          'Biguaçu',          'SC', 'SERVICE', 'SSC2',  true, 140),
('SSP25', 'Atibaia',          'Atibaia',          'SP', 'SERVICE', 'SSP25', true, 150),
('SFC1',  'Itupeva SFC',      'Itupeva',          'SP', 'SERVICE', 'SFC1',  true, 160),
('ESP18', 'XPT Franco da Rocha','Franco da Rocha','SP', 'XPT',     'SSP25', true, 170)
ON CONFLICT (codigo) DO UPDATE SET
  nome = EXCLUDED.nome, cidade = EXCLUDED.cidade, uf = EXCLUDED.uf,
  tipo = EXCLUDED.tipo, service_center_id = EXCLUDED.service_center_id,
  ativo = EXCLUDED.ativo, ordem = EXCLUDED.ordem, updated_at = now();

CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH ref AS (
  SELECT COALESCE(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date) AS dia
), linhas AS (
  SELECT u.id, u.codigo, u.nome, u.cidade, u.uf, u.tipo, u.ordem,
         p.veiculos, p.pacotes, p.entregues, p.dc_cancelado, p.sinistros,
         p.insucessos, p.pnr, p.origem, p.source_updated_at,
         CASE WHEN p.id IS NULL THEN 'sem_dados' ELSE 'ok' END AS status,
         CASE WHEN COALESCE(p.pacotes,0) = 0 THEN NULL ELSE round(100.0 * p.entregues / p.pacotes, 2) END AS performance_logistics,
         CASE WHEN COALESCE(p.pacotes,0) = 0 THEN NULL ELSE round(100.0 * (p.entregues + p.dc_cancelado) / p.pacotes, 2) END AS performance_sem_dc,
         CASE WHEN COALESCE(p.pacotes,0) = 0 THEN NULL ELSE round(100.0 * (p.entregues + p.dc_cancelado + p.sinistros) / p.pacotes, 2) END AS performance_sem_dc_sinistro
  FROM public.meli_unidades_operacionais u CROSS JOIN ref
  LEFT JOIN public.meli_performance_diaria p ON p.unidade_id = u.id AND p.data_operacional = ref.dia
  WHERE u.ativo
), totais AS (
  SELECT COALESCE(sum(veiculos),0) veiculos, COALESCE(sum(pacotes),0) pacotes,
         COALESCE(sum(entregues),0) entregues, COALESCE(sum(dc_cancelado),0) dc_cancelado,
         COALESCE(sum(sinistros),0) sinistros, COALESCE(sum(insucessos),0) insucessos,
         COALESCE(sum(pnr),0) pnr, count(*) FILTER (WHERE status = 'ok') bases_com_dados
  FROM linhas
)
SELECT jsonb_build_object(
  'status','ok', 'data',(SELECT dia FROM ref),
  'bases', COALESCE((SELECT jsonb_agg(to_jsonb(l) - 'ordem' ORDER BY ordem) FROM linhas l),'[]'::jsonb),
  'totais', (SELECT to_jsonb(t) || jsonb_build_object(
    'performance_logistics', CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*entregues/pacotes,2) END,
    'performance_sem_dc', CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado)/pacotes,2) END,
    'performance_sem_dc_sinistro', CASE WHEN pacotes=0 THEN NULL ELSE round(100.0*(entregues+dc_cancelado+sinistros)/pacotes,2) END
  ) FROM totais t)
);
$$;

CREATE OR REPLACE FUNCTION public.meli_fechar_dashboard_geral(p_data date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_data date := COALESCE(p_data, ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)); v_id uuid;
BEGIN
  INSERT INTO public.meli_performance_fechamentos (data_operacional, snapshot)
  VALUES (v_data, public.meli_dashboard_geral(v_data))
  ON CONFLICT (data_operacional) DO UPDATE SET snapshot=EXCLUDED.snapshot, fechado_at=now(), email_status='pendente'
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.meli_fechar_dashboard_geral(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meli_fechar_dashboard_geral(date) TO service_role;

GRANT SELECT ON public.meli_unidades_operacionais, public.meli_performance_diaria, public.meli_performance_fechamentos TO authenticated;
GRANT ALL ON public.meli_unidades_operacionais, public.meli_performance_diaria, public.meli_performance_fechamentos TO service_role;
