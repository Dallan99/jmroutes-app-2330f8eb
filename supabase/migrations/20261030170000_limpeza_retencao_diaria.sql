CREATE OR REPLACE FUNCTION public.limpeza_diaria_retencao()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  inicio timestamptz := clock_timestamp();
  n int;
  escalas_apagadas int := 0;
  pacotes_apagados int := 0;
  copias_apagadas int := 0;
  ciclos_apagados int := 0;
BEGIN
  DELETE FROM public.meli_piloto_staging WHERE created_at < now() - interval '2 days';
  GET DIAGNOSTICS n = ROW_COUNT; copias_apagadas := copias_apagadas + n;
  DELETE FROM public.meli_piloto_paginas WHERE created_at < now() - interval '2 days';
  GET DIAGNOSTICS n = ROW_COUNT; copias_apagadas := copias_apagadas + n;
  DELETE FROM public.meli_piloto_erros WHERE ocorrido_em < now() - interval '10 days';

  LOOP
    DELETE FROM public.escalas WHERE id IN (
      SELECT e.id FROM public.escalas e
      WHERE e.data_referencia < current_date - 10
        AND NOT EXISTS (SELECT 1 FROM public.devolucoes d WHERE d.escala_id = e.id)
      LIMIT 5000);
    GET DIAGNOSTICS n = ROW_COUNT; escalas_apagadas := escalas_apagadas + n;
    EXIT WHEN n = 0 OR clock_timestamp() - inicio > interval '5 minutes';
  END LOOP;

  LOOP
    DELETE FROM public.meli_piloto_pacotes WHERE id IN (
      SELECT k.id FROM public.meli_piloto_pacotes k
      WHERE k.coletado_em < now() - interval '10 days'
        AND NOT EXISTS (SELECT 1 FROM public.escalas e WHERE e.meli_pacote_id = k.id)
        AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_rotas r WHERE r.route_id = k.route_id AND r.data_rota >= current_date - 10)
      LIMIT 5000);
    GET DIAGNOSTICS n = ROW_COUNT; pacotes_apagados := pacotes_apagados + n;
    EXIT WHEN n = 0 OR clock_timestamp() - inicio > interval '10 minutes';
  END LOOP;

  DELETE FROM public.meli_piloto_ciclos c
  WHERE c.iniciado_em < now() - interval '10 days'
    AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_pacotes k WHERE k.ultimo_ciclo_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_rotas r WHERE r.primeiro_ciclo_id = c.id OR r.ultimo_ciclo_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_erros x WHERE x.ciclo_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_staging s WHERE s.ciclo_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM public.meli_piloto_paginas p WHERE p.ciclo_id = c.id);
  GET DIAGNOSTICS ciclos_apagados = ROW_COUNT;

  RETURN jsonb_build_object('escalas', escalas_apagadas, 'pacotes', pacotes_apagados,
    'copias', copias_apagadas, 'ciclos', ciclos_apagados,
    'segundos', round(extract(epoch FROM clock_timestamp() - inicio)));
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.limpeza_diaria_retencao() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule('limpeza-retencao-10-dias', '17 6 * * *', 'SELECT public.limpeza_diaria_retencao()');

SELECT public.limpeza_diaria_retencao() AS primeira_execucao;
