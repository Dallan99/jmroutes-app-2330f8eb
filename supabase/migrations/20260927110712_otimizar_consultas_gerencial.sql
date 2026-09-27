-- Mantém as consultas pesadas do Gerencial dentro do PostgreSQL. As funções
-- são SECURITY INVOKER (padrão), portanto continuam respeitando as RLS e as
-- bases permitidas ao usuário autenticado.

CREATE OR REPLACE FUNCTION public.gerencial_produtividade_agregada(
  p_inicio_mes timestamptz
)
RETURNS TABLE(
  dia date,
  operador_id uuid,
  nome text,
  total bigint,
  ok bigint,
  erros bigint,
  rotas bigint,
  tempo_soma numeric,
  tempo_qtd bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  SELECT
    r.created_at::date AS dia,
    r.operador_id,
    COALESCE(p.nome, p.email, '—') AS nome,
    count(*) AS total,
    count(*) FILTER (
      WHERE r.resultado = 'ok'
    ) AS ok,
    count(*) FILTER (
      WHERE r.resultado <> 'ok'
    ) AS erros,
    count(DISTINCT r.rota_id) FILTER (WHERE r.rota_id IS NOT NULL) AS rotas,
    COALESCE(sum(r.tempo_desde_ultima_ms) FILTER (
      WHERE r.tempo_desde_ultima_ms > 0 AND r.tempo_desde_ultima_ms < 300000
    ), 0)::numeric AS tempo_soma,
    count(*) FILTER (
      WHERE r.tempo_desde_ultima_ms > 0 AND r.tempo_desde_ultima_ms < 300000
    ) AS tempo_qtd
  FROM public.recebimentos r
  LEFT JOIN public.profiles p ON p.id = r.operador_id
  WHERE r.created_at >= p_inicio_mes
  GROUP BY r.created_at::date, r.operador_id, p.nome, p.email
$function$;

REVOKE ALL ON FUNCTION public.gerencial_produtividade_agregada(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerencial_produtividade_agregada(timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.gerencial_resumo_bases(
  p_inicio date,
  p_fim date
)
RETURNS TABLE(
  base_id uuid,
  codigo text,
  nome text,
  triados bigint,
  recebimentos bigint,
  devolucoes bigint,
  inventario bigint,
  transferencias bigint,
  contagens bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
  WITH
  rec AS (
    SELECT
      r.base_id,
      count(*) AS recebimentos,
      count(*) FILTER (
        WHERE r.resultado = 'ok'
      ) AS triados
    FROM public.recebimentos r
    WHERE r.data_operacional BETWEEN p_inicio AND p_fim
    GROUP BY r.base_id
  ),
  dev AS (
    SELECT d.base_id, count(*) AS devolucoes
    FROM public.devolucoes d
    WHERE d.devolvido_em >= (p_inicio::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND d.devolvido_em < ((p_fim + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
      AND NOT COALESCE(d.cancelado, false)
    GROUP BY d.base_id
  ),
  inv AS (
    SELECT i.base_id, count(*) AS inventario
    FROM public.inventario_leituras i
    WHERE i.dia_operacional BETWEEN p_inicio AND p_fim
    GROUP BY i.base_id
  ),
  tra AS (
    SELECT t.base_id, count(*) AS transferencias
    FROM public.transferencias t
    WHERE t.data_operacional BETWEEN p_inicio AND p_fim
      AND t.status <> 'cancelada'
    GROUP BY t.base_id
  ),
  con AS (
    SELECT c.base_id, count(*) AS contagens
    FROM public.contagens c
    WHERE c.data_operacional BETWEEN p_inicio AND p_fim
    GROUP BY c.base_id
  )
  SELECT
    b.id,
    b.codigo,
    b.nome,
    COALESCE(rec.triados, 0),
    COALESCE(rec.recebimentos, 0),
    COALESCE(dev.devolucoes, 0),
    COALESCE(inv.inventario, 0),
    COALESCE(tra.transferencias, 0),
    COALESCE(con.contagens, 0)
  FROM public.bases b
  LEFT JOIN rec ON rec.base_id = b.id
  LEFT JOIN dev ON dev.base_id = b.id
  LEFT JOIN inv ON inv.base_id = b.id
  LEFT JOIN tra ON tra.base_id = b.id
  LEFT JOIN con ON con.base_id = b.id
  ORDER BY b.codigo
$function$;

REVOKE ALL ON FUNCTION public.gerencial_resumo_bases(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerencial_resumo_bases(date, date) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_recebimentos_created_operador
  ON public.recebimentos (created_at, operador_id);
