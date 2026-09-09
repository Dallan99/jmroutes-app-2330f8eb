CREATE OR REPLACE FUNCTION public.gerencial_rotas_por_base(p_importacao_ids uuid[])
RETURNS TABLE(
  importacao_id uuid,
  base_operacional_id uuid,
  nro_rota text,
  motorista text,
  placa text,
  total bigint,
  triado bigint,
  devolvido bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    e.importacao_id,
    e.base_operacional_id,
    COALESCE(NULLIF(btrim(e.nro_rota), ''), '—') AS nro_rota,
    (array_agg(e.driver) FILTER (WHERE e.driver IS NOT NULL))[1] AS motorista,
    (array_agg(e.placa) FILTER (WHERE e.placa IS NOT NULL))[1] AS placa,
    count(*) AS total,
    count(*) FILTER (WHERE e.triado) AS triado,
    count(*) FILTER (WHERE e.devolvido) AS devolvido
  FROM public.escalas e
  WHERE e.importacao_id = ANY(p_importacao_ids)
    AND auth.uid() IS NOT NULL
  GROUP BY 1, 2, 3
$$;

REVOKE ALL ON FUNCTION public.gerencial_rotas_por_base(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gerencial_rotas_por_base(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.gerencial_rotas_por_base(uuid[]) TO service_role;