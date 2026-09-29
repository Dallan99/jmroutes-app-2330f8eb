-- Replay da estrutura do JMRoutes (homologacao) — lote 2 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260714143500_transferencias_module.sql ====
-- JMRoutes — módulo Transferências
-- Migration aditiva. Não executa backfill, não remove dados e não publica nada.
-- Aplicar primeiro em homologação somente após backup e revisão do PR.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Modelo operacional
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.transferencia_motivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nome text NOT NULL,
  responsabilidade text NOT NULL CHECK (responsabilidade IN ('JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE')),
  etapa text CHECK (etapa IS NULL OR etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  exige_descricao boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.transferencia_slas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  service text NOT NULL,
  chegada_service_limite time NOT NULL DEFAULT '07:00',
  saida_service_limite time NOT NULL DEFAULT '09:00',
  transito_max_minutos integer NOT NULL DEFAULT 60 CHECK (transito_max_minutos BETWEEN 1 AND 1440),
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_transferencia_sla_ativa
  ON public.transferencia_slas (base_id, lower(service)) WHERE ativo;

CREATE TABLE IF NOT EXISTS public.transferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  data_operacional date NOT NULL,
  service text NOT NULL,
  motorista text NOT NULL,
  placa text NOT NULL,
  tipo_veiculo text,
  status text NOT NULL DEFAULT 'aguardando_chegada_service' CHECK (status IN (
    'aguardando_chegada_service',
    'no_service',
    'em_transito_xpt',
    'concluida_no_prazo',
    'concluida_com_atraso',
    'pendente_evidencia',
    'em_analise',
    'cancelada'
  )),
  observacao text,
  criado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  finalizada_em timestamptz,
  cancelada_em timestamptz,
  cancelada_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(service)) BETWEEN 2 AND 120),
  CHECK (length(btrim(motorista)) BETWEEN 2 AND 160),
  CHECK (length(btrim(placa)) BETWEEN 5 AND 20)
);

CREATE INDEX IF NOT EXISTS idx_transferencias_base_data
  ON public.transferencias (base_id, data_operacional DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_status
  ON public.transferencias (status, data_operacional DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_service
  ON public.transferencias (lower(service), data_operacional DESC);
CREATE INDEX IF NOT EXISTS idx_transferencias_motorista
  ON public.transferencias (lower(motorista), data_operacional DESC);

CREATE TABLE IF NOT EXISTS public.transferencia_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  ocorrido_em timestamptz NOT NULL,
  localizacao_texto text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  minutos_atraso integer NOT NULL DEFAULT 0 CHECK (minutos_atraso >= 0),
  registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transferencia_id, etapa)
);

CREATE INDEX IF NOT EXISTS idx_transferencia_eventos_transferencia
  ON public.transferencia_eventos (transferencia_id, ocorrido_em);

CREATE TABLE IF NOT EXISTS public.transferencia_ocorrencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  evento_id uuid NOT NULL REFERENCES public.transferencia_eventos(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  motivo_id uuid REFERENCES public.transferencia_motivos(id) ON DELETE RESTRICT,
  responsabilidade text NOT NULL CHECK (responsabilidade IN ('SEM_ATRASO', 'JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE')),
  minutos_atraso integer NOT NULL DEFAULT 0 CHECK (minutos_atraso >= 0),
  observacao text,
  registrado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transferencia_ocorrencias_transferencia
  ON public.transferencia_ocorrencias (transferencia_id, etapa);
CREATE INDEX IF NOT EXISTS idx_transferencia_ocorrencias_motivo
  ON public.transferencia_ocorrencias (motivo_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.transferencia_evidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transferencia_id uuid NOT NULL REFERENCES public.transferencias(id) ON DELETE RESTRICT,
  evento_id uuid NOT NULL REFERENCES public.transferencia_eventos(id) ON DELETE RESTRICT,
  etapa text NOT NULL CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt')),
  storage_path text,
  timemark_url text,
  horario_evidencia timestamptz,
  localizacao_texto text,
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviada', 'validada', 'rejeitada')),
  enviado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  validado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validado_em timestamptz,
  rejeicao_motivo text,
  substituida_por uuid REFERENCES public.transferencia_evidencias(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (storage_path IS NOT NULL OR timemark_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_transferencia_evidencias_transferencia
  ON public.transferencia_evidencias (transferencia_id, etapa, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transferencia_evidencias_status
  ON public.transferencia_evidencias (status, created_at DESC);

DROP TRIGGER IF EXISTS trg_transferencias_updated ON public.transferencias;
CREATE TRIGGER trg_transferencias_updated BEFORE UPDATE ON public.transferencias
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_transferencia_slas_updated ON public.transferencia_slas;
CREATE TRIGGER trg_transferencia_slas_updated BEFORE UPDATE ON public.transferencia_slas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Acesso: somente admin é global; todos os demais ficam na profiles.base_id
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transferencia_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.ativo = true
      AND _base_id IS NOT NULL
      AND (
        public.has_role(_user_id, 'admin')
        OR p.base_id = _base_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.transferencia_access(_user_id uuid, _transferencia_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.transferencias t
    WHERE t.id = _transferencia_id
      AND public.transferencia_base_access(_user_id, t.base_id)
  );
$$;

REVOKE ALL ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transferencia_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_ocorrencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_evidencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_motivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencia_slas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "transferencias select base" ON public.transferencias
  FOR SELECT TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencias insert base" ON public.transferencias
  FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid() AND public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencias update base" ON public.transferencias
  FOR UPDATE TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id))
  WITH CHECK (public.transferencia_base_access(auth.uid(), base_id));

CREATE POLICY "transferencia eventos select" ON public.transferencia_eventos
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));
CREATE POLICY "transferencia ocorrencias select" ON public.transferencia_ocorrencias
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));
CREATE POLICY "transferencia evidencias select" ON public.transferencia_evidencias
  FOR SELECT TO authenticated
  USING (public.transferencia_access(auth.uid(), transferencia_id));

CREATE POLICY "transferencia motivos select" ON public.transferencia_motivos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "transferencia motivos admin" ON public.transferencia_motivos
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "transferencia slas select" ON public.transferencia_slas
  FOR SELECT TO authenticated
  USING (public.transferencia_base_access(auth.uid(), base_id));
CREATE POLICY "transferencia slas admin" ON public.transferencia_slas
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT ON public.transferencia_motivos, public.transferencia_slas,
  public.transferencias, public.transferencia_eventos,
  public.transferencia_ocorrencias, public.transferencia_evidencias TO authenticated;
GRANT ALL ON public.transferencia_motivos, public.transferencia_slas,
  public.transferencias, public.transferencia_eventos,
  public.transferencia_ocorrencias, public.transferencia_evidencias TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Motivos iniciais (editáveis pelo admin, sem dados pessoais)
-- ---------------------------------------------------------------------------

INSERT INTO public.transferencia_motivos (codigo, nome, responsabilidade, etapa, exige_descricao, ordem)
VALUES
  ('MOTORISTA_ATRASADO', 'Motorista apresentou-se com atraso', 'JM_FROTA', 'chegada_service', false, 10),
  ('ROTA_ANTERIOR', 'Rota anterior atrasou a apresentação', 'JM_FROTA', 'chegada_service', false, 20),
  ('QUEBRA_ANTES_SERVICE', 'Quebra do veículo antes do Service', 'JM_FROTA', 'chegada_service', false, 30),
  ('FALTA_MOTORISTA', 'Falta ou troca de motorista', 'JM_FROTA', 'chegada_service', false, 40),
  ('DOCUMENTACAO_FROTA', 'Pendência de documentação da frota', 'JM_FROTA', NULL, false, 50),
  ('ATRASO_CARREGAMENTO', 'Atraso no carregamento', 'MELI', 'saida_service', false, 60),
  ('FILA_DOCA', 'Fila de doca', 'MELI', 'saida_service', false, 70),
  ('PORTA_BLOQUEADA', 'Porta ou doca bloqueada', 'MELI', 'saida_service', false, 80),
  ('CARGA_NAO_LIBERADA', 'Carga não liberada', 'MELI', 'saida_service', false, 90),
  ('SISTEMA_SERVICE', 'Sistema ou documentação do Service', 'MELI', 'saida_service', false, 100),
  ('QUEBRA_NO_SERVICE', 'Quebra do veículo no Service', 'JM_FROTA', 'saida_service', false, 110),
  ('QUEBRA_TRAJETO', 'Quebra do veículo no trajeto', 'JM_FROTA', 'chegada_xpt', false, 120),
  ('PARADA_DESVIO', 'Parada ou desvio no trajeto', 'JM_FROTA', 'chegada_xpt', true, 130),
  ('TRANSITO_SEVERO', 'Trânsito severo', 'EXTERNO', 'chegada_xpt', false, 140),
  ('ACIDENTE_INTERDICAO', 'Acidente ou interdição', 'EXTERNO', 'chegada_xpt', false, 150),
  ('CLIMA', 'Condição climática', 'EXTERNO', 'chegada_xpt', false, 160),
  ('FISCALIZACAO', 'Fiscalização', 'EXTERNO', 'chegada_xpt', false, 170),
  ('OUTRO', 'Outro motivo', 'EM_ANALISE', NULL, true, 999)
ON CONFLICT (codigo) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RPCs atômicas: criação, registro de etapa e cancelamento
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.criar_transferencia(
  p_base_id uuid,
  p_data_operacional date,
  p_service text,
  p_motorista text,
  p_placa text,
  p_tipo_veiculo text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_codigo text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.transferencia_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF p_data_operacional IS NULL OR p_service IS NULL OR length(btrim(p_service)) < 2
     OR p_motorista IS NULL OR length(btrim(p_motorista)) < 2
     OR p_placa IS NULL OR length(btrim(p_placa)) < 5 THEN
    RAISE EXCEPTION 'dados_obrigatorios_invalidos' USING ERRCODE = '22023';
  END IF;

  v_codigo := 'TRF-' || to_char(p_data_operacional, 'YYYYMMDD') || '-' || upper(substr(replace(v_id::text, '-', ''), 1, 8));

  INSERT INTO public.transferencias (
    id, codigo, base_id, data_operacional, service, motorista, placa,
    tipo_veiculo, observacao, criado_por
  ) VALUES (
    v_id, v_codigo, p_base_id, p_data_operacional, btrim(p_service), btrim(p_motorista),
    upper(btrim(p_placa)), nullif(btrim(p_tipo_veiculo), ''), nullif(btrim(p_observacao), ''), v_uid
  );

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.criar', 'transferencia', v_id::text,
    jsonb_build_object('base_id', p_base_id, 'codigo', v_codigo));

  RETURN jsonb_build_object('id', v_id, 'codigo', v_codigo, 'status', 'aguardando_chegada_service');
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_evento_transferencia(
  p_transferencia_id uuid,
  p_etapa text,
  p_ocorrido_em timestamptz,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL,
  p_motivo_codigo text DEFAULT NULL,
  p_responsabilidade text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento_id uuid;
  v_motivo public.transferencia_motivos%ROWTYPE;
  v_chegada_limite time := '07:00';
  v_saida_limite time := '09:00';
  v_transito_max integer := 60;
  v_referencia timestamptz;
  v_chegada_service timestamptz;
  v_saida_service timestamptz;
  v_atraso integer := 0;
  v_evidencia_completa boolean;
  v_status text;
  v_tem_atraso boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF p_ocorrido_em IS NULL THEN RAISE EXCEPTION 'horario_obrigatorio' USING ERRCODE = '22023'; END IF;
  IF p_ocorrido_em > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'horario_futuro_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = p_etapa) THEN
    RAISE EXCEPTION 'etapa_ja_registrada' USING ERRCODE = '23505';
  END IF;
  IF p_etapa = 'saida_service' AND NOT EXISTS (
    SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = 'chegada_service'
  ) THEN RAISE EXCEPTION 'registre_chegada_service_primeiro' USING ERRCODE = '22023'; END IF;
  IF p_etapa = 'saida_service' THEN
    SELECT ocorrido_em INTO v_chegada_service FROM public.transferencia_eventos
      WHERE transferencia_id = v_t.id AND etapa = 'chegada_service';
    IF p_ocorrido_em < v_chegada_service THEN
      RAISE EXCEPTION 'saida_anterior_a_chegada_service' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_etapa = 'chegada_xpt' THEN
    SELECT ocorrido_em INTO v_saida_service FROM public.transferencia_eventos
      WHERE transferencia_id = v_t.id AND etapa = 'saida_service';
    IF v_saida_service IS NULL THEN
      RAISE EXCEPTION 'registre_saida_service_primeiro' USING ERRCODE = '22023';
    END IF;
    IF p_ocorrido_em < v_saida_service THEN
      RAISE EXCEPTION 'chegada_xpt_anterior_a_saida_service' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT chegada_service_limite, saida_service_limite, transito_max_minutos
    INTO v_chegada_limite, v_saida_limite, v_transito_max
  FROM public.transferencia_slas
  WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo
  LIMIT 1;

  -- SELECT INTO zera as variáveis quando não encontra configuração. Nesse caso,
  -- preserva os SLAs corporativos iniciais do módulo.
  v_chegada_limite := coalesce(v_chegada_limite, '07:00'::time);
  v_saida_limite := coalesce(v_saida_limite, '09:00'::time);
  v_transito_max := coalesce(v_transito_max, 60);

  IF p_etapa = 'chegada_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_chegada_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'saida_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_saida_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSE
    v_referencia := v_saida_service + make_interval(mins => v_transito_max);
  END IF;

  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);
  v_evidencia_completa := nullif(btrim(p_storage_path), '') IS NOT NULL
    AND nullif(btrim(p_timemark_url), '') IS NOT NULL;

  IF v_atraso > 0 THEN
    IF p_responsabilidade NOT IN ('JM_FROTA', 'MELI', 'EXTERNO', 'EM_ANALISE') THEN
      RAISE EXCEPTION 'responsabilidade_obrigatoria' USING ERRCODE = '22023';
    END IF;
    IF nullif(btrim(p_motivo_codigo), '') IS NULL THEN
      RAISE EXCEPTION 'motivo_obrigatorio' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_motivo FROM public.transferencia_motivos
      WHERE codigo = p_motivo_codigo AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'motivo_invalido' USING ERRCODE = '22023'; END IF;
    IF v_motivo.etapa IS NOT NULL AND v_motivo.etapa <> p_etapa THEN
      RAISE EXCEPTION 'motivo_incompativel_com_etapa' USING ERRCODE = '22023';
    END IF;
    IF v_motivo.responsabilidade <> p_responsabilidade AND p_responsabilidade <> 'EM_ANALISE' THEN
      RAISE EXCEPTION 'motivo_responsabilidade_incompativeis' USING ERRCODE = '22023';
    END IF;
    IF v_motivo.exige_descricao AND length(btrim(coalesce(p_observacao, ''))) < 5 THEN
      RAISE EXCEPTION 'descricao_obrigatoria' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.transferencia_eventos (
    transferencia_id, etapa, ocorrido_em, localizacao_texto, minutos_atraso, registrado_por
  ) VALUES (
    v_t.id, p_etapa, p_ocorrido_em, nullif(btrim(p_localizacao_texto), ''), v_atraso, v_uid
  ) RETURNING id INTO v_evento_id;

  IF nullif(btrim(p_storage_path), '') IS NOT NULL OR nullif(btrim(p_timemark_url), '') IS NOT NULL THEN
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''),
      CASE WHEN v_evidencia_completa THEN 'enviada' ELSE 'pendente' END, v_uid
    );
  END IF;

  IF v_atraso > 0 THEN
    INSERT INTO public.transferencia_ocorrencias (
      transferencia_id, evento_id, etapa, motivo_id, responsabilidade,
      minutos_atraso, observacao, registrado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, v_motivo.id, p_responsabilidade,
      v_atraso, nullif(btrim(p_observacao), ''), v_uid
    );
  END IF;

  IF NOT v_evidencia_completa THEN
    v_status := 'pendente_evidencia';
  ELSIF p_etapa = 'chegada_service' THEN
    v_status := 'no_service';
  ELSIF p_etapa = 'saida_service' THEN
    v_status := 'em_transito_xpt';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.transferencia_eventos e
      WHERE e.transferencia_id = v_t.id AND e.minutos_atraso > 0
    ) INTO v_tem_atraso;
    v_status := CASE WHEN v_tem_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
  END IF;

  UPDATE public.transferencias
  SET status = v_status,
      finalizada_em = CASE WHEN p_etapa = 'chegada_xpt' THEN p_ocorrido_em ELSE finalizada_em END
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evento.' || p_etapa, 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento_id, 'minutos_atraso', v_atraso,
      'responsabilidade', CASE WHEN v_atraso > 0 THEN p_responsabilidade ELSE 'SEM_ATRASO' END,
      'evidencia_completa', v_evidencia_completa));

  RETURN jsonb_build_object(
    'id', v_t.id, 'evento_id', v_evento_id, 'etapa', p_etapa,
    'minutos_atraso', v_atraso, 'status', v_status,
    'evidencia_completa', v_evidencia_completa
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.anexar_evidencia_transferencia(
  p_transferencia_id uuid,
  p_etapa text,
  p_storage_path text,
  p_timemark_url text,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento public.transferencia_eventos%ROWTYPE;
  v_evidencia public.transferencia_evidencias%ROWTYPE;
  v_completa boolean;
  v_status text;
  v_ultima_etapa text;
  v_tem_atraso boolean;
  v_tem_pendente boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NULL AND nullif(btrim(p_timemark_url), '') IS NULL THEN
    RAISE EXCEPTION 'evidencia_vazia' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_evento FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id AND etapa = p_etapa;
  IF NOT FOUND THEN RAISE EXCEPTION 'evento_nao_encontrado' USING ERRCODE = 'P0002'; END IF;

  SELECT * INTO v_evidencia FROM public.transferencia_evidencias
  WHERE evento_id = v_evento.id AND substituida_por IS NULL
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF FOUND THEN
    UPDATE public.transferencia_evidencias SET
      storage_path = coalesce(nullif(btrim(p_storage_path), ''), storage_path),
      timemark_url = coalesce(nullif(btrim(p_timemark_url), ''), timemark_url),
      horario_evidencia = coalesce(p_horario_evidencia, horario_evidencia),
      localizacao_texto = coalesce(nullif(btrim(p_localizacao_texto), ''), localizacao_texto),
      status = CASE
        WHEN coalesce(nullif(btrim(p_storage_path), ''), storage_path) IS NOT NULL
         AND coalesce(nullif(btrim(p_timemark_url), ''), timemark_url) IS NOT NULL
        THEN 'enviada' ELSE 'pendente' END
    WHERE id = v_evidencia.id
    RETURNING * INTO v_evidencia;
  ELSE
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento.id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''),
      CASE WHEN nullif(btrim(p_storage_path), '') IS NOT NULL
             AND nullif(btrim(p_timemark_url), '') IS NOT NULL
           THEN 'enviada' ELSE 'pendente' END,
      v_uid
    ) RETURNING * INTO v_evidencia;
  END IF;

  v_completa := v_evidencia.storage_path IS NOT NULL AND v_evidencia.timemark_url IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM public.transferencia_eventos e
    WHERE e.transferencia_id = v_t.id
      AND NOT EXISTS (
        SELECT 1 FROM public.transferencia_evidencias ev
        WHERE ev.evento_id = e.id AND ev.storage_path IS NOT NULL
          AND ev.timemark_url IS NOT NULL AND ev.substituida_por IS NULL
      )
  ) INTO v_tem_pendente;

  SELECT etapa INTO v_ultima_etapa FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
  ORDER BY CASE etapa
    WHEN 'chegada_service' THEN 1 WHEN 'saida_service' THEN 2 ELSE 3 END DESC
  LIMIT 1;

  IF v_tem_pendente THEN
    v_status := 'pendente_evidencia';
  ELSIF v_ultima_etapa = 'chegada_service' THEN
    v_status := 'no_service';
  ELSIF v_ultima_etapa = 'saida_service' THEN
    v_status := 'em_transito_xpt';
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.transferencia_eventos e
      WHERE e.transferencia_id = v_t.id AND e.minutos_atraso > 0
    ) INTO v_tem_atraso;
    v_status := CASE WHEN v_tem_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
  END IF;

  UPDATE public.transferencias SET status = v_status WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evidencia.anexar', 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento.id, 'etapa', p_etapa,
      'evidencia_id', v_evidencia.id, 'evidencia_completa', v_completa));

  RETURN jsonb_build_object('id', v_t.id, 'evidencia_id', v_evidencia.id,
    'status', v_status, 'evidencia_completa', v_completa);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancelar_transferencia(
  p_transferencia_id uuid,
  p_justificativa text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF length(btrim(coalesce(p_justificativa, ''))) < 10 THEN
    RAISE EXCEPTION 'justificativa_minimo_10_caracteres' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_ja_cancelada' USING ERRCODE = '55000'; END IF;

  UPDATE public.transferencias SET
    status = 'cancelada', cancelada_em = now(), cancelada_por = v_uid,
    cancelamento_motivo = btrim(p_justificativa)
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.cancelar', 'transferencia', v_t.id::text,
    jsonb_build_object('justificativa', btrim(p_justificativa)));

  RETURN jsonb_build_object('id', v_t.id, 'status', 'cancelada');
END;
$$;

CREATE OR REPLACE FUNCTION public.salvar_sla_transferencia(
  p_base_id uuid,
  p_service text,
  p_chegada_service_limite time,
  p_saida_service_limite time,
  p_transito_max_minutos integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.has_role(v_uid, 'admin') OR NOT public.transferencia_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'somente_admin' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(p_service, ''))) < 2
     OR p_chegada_service_limite IS NULL OR p_saida_service_limite IS NULL
     OR p_transito_max_minutos IS NULL OR p_transito_max_minutos NOT BETWEEN 1 AND 1440 THEN
    RAISE EXCEPTION 'sla_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.transferencia_slas
  WHERE base_id = p_base_id AND lower(service) = lower(btrim(p_service)) AND ativo
  FOR UPDATE;

  IF v_id IS NULL THEN
    INSERT INTO public.transferencia_slas (
      base_id, service, chegada_service_limite, saida_service_limite, transito_max_minutos
    ) VALUES (
      p_base_id, btrim(p_service), p_chegada_service_limite,
      p_saida_service_limite, p_transito_max_minutos
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE public.transferencia_slas SET
      service = btrim(p_service),
      chegada_service_limite = p_chegada_service_limite,
      saida_service_limite = p_saida_service_limite,
      transito_max_minutos = p_transito_max_minutos
    WHERE id = v_id;
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.sla.salvar', 'transferencia_sla', v_id::text,
    jsonb_build_object('base_id', p_base_id, 'service', btrim(p_service),
      'chegada_service_limite', p_chegada_service_limite,
      'saida_service_limite', p_saida_service_limite,
      'transito_max_minutos', p_transito_max_minutos));

  RETURN jsonb_build_object('id', v_id, 'base_id', p_base_id, 'service', btrim(p_service));
END;
$$;

REVOKE ALL ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancelar_transferencia(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_transferencia(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Bucket privado. Caminho: <base_id>/<transferencia_id>/<arquivo>
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'transferencias-evidencias', 'transferencias-evidencias', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY "transferencias evidencia upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'transferencias-evidencias'
    AND public.transferencia_access(auth.uid(), ((storage.foldername(name))[2])::uuid)
  );

CREATE POLICY "transferencias evidencia read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transferencias-evidencias'
    AND public.transferencia_access(auth.uid(), ((storage.foldername(name))[2])::uuid)
  );

COMMIT;

-- Rollback operacional (usar apenas antes de existir dado real):
-- DROP POLICY ...; DROP FUNCTION ...; DROP TABLE ... em ordem inversa.
-- O bucket deve ser removido somente depois de confirmar que está vazio.
-- ==== fim 20260714143500_transferencias_module.sql ====

-- ==== inicio 20260716130000_transferencias_lote_sla.sql ====
-- JMRoutes — ajuste operacional do módulo Transferências
-- Migration aditiva: lote, SLA de trajeto de 80 minutos e responsabilidade automática MELI na saída tardia.

BEGIN;

-- O trajeto Service -> XPT passa a aceitar até 1h20 sem atraso.
ALTER TABLE public.transferencia_slas
  ALTER COLUMN transito_max_minutos SET DEFAULT 80;

-- Atualiza somente configurações que ainda estão no padrão antigo de 60 minutos.
UPDATE public.transferencia_slas
SET transito_max_minutos = 80
WHERE transito_max_minutos = 60;

-- Garante que atrasos na etapa de saída do Service sejam atribuídos ao MELI,
-- independentemente do valor enviado pela interface.
CREATE OR REPLACE FUNCTION public.tg_transferencia_saida_service_meli()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_motivo_id uuid;
BEGIN
  IF NEW.etapa = 'saida_service' AND NEW.minutos_atraso > 0 THEN
    SELECT id INTO v_motivo_id
    FROM public.transferencia_motivos
    WHERE codigo = 'ATRASO_CARREGAMENTO'
      AND ativo = true
    LIMIT 1;

    NEW.responsabilidade := 'MELI';
    NEW.motivo_id := coalesce(v_motivo_id, NEW.motivo_id);
    NEW.observacao := coalesce(
      nullif(btrim(NEW.observacao), ''),
      'Saída do Service após o horário limite; responsabilidade MELI aplicada automaticamente.'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transferencia_saida_service_meli
  ON public.transferencia_ocorrencias;

CREATE TRIGGER trg_transferencia_saida_service_meli
BEFORE INSERT OR UPDATE ON public.transferencia_ocorrencias
FOR EACH ROW
EXECUTE FUNCTION public.tg_transferencia_saida_service_meli();

INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
SELECT
  auth.uid(),
  'transferencia.regra_operacional.atualizar',
  'transferencia_configuracao',
  'sla_trajeto_80_meli_saida',
  jsonb_build_object(
    'transito_max_minutos', 80,
    'saida_service_responsabilidade', 'MELI',
    'motivo', 'ATRASO_CARREGAMENTO'
  )
WHERE auth.uid() IS NOT NULL;

COMMIT;
-- ==== fim 20260716130000_transferencias_lote_sla.sql ====

-- ==== inicio 20260716133000_inventario_central.sql ====
-- JMRoutes — Inventário centralizado
-- Migration aditiva. Não remove dados locais existentes e não executa backfill automático.

BEGIN;

CREATE TABLE IF NOT EXISTS public.inventarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  dia_operacional date NOT NULL,
  responsavel text,
  observacao text,
  status text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'finalizado', 'cancelado')),
  criado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  finalizado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  finalizado_em timestamptz,
  cancelado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_id, dia_operacional)
);

CREATE TABLE IF NOT EXISTS public.inventario_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inventario_id uuid NOT NULL REFERENCES public.inventarios(id) ON DELETE RESTRICT,
  base_id uuid NOT NULL REFERENCES public.bases(id) ON DELETE RESTRICT,
  dia_operacional date NOT NULL,
  codigo text NOT NULL,
  bipado_por uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  bipado_em timestamptz NOT NULL DEFAULT now(),
  cancelado boolean NOT NULL DEFAULT false,
  cancelado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelado_em timestamptz,
  cancelamento_motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (length(btrim(codigo)) BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventario_leitura_ativa
  ON public.inventario_leituras (inventario_id, codigo)
  WHERE cancelado = false;

CREATE INDEX IF NOT EXISTS idx_inventarios_base_dia
  ON public.inventarios (base_id, dia_operacional DESC);

CREATE INDEX IF NOT EXISTS idx_inventario_leituras_base_dia
  ON public.inventario_leituras (base_id, dia_operacional DESC, bipado_em DESC);

CREATE INDEX IF NOT EXISTS idx_inventario_leituras_codigo
  ON public.inventario_leituras (codigo, bipado_em DESC);

DROP TRIGGER IF EXISTS trg_inventarios_updated ON public.inventarios;
CREATE TRIGGER trg_inventarios_updated
  BEFORE UPDATE ON public.inventarios
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE OR REPLACE FUNCTION public.inventario_base_access(_user_id uuid, _base_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND p.ativo = true
      AND (
        public.has_role(_user_id, 'admin')
        OR p.base_id = _base_id
        OR EXISTS (
          SELECT 1 FROM public.user_bases ub
          WHERE ub.user_id = _user_id AND ub.base_id = _base_id
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.inventario_global_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.ativo = true
      AND public.has_role(_user_id, 'admin')
  );
$$;

ALTER TABLE public.inventarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_leituras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventarios select autorizados" ON public.inventarios
  FOR SELECT TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventarios insert autorizados" ON public.inventarios
  FOR INSERT TO authenticated
  WITH CHECK (
    criado_por = auth.uid()
    AND public.inventario_base_access(auth.uid(), base_id)
  );

CREATE POLICY "inventarios update autorizados" ON public.inventarios
  FOR UPDATE TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id))
  WITH CHECK (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventario leituras select autorizadas" ON public.inventario_leituras
  FOR SELECT TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id));

CREATE POLICY "inventario leituras insert autorizadas" ON public.inventario_leituras
  FOR INSERT TO authenticated
  WITH CHECK (
    bipado_por = auth.uid()
    AND public.inventario_base_access(auth.uid(), base_id)
  );

CREATE POLICY "inventario leituras update autorizadas" ON public.inventario_leituras
  FOR UPDATE TO authenticated
  USING (public.inventario_base_access(auth.uid(), base_id))
  WITH CHECK (public.inventario_base_access(auth.uid(), base_id));

GRANT SELECT, INSERT, UPDATE ON public.inventarios TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.inventario_leituras TO authenticated;
GRANT ALL ON public.inventarios, public.inventario_leituras TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_leitura_inventario(
  p_base_id uuid,
  p_dia_operacional date,
  p_codigo text,
  p_responsavel text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inventario_id uuid;
  v_leitura_id uuid;
  v_existente public.inventario_leituras%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;
  IF NOT public.inventario_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF p_dia_operacional IS NULL OR length(btrim(coalesce(p_codigo, ''))) < 1 THEN
    RAISE EXCEPTION 'dados_invalidos' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.inventarios (
    base_id, dia_operacional, responsavel, observacao, criado_por
  ) VALUES (
    p_base_id, p_dia_operacional, nullif(btrim(p_responsavel), ''),
    nullif(btrim(p_observacao), ''), v_uid
  )
  ON CONFLICT (base_id, dia_operacional)
  DO UPDATE SET
    responsavel = coalesce(nullif(btrim(EXCLUDED.responsavel), ''), public.inventarios.responsavel),
    observacao = coalesce(nullif(btrim(EXCLUDED.observacao), ''), public.inventarios.observacao)
  RETURNING id INTO v_inventario_id;

  SELECT * INTO v_existente
  FROM public.inventario_leituras
  WHERE inventario_id = v_inventario_id
    AND codigo = btrim(p_codigo)
    AND cancelado = false
  ORDER BY bipado_em DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'resultado', 'duplicado',
      'mensagem', 'Código já bipado neste inventário.',
      'leitura_id', v_existente.id,
      'bipado_em', v_existente.bipado_em
    );
  END IF;

  INSERT INTO public.inventario_leituras (
    inventario_id, base_id, dia_operacional, codigo, bipado_por
  ) VALUES (
    v_inventario_id, p_base_id, p_dia_operacional, btrim(p_codigo), v_uid
  ) RETURNING id INTO v_leitura_id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v_uid,
    'inventario.leitura.registrar',
    'inventario_leitura',
    v_leitura_id::text,
    jsonb_build_object('base_id', p_base_id, 'dia_operacional', p_dia_operacional, 'codigo', btrim(p_codigo))
  );

  RETURN jsonb_build_object(
    'resultado', 'ok',
    'mensagem', 'Código registrado no inventário.',
    'inventario_id', v_inventario_id,
    'leitura_id', v_leitura_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finalizar_inventario(
  p_inventario_id uuid,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inv public.inventarios%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_inv FROM public.inventarios WHERE id = p_inventario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventario_nao_encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.inventario_base_access(v_uid, v_inv.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;

  UPDATE public.inventarios
  SET status = 'finalizado',
      finalizado_por = v_uid,
      finalizado_em = now(),
      observacao = coalesce(nullif(btrim(p_observacao), ''), observacao)
  WHERE id = p_inventario_id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'inventario.finalizar', 'inventario', p_inventario_id::text, '{}'::jsonb);

  RETURN jsonb_build_object('id', p_inventario_id, 'status', 'finalizado');
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalizar_inventario(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalizar_inventario(uuid, text) TO authenticated;

COMMIT;
-- ==== fim 20260716133000_inventario_central.sql ====

-- ==== inicio 20260717110000_transferencias_saida_xpt.sql ====
-- JMRoutes — quarto marco da transferência e evidência opcional
-- Fluxo: chegada Service -> saída Service -> chegada XPT -> saída XPT.

BEGIN;

ALTER TABLE public.transferencia_motivos
  DROP CONSTRAINT IF EXISTS transferencia_motivos_etapa_check;
ALTER TABLE public.transferencia_motivos
  ADD CONSTRAINT transferencia_motivos_etapa_check
  CHECK (etapa IS NULL OR etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_eventos
  DROP CONSTRAINT IF EXISTS transferencia_eventos_etapa_check;
ALTER TABLE public.transferencia_eventos
  ADD CONSTRAINT transferencia_eventos_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_ocorrencias
  DROP CONSTRAINT IF EXISTS transferencia_ocorrencias_etapa_check;
ALTER TABLE public.transferencia_ocorrencias
  ADD CONSTRAINT transferencia_ocorrencias_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencia_evidencias
  DROP CONSTRAINT IF EXISTS transferencia_evidencias_etapa_check;
ALTER TABLE public.transferencia_evidencias
  ADD CONSTRAINT transferencia_evidencias_etapa_check
  CHECK (etapa IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt'));

ALTER TABLE public.transferencias
  DROP CONSTRAINT IF EXISTS transferencias_status_check;
ALTER TABLE public.transferencias
  ADD CONSTRAINT transferencias_status_check CHECK (status IN (
    'aguardando_chegada_service', 'no_service', 'em_transito_xpt', 'no_xpt',
    'concluida_no_prazo', 'concluida_com_atraso', 'pendente_evidencia',
    'em_analise', 'cancelada'
  ));

CREATE OR REPLACE FUNCTION public.transferencia_status_atual(p_transferencia_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_etapa text;
  v_atraso boolean;
BEGIN
  SELECT etapa INTO v_etapa
  FROM public.transferencia_eventos
  WHERE transferencia_id = p_transferencia_id
  ORDER BY CASE etapa
    WHEN 'chegada_service' THEN 1
    WHEN 'saida_service' THEN 2
    WHEN 'chegada_xpt' THEN 3
    WHEN 'saida_xpt' THEN 4
    ELSE 0 END DESC
  LIMIT 1;

  IF v_etapa IS NULL THEN RETURN 'aguardando_chegada_service'; END IF;
  IF v_etapa = 'chegada_service' THEN RETURN 'no_service'; END IF;
  IF v_etapa = 'saida_service' THEN RETURN 'em_transito_xpt'; END IF;
  IF v_etapa = 'chegada_xpt' THEN RETURN 'no_xpt'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.transferencia_eventos
    WHERE transferencia_id = p_transferencia_id AND minutos_atraso > 0
  ) INTO v_atraso;
  RETURN CASE WHEN v_atraso THEN 'concluida_com_atraso' ELSE 'concluida_no_prazo' END;
END;
$$;

REVOKE ALL ON FUNCTION public.transferencia_status_atual(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferencia_status_atual(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.registrar_evento_transferencia_v2(
  p_transferencia_id uuid,
  p_etapa text,
  p_ocorrido_em timestamptz,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL,
  p_motivo_codigo text DEFAULT NULL,
  p_responsabilidade text DEFAULT NULL,
  p_observacao text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento_id uuid;
  v_motivo public.transferencia_motivos%ROWTYPE;
  v_anterior timestamptz;
  v_chegada_limite time := '07:00';
  v_saida_limite time := '09:00';
  v_transito_max integer := 80;
  v_referencia timestamptz;
  v_atraso integer := 0;
  v_status text;
  v_responsabilidade text;
  v_evidencia boolean;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF p_ocorrido_em IS NULL OR p_ocorrido_em > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'horario_invalido' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002'; END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF v_t.status = 'cancelada' THEN RAISE EXCEPTION 'transferencia_cancelada' USING ERRCODE = '55000'; END IF;
  IF EXISTS (SELECT 1 FROM public.transferencia_eventos WHERE transferencia_id = v_t.id AND etapa = p_etapa) THEN
    RAISE EXCEPTION 'etapa_ja_registrada' USING ERRCODE = '23505';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;

  IF p_etapa <> 'chegada_service' THEN
    SELECT ocorrido_em INTO v_anterior
    FROM public.transferencia_eventos
    WHERE transferencia_id = v_t.id
      AND etapa = CASE p_etapa
        WHEN 'saida_service' THEN 'chegada_service'
        WHEN 'chegada_xpt' THEN 'saida_service'
        WHEN 'saida_xpt' THEN 'chegada_xpt' END;
    IF v_anterior IS NULL THEN RAISE EXCEPTION 'registre_etapa_anterior_primeiro' USING ERRCODE = '22023'; END IF;
    IF p_ocorrido_em < v_anterior THEN RAISE EXCEPTION 'horario_anterior_a_etapa_precedente' USING ERRCODE = '22023'; END IF;
  END IF;

  SELECT chegada_service_limite, saida_service_limite, transito_max_minutos
  INTO v_chegada_limite, v_saida_limite, v_transito_max
  FROM public.transferencia_slas
  WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo
  LIMIT 1;
  v_chegada_limite := coalesce(v_chegada_limite, '07:00'::time);
  v_saida_limite := coalesce(v_saida_limite, '09:00'::time);
  v_transito_max := coalesce(v_transito_max, 80);

  IF p_etapa = 'chegada_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_chegada_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'saida_service' THEN
    v_referencia := (v_t.data_operacional::text || ' ' || v_saida_limite::text)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'chegada_xpt' THEN
    v_referencia := v_anterior + make_interval(mins => v_transito_max);
  ELSE
    v_referencia := p_ocorrido_em;
  END IF;
  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);

  IF v_atraso > 0 THEN
    SELECT * INTO v_motivo FROM public.transferencia_motivos
    WHERE codigo = coalesce(nullif(btrim(p_motivo_codigo), ''), 'OUTRO') AND ativo;
    IF NOT FOUND THEN RAISE EXCEPTION 'motivo_invalido' USING ERRCODE = '22023'; END IF;
    v_responsabilidade := coalesce(nullif(btrim(p_responsabilidade), ''), v_motivo.responsabilidade, 'EM_ANALISE');
  END IF;

  INSERT INTO public.transferencia_eventos (
    transferencia_id, etapa, ocorrido_em, localizacao_texto, minutos_atraso, registrado_por
  ) VALUES (
    v_t.id, p_etapa, p_ocorrido_em, nullif(btrim(p_localizacao_texto), ''), v_atraso, v_uid
  ) RETURNING id INTO v_evento_id;

  v_evidencia := nullif(btrim(p_storage_path), '') IS NOT NULL OR nullif(btrim(p_timemark_url), '') IS NOT NULL;
  IF v_evidencia THEN
    INSERT INTO public.transferencia_evidencias (
      transferencia_id, evento_id, etapa, storage_path, timemark_url,
      horario_evidencia, localizacao_texto, status, enviado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, nullif(btrim(p_storage_path), ''),
      nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
      nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
    );
  END IF;

  IF v_atraso > 0 THEN
    INSERT INTO public.transferencia_ocorrencias (
      transferencia_id, evento_id, etapa, motivo_id, responsabilidade,
      minutos_atraso, observacao, registrado_por
    ) VALUES (
      v_t.id, v_evento_id, p_etapa, v_motivo.id, v_responsabilidade,
      v_atraso, coalesce(nullif(btrim(p_observacao), ''), 'Pendente de classificação operacional.'), v_uid
    );
  END IF;

  v_status := public.transferencia_status_atual(v_t.id);
  UPDATE public.transferencias SET
    status = v_status,
    finalizada_em = CASE WHEN p_etapa = 'saida_xpt' THEN p_ocorrido_em ELSE finalizada_em END
  WHERE id = v_t.id;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evento.' || p_etapa, 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento_id, 'minutos_atraso', v_atraso,
      'responsabilidade', coalesce(v_responsabilidade, 'SEM_ATRASO'), 'evidencia_anexada', v_evidencia));

  RETURN jsonb_build_object('id', v_t.id, 'evento_id', v_evento_id, 'etapa', p_etapa,
    'minutos_atraso', v_atraso, 'status', v_status, 'evidencia_anexada', v_evidencia);
END;
$$;

CREATE OR REPLACE FUNCTION public.anexar_evidencia_transferencia_v2(
  p_transferencia_id uuid,
  p_etapa text,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_localizacao_texto text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento public.transferencia_eventos%ROWTYPE;
  v_evidencia_id uuid;
  v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000'; END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NULL AND nullif(btrim(p_timemark_url), '') IS NULL THEN
    RAISE EXCEPTION 'evidencia_vazia' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_t FROM public.transferencias WHERE id = p_transferencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'transferencia_nao_autorizada' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_storage_path), '') IS NOT NULL
     AND p_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
    RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_timemark_url), '') IS NOT NULL
     AND p_timemark_url !~* '^https://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'link_timemark_invalido' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_evento FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id AND etapa = p_etapa;
  IF NOT FOUND THEN RAISE EXCEPTION 'evento_nao_encontrado' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO public.transferencia_evidencias (
    transferencia_id, evento_id, etapa, storage_path, timemark_url,
    horario_evidencia, localizacao_texto, status, enviado_por
  ) VALUES (
    v_t.id, v_evento.id, p_etapa, nullif(btrim(p_storage_path), ''),
    nullif(btrim(p_timemark_url), ''), p_horario_evidencia,
    nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
  ) RETURNING id INTO v_evidencia_id;

  v_status := public.transferencia_status_atual(v_t.id);
  UPDATE public.transferencias SET status = v_status WHERE id = v_t.id;
  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (v_uid, 'transferencia.evidencia.anexar', 'transferencia', v_t.id::text,
    jsonb_build_object('evento_id', v_evento.id, 'etapa', p_etapa, 'evidencia_id', v_evidencia_id));
  RETURN jsonb_build_object('id', v_t.id, 'evidencia_id', v_evidencia_id, 'status', v_status);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_evento_transferencia_v2(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.anexar_evidencia_transferencia_v2(uuid, text, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_evento_transferencia_v2(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anexar_evidencia_transferencia_v2(uuid, text, text, text, timestamptz, text) TO authenticated;

UPDATE public.transferencias t
SET status = public.transferencia_status_atual(t.id),
    finalizada_em = CASE
      WHEN EXISTS (SELECT 1 FROM public.transferencia_eventos e WHERE e.transferencia_id = t.id AND e.etapa = 'saida_xpt')
      THEN (SELECT e.ocorrido_em FROM public.transferencia_eventos e WHERE e.transferencia_id = t.id AND e.etapa = 'saida_xpt')
      ELSE NULL END
WHERE t.status <> 'cancelada';

COMMIT;
-- ==== fim 20260717110000_transferencias_saida_xpt.sql ====

-- ==== inicio 20260717143000_corrigir_etapa_transferencia.sql ====
-- Corrige uma etapa com a sessão autenticada, sem chave secreta no Vercel.
-- A função valida acesso à base, ordem cronológica, evidência e registra auditoria.
CREATE OR REPLACE FUNCTION public.corrigir_etapa_transferencia(
  p_transferencia_id uuid,
  p_etapa text,
  p_ocorrido_em timestamptz,
  p_localizacao_texto text DEFAULT NULL,
  p_storage_path text DEFAULT NULL,
  p_timemark_url text DEFAULT NULL,
  p_horario_evidencia timestamptz DEFAULT NULL,
  p_editar_evidencia boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_t public.transferencias%ROWTYPE;
  v_evento public.transferencia_eventos%ROWTYPE;
  v_anterior timestamptz;
  v_seguinte timestamptz;
  v_evidencia public.transferencia_evidencias%ROWTYPE;
  v_nova_evidencia_id uuid;
  v_storage_path text;
  v_timemark_url text;
  v_limite time;
  v_transito_max integer := 80;
  v_referencia timestamptz;
  v_atraso integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '28000';
  END IF;
  IF p_etapa NOT IN ('chegada_service', 'saida_service', 'chegada_xpt', 'saida_xpt') THEN
    RAISE EXCEPTION 'etapa_invalida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_t
  FROM public.transferencias
  WHERE id = p_transferencia_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'transferencia_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.transferencia_base_access(v_uid, v_t.base_id) THEN
    RAISE EXCEPTION 'base_nao_autorizada' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_evento
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id AND etapa = p_etapa
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'etapa_nao_encontrada' USING ERRCODE = 'P0002';
  END IF;

  SELECT ocorrido_em INTO v_anterior
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
    AND etapa = CASE p_etapa
      WHEN 'saida_service' THEN 'chegada_service'
      WHEN 'chegada_xpt' THEN 'saida_service'
      WHEN 'saida_xpt' THEN 'chegada_xpt'
      ELSE '__sem_anterior__'
    END;
  SELECT ocorrido_em INTO v_seguinte
  FROM public.transferencia_eventos
  WHERE transferencia_id = v_t.id
    AND etapa = CASE p_etapa
      WHEN 'chegada_service' THEN 'saida_service'
      WHEN 'saida_service' THEN 'chegada_xpt'
      WHEN 'chegada_xpt' THEN 'saida_xpt'
      ELSE '__sem_seguinte__'
    END;

  IF v_anterior IS NOT NULL AND p_ocorrido_em < v_anterior THEN
    RAISE EXCEPTION 'horario_anterior_etapa_precedente' USING ERRCODE = '22023';
  END IF;
  IF v_seguinte IS NOT NULL AND p_ocorrido_em > v_seguinte THEN
    RAISE EXCEPTION 'horario_posterior_etapa_seguinte' USING ERRCODE = '22023';
  END IF;

  IF p_etapa IN ('chegada_service', 'saida_service') THEN
    SELECT
      CASE p_etapa
        WHEN 'chegada_service' THEN chegada_service_limite
        ELSE saida_service_limite
      END
    INTO v_limite
    FROM public.transferencia_slas
    WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo = true
    LIMIT 1;
    v_limite := coalesce(v_limite, CASE WHEN p_etapa = 'chegada_service' THEN '07:00'::time ELSE '09:00'::time END);
    v_referencia := (v_t.data_operacional + v_limite) AT TIME ZONE 'America/Sao_Paulo';
  ELSIF p_etapa = 'chegada_xpt' AND v_anterior IS NOT NULL THEN
    SELECT transito_max_minutos INTO v_transito_max
    FROM public.transferencia_slas
    WHERE base_id = v_t.base_id AND lower(service) = lower(v_t.service) AND ativo = true
    LIMIT 1;
    v_referencia := v_anterior + make_interval(mins => coalesce(v_transito_max, 80));
  ELSE
    v_referencia := p_ocorrido_em;
  END IF;
  v_atraso := greatest(0, ceil(extract(epoch FROM (p_ocorrido_em - v_referencia)) / 60.0)::integer);

  UPDATE public.transferencia_eventos
  SET ocorrido_em = p_ocorrido_em,
      localizacao_texto = nullif(btrim(p_localizacao_texto), ''),
      minutos_atraso = v_atraso
  WHERE id = v_evento.id;

  UPDATE public.transferencia_ocorrencias
  SET minutos_atraso = v_atraso
  WHERE evento_id = v_evento.id;

  IF p_editar_evidencia THEN
    SELECT * INTO v_evidencia
    FROM public.transferencia_evidencias
    WHERE transferencia_id = v_t.id AND etapa = p_etapa AND substituida_por IS NULL
    ORDER BY created_at DESC
    LIMIT 1;

    v_storage_path := coalesce(nullif(btrim(p_storage_path), ''), v_evidencia.storage_path);
    v_timemark_url := nullif(btrim(p_timemark_url), '');
    IF v_storage_path IS NOT NULL
       AND v_storage_path NOT LIKE v_t.base_id::text || '/' || v_t.id::text || '/%' THEN
      RAISE EXCEPTION 'caminho_evidencia_invalido' USING ERRCODE = '22023';
    END IF;

    IF v_storage_path IS NOT NULL OR v_timemark_url IS NOT NULL THEN
      INSERT INTO public.transferencia_evidencias (
        transferencia_id, evento_id, etapa, storage_path, timemark_url,
        horario_evidencia, localizacao_texto, status, enviado_por
      ) VALUES (
        v_t.id, v_evento.id, p_etapa, v_storage_path, v_timemark_url,
        coalesce(p_horario_evidencia, p_ocorrido_em),
        nullif(btrim(p_localizacao_texto), ''), 'enviada', v_uid
      ) RETURNING id INTO v_nova_evidencia_id;

      IF v_evidencia.id IS NOT NULL THEN
        UPDATE public.transferencia_evidencias
        SET substituida_por = v_nova_evidencia_id
        WHERE id = v_evidencia.id;
      END IF;
    END IF;
  END IF;

  IF v_t.finalizada_em IS NOT NULL
     AND (p_etapa = 'saida_xpt' OR (p_etapa = 'chegada_xpt' AND v_seguinte IS NULL)) THEN
    UPDATE public.transferencias SET finalizada_em = p_ocorrido_em WHERE id = v_t.id;
  END IF;

  INSERT INTO public.audit_logs (user_id, acao, entidade, entidade_id, detalhes)
  VALUES (
    v_uid,
    'transferencia.evento.corrigir',
    'transferencia_evento',
    v_evento.id::text,
    jsonb_build_object(
      'etapa', p_etapa,
      'horario_anterior', v_evento.ocorrido_em,
      'horario_novo', p_ocorrido_em,
      'localizacao_anterior', v_evento.localizacao_texto,
      'localizacao_nova', nullif(btrim(p_localizacao_texto), ''),
      'evidencia_corrigida', p_editar_evidencia,
      'minutos_atraso', v_atraso
    )
  );

  RETURN jsonb_build_object('id', v_evento.id, 'ocorrido_em', p_ocorrido_em, 'minutos_atraso', v_atraso);
END;
$$;

REVOKE ALL ON FUNCTION public.corrigir_etapa_transferencia(
  uuid, text, timestamptz, text, text, text, timestamptz, boolean
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_etapa_transferencia(
  uuid, text, timestamptz, text, text, text, timestamptz, boolean
) TO authenticated, service_role;
-- ==== fim 20260717143000_corrigir_etapa_transferencia.sql ====

-- ==== inicio 20260719113901_8470bda4-d20d-492b-a9fe-2015a2261168.sql ====

-- 1) Prevent self-escalation via profiles.base_id
CREATE OR REPLACE FUNCTION public.prevent_profile_self_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('request.jwt.claims', true) IS NULL
     OR (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.base_id IS DISTINCT FROM OLD.base_id
     AND NOT (public.has_role(auth.uid(), 'admin'::app_role)
              OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
    RAISE EXCEPTION 'Somente administradores ou gerentes podem alterar a base do usuário.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.email IS DISTINCT FROM OLD.email THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'gerente'::app_role)) THEN
      RAISE EXCEPTION 'Campos sensíveis não podem ser alterados por este usuário.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_self_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_self_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_self_escalation();

-- 2) Revoke EXECUTE on internal/trigger functions from anon and authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_admin_role_grant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_transferencia_saida_service_meli() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_self_escalation() FROM PUBLIC, anon, authenticated;

-- 3) Revoke anon EXECUTE on SECURITY DEFINER RPCs and helpers (keep authenticated)
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_allowed_bases(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.inventario_global_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.criar_transferencia(uuid, date, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_transferencia(uuid, text, timestamptz, text, text, timestamptz, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.anexar_evidencia_transferencia(uuid, text, text, text, timestamptz, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancelar_transferencia(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.salvar_sla_transferencia(uuid, text, time, time, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.registrar_leitura_inventario(uuid, date, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalizar_inventario(uuid, text) FROM anon;
-- ==== fim 20260719113901_8470bda4-d20d-492b-a9fe-2015a2261168.sql ====

-- ==== inicio 20260720001442_50a999c6-26fd-4239-b710-01af6309455f.sql ====
-- Rotate seed admin password to a random value so the leaked literal is no longer active.
UPDATE auth.users
   SET encrypted_password = crypt(gen_random_uuid()::text || gen_random_uuid()::text, gen_salt('bf')),
       updated_at = now()
 WHERE email = 'dallan.zanini@jmdistribuicao.com.br';

-- Restrict direct execution of internal SECURITY DEFINER access helpers.
-- These helpers remain callable from policies and trusted database code, but not via the public API.
REVOKE EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventario_global_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- ==== fim 20260720001442_50a999c6-26fd-4239-b710-01af6309455f.sql ====

-- ==== inicio 20260720102853_472bc289-0f9d-445f-a869-84acde0961ef.sql ====

-- Reset senha do admin
UPDATE auth.users
SET encrypted_password = crypt('JM@transportes', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE email = 'dallan.zanini@jmdistribuicao.com.br';

ALTER TABLE public.user_roles DISABLE TRIGGER USER;

DO $$
DECLARE
  v_user record;
  v_id uuid;
  v_base_esp16 uuid := 'a5ae8637-1e33-40e3-8fdb-d1a464628ab9';
  v_base_esp17 uuid := 'e4e9b675-6cff-4d6b-b7db-684573f58294';
  v_pwd text := crypt('JM@transportes', gen_salt('bf'));
BEGIN
  FOR v_user IN
    SELECT * FROM (VALUES
      ('lincoln.silva@jmdistribuicao.com.br','lincoln silva','supervisor'::app_role, v_base_esp16),
      ('matheus.soares@jmdistribuicao.com.br','matheus soares','supervisor'::app_role, v_base_esp16),
      ('marcos.soares@jmdistribuicao.com.br','Marcos Soares','admin'::app_role, NULL),
      ('larissa.santos@jmdistribuicao.com.br','Larissa Santos','admin'::app_role, NULL),
      ('marcos.souza@jmdistribuicao.com.br','Marcos Roberto Maciel de Souza','admin'::app_role, NULL),
      ('ciro.gomes@jmdistribuicao.com.br','Ciro Gomes','admin'::app_role, NULL),
      ('diogo.santos@jmdistribuicao.com.br','Diogo Santos','operador'::app_role, v_base_esp17),
      ('moacir.benkendorf@jmdistribuicao.com.br','Moacir Benkendorf','admin'::app_role, NULL),
      ('ana.rodrigues@jmdistribuicao.com.br','Ana Ketrellyn Rodrigues','operador'::app_role, v_base_esp16),
      ('niquelle.goncalves@jmdistribuicao.com.br','Niquelle Gonçalves','admin'::app_role, NULL),
      ('andre.machado@jmdistribuicao.com.br','Andre Machado freitas','operador'::app_role, v_base_esp16),
      ('leonardo.jacobre@jmdistribuicao.com.br','Leonardo Jacobe','operador'::app_role, v_base_esp17),
      ('viviane.pires@jmdistribuicao.com.br','Viviane Cetto Pires','admin'::app_role, NULL),
      ('sergio.nemeth@jmdistribuicao.com.br','Sergio Nemeth','admin'::app_role, NULL),
      ('rene.mendes@jmdistribuicao.com.br','Renê Mendes','admin'::app_role, NULL)
    ) AS t(email, nome, role, base_id)
  LOOP
    SELECT id INTO v_id FROM auth.users WHERE email = v_user.email;
    IF v_id IS NULL THEN
      v_id := gen_random_uuid();
      INSERT INTO auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change,
        email_change_token_new, recovery_token
      ) VALUES (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
        v_user.email, v_pwd, now(),
        jsonb_build_object('provider','email','providers',ARRAY['email']),
        jsonb_build_object('nome', v_user.nome),
        now(), now(), '', '', '', ''
      );
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (gen_random_uuid(), v_id, v_user.email,
        jsonb_build_object('sub', v_id::text, 'email', v_user.email, 'email_verified', true),
        'email', now(), now(), now());
    END IF;

    INSERT INTO public.profiles (id, nome, email, base_id, ativo)
    VALUES (v_id, v_user.nome, v_user.email, v_user.base_id, true)
    ON CONFLICT (id) DO UPDATE SET nome=EXCLUDED.nome, email=EXCLUDED.email, base_id=EXCLUDED.base_id, ativo=true;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_id, v_user.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END LOOP;
END $$;

ALTER TABLE public.user_roles ENABLE TRIGGER USER;
-- ==== fim 20260720102853_472bc289-0f9d-445f-a869-84acde0961ef.sql ====

-- ==== inicio 20260720120351_44febbb4-c0ad-483f-9068-c81022686b3a.sql ====
DO $$
DECLARE
    tbl record;
BEGIN
    FOR tbl IN
        SELECT c.relname AS table_name
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind = 'r' AND n.nspname = 'public'
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', tbl.table_name);
        EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl.table_name);
    END LOOP;
END;
$$;
-- ==== fim 20260720120351_44febbb4-c0ad-483f-9068-c81022686b3a.sql ====

-- ==== inicio 20260720120847_20ab8773-4560-4485-8f1c-47e91d3de469.sql ====
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bases TO authenticated;
GRANT ALL ON public.bases TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_bases TO authenticated;
GRANT ALL ON public.user_bases TO service_role;
-- ==== fim 20260720120847_20ab8773-4560-4485-8f1c-47e91d3de469.sql ====

-- ==== inicio 20260720134108_3c74d38c-73f4-4ae1-a125-54149bfaa98d.sql ====
-- Restaurar EXECUTE nas funções usadas em políticas RLS.
-- Elas são SECURITY DEFINER (bypass RLS interno) mas o caller ainda precisa de EXECUTE
-- para que a policy consiga invocá-las durante SELECT/INSERT/UPDATE em transferencias/inventarios.
GRANT EXECUTE ON FUNCTION public.transferencia_base_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferencia_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventario_base_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.inventario_global_access(uuid) TO authenticated;
-- ==== fim 20260720134108_3c74d38c-73f4-4ae1-a125-54149bfaa98d.sql ====

-- ==== inicio 20260722162536_5c3bf4ec-764a-4d99-b159-e0344d9b8588.sql ====

-- ============================================================
-- Módulo piloto: Integração Meli
-- ============================================================

-- ---------- meli_rotas ----------
CREATE TABLE public.meli_rotas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id text NOT NULL UNIQUE,
  cluster text,
  carrier text,
  facility text,
  data_rota date,
  total_pacotes integer NOT NULL DEFAULT 0,
  total_impressos integer NOT NULL DEFAULT 0,
  origem_importacao uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_rotas TO authenticated;
GRANT ALL ON public.meli_rotas TO service_role;

ALTER TABLE public.meli_rotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_rotas_select_privilegiado"
  ON public.meli_rotas FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_rotas_touch_updated_at
  BEFORE UPDATE ON public.meli_rotas
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX meli_rotas_data_rota_idx ON public.meli_rotas(data_rota);
CREATE INDEX meli_rotas_cluster_idx ON public.meli_rotas(cluster);

-- ---------- meli_pacotes ----------
CREATE TABLE public.meli_pacotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rota_id uuid NOT NULL REFERENCES public.meli_rotas(id) ON DELETE CASCADE,
  tracking_id text NOT NULL,
  shipment_id text,
  destinatario text,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  status text,
  printed_label text,
  ordem integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rota_id, tracking_id)
);

GRANT SELECT ON public.meli_pacotes TO authenticated;
GRANT ALL ON public.meli_pacotes TO service_role;

ALTER TABLE public.meli_pacotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_pacotes_select_privilegiado"
  ON public.meli_pacotes FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_pacotes_touch_updated_at
  BEFORE UPDATE ON public.meli_pacotes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX meli_pacotes_rota_id_idx ON public.meli_pacotes(rota_id);
CREATE INDEX meli_pacotes_tracking_idx ON public.meli_pacotes(tracking_id);

-- ---------- meli_importacoes ----------
CREATE TABLE public.meli_importacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arquivo_nome text,
  status text NOT NULL DEFAULT 'pendente',
  total_rotas integer NOT NULL DEFAULT 0,
  total_pacotes integer NOT NULL DEFAULT 0,
  total_erros integer NOT NULL DEFAULT 0,
  mensagem_erro text,
  importado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_importacoes TO authenticated;
GRANT ALL ON public.meli_importacoes TO service_role;

ALTER TABLE public.meli_importacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_importacoes_select_privilegiado"
  ON public.meli_importacoes FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'gerente')
    OR public.has_role(auth.uid(), 'supervisor')
  );

CREATE TRIGGER meli_importacoes_touch_updated_at
  BEFORE UPDATE ON public.meli_importacoes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- Vínculo tardio: origem_importacao em meli_rotas
ALTER TABLE public.meli_rotas
  ADD CONSTRAINT meli_rotas_origem_importacao_fkey
  FOREIGN KEY (origem_importacao) REFERENCES public.meli_importacoes(id) ON DELETE SET NULL;

-- ---------- meli_rotas_payload (bruto, restrito a admins) ----------
CREATE TABLE public.meli_rotas_payload (
  rota_id uuid PRIMARY KEY REFERENCES public.meli_rotas(id) ON DELETE CASCADE,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.meli_rotas_payload TO authenticated;
GRANT ALL ON public.meli_rotas_payload TO service_role;

ALTER TABLE public.meli_rotas_payload ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meli_rotas_payload_admin_only"
  ON public.meli_rotas_payload FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER meli_rotas_payload_touch_updated_at
  BEFORE UPDATE ON public.meli_rotas_payload
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
-- ==== fim 20260722162536_5c3bf4ec-764a-4d99-b159-e0344d9b8588.sql ====
