-- Pagamento semanal de motoristas: domingo a sábado, pagamento na quarta seguinte.
-- A elegibilidade é estrita: somente rotas com mais de 90% dos pedidos entregues.

CREATE TABLE public.pagamento_regras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  tipo_veiculo text NOT NULL CHECK (tipo_veiculo IN ('passeio','utilitario','vuc')),
  valor_rota numeric(12,2) NOT NULL CHECK (valor_rota >= 0),
  percentual_minimo numeric(5,2) NOT NULL DEFAULT 90 CHECK (percentual_minimo BETWEEN 0 AND 100),
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (base_id, tipo_veiculo, vigencia_inicio)
);

CREATE TABLE public.motorista_veiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  motorista_id uuid REFERENCES public.motoristas(id),
  meli_driver_id text NOT NULL,
  tipo_veiculo text NOT NULL CHECK (tipo_veiculo IN ('passeio','utilitario','vuc')),
  placa text,
  vigencia_inicio date NOT NULL DEFAULT current_date,
  vigencia_fim date,
  ativo boolean NOT NULL DEFAULT true,
  criado_por uuid REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (vigencia_fim IS NULL OR vigencia_fim >= vigencia_inicio),
  UNIQUE (meli_driver_id, vigencia_inicio)
);

CREATE TABLE public.pagamento_extras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_inicio date NOT NULL,
  meli_rota_id uuid NOT NULL REFERENCES public.meli_rotas(id) ON DELETE RESTRICT,
  valor numeric(12,2) NOT NULL CHECK (valor > 0),
  motivo text NOT NULL CHECK (motivo IN ('domingo','feriado','outro')),
  observacao text,
  permitir_rota_nao_pagavel boolean NOT NULL DEFAULT false,
  aprovado_por uuid REFERENCES auth.users(id),
  aprovado_em timestamptz,
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (extract(dow FROM semana_inicio) = 0),
  CHECK ((aprovado_por IS NULL) = (aprovado_em IS NULL))
);

CREATE TABLE public.pagamento_fechamentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  semana_inicio date NOT NULL,
  semana_fim date NOT NULL,
  pagamento_previsto date NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','conferido','aprovado','enviado_financeiro','pago','cancelado')),
  total_rotas integer NOT NULL DEFAULT 0,
  rotas_pagaveis integer NOT NULL DEFAULT 0,
  rotas_nao_pagaveis integer NOT NULL DEFAULT 0,
  valor_rotas numeric(14,2) NOT NULL DEFAULT 0,
  valor_extras numeric(14,2) NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  conferido_por uuid REFERENCES auth.users(id),
  conferido_em timestamptz,
  aprovado_por uuid REFERENCES auth.users(id),
  aprovado_em timestamptz,
  enviado_financeiro_por uuid REFERENCES auth.users(id),
  enviado_financeiro_em timestamptz,
  pago_por uuid REFERENCES auth.users(id),
  pago_em timestamptz,
  observacao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CHECK (semana_fim = semana_inicio + 6),
  CHECK (pagamento_previsto = semana_inicio + 10),
  CHECK (extract(dow FROM semana_inicio) = 0),
  UNIQUE (base_id, semana_inicio)
);

CREATE TABLE public.pagamento_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fechamento_id uuid NOT NULL REFERENCES public.pagamento_fechamentos(id) ON DELETE CASCADE,
  meli_rota_id uuid NOT NULL REFERENCES public.meli_rotas(id),
  route_id text NOT NULL,
  data_rota date NOT NULL,
  motorista_id uuid REFERENCES public.motoristas(id),
  meli_driver_id text,
  motorista_nome text NOT NULL,
  placa text,
  tipo_veiculo text CHECK (tipo_veiculo IN ('passeio','utilitario','vuc')),
  total_pedidos integer NOT NULL CHECK (total_pedidos >= 0),
  pedidos_entregues integer NOT NULL CHECK (pedidos_entregues >= 0),
  percentual_entregue numeric(7,4) NOT NULL,
  percentual_minimo numeric(5,2) NOT NULL,
  pagavel boolean NOT NULL,
  motivo_nao_pagavel text,
  valor_rota numeric(12,2) NOT NULL DEFAULT 0,
  valor_extras numeric(12,2) NOT NULL DEFAULT 0,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fechamento_id, meli_rota_id)
);

CREATE TABLE public.pagamento_status_historico (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fechamento_id uuid NOT NULL REFERENCES public.pagamento_fechamentos(id) ON DELETE CASCADE,
  status_anterior text,
  status_novo text NOT NULL,
  observacao text,
  alterado_por uuid NOT NULL REFERENCES auth.users(id),
  alterado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pagamento_regras_busca_idx ON public.pagamento_regras (base_id, tipo_veiculo, vigencia_inicio DESC) WHERE ativo;
CREATE INDEX motorista_veiculos_busca_idx ON public.motorista_veiculos (meli_driver_id, vigencia_inicio DESC) WHERE ativo;
CREATE INDEX pagamento_extras_semana_idx ON public.pagamento_extras (semana_inicio, meli_rota_id);
CREATE INDEX pagamento_fechamentos_semana_idx ON public.pagamento_fechamentos (semana_inicio DESC, base_id);
CREATE INDEX pagamento_itens_motorista_idx ON public.pagamento_itens (fechamento_id, motorista_nome);

INSERT INTO public.pagamento_regras (base_id, tipo_veiculo, valor_rota, percentual_minimo, vigencia_inicio)
SELECT b.id, v.tipo, v.valor, 90, DATE '2026-10-04'
FROM public.bases b
CROSS JOIN (VALUES ('passeio'::text, 200.00::numeric), ('utilitario', 300.00), ('vuc', 500.00)) AS v(tipo, valor)
WHERE b.codigo IN ('ESP15','ESP16','ESP17','ESP18')
ON CONFLICT (base_id, tipo_veiculo, vigencia_inicio) DO NOTHING;

ALTER TABLE public.pagamento_regras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.motorista_veiculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_fechamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_status_historico ENABLE ROW LEVEL SECURITY;

CREATE POLICY pagamento_regras_leitura_gestao ON public.pagamento_regras FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY motorista_veiculos_leitura_gestao ON public.motorista_veiculos FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY pagamento_extras_leitura_gestao ON public.pagamento_extras FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY pagamento_fechamentos_leitura_gestao ON public.pagamento_fechamentos FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY pagamento_itens_leitura_gestao ON public.pagamento_itens FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);
CREATE POLICY pagamento_historico_leitura_gestao ON public.pagamento_status_historico FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id=auth.uid() AND ur.role IN ('admin','supervisor','gerente'))
);

REVOKE ALL ON public.pagamento_regras, public.motorista_veiculos, public.pagamento_extras,
  public.pagamento_fechamentos, public.pagamento_itens, public.pagamento_status_historico FROM PUBLIC, anon;
GRANT SELECT ON public.pagamento_regras, public.motorista_veiculos, public.pagamento_extras,
  public.pagamento_fechamentos, public.pagamento_itens, public.pagamento_status_historico TO authenticated;
GRANT ALL ON public.pagamento_regras, public.motorista_veiculos, public.pagamento_extras,
  public.pagamento_fechamentos, public.pagamento_itens, public.pagamento_status_historico TO service_role;

CREATE OR REPLACE FUNCTION public.pagamentos_previa_semanal(p_semana_inicio date, p_base_codigo text DEFAULT NULL)
RETURNS TABLE (
  rota_uuid uuid, route_id text, data_rota date, base_id uuid, base_codigo text,
  motorista_id uuid, meli_driver_id text, motorista_nome text, placa text,
  tipo_veiculo text, total_pedidos integer, pedidos_entregues integer,
  percentual_entregue numeric, percentual_minimo numeric, pagavel boolean,
  motivo_nao_pagavel text, valor_rota numeric, valor_extras numeric, valor_total numeric
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public','pg_temp' AS $$
WITH rotas AS (
  SELECT r.*, b.codigo AS base_codigo
  FROM public.meli_rotas r
  JOIN public.bases b ON b.id=r.base_id
  WHERE r.data_rota BETWEEN p_semana_inicio AND p_semana_inicio + 6
    AND b.codigo IN ('ESP15','ESP16','ESP17','ESP18')
    AND (p_base_codigo IS NULL OR b.codigo=upper(p_base_codigo))
), classificadas AS (
  SELECT r.*,
    mv.tipo_veiculo AS tipo_veiculo_cfg,
    coalesce(mv.placa,r.vehicle_license) AS placa_cfg,
    regra.valor_rota AS valor_rota_cfg,
    coalesce(regra.percentual_minimo,90) AS percentual_minimo_cfg,
    CASE WHEN r.total_pacotes>0 THEN round(100.0*coalesce(r.delivered_total,0)/r.total_pacotes,4) ELSE 0 END AS percentual,
    coalesce(ex.valor_normal,0) AS extras_normais,
    coalesce(ex.valor_excecao,0) AS extras_excecao
  FROM rotas r
  LEFT JOIN LATERAL (
    SELECT v.* FROM public.motorista_veiculos v
    WHERE v.meli_driver_id=r.driver_id AND v.ativo
      AND v.vigencia_inicio<=r.data_rota AND (v.vigencia_fim IS NULL OR v.vigencia_fim>=r.data_rota)
    ORDER BY v.vigencia_inicio DESC LIMIT 1
  ) mv ON true
  LEFT JOIN LATERAL (
    SELECT pr.* FROM public.pagamento_regras pr
    WHERE pr.base_id=r.base_id AND pr.tipo_veiculo=mv.tipo_veiculo AND pr.ativo
      AND pr.vigencia_inicio<=r.data_rota AND (pr.vigencia_fim IS NULL OR pr.vigencia_fim>=r.data_rota)
    ORDER BY pr.vigencia_inicio DESC LIMIT 1
  ) regra ON true
  LEFT JOIN LATERAL (
    SELECT
      sum(e.valor) FILTER (WHERE NOT e.permitir_rota_nao_pagavel) AS valor_normal,
      sum(e.valor) FILTER (WHERE e.permitir_rota_nao_pagavel AND e.aprovado_por IS NOT NULL) AS valor_excecao
    FROM public.pagamento_extras e
    WHERE e.meli_rota_id=r.id AND e.semana_inicio=p_semana_inicio
  ) ex ON true
)
SELECT c.id, c.route_id, c.data_rota, c.base_id, c.base_codigo,
  c.motorista_id, c.driver_id, coalesce(nullif(c.driver_name,''),'Motorista não identificado'), c.placa_cfg,
  c.tipo_veiculo_cfg, c.total_pacotes, coalesce(c.delivered_total,0), c.percentual,
  c.percentual_minimo_cfg,
  (c.driver_id IS NOT NULL AND c.tipo_veiculo_cfg IS NOT NULL AND c.valor_rota_cfg IS NOT NULL
    AND c.total_pacotes>0 AND c.percentual>c.percentual_minimo_cfg) AS pagavel,
  CASE
    WHEN c.driver_id IS NULL THEN 'motorista_nao_identificado'
    WHEN c.tipo_veiculo_cfg IS NULL THEN 'veiculo_nao_configurado'
    WHEN c.valor_rota_cfg IS NULL THEN 'tarifa_nao_configurada'
    WHEN c.total_pacotes<=0 THEN 'rota_sem_pedidos'
    WHEN c.percentual<=c.percentual_minimo_cfg THEN 'percentual_insuficiente'
    ELSE NULL
  END,
  CASE WHEN c.driver_id IS NOT NULL AND c.tipo_veiculo_cfg IS NOT NULL AND c.valor_rota_cfg IS NOT NULL
    AND c.total_pacotes>0 AND c.percentual>c.percentual_minimo_cfg THEN c.valor_rota_cfg ELSE 0 END,
  CASE WHEN c.driver_id IS NOT NULL AND c.tipo_veiculo_cfg IS NOT NULL AND c.valor_rota_cfg IS NOT NULL
    AND c.total_pacotes>0 AND c.percentual>c.percentual_minimo_cfg THEN c.extras_normais+c.extras_excecao ELSE c.extras_excecao END,
  CASE WHEN c.driver_id IS NOT NULL AND c.tipo_veiculo_cfg IS NOT NULL AND c.valor_rota_cfg IS NOT NULL
    AND c.total_pacotes>0 AND c.percentual>c.percentual_minimo_cfg THEN c.valor_rota_cfg+c.extras_normais+c.extras_excecao ELSE c.extras_excecao END
FROM classificadas c
ORDER BY c.base_codigo, coalesce(c.driver_name,''), c.data_rota, c.route_id;
$$;

CREATE OR REPLACE FUNCTION public.pagamentos_gerar_fechamentos(p_semana_inicio date)
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE v_user uuid:=auth.uid(); v_base record; v_fechamento uuid;
BEGIN
  IF extract(dow FROM p_semana_inicio)<>0 THEN RAISE EXCEPTION 'semana_inicio_deve_ser_domingo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=v_user AND role IN ('admin','gerente')) THEN
    RAISE EXCEPTION 'acesso_negado';
  END IF;
  FOR v_base IN SELECT id,codigo FROM public.bases WHERE codigo IN ('ESP15','ESP16','ESP17','ESP18') LOOP
    INSERT INTO public.pagamento_fechamentos(base_id,semana_inicio,semana_fim,pagamento_previsto,criado_por)
    VALUES(v_base.id,p_semana_inicio,p_semana_inicio+6,p_semana_inicio+10,v_user)
    ON CONFLICT(base_id,semana_inicio) DO UPDATE SET atualizado_em=now()
    RETURNING id INTO v_fechamento;
    IF EXISTS (SELECT 1 FROM public.pagamento_fechamentos WHERE id=v_fechamento AND status<>'rascunho') THEN
      RAISE EXCEPTION 'fechamento_nao_esta_em_rascunho_para_base_%',v_base.codigo;
    END IF;
    DELETE FROM public.pagamento_itens WHERE fechamento_id=v_fechamento;
    INSERT INTO public.pagamento_itens(fechamento_id,meli_rota_id,route_id,data_rota,motorista_id,meli_driver_id,motorista_nome,placa,tipo_veiculo,total_pedidos,pedidos_entregues,percentual_entregue,percentual_minimo,pagavel,motivo_nao_pagavel,valor_rota,valor_extras,valor_total)
    SELECT v_fechamento,rota_uuid,route_id,data_rota,motorista_id,meli_driver_id,motorista_nome,placa,tipo_veiculo,total_pedidos,pedidos_entregues,percentual_entregue,percentual_minimo,pagavel,motivo_nao_pagavel,valor_rota,valor_extras,valor_total
    FROM public.pagamentos_previa_semanal(p_semana_inicio,v_base.codigo);
    UPDATE public.pagamento_fechamentos f SET
      total_rotas=x.total_rotas, rotas_pagaveis=x.pagaveis, rotas_nao_pagaveis=x.nao_pagaveis,
      valor_rotas=x.valor_rotas, valor_extras=x.valor_extras, valor_total=x.valor_total, atualizado_em=now()
    FROM (SELECT count(*)::int total_rotas,count(*) FILTER(WHERE pagavel)::int pagaveis,count(*) FILTER(WHERE NOT pagavel)::int nao_pagaveis,coalesce(sum(valor_rota),0) valor_rotas,coalesce(sum(valor_extras),0) valor_extras,coalesce(sum(valor_total),0) valor_total FROM public.pagamento_itens WHERE fechamento_id=v_fechamento) x
    WHERE f.id=v_fechamento;
    INSERT INTO public.pagamento_status_historico(fechamento_id,status_novo,observacao,alterado_por) VALUES(v_fechamento,'rascunho','Fechamento semanal gerado/recalculado',v_user);
    RETURN NEXT v_fechamento;
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.pagamentos_previa_semanal(date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pagamentos_previa_semanal(date,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.pagamentos_gerar_fechamentos(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.pagamentos_gerar_fechamentos(date) TO authenticated,service_role;
