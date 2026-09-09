-- A tabela pode ter sido criada anteriormente por uma versão parcial. Remove
-- duplicatas preservando a leitura mais recente antes de garantir a chave.
DELETE FROM public.meli_monitoramento_snapshots antigo
USING public.meli_monitoramento_snapshots recente
WHERE antigo.base_codigo=recente.base_codigo
  AND antigo.data_operacional=recente.data_operacional
  AND (antigo.coletado_em<recente.coletado_em OR (antigo.coletado_em=recente.coletado_em AND antigo.id<recente.id));

CREATE UNIQUE INDEX IF NOT EXISTS meli_monitoramento_base_dia_uidx
  ON public.meli_monitoramento_snapshots(base_codigo,data_operacional);
