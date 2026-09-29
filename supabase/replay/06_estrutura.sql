-- Replay da estrutura do JMRoutes (homologacao) — lote 6 de ~16
-- Gerado a partir de supabase/migrations em ordem de nome. Nao editar a mao.


-- ==== inicio 20260814233108_1fbb6898-875f-4855-bdd2-8afbc47b1170.sql ====
-- 1. Tipos e Tabelas
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'meli_romaneio_status') THEN
        CREATE TYPE public.meli_romaneio_status AS ENUM ('em_andamento', 'concluido', 'cancelado');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.meli_devolucao_romaneios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo TEXT UNIQUE NOT NULL,
    base_id UUID NOT NULL REFERENCES public.bases(id),
    data_operacional DATE NOT NULL,
    sequencial INTEGER NOT NULL CHECK (sequencial > 0),
    status public.meli_romaneio_status NOT NULL DEFAULT 'em_andamento',
    route_id TEXT,
    motorista TEXT,
    observacao_inicial TEXT,
    aberto_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    aberto_por UUID NOT NULL REFERENCES auth.users(id),
    concluido_em TIMESTAMPTZ,
    concluido_por UUID REFERENCES auth.users(id),
    cancelado_em TIMESTAMPTZ,
    cancelado_por UUID REFERENCES auth.users(id),
    justificativa_cancelamento TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT meli_romaneio_sequencial_unico UNIQUE (base_id, data_operacional, sequencial),
    CONSTRAINT meli_romaneio_formato_codigo CHECK (codigo ~ '^EXP-REC-\d{8}-[A-Z0-9]+-\d{3}$'),
    CONSTRAINT meli_romaneio_coerencia_status CHECK (
        (status = 'em_andamento' AND concluido_em IS NULL AND concluido_por IS NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'concluido' AND concluido_em IS NOT NULL AND concluido_por IS NOT NULL AND cancelado_em IS NULL AND cancelado_por IS NULL) OR
        (status = 'cancelado' AND cancelado_em IS NOT NULL AND cancelado_por IS NOT NULL AND justificativa_cancelamento IS NOT NULL AND concluido_em IS NULL AND concluido_por IS NULL)
    )
);

ALTER TABLE public.meli_devolucoes 
ADD COLUMN IF NOT EXISTS romaneio_id UUID REFERENCES public.meli_devolucao_romaneios(id);

-- Índices
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_base_data_status ON public.meli_devolucao_romaneios(base_id, data_operacional, status);
CREATE INDEX IF NOT EXISTS idx_meli_romaneios_codigo ON public.meli_devolucao_romaneios(codigo);
CREATE INDEX IF NOT EXISTS idx_meli_devolucoes_romaneio_id ON public.meli_devolucoes(romaneio_id);

-- Trigger updated_at
CREATE TRIGGER trg_meli_devolucao_romaneios_updated_at
    BEFORE UPDATE ON public.meli_devolucao_romaneios
    FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- 2. Segurança e RLS
ALTER TABLE public.meli_devolucao_romaneios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meli_devolucao_romaneios FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.meli_devolucao_romaneios TO authenticated;
GRANT ALL ON public.meli_devolucao_romaneios TO service_role;

CREATE POLICY "Romaneios visiveis por base ou admin" 
ON public.meli_devolucao_romaneios
FOR SELECT 
TO authenticated
USING (
    public.has_role(auth.uid(), 'admin') OR 
    public.has_role(auth.uid(), 'gerente') OR 
    public.has_base_access(auth.uid(), base_id)
);

-- 3. Função Interna de Recebimento (Encapsulada)
CREATE OR REPLACE FUNCTION public.internal_meli_devolucao_processar_bip(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT,
    p_usuario_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r public.meli_devolucao_romaneios;
    v_d public.meli_devolucoes;
    v_delivered BOOLEAN;
    v_estado_novo TEXT;
BEGIN
    -- Lock no romaneio
    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_invalido', 'mensagem', 'Romaneio não encontrado.');
    END IF;

    IF v_r.status <> 'em_andamento' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'romaneio_fechado', 'mensagem', 'Este romaneio não permite novas bipagens.');
    END IF;

    IF v_r.base_id <> p_base_id THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_invalida', 'mensagem', 'Base informada não coincide com a base do romaneio.');
    END IF;

    -- Lock no pacote
    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;

    IF v_d.id IS NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (upper(btrim(p_tracking_id)), p_base_id, 'pacote_desconhecido', jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'nao_encontrado', 'mensagem', 'Pacote não encontrado nos registros do Meli.');
    END IF;

    IF v_d.base_id <> p_base_id THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'base_divergente', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'base_lida', p_base_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'base_divergente', 'mensagem', 'Este pacote pertence a outra base.');
    END IF;

    IF v_d.romaneio_id IS NOT NULL OR v_d.recebido_em IS NOT NULL THEN
        INSERT INTO public.meli_devolucoes_eventos (devolucao_id, tracking_id, base_id, tipo, detalhes, registrado_por)
        VALUES (v_d.id, v_d.tracking_id, v_d.base_id, 'bipagem_duplicada', 
                jsonb_build_object('romaneio_id', p_romaneio_id, 'romaneio_original', v_d.romaneio_id), p_usuario_id);
        RETURN jsonb_build_object('status', 'duplicado', 'codigo', 'duplicado', 'mensagem', 'Este pacote já foi recebido.');
    END IF;

    v_delivered := lower(coalesce(v_d.situacao_meli, '')) IN ('entregue', 'delivered');

    IF v_delivered AND coalesce(btrim(p_observacao), '') = '' THEN
        RETURN jsonb_build_object('status', 'erro', 'codigo', 'observacao_obrigatoria', 'mensagem', 'Pacote consta como entregue. Observação obrigatória.');
    END IF;

    v_estado_novo := CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'recebido_na_base' END;

    UPDATE public.meli_devolucoes
    SET romaneio_id = p_romaneio_id,
        estado = v_estado_novo,
        recebido_em = now(),
        recebido_por = p_usuario_id,
        recebido_base_id = p_base_id,
        metodo_confirmacao = 'scanner',
        divergencia_delivered = v_delivered,
        observacao_recebimento = nullif(btrim(p_observacao), '')
    WHERE id = v_d.id;

    INSERT INTO public.meli_devolucoes_eventos (
        devolucao_id, tracking_id, base_id, tipo, 
        estado_anterior, estado_novo, detalhes, registrado_por
    )
    VALUES (
        v_d.id, v_d.tracking_id, v_d.base_id, 
        CASE WHEN v_delivered THEN 'divergencia_delivered' ELSE 'bipagem_ok' END,
        v_d.estado, v_estado_novo, jsonb_build_object('romaneio_id', p_romaneio_id), p_usuario_id
    );

    RETURN jsonb_build_object('status', 'ok', 'tracking_id', v_d.tracking_id, 'divergencia_delivered', v_delivered);
END;
$$;

REVOKE ALL ON FUNCTION public.internal_meli_devolucao_processar_bip FROM PUBLIC, anon, authenticated;

-- 4. RPCs Externas
CREATE OR REPLACE FUNCTION public.meli_romaneio_abrir_com_primeiro_pacote(
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_hoje DATE := timezone('America/Sao_Paulo', now())::date;
    v_base_codigo TEXT;
    v_sequencial INT;
    v_romaneio_id UUID;
    v_romaneio_codigo TEXT;
    v_d RECORD;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    -- Lock por base e data
    PERFORM pg_advisory_xact_lock(hashtext('meli_romaneio_seq_' || p_base_id::text || '_' || v_hoje::text));

    SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
    IF v_base_codigo IS NULL OR v_base_codigo = '' THEN RAISE EXCEPTION 'Código da base não encontrado'; END IF;

    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;
    IF v_d.id IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;

    SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_sequencial
    FROM public.meli_devolucao_romaneios
    WHERE base_id = p_base_id AND data_operacional = v_hoje;

    v_romaneio_codigo := 'EXP-REC-' || to_char(v_hoje, 'YYYYMMDD') || '-' || v_base_codigo || '-' || LPAD(v_sequencial::TEXT, 3, '0');

    INSERT INTO public.meli_devolucao_romaneios (
        codigo, base_id, data_operacional, sequencial, 
        route_id, motorista, aberto_por
    )
    VALUES (
        v_romaneio_codigo, p_base_id, v_hoje, v_sequencial,
        v_d.route_id, v_d.motorista, v_uid
    )
    RETURNING id INTO v_romaneio_id;

    v_res := public.internal_meli_devolucao_processar_bip(v_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
    
    IF v_res->>'status' = 'erro' THEN
        RAISE EXCEPTION '%', v_res->>'mensagem';
    END IF;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (p_base_id, 'romaneio_aberto', jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo', v_romaneio_codigo), v_uid);

    RETURN v_res || jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo_romaneio', v_romaneio_codigo);
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_bipar(
    p_romaneio_id UUID,
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    RETURN public.internal_meli_devolucao_processar_bip(p_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_finalizar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT public.has_base_access(v_uid, v_r.base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    IF v_r.status = 'concluido' THEN
        RETURN jsonb_build_object('status', 'ok', 'mensagem', 'Romaneio já estava concluído.');
    END IF;

    IF v_r.status = 'cancelado' THEN RAISE EXCEPTION 'Não é possível finalizar um romaneio cancelado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'concluido',
        concluido_em = now(),
        concluido_por = v_uid
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_finalizado', jsonb_build_object('romaneio_id', p_romaneio_id), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_cancelar(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'gerente')) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem cancelar romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'cancelado',
        cancelado_em = now(),
        cancelado_por = v_uid,
        justificativa_cancelamento = p_justificativa
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_cancelado', jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_reabrir(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'gerente')) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem reabrir romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'em_andamento',
        concluido_em = NULL,
        concluido_por = NULL,
        cancelado_em = NULL,
        cancelado_por = NULL,
        justificativa_cancelamento = NULL
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.base_id, 'romaneio_reaberto', jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_impressao(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r RECORD;
    v_pacotes JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT r.*, b.codigo as base_codigo INTO v_r
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    WHERE r.id = p_romaneio_id;

    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT public.has_base_access(auth.uid(), v_r.base_id) THEN RAISE EXCEPTION 'Sem acesso a este romaneio'; END IF;

    SELECT jsonb_agg(t) INTO v_pacotes
    FROM (
        SELECT tracking_id, estado, recebido_em, divergencia_delivered, observacao_recebimento
        FROM public.meli_devolucoes WHERE romaneio_id = p_romaneio_id
    ) t;

    RETURN to_jsonb(v_r) || jsonb_build_object('pacotes', coalesce(v_pacotes, '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneios_listar(
    p_base_id UUID DEFAULT NULL,
    p_data_de DATE DEFAULT NULL,
    p_data_ate DATE DEFAULT NULL,
    p_status public.meli_romaneio_status DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    codigo TEXT,
    base_id UUID,
    base_codigo TEXT,
    data_operacional DATE,
    sequencial INTEGER,
    status public.meli_romaneio_status,
    route_id TEXT,
    motorista TEXT,
    aberto_em TIMESTAMPTZ,
    aberto_por_nome TEXT,
    total_pacotes BIGINT,
    concluido_em TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    RETURN QUERY
    SELECT 
        r.id,
        r.codigo,
        r.base_id,
        b.codigo as base_codigo,
        r.data_operacional,
        r.sequencial,
        r.status,
        r.route_id,
        r.motorista,
        r.aberto_em,
        p.nome as aberto_por_nome,
        (SELECT count(*) FROM public.meli_devolucoes d WHERE d.romaneio_id = r.id) as total_pacotes,
        r.concluido_em
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    WHERE (p_base_id IS NULL OR r.base_id = p_base_id)
      AND (p_data_de IS NULL OR r.data_operacional >= p_data_de)
      AND (p_data_ate IS NULL OR r.data_operacional <= p_data_ate)
      AND (p_status IS NULL OR r.status = p_status)
      AND (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), r.base_id))
    ORDER BY r.aberto_em DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_detalhar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_r RECORD;
    v_pacotes JSONB;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT 
        r.*, 
        b.codigo as base_codigo, 
        p.nome as aberto_por_nome,
        pc.nome as concluido_por_nome
    INTO v_r
    FROM public.meli_devolucao_romaneios r
    JOIN public.bases b ON b.id = r.base_id
    JOIN public.profiles p ON p.id = r.aberto_por
    LEFT JOIN public.profiles pc ON pc.id = r.concluido_por
    WHERE r.id = p_romaneio_id;

    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_base_access(auth.uid(), v_r.base_id)) THEN
        RAISE EXCEPTION 'Sem acesso a este romaneio';
    END IF;

    SELECT jsonb_agg(t) INTO v_pacotes
    FROM (
        SELECT 
            d.tracking_id, d.estado, d.recebido_em, d.divergencia_delivered, d.observacao_recebimento,
            d.meli_status, d.meli_substatus, d.occurrence_code
        FROM public.meli_devolucoes d
        WHERE d.romaneio_id = p_romaneio_id
        ORDER BY d.recebido_em DESC
    ) t;

    RETURN to_jsonb(v_r) || jsonb_build_object('pacotes', coalesce(v_pacotes, '[]'::jsonb));
END;
$$;

DO $$ 
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_abrir_com_primeiro_pacote', 'meli_romaneio_bipar', 'meli_romaneio_finalizar', 'meli_romaneio_cancelar', 'meli_romaneios_listar', 'meli_romaneio_detalhar', 'meli_romaneio_reabrir', 'meli_romaneio_impressao'];
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;
-- ==== fim 20260814233108_1fbb6898-875f-4855-bdd2-8afbc47b1170.sql ====

-- ==== inicio 20260814235012_dde1be18-c863-45f4-964e-78857552f224.sql ====
-- Migration: Fix recebimentos_insert_security_v1
-- Descrição: Restringe a inserção na tabela recebimentos para garantir que o operador tenha acesso à base informada.

BEGIN;

-- 1. Remover a policy vulnerável anterior
DROP POLICY IF EXISTS "base access recebimentos insert" ON public.recebimentos;

-- 2. Criar a nova policy robusta com WITH CHECK
-- A função public.has_role(auth.uid(), 'admin'::public.app_role) é usada para validar permissões administrativas.
CREATE POLICY "recebimentos_insert_security_v1"
ON public.recebimentos
FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() IS NOT NULL AND (
        public.has_role(auth.uid(), 'admin'::public.app_role) OR 
        public.has_role(auth.uid(), 'gerente'::public.app_role) OR
        public.has_base_access(auth.uid(), base_id)
    )
);

-- 3. Nota de auditoria interna
COMMENT ON POLICY "recebimentos_insert_security_v1" ON public.recebimentos IS 'Garante que inserções respeitem o isolamento de base e as permissões do operador.';

COMMIT;
-- ==== fim 20260814235012_dde1be18-c863-45f4-964e-78857552f224.sql ====

-- ==== inicio 20260815002325_4ced4c8f-82a2-4961-8aa3-b3649db6b760.sql ====
-- Corrige violação de NOT NULL em meli_devolucoes_eventos.tracking_id
-- nos eventos de nível de romaneio (abrir/finalizar/cancelar/reabrir).

CREATE OR REPLACE FUNCTION public.meli_romaneio_abrir_com_primeiro_pacote(
    p_base_id UUID,
    p_tracking_id TEXT,
    p_observacao TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_hoje DATE := timezone('America/Sao_Paulo', now())::date;
    v_base_codigo TEXT;
    v_sequencial INT;
    v_romaneio_id UUID;
    v_romaneio_codigo TEXT;
    v_d RECORD;
    v_res JSONB;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT public.has_base_access(v_uid, p_base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    PERFORM pg_advisory_xact_lock(hashtext('meli_romaneio_seq_' || p_base_id::text || '_' || v_hoje::text));

    SELECT codigo INTO v_base_codigo FROM public.bases WHERE id = p_base_id;
    IF v_base_codigo IS NULL OR v_base_codigo = '' THEN RAISE EXCEPTION 'Código da base não encontrado'; END IF;

    SELECT * INTO v_d FROM public.meli_devolucoes WHERE upper(tracking_id) = upper(btrim(p_tracking_id)) FOR UPDATE;
    IF v_d.id IS NULL THEN RAISE EXCEPTION 'Pacote não encontrado'; END IF;

    SELECT COALESCE(MAX(sequencial), 0) + 1 INTO v_sequencial
    FROM public.meli_devolucao_romaneios
    WHERE base_id = p_base_id AND data_operacional = v_hoje;

    v_romaneio_codigo := 'EXP-REC-' || to_char(v_hoje, 'YYYYMMDD') || '-' || v_base_codigo || '-' || LPAD(v_sequencial::TEXT, 3, '0');

    INSERT INTO public.meli_devolucao_romaneios (
        codigo, base_id, data_operacional, sequencial,
        route_id, motorista, aberto_por
    )
    VALUES (
        v_romaneio_codigo, p_base_id, v_hoje, v_sequencial,
        v_d.route_id, v_d.motorista, v_uid
    )
    RETURNING id INTO v_romaneio_id;

    v_res := public.internal_meli_devolucao_processar_bip(v_romaneio_id, p_base_id, p_tracking_id, p_observacao, v_uid);

    IF v_res->>'status' = 'erro' THEN
        RAISE EXCEPTION '%', v_res->>'mensagem';
    END IF;

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_romaneio_codigo, p_base_id, 'romaneio_aberto',
            jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo', v_romaneio_codigo), v_uid);

    RETURN v_res || jsonb_build_object('romaneio_id', v_romaneio_id, 'codigo_romaneio', v_romaneio_codigo);
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_finalizar(p_romaneio_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;
    IF NOT public.has_base_access(v_uid, v_r.base_id) THEN RAISE EXCEPTION 'Sem acesso à base'; END IF;

    IF v_r.status = 'concluido' THEN
        RETURN jsonb_build_object('status', 'ok', 'mensagem', 'Romaneio já estava concluído.');
    END IF;

    IF v_r.status = 'cancelado' THEN RAISE EXCEPTION 'Não é possível finalizar um romaneio cancelado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'concluido',
        concluido_em = now(),
        concluido_por = v_uid
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_finalizado', jsonb_build_object('romaneio_id', p_romaneio_id), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_cancelar(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gerente'::public.app_role)) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem cancelar romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'cancelado',
        cancelado_em = now(),
        cancelado_por = v_uid,
        justificativa_cancelamento = p_justificativa
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_cancelado',
            jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

CREATE OR REPLACE FUNCTION public.meli_romaneio_reabrir(p_romaneio_id UUID, p_justificativa TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid UUID := auth.uid();
    v_r public.meli_devolucao_romaneios;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
    IF NOT (public.has_role(v_uid, 'admin'::public.app_role) OR public.has_role(v_uid, 'gerente'::public.app_role)) THEN
        RAISE EXCEPTION 'Apenas administradores ou gerentes podem reabrir romaneios';
    END IF;

    SELECT * INTO v_r FROM public.meli_devolucao_romaneios WHERE id = p_romaneio_id FOR UPDATE;
    IF v_r.id IS NULL THEN RAISE EXCEPTION 'Romaneio não encontrado'; END IF;

    UPDATE public.meli_devolucao_romaneios
    SET status = 'em_andamento',
        concluido_em = NULL,
        concluido_por = NULL,
        cancelado_em = NULL,
        cancelado_por = NULL,
        justificativa_cancelamento = NULL
    WHERE id = p_romaneio_id;

    INSERT INTO public.meli_devolucoes_eventos (tracking_id, base_id, tipo, detalhes, registrado_por)
    VALUES (v_r.codigo, v_r.base_id, 'romaneio_reaberto',
            jsonb_build_object('romaneio_id', p_romaneio_id, 'justificativa', p_justificativa), v_uid);

    RETURN jsonb_build_object('status', 'ok');
END;
$$;

DO $$
DECLARE
    rpc text;
    rpcs text[] := ARRAY['meli_romaneio_abrir_com_primeiro_pacote', 'meli_romaneio_finalizar', 'meli_romaneio_cancelar', 'meli_romaneio_reabrir'];
BEGIN
    FOREACH rpc IN ARRAY rpcs LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM PUBLIC', rpc);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I FROM anon', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO authenticated', rpc);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I TO service_role', rpc);
    END LOOP;
END $$;
-- ==== fim 20260815002325_4ced4c8f-82a2-4961-8aa3-b3649db6b760.sql ====

-- ==== inicio 20260815120000_corrigir_sincronizacao_meli_devolucoes.sql ====
-- Corrige a classificacao e a reconciliacao estrutural de Devolucoes.
-- Esta migration redefine a RPC publica existente, mas nao a executa.

ALTER TABLE public.meli_devolucoes
  ALTER COLUMN prazo_retorno_em DROP NOT NULL;

UPDATE public.meli_devolucoes
   SET prazo_retorno_em = NULL
 WHERE estado <> 'aguardando_retorno'
   AND prazo_retorno_em IS NOT NULL;

CREATE OR REPLACE FUNCTION public.meli_devolucoes_sincronizar(
  p_data_de date DEFAULT NULL,
  p_data_ate date DEFAULT NULL,
  p_base_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_hoje date := (clock_timestamp() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_de date := coalesce(p_data_de, v_hoje - 7);
  v_ate date := coalesce(p_data_ate, v_hoje);
  v_criadas integer := 0;
  v_atualizadas integer := 0;
  v_reconciliadas integer := 0;
  v_revisao integer := 0;
  v_conflitos_base integer := 0;
  v_eventos integer := 0;
  v_analisados integer := 0;
  v_sem_alteracao integer := 0;
  v_aguardando integer := 0;
  v_investigacao integer := 0;
  v_transferidos integer := 0;
  v_base record;
  v_item record;
  v_atual public.meli_devolucoes%ROWTYPE;
  v_codigo text;
  v_estado_novo text;
  v_prazo_novo timestamptz;
  v_ocorrido_novo timestamptz;
  v_situacao_nova text;
  v_inseriu boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Usuario nao autenticado.';
  END IF;
  IF v_de > v_ate THEN
    RAISE EXCEPTION USING ERRCODE = '22007', MESSAGE = 'Intervalo de datas invalido.';
  END IF;
  IF p_base_id IS NOT NULL AND NOT public.has_base_access(v_uid, p_base_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Usuario sem acesso a base solicitada.';
  END IF;

  -- Trava todas as bases antes da primeira escrita e sempre na mesma ordem.
  FOR v_base IN
    SELECT DISTINCT ro.base_id
      FROM public.meli_rotas_ativas ro
     WHERE ro.base_id IS NOT NULL
       AND ro.data_rota BETWEEN v_de AND v_ate
       AND public.has_base_access(v_uid, ro.base_id)
       AND (p_base_id IS NULL OR ro.base_id = p_base_id)
     ORDER BY ro.base_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('meli_devolucoes_sincronizar:' || v_base.base_id::text, 0)
    );
  END LOOP;

  FOR v_item IN
    WITH candidatos AS (
      SELECT DISTINCT ON (ro.base_id, p.tracking_id)
             p.tracking_id,
             lower(btrim(coalesce(nullif(p.occurrence_code, ''), nullif(p.substatus, ''), ''))) AS codigo_bruto,
             lower(btrim(coalesce(p.status, ''))) AS status_normalizado,
             p.status, p.substatus,
             coalesce(p.last_synced_at, p.updated_at, p.created_at) AS ocorrido_em,
             p.last_synced_at, ro.id AS rota_id, ro.route_id, ro.cluster,
             ro.base_id, ro.driver_name, ro.carrier
        FROM public.meli_pacotes p
        JOIN public.meli_rotas_ativas ro ON ro.id = p.rota_id
       WHERE ro.base_id IS NOT NULL
         AND nullif(btrim(p.tracking_id), '') IS NOT NULL
         AND ro.data_rota BETWEEN v_de AND v_ate
         AND public.has_base_access(v_uid, ro.base_id)
         AND (p_base_id IS NULL OR ro.base_id = p_base_id)
       ORDER BY ro.base_id, p.tracking_id,
                coalesce(p.last_synced_at, p.updated_at, p.created_at) DESC, p.id DESC
    )
    SELECT * FROM candidatos
     WHERE status_normalizado IN ('delivered', 'picked_up') OR codigo_bruto <> ''
     ORDER BY base_id, tracking_id
  LOOP
    v_analisados := v_analisados + 1;
    v_codigo := CASE v_item.codigo_bruto
      WHEN 'unvisited' THEN 'unvisited_address'
      WHEN 'blocked' THEN 'blocked_by_keyword'
      WHEN 'blocked_kw' THEN 'blocked_by_keyword'
      ELSE v_item.codigo_bruto
    END;

    SELECT * INTO v_atual
      FROM public.meli_devolucoes d
     WHERE d.tracking_id = v_item.tracking_id
     FOR UPDATE;

    -- A constraint historica e global; colisao de outra base e somente relatada.
    IF v_atual.id IS NOT NULL AND v_atual.base_id <> v_item.base_id THEN
      v_conflitos_base := v_conflitos_base + 1;
      v_sem_alteracao := v_sem_alteracao + 1;
      CONTINUE;
    END IF;

    -- Sucessos nao criam devolucao. Se havia retorno pendente, encerram-no sem
    -- preencher qualquer campo de recebimento fisico.
    IF v_item.status_normalizado IN ('delivered', 'picked_up') THEN
      IF v_atual.id IS NOT NULL AND v_atual.estado = 'aguardando_retorno' THEN
        UPDATE public.meli_devolucoes d
           SET meli_status = v_item.status,
               meli_substatus = v_item.substatus,
               situacao_meli = CASE WHEN v_item.status_normalizado = 'delivered'
                                    THEN 'entregue' ELSE 'retirado' END,
               last_synced_at = v_item.last_synced_at,
               estado = 'encerrado', prazo_retorno_em = NULL
         WHERE d.id = v_atual.id AND d.base_id = v_item.base_id
           AND (d.meli_status, d.meli_substatus, d.situacao_meli, d.last_synced_at,
                d.estado, d.prazo_retorno_em) IS DISTINCT FROM
               (v_item.status, v_item.substatus,
                CASE WHEN v_item.status_normalizado = 'delivered' THEN 'entregue' ELSE 'retirado' END,
                v_item.last_synced_at, 'encerrado'::text, NULL::timestamptz);
        IF FOUND THEN
          v_atualizadas := v_atualizadas + 1;
          v_reconciliadas := v_reconciliadas + 1;
          INSERT INTO public.meli_devolucoes_eventos
            (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
          VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'reconciliacao_meli',
                  v_atual.estado, 'encerrado',
                  jsonb_build_object('meli_status', v_item.status_normalizado,
                                     'recebimento_fisico', false), v_uid);
          v_eventos := v_eventos + 1;
        ELSE
          v_sem_alteracao := v_sem_alteracao + 1;
        END IF;
      ELSE
        v_sem_alteracao := v_sem_alteracao + 1;
      END IF;
      CONTINUE;
    END IF;

    IF v_codigo IN ('buyer_rejected','buyer_absent','business_closed','unvisited_address',
                    'damaged','bad_address','missrouted','blocked_by_keyword') THEN
      v_estado_novo := 'aguardando_retorno';
    ELSIF v_codigo IN ('missing','lost','stolen') THEN
      v_estado_novo := 'em_investigacao';
    ELSIF v_codigo = 'transferred' THEN
      v_estado_novo := 'transferido';
    ELSE
      v_estado_novo := 'revisao_necessaria';
    END IF;

    IF v_estado_novo = 'aguardando_retorno' THEN
      v_aguardando := v_aguardando + 1;
    ELSIF v_estado_novo = 'em_investigacao' THEN
      v_investigacao := v_investigacao + 1;
    ELSIF v_estado_novo = 'transferido' THEN
      v_transferidos := v_transferidos + 1;
    END IF;

    v_situacao_nova := CASE v_estado_novo
      WHEN 'aguardando_retorno' THEN 'insucesso'
      WHEN 'em_investigacao' THEN 'investigacao'
      WHEN 'transferido' THEN 'transferido'
      ELSE 'revisao_necessaria'
    END;
    v_ocorrido_novo := v_item.ocorrido_em;
    v_prazo_novo := CASE WHEN v_estado_novo = 'aguardando_retorno'
                         THEN v_ocorrido_novo + interval '3 days' ELSE NULL END;
    v_inseriu := false;

    IF v_atual.id IS NULL THEN
      BEGIN
        INSERT INTO public.meli_devolucoes (
          tracking_id, base_id, rota_id, route_id, cluster, motorista, transportadora,
          occurrence_code, meli_status, meli_substatus, situacao_meli,
          ocorrido_em, prazo_retorno_em, last_synced_at, estado
        ) VALUES (
          v_item.tracking_id, v_item.base_id, v_item.rota_id, v_item.route_id,
          v_item.cluster, v_item.driver_name, v_item.carrier, v_codigo,
          v_item.status, v_item.substatus, v_situacao_nova, v_ocorrido_novo,
          v_prazo_novo, v_item.last_synced_at, v_estado_novo
        ) RETURNING * INTO v_atual;
        v_inseriu := true;
      EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_atual FROM public.meli_devolucoes d
         WHERE d.tracking_id = v_item.tracking_id FOR UPDATE;
        IF v_atual.id IS NULL OR v_atual.base_id <> v_item.base_id THEN
          v_conflitos_base := v_conflitos_base + 1;
          CONTINUE;
        END IF;
      END;
    END IF;

    IF v_inseriu THEN
      v_criadas := v_criadas + 1;
      IF v_estado_novo = 'revisao_necessaria' THEN v_revisao := v_revisao + 1; END IF;
      INSERT INTO public.meli_devolucoes_eventos
        (devolucao_id, tracking_id, base_id, tipo, estado_novo, detalhes, registrado_por)
      VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'criada', v_atual.estado,
              jsonb_build_object('occurrence_code', v_codigo, 'origem', 'sincronizacao'), v_uid);
      v_eventos := v_eventos + 1;
      CONTINUE;
    END IF;

    -- Preserva os estados que dependem de acao fisica/manual.
    IF v_atual.estado IN ('recebido_na_base','divergencia_delivered','encerrado') THEN
      v_estado_novo := v_atual.estado;
      v_prazo_novo := v_atual.prazo_retorno_em;
    END IF;

    UPDATE public.meli_devolucoes d
       SET rota_id = v_item.rota_id, route_id = v_item.route_id,
           cluster = v_item.cluster, motorista = v_item.driver_name,
           transportadora = v_item.carrier, occurrence_code = v_codigo,
           meli_status = v_item.status, meli_substatus = v_item.substatus,
           situacao_meli = v_situacao_nova,
           ocorrido_em = CASE WHEN d.occurrence_code IS DISTINCT FROM v_codigo
                              THEN v_ocorrido_novo ELSE d.ocorrido_em END,
           prazo_retorno_em = CASE
             WHEN v_estado_novo <> 'aguardando_retorno' THEN v_prazo_novo
             WHEN d.occurrence_code IS DISTINCT FROM v_codigo THEN v_prazo_novo
             ELSE d.prazo_retorno_em END,
           last_synced_at = v_item.last_synced_at, estado = v_estado_novo
     WHERE d.id = v_atual.id AND d.base_id = v_item.base_id
       AND (d.rota_id, d.route_id, d.cluster, d.motorista, d.transportadora,
            d.occurrence_code, d.meli_status, d.meli_substatus, d.situacao_meli,
            d.last_synced_at, d.estado) IS DISTINCT FROM
           (v_item.rota_id, v_item.route_id, v_item.cluster, v_item.driver_name,
            v_item.carrier, v_codigo, v_item.status, v_item.substatus,
            v_situacao_nova, v_item.last_synced_at, v_estado_novo);

    IF FOUND THEN
      v_atualizadas := v_atualizadas + 1;
      IF v_estado_novo = 'revisao_necessaria' AND v_atual.estado <> 'revisao_necessaria' THEN
        v_revisao := v_revisao + 1;
      END IF;
      INSERT INTO public.meli_devolucoes_eventos
        (devolucao_id, tracking_id, base_id, tipo, estado_anterior, estado_novo, detalhes, registrado_por)
      VALUES (v_atual.id, v_atual.tracking_id, v_atual.base_id, 'atualizacao_meli',
              v_atual.estado, v_estado_novo,
              jsonb_build_object('occurrence_code', v_codigo, 'meli_status', v_item.status,
                                 'meli_substatus', v_item.substatus), v_uid);
      v_eventos := v_eventos + 1;
    ELSE
      v_sem_alteracao := v_sem_alteracao + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'ok', 'analisados', v_analisados,
    'criadas', v_criadas, 'criados', v_criadas,
    'atualizadas', v_atualizadas, 'atualizados', v_atualizadas,
    'sem_alteracao', v_sem_alteracao,
    'aguardando', v_aguardando, 'investigacao', v_investigacao,
    'transferidos', v_transferidos, 'erros', 0,
    'reconciliadas', v_reconciliadas, 'revisao_necessaria', v_revisao,
    'conflitos_base', v_conflitos_base, 'eventos', v_eventos,
    'data_de', v_de, 'data_ate', v_ate,
    'server_time', clock_timestamp(), 'sincronizado_em', clock_timestamp()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.meli_devolucoes_sincronizar(date, date, uuid)
  TO authenticated;
-- ==== fim 20260815120000_corrigir_sincronizacao_meli_devolucoes.sql ====

-- ==== inicio 20260824194748_meli_oauth_integracao.sql ====
-- Integração oficial Mercado Livre. As tabelas são exclusivamente server-side:
-- nenhuma permissão é concedida ao cliente web.

create table if not exists public.meli_oauth_states (
  state_hash text primary key,
  code_verifier text not null,
  solicitado_por uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default (now() + interval '10 minutes'),
  usado_em timestamptz
);

create table if not exists public.meli_api_conexoes (
  id uuid primary key default gen_random_uuid(),
  meli_user_id bigint not null unique,
  apelido text,
  access_token_criptografado text not null,
  refresh_token_criptografado text not null,
  token_expira_em timestamptz not null,
  scopes text[] not null default '{}',
  conectado_por uuid references auth.users(id) on delete set null,
  conectado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  ativo boolean not null default true
);

create table if not exists public.meli_api_notificacoes (
  id uuid primary key default gen_random_uuid(),
  notification_id text unique,
  topic text not null,
  resource text not null,
  meli_user_id bigint,
  application_id bigint,
  payload jsonb not null,
  recebido_em timestamptz not null default now(),
  processado_em timestamptz,
  erro text
);

create index if not exists meli_api_notificacoes_pendentes_idx
  on public.meli_api_notificacoes (recebido_em)
  where processado_em is null;

alter table public.meli_oauth_states enable row level security;
alter table public.meli_api_conexoes enable row level security;
alter table public.meli_api_notificacoes enable row level security;

revoke all on public.meli_oauth_states from anon, authenticated;
revoke all on public.meli_api_conexoes from anon, authenticated;
revoke all on public.meli_api_notificacoes from anon, authenticated;

grant all on public.meli_oauth_states to service_role;
grant all on public.meli_api_conexoes to service_role;
grant all on public.meli_api_notificacoes to service_role;
-- ==== fim 20260824194748_meli_oauth_integracao.sql ====

-- ==== inicio 20260826235547_meli_tracking_foundation.sql ====
-- Fundação aditiva para a futura integração oficial de Carrier/Tracking.
-- Não cria triggers operacionais, não envia notificações e não altera o worker AdminML.

alter table public.meli_pacotes
  add column if not exists tracking_number text,
  add column if not exists facility text,
  add column if not exists service_center_id text;

create index if not exists meli_pacotes_tracking_number_idx
  on public.meli_pacotes (tracking_number)
  where tracking_number is not null;

create index if not exists meli_pacotes_service_center_idx
  on public.meli_pacotes (service_center_id)
  where service_center_id is not null;

create table if not exists public.meli_tracking_eventos (
  id uuid primary key default gen_random_uuid(),
  meli_pacote_id uuid references public.meli_pacotes(id) on delete set null,
  rota_id uuid references public.meli_rotas(id) on delete set null,
  shipment_id text not null,
  tracking_number text not null,
  tipo_evento_interno text not null check (tipo_evento_interno in (
    'RECEBIDO_BASE',
    'TRIADO',
    'CARREGADO',
    'SAIU_ENTREGA',
    'ENTREGUE',
    'INSUCESSO',
    'DEVOLUCAO'
  )),
  event_date timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  status_envio text not null default 'REGISTRO_INTERNO' check (status_envio in (
    'REGISTRO_INTERNO',
    'PENDENTE',
    'ENVIANDO',
    'ENVIADO',
    'ERRO',
    'CANCELADO'
  )),
  numero_tentativas integer not null default 0 check (numero_tentativas >= 0),
  resposta_mercado_livre jsonb,
  mensagem_erro text,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists meli_tracking_eventos_pendentes_idx
  on public.meli_tracking_eventos (created_at)
  where status_envio in ('PENDENTE', 'ERRO');

create index if not exists meli_tracking_eventos_shipment_idx
  on public.meli_tracking_eventos (shipment_id, event_date desc);

-- Cache por audience para reutilização e renovação preventiva do token.
-- O token deve ser criptografado pela camada server-side antes da persistência.
create table if not exists public.meli_carrier_oauth_tokens (
  audience text primary key,
  access_token_criptografado text not null,
  token_expira_em timestamptz not null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (length(btrim(audience)) > 0)
);

alter table public.meli_tracking_eventos enable row level security;
alter table public.meli_carrier_oauth_tokens enable row level security;

revoke all on public.meli_tracking_eventos from public, anon, authenticated;
revoke all on public.meli_carrier_oauth_tokens from public, anon, authenticated;

grant all on public.meli_tracking_eventos to service_role;
grant all on public.meli_carrier_oauth_tokens to service_role;

comment on table public.meli_tracking_eventos is
  'Fila interna inativa de eventos de tracking; envio oficial ainda não implementado.';
comment on table public.meli_carrier_oauth_tokens is
  'Cache server-side criptografado de tokens client_credentials por audience.';
-- ==== fim 20260826235547_meli_tracking_foundation.sql ====

-- ==== inicio 20260827180610_expedicao_independente.sql ====
-- Expedição independente do Recebimento.
-- As leituras usam a relação original da importação e nunca alteram escalas.triado.

CREATE TABLE public.expedicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  importacao_id uuid NOT NULL REFERENCES public.importacoes_escala(id),
  data_operacional date NOT NULL,
  rota text NOT NULL CHECK (btrim(rota) <> ''),
  status text NOT NULL DEFAULT 'em_conferencia'
    CHECK (status IN ('em_conferencia', 'concluida', 'concluida_com_ressalva')),
  quantidade_prevista integer NOT NULL CHECK (quantidade_prevista >= 0),
  quantidade_conferida integer NOT NULL DEFAULT 0 CHECK (quantidade_conferida >= 0),
  responsavel_expedicao_id uuid REFERENCES auth.users(id),
  motorista text,
  responsavel_meli_svc text,
  outro_responsavel text,
  observacao text,
  iniciada_por uuid NOT NULL REFERENCES auth.users(id),
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  concluida_por uuid REFERENCES auth.users(id),
  concluida_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importacao_id, rota)
);

CREATE INDEX expedicoes_base_dia_idx
  ON public.expedicoes (base_id, data_operacional, status);

CREATE TABLE public.expedicao_leituras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expedicao_id uuid NOT NULL REFERENCES public.expedicoes(id) ON DELETE CASCADE,
  escala_id uuid NOT NULL REFERENCES public.escalas(id),
  shipment text NOT NULL CHECK (btrim(shipment) <> ''),
  operador_id uuid NOT NULL REFERENCES auth.users(id),
  resultado text NOT NULL CHECK (resultado IN ('ok', 'duplicado', 'inexistente', 'outra_rota')),
  nao_localizado_no_recebimento boolean NOT NULL DEFAULT false,
  localizado_posteriormente_na_expedicao boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expedicao_id, shipment)
);

CREATE INDEX expedicao_leituras_expedicao_created_idx
  ON public.expedicao_leituras (expedicao_id, created_at DESC);
CREATE INDEX expedicao_leituras_recuperadas_idx
  ON public.expedicao_leituras (expedicao_id)
  WHERE localizado_posteriormente_na_expedicao;

-- Estrutura do fechamento diário; PDF e envio serão acoplados sem recalcular o passado.
CREATE TABLE public.fechamentos_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_id uuid NOT NULL REFERENCES public.bases(id),
  data_operacional date NOT NULL,
  status text NOT NULL DEFAULT 'aberto'
    CHECK (status IN ('aberto', 'reconciliado', 'enviado', 'erro_envio')),
  faltantes_recebimento integer NOT NULL DEFAULT 0,
  recuperados_expedicao integer NOT NULL DEFAULT 0,
  faltantes_finais integer NOT NULL DEFAULT 0,
  shipment_ids_finais jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(shipment_ids_finais) = 'array'),
  pdf_path text,
  email_destinatario text,
  email_message_id text,
  enviado_por uuid REFERENCES auth.users(id),
  enviado_em timestamptz,
  evidencia_envio jsonb,
  criado_por uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (base_id, data_operacional)
);

ALTER TABLE public.expedicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expedicao_leituras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fechamentos_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expedicoes_visiveis_por_base"
  ON public.expedicoes FOR SELECT TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id));
CREATE POLICY "expedicoes_criadas_por_base"
  ON public.expedicoes FOR INSERT TO authenticated
  WITH CHECK (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND iniciada_por = (SELECT auth.uid())
  );
CREATE POLICY "expedicoes_atualizadas_por_base"
  ON public.expedicoes FOR UPDATE TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id))
  WITH CHECK (public.has_base_access((SELECT auth.uid()), base_id));

CREATE POLICY "expedicao_leituras_visiveis_por_base"
  ON public.expedicao_leituras FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.expedicoes e
    WHERE e.id = expedicao_id
      AND public.has_base_access((SELECT auth.uid()), e.base_id)
  ));
CREATE POLICY "expedicao_leituras_criadas_por_base"
  ON public.expedicao_leituras FOR INSERT TO authenticated
  WITH CHECK (
    operador_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.expedicoes e
      WHERE e.id = expedicao_id
        AND public.has_base_access((SELECT auth.uid()), e.base_id)
    )
  );

CREATE POLICY "fechamentos_visiveis_por_base"
  ON public.fechamentos_operacionais FOR SELECT TO authenticated
  USING (public.has_base_access((SELECT auth.uid()), base_id));
CREATE POLICY "fechamentos_criados_por_base"
  ON public.fechamentos_operacionais FOR INSERT TO authenticated
  WITH CHECK (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND criado_por = (SELECT auth.uid())
  );
CREATE POLICY "fechamentos_atualizados_por_gestao"
  ON public.fechamentos_operacionais FOR UPDATE TO authenticated
  USING (
    public.has_base_access((SELECT auth.uid()), base_id)
    AND (
      public.has_role((SELECT auth.uid()), 'admin')
      OR public.has_role((SELECT auth.uid()), 'gerente')
      OR public.has_role((SELECT auth.uid()), 'supervisor')
    )
  )
  WITH CHECK (public.has_base_access((SELECT auth.uid()), base_id));

-- Opt-in explícito para a Data API (mudança de plataforma Supabase de 2026).
GRANT SELECT, INSERT, UPDATE ON public.expedicoes TO authenticated;
GRANT SELECT, INSERT ON public.expedicao_leituras TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.fechamentos_operacionais TO authenticated;
GRANT ALL ON public.expedicoes, public.expedicao_leituras,
  public.fechamentos_operacionais TO service_role;
-- ==== fim 20260827180610_expedicao_independente.sql ====

-- ==== inicio 20260829103000_app_motorista_meli.sql ====
-- Vincula o catálogo Meli à Expedição e ao usuário que acessará o app móvel.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS meli_driver_id text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_meli_driver_id_uidx
  ON public.profiles (meli_driver_id)
  WHERE meli_driver_id IS NOT NULL;

ALTER TABLE public.expedicoes
  ADD COLUMN IF NOT EXISTS motorista_meli_id text,
  ADD COLUMN IF NOT EXISTS motorista_usuario_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expedicoes_motorista_usuario_status_idx
  ON public.expedicoes (motorista_usuario_id, status, data_operacional DESC)
  WHERE motorista_usuario_id IS NOT NULL;

-- As tabelas já possuem RLS. Os novos campos seguem as mesmas políticas e grants.
-- ==== fim 20260829103000_app_motorista_meli.sql ====

-- ==== inicio 20260829162801_cadastro_motorista_app.sql ====
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS placa text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_placa_formato_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_placa_formato_check
  CHECK (placa IS NULL OR placa ~ '^[A-Z0-9]{7}$');

-- O vínculo único com o Meli já é garantido pelo índice
-- profiles_meli_driver_id_uidx criado junto do módulo de Expedição.

COMMENT ON COLUMN public.profiles.placa IS
  'Placa operacional informada no cadastro interno do motorista, sem pontuação.';
-- ==== fim 20260829162801_cadastro_motorista_app.sql ====

-- ==== inicio 20260829163000_catalogo_motoristas_meli.sql ====
CREATE TABLE IF NOT EXISTS public.meli_motoristas_catalogo (
  meli_driver_id text PRIMARY KEY,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'adminml',
  service_center_id text,
  ultima_rota_em date,
  sincronizado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meli_motoristas_catalogo_nome_check CHECK (length(btrim(nome)) > 0),
  CONSTRAINT meli_motoristas_catalogo_origem_check CHECK (origem IN ('adminml', 'rota_observada'))
);

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_nome_idx
  ON public.meli_motoristas_catalogo (nome);

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_ativos_idx
  ON public.meli_motoristas_catalogo (ativo)
  WHERE ativo = true;

ALTER TABLE public.meli_motoristas_catalogo ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "motoristas_meli_select_authenticated" ON public.meli_motoristas_catalogo;
CREATE POLICY "motoristas_meli_select_authenticated"
  ON public.meli_motoristas_catalogo
  FOR SELECT
  TO authenticated
  USING (true);

REVOKE ALL ON TABLE public.meli_motoristas_catalogo FROM anon;
GRANT SELECT ON TABLE public.meli_motoristas_catalogo TO authenticated;
GRANT ALL ON TABLE public.meli_motoristas_catalogo TO service_role;

-- Compatibilidade inicial: cria o catálogo com os motoristas já observados nas
-- rotas. A sincronização do catálogo oficial do AdminML fará upsert nestas
-- mesmas chaves, mudando a origem para `adminml`, sem afetar os vínculos.
INSERT INTO public.meli_motoristas_catalogo (
  meli_driver_id,
  nome,
  origem,
  ultima_rota_em,
  sincronizado_em
)
SELECT DISTINCT ON (driver_id)
  btrim(driver_id),
  btrim(driver_name),
  'rota_observada',
  data_rota,
  now()
FROM public.meli_rotas
WHERE nullif(btrim(driver_id), '') IS NOT NULL
  AND nullif(btrim(driver_name), '') IS NOT NULL
ORDER BY driver_id, data_rota DESC NULLS LAST
ON CONFLICT (meli_driver_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  ultima_rota_em = GREATEST(
    public.meli_motoristas_catalogo.ultima_rota_em,
    EXCLUDED.ultima_rota_em
  ),
  updated_at = now();

COMMENT ON TABLE public.meli_motoristas_catalogo IS
  'Catálogo canônico de motoristas do Mercado Livre usado na atribuição de rotas e no app do motorista.';
-- ==== fim 20260829163000_catalogo_motoristas_meli.sql ====

-- ==== inicio 20260829174500_status_catalogo_motoristas_meli.sql ====
ALTER TABLE public.meli_motoristas_catalogo
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS carrier_id text;

ALTER TABLE public.meli_motoristas_catalogo
  DROP CONSTRAINT IF EXISTS meli_motoristas_catalogo_status_check;
ALTER TABLE public.meli_motoristas_catalogo
  ADD CONSTRAINT meli_motoristas_catalogo_status_check
  CHECK (status IN ('active', 'inactive', 'blocked', 'unknown'));

CREATE INDEX IF NOT EXISTS meli_motoristas_catalogo_status_idx
  ON public.meli_motoristas_catalogo (status);
-- ==== fim 20260829174500_status_catalogo_motoristas_meli.sql ====

-- ==== inicio 20260831151041_separar_cadastro_motoristas.sql ====
ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS meli_driver_id text;

ALTER TABLE public.motoristas
  DROP CONSTRAINT IF EXISTS motoristas_placa_formato_check;
ALTER TABLE public.motoristas
  ADD CONSTRAINT motoristas_placa_formato_check
  CHECK (placa IS NULL OR placa ~ '^[A-Z0-9]{7}$');

CREATE UNIQUE INDEX IF NOT EXISTS motoristas_meli_driver_id_uidx
  ON public.motoristas (meli_driver_id)
  WHERE meli_driver_id IS NOT NULL;

COMMENT ON COLUMN public.motoristas.meli_driver_id IS
  'Identidade do catálogo Meli vinculada ao cadastro operacional do motorista.';

CREATE OR REPLACE FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.motorista_id := (
    SELECT m.id
    FROM public.motoristas m
    WHERE m.meli_driver_id = NEW.driver_id
      AND m.ativo = true
    LIMIT 1
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vincular_motorista_cadastrado_na_rota_meli()
  TO service_role;

DROP TRIGGER IF EXISTS trg_vincular_motorista_cadastrado_na_rota_meli ON public.meli_rotas;
CREATE TRIGGER trg_vincular_motorista_cadastrado_na_rota_meli
BEFORE INSERT OR UPDATE OF driver_id ON public.meli_rotas
FOR EACH ROW
EXECUTE FUNCTION public.vincular_motorista_cadastrado_na_rota_meli();

UPDATE public.meli_rotas r
SET motorista_id = m.id
FROM public.motoristas m
WHERE m.ativo = true
  AND m.meli_driver_id IS NOT NULL
  AND r.driver_id = m.meli_driver_id
  AND r.motorista_id IS DISTINCT FROM m.id;
-- ==== fim 20260831151041_separar_cadastro_motoristas.sql ====

-- ==== inicio 20260831184500_restaurar_acessos_motoristas.sql ====
ALTER TABLE public.motoristas
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS usuario text;

CREATE UNIQUE INDEX IF NOT EXISTS motoristas_auth_user_id_uidx ON public.motoristas (auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS motoristas_usuario_lower_uidx ON public.motoristas (lower(usuario)) WHERE usuario IS NOT NULL;

COMMENT ON COLUMN public.motoristas.auth_user_id IS 'Usuário de autenticação exclusivo do aplicativo do motorista.';
COMMENT ON COLUMN public.motoristas.usuario IS 'Nome de usuário utilizado pelo motorista para entrar no aplicativo.';
-- ==== fim 20260831184500_restaurar_acessos_motoristas.sql ====

-- ==== inicio 20260901161603_incluir_rotas_rostering_sem_pacotes.sql ====
-- Rotas classificadas diretamente pelo Rostering podem não possuir pacotes no
-- monitor de entregas. O painel deve preservar essa evidência e exibi-las com
-- totais zerados, sem fabricar resultados de entrega.
CREATE OR REPLACE FUNCTION public.meli_rotas_area_risco(
  p_data date DEFAULT NULL::date,
  p_base_id uuid DEFAULT NULL::uuid,
  p_rota text DEFAULT NULL::text,
  p_motorista text DEFAULT NULL::text,
  p_transportadora text DEFAULT NULL::text,
  p_risco text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_data date := coalesce(p_data, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_res jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'erro', 'Não autenticado.');
  END IF;

  WITH pac AS (
    SELECT r.id AS rota_id, r.route_id, r.cluster, r.base_id, b.codigo AS base_codigo,
           b.nome AS base_nome, r.driver_name, r.vehicle_license, r.carrier,
           r.data_rota, r.last_synced_at,
           r.rota_area_risco, r.area_risco_parcial,
           coalesce(r.motivo_area_risco, '') AS motivo_area_risco,
           coalesce(r.codigo_area_risco, '') AS codigo_area_risco,
           coalesce(r.origem_area_risco, '') AS origem_area_risco,
           p.id AS pacote_id,
           coalesce(p.pacote_area_risco, false) AS pacote_area_risco,
           public.meli_status_normalizado(p.status, p.substatus, p.occurrence_code) AS situacao
      FROM public.meli_rotas r
      LEFT JOIN public.meli_pacotes p ON p.rota_id = r.id
      LEFT JOIN public.bases b ON b.id = r.base_id
     WHERE (r.rota_area_risco OR r.area_risco_parcial OR coalesce(p.pacote_area_risco, false))
       AND (r.base_id IS NOT NULL AND public.has_base_access(v_uid, r.base_id))
       AND (p_base_id IS NULL OR r.base_id = p_base_id)
       AND (r.data_rota = v_data)
       AND NOT public.meli_rota_pm_excluida(r.id)
       AND (p_rota IS NULL OR r.route_id ILIKE '%' || p_rota || '%' OR coalesce(r.cluster, '') ILIKE '%' || p_rota || '%')
       AND (p_motorista IS NULL OR coalesce(r.driver_name, '') ILIKE '%' || p_motorista || '%')
       AND (p_transportadora IS NULL OR coalesce(r.carrier, '') ILIKE '%' || p_transportadora || '%')
       AND (p_risco IS NULL OR p_risco = 'qualquer'
            OR (p_risco = 'integral' AND r.rota_area_risco)
            OR (p_risco = 'parcial' AND r.area_risco_parcial AND NOT r.rota_area_risco))
  ), pac_f AS (
    SELECT * FROM pac
     WHERE p_status IS NULL
        OR (pacote_id IS NOT NULL AND situacao = p_status)
  ), rotas AS (
    SELECT rota_id, route_id, cluster, base_id, base_codigo, base_nome,
           driver_name, vehicle_license, carrier, data_rota,
           max(last_synced_at) AS last_synced_at,
           bool_or(rota_area_risco) AS rota_area_risco,
           bool_or(area_risco_parcial) AS area_risco_parcial,
           max(motivo_area_risco) AS motivo_area_risco,
           max(codigo_area_risco) AS codigo_area_risco,
           max(origem_area_risco) AS origem_area_risco,
           count(pacote_id)::int AS total,
           count(pacote_id) FILTER (WHERE pacote_area_risco OR rota_area_risco)::int AS pacotes_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'entregue')::int AS entregue_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao IN ('nao_iniciado','em_rota','desconhecido'))::int AS pendente_risco,
           count(pacote_id) FILTER (WHERE (pacote_area_risco OR rota_area_risco) AND situacao = 'insucesso')::int AS insucesso_risco
      FROM pac_f
     GROUP BY rota_id, route_id, cluster, base_id, base_codigo, base_nome,
              driver_name, vehicle_license, carrier, data_rota
  )
  SELECT jsonb_build_object(
    'status', 'ok',
    'data_operacional', v_data,
    'server_time', now(),
    'cards', (
      SELECT jsonb_build_object(
        'rotas', coalesce(count(*), 0),
        'rotas_integrais', coalesce(count(*) FILTER (WHERE rota_area_risco), 0),
        'rotas_parciais', coalesce(count(*) FILTER (WHERE area_risco_parcial AND NOT rota_area_risco), 0),
        'pacotes', coalesce(sum(pacotes_risco), 0),
        'entregue', coalesce(sum(entregue_risco), 0),
        'pendente', coalesce(sum(pendente_risco), 0),
        'insucesso', coalesce(sum(insucesso_risco), 0),
        'perc_conclusao', CASE WHEN coalesce(sum(pacotes_risco), 0) > 0
          THEN round(100.0 * sum(entregue_risco) / sum(pacotes_risco), 1) ELSE 0 END,
        'ultima_sincronizacao', max(last_synced_at)
      ) FROM rotas
    ),
    'rotas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'rota_id', rota_id,
        'route_id', route_id,
        'cluster', cluster,
        'base_id', base_id,
        'base_codigo', base_codigo,
        'base_nome', base_nome,
        'driver_name', driver_name,
        'vehicle_license', vehicle_license,
        'carrier', carrier,
        'data_rota', data_rota,
        'last_synced_at', last_synced_at,
        'rota_area_risco', rota_area_risco,
        'area_risco_parcial', area_risco_parcial,
        'motivo_area_risco', nullif(motivo_area_risco, ''),
        'codigo_area_risco', nullif(codigo_area_risco, ''),
        'origem_area_risco', nullif(origem_area_risco, ''),
        'total', total,
        'pacotes_risco', pacotes_risco,
        'entregue_risco', entregue_risco,
        'pendente_risco', pendente_risco,
        'insucesso_risco', insucesso_risco,
        'perc_conclusao', CASE WHEN pacotes_risco > 0
          THEN round(100.0 * entregue_risco / pacotes_risco, 1) ELSE 0 END
      ) ORDER BY pacotes_risco DESC, route_id)
      FROM rotas
    ), '[]'::jsonb)
  ) INTO v_res;

  RETURN v_res;
END;
$function$;
-- ==== fim 20260901161603_incluir_rotas_rostering_sem_pacotes.sql ====

-- ==== inicio 20260908142535_dashboard_geral_multibase.sql ====
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
-- ==== fim 20260908142535_dashboard_geral_multibase.sql ====

-- ==== inicio 20260908162145_dashboard_geral_tempo_real.sql ====
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
-- ==== fim 20260908162145_dashboard_geral_tempo_real.sql ====

-- ==== inicio 20260908221127_monitoramento_snapshots.sql ====
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
-- ==== fim 20260908221127_monitoramento_snapshots.sql ====

-- ==== inicio 20260908221509_dashboard_geral_service_role.sql ====
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
-- ==== fim 20260908221509_dashboard_geral_service_role.sql ====

-- ==== inicio 20260908221956_dashboard_geral_planilha_gestao.sql ====
-- Dashboard Geral no formato oficial da planilha diária da gestão.
UPDATE public.meli_unidades_operacionais SET ativo=false
WHERE codigo NOT IN ('SSP3','SSP38','ESP15','SSP5','SSP20','ESP17','ESP16','SSP17','SSP6','SSP45','SSP15','SSP37','SSP23','SSC2','ESP18');
UPDATE public.meli_unidades_operacionais SET
  nome=CASE codigo WHEN 'ESP17' THEN 'XPT Embu Guaçu' WHEN 'ESP18' THEN 'Atibaia' ELSE nome END,
  cidade=CASE codigo WHEN 'ESP17' THEN 'Embu Guaçu' WHEN 'ESP18' THEN 'Atibaia' ELSE cidade END,
  tipo=CASE WHEN codigo LIKE 'ESP%' THEN 'XPT' ELSE 'SERVICE' END,
  updated_at=now()
WHERE ativo;

CREATE OR REPLACE FUNCTION public.meli_dashboard_geral(p_data date DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
WITH ref AS (SELECT COALESCE(p_data,(now() AT TIME ZONE 'America/Sao_Paulo')::date) dia),
ocorrencias AS (
 SELECT b.codigo,
   count(p.id) FILTER (WHERE public.meli_status_normalizado(p.status,p.substatus,p.occurrence_code)='cancelado')::int dc_cancelado,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('damaged','lost','stolen'))::int sinistros,
   count(p.id) FILTER (WHERE lower(coalesce(p.occurrence_code,'')) IN ('pnr','package_not_received','parcel_not_received','buyer_not_received','recipient_not_received'))::int pnr
 FROM public.bases b JOIN public.meli_rotas_ativas r ON r.base_id=b.id CROSS JOIN ref
 LEFT JOIN public.meli_pacotes p ON p.rota_id=r.id
 WHERE r.data_rota=ref.dia AND NOT public.meli_rota_pm_excluida(r.id)
 GROUP BY b.codigo
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
$$;
REVOKE ALL ON FUNCTION public.meli_dashboard_geral(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meli_dashboard_geral(date) TO authenticated,service_role;
-- ==== fim 20260908221956_dashboard_geral_planilha_gestao.sql ====

-- ==== inicio 20260908223536_monitoramento_updated_at.sql ====
ALTER TABLE public.meli_monitoramento_snapshots
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
-- ==== fim 20260908223536_monitoramento_updated_at.sql ====
