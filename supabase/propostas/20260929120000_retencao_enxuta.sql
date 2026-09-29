-- =============================================================================
-- PROPOSTA — NÃO APLICADA
-- Retenção "banco enxuto" para o plano gratuito (limite 500 MB)
-- Projeto: homologação ieqvzndvkzozqvseubuc
--
-- Contexto (medição de 29/09/2026):
--   banco 1.558 MB | escalas 764 MB | meli_pacotes 533 MB | demais 260 MB
--   default_transaction_read_only = on  ->  NENHUMA escrita roda hoje
--   (nem CREATE TABLE, nem DELETE, nem VACUUM). Aplicar este arquivo depende
--   primeiro de destravar a escrita; ver docs/retencao-dados.md.
--
-- O que este arquivo faz (aditivo, reversível):
--   1. escala_resumo_diario_base  -> 1 linha por base por dia (substitui o
--      detalhe da escala na consulta histórica; ~6.200 linhas/ano)
--   2. meli_manutencao_log        -> registro auditável de cada execução
--   3. escala_resumo_consolidar() -> preenche/atualiza o resumo (idempotente)
--   4. meli_manutencao_retencao() -> apaga o detalhe antigo em lotes, com
--      commits parciais, preservando trilha de auditoria
--   5. agendamento pg_cron (já instalado) todo dia às 01:30
--
-- NADA aqui altera painéis, login, RLS existente, worker, nem regras de negócio.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) Resumo diário de escala por base
-- -----------------------------------------------------------------------------
create table if not exists public.escala_resumo_diario_base (
  id                uuid primary key default gen_random_uuid(),
  base_id           uuid not null references public.bases(id) on delete cascade,
  data_referencia   date not null,
  rotas             integer not null default 0,
  veiculos          integer not null default 0,
  motoristas        integer not null default 0,
  pacotes           integer not null default 0,
  triadas           integer not null default 0,
  recebidas         integer not null default 0,
  devolvidas        integer not null default 0,
  sem_base          integer not null default 0,
  consolidado_em    timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint escala_resumo_diario_base_unico unique (base_id, data_referencia)
);

comment on table public.escala_resumo_diario_base is
  'Resumo diário por base da escala importada; permite apagar o detalhe de escalas antigo sem perder a série histórica.';

-- GRANTS obrigatórios (o Data API não recebe privilégios padrão no schema public)
grant select on public.escala_resumo_diario_base to authenticated;
grant all on public.escala_resumo_diario_base to service_role;

alter table public.escala_resumo_diario_base enable row level security;

drop policy if exists "base access leem resumo diario escala" on public.escala_resumo_diario_base;
create policy "base access leem resumo diario escala"
  on public.escala_resumo_diario_base for select
  to authenticated
  using (public.has_base_access(auth.uid(), base_id));

-- Escrita apenas pela rotina de manutenção (SECURITY DEFINER); sem policy de escrita
-- para usuários comuns, de propósito.

drop trigger if exists trg_escala_resumo_diario_base_updated_at on public.escala_resumo_diario_base;
create trigger trg_escala_resumo_diario_base_updated_at
  before update on public.escala_resumo_diario_base
  for each row execute function public.tg_touch_updated_at();

-- -----------------------------------------------------------------------------
-- 2) Log auditável das execuções de manutenção
-- -----------------------------------------------------------------------------
create table if not exists public.meli_manutencao_log (
  id             uuid primary key default gen_random_uuid(),
  janela         text not null,
  parametros     jsonb not null default '{}'::jsonb,
  resultado      jsonb not null default '{}'::jsonb,
  status         text not null default 'em_andamento',
  iniciado_em    timestamptz not null default now(),
  finalizado_em  timestamptz,
  duracao_ms     integer
);

comment on table public.meli_manutencao_log is
  'Histórico de cada execução da rotina de retenção: o que foi consolidado e apagado, quando e com quais critérios.';

grant select on public.meli_manutencao_log to authenticated;
grant all on public.meli_manutencao_log to service_role;

alter table public.meli_manutencao_log enable row level security;

drop policy if exists "gestao le log manutencao" on public.meli_manutencao_log;
create policy "gestao le log manutencao"
  on public.meli_manutencao_log for select
  to authenticated
  using (public.meli_pode_operar());

-- -----------------------------------------------------------------------------
-- 3) Consolidação do resumo (idempotente: pode rodar de novo no mesmo dia)
-- -----------------------------------------------------------------------------
create or replace function public.escala_resumo_consolidar(p_data date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linhas integer;
begin
  insert into public.escala_resumo_diario_base as r (
    base_id, data_referencia, rotas, veiculos, motoristas, pacotes,
    triadas, recebidas, devolvidas, consolidado_em
  )
  select
    e.base_id,
    e.data_referencia,
    count(*),
    count(distinct nullif(btrim(e.placa), '')),
    count(distinct nullif(btrim(e.driver), '')),
    coalesce(sum(e.pacotes), 0),
    count(*) filter (where e.triado),
    count(*) filter (where e.recebido),
    count(*) filter (where e.devolvido),
    now()
  from public.escalas e
  where e.data_referencia = p_data
    and e.base_id is not null
  group by e.base_id, e.data_referencia
  on conflict (base_id, data_referencia) do update set
    rotas          = excluded.rotas,
    veiculos       = excluded.veiculos,
    motoristas     = excluded.motoristas,
    pacotes        = excluded.pacotes,
    triadas        = excluded.triadas,
    recebidas      = excluded.recebidas,
    devolvidas     = excluded.devolvidas,
    consolidado_em = excluded.consolidado_em;

  get diagnostics v_linhas = row_count;
  return v_linhas;
end;
$$;

comment on function public.escala_resumo_consolidar(date) is
  'Soma a escala de um dia no resumo por base. Pode ser executada quantas vezes quiser: o resultado é o mesmo.';

-- -----------------------------------------------------------------------------
-- 4) Rotina de manutenção: consolida e apaga o detalhe antigo em lotes
-- -----------------------------------------------------------------------------
-- Parâmetros de janela (dias). Ajuste fino sem mexer em código:
create or replace function public.meli_manutencao_retencao(
  p_dias_detalhe        integer default 7,    -- escalas e meli_pacotes
  p_dias_payload        integer default 7,    -- cru de importação
  p_dias_execucoes      integer default 30,   -- telemetria do coletor
  p_dias_importacoes    integer default 90,   -- log de importação
  p_dias_eventos        integer default 180,  -- trilha de devoluções (auditoria)
  p_lote                integer default 20000,
  p_consolidar          boolean default true,
  p_apagar              boolean default true  -- false = só mede, não apaga
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_log      uuid;
  v_ini      timestamptz := clock_timestamp();
  v_corte    timestamptz;
  v_data_ini date;
  v_data_fim date;
  v_dia      date;
  v_res      jsonb := '{}'::jsonb;
  v_tot      bigint;
  v_n        bigint;
begin
  -- Trava de segurança: quem estiver autenticado precisa ser da gestão.
  if auth.uid() is not null and not public.meli_pode_operar() then
    raise exception 'sem permissao para executar a manutencao';
  end if;

  if p_dias_detalhe < 1 or p_lote < 100 or p_lote > 100000 then
    raise exception 'parametros fora dos limites seguros';
  end if;

  insert into public.meli_manutencao_log (janela, parametros)
  values ('retencao_enxuta', to_jsonb(
    p_dias_detalhe || '/' || p_dias_payload || '/' || p_dias_execucoes || '/' ||
    p_dias_importacoes || '/' || p_dias_eventos
  ))
  returning id into v_log;

  -- 4.1 Consolida o resumo de tudo que está fora da janela de detalhe.
  if p_consolidar then
    v_data_fim := (current_date - p_dias_detalhe);
    select min(data_referencia) into v_data_ini from public.escalas;
    if v_data_ini is not null then
      v_dia := v_data_ini;
      v_tot := 0;
      while v_dia <= v_data_fim loop
        v_tot := v_tot + public.escala_resumo_consolidar(v_dia);
        v_dia := v_dia + 1;
      end loop;
      v_res := v_res || jsonb_build_object('resumo_consolidado', v_tot);
    end if;
  end if;

  -- 4.2 Apaga em lotes, com commit entre lotes (evita trancao longa e trava).
  if p_apagar then
    -- meli_pacotes: detalhe de pacote (nisto referencia esta tabela; FK de
    -- meli_tracking_eventos e ON DELETE SET NULL).
    v_corte := now() - make_interval(days => p_dias_detalhe);
    v_tot := 0;
    loop
      delete from public.meli_pacotes p
       where p.id in (
         select id from public.meli_pacotes
          where created_at < v_corte
          order by created_at
          limit p_lote
       );
      get diagnostics v_n = row_count;
      v_tot := v_tot + v_n;
      exit when v_n = 0;
      commit;
    end loop;
    v_res := v_res || jsonb_build_object('meli_pacotes_apagados', v_tot);

    -- escalas: mantem as que tem leitura de expedicao registrada (evidencia).
    v_data_ini := current_date - p_dias_detalhe;
    v_tot := 0;
    loop
      delete from public.escalas e
       where e.id in (
         select id from public.escalas e2
          where e2.data_referencia < v_data_ini
            and not exists (
              select 1 from public.expedicao_leituras l where l.escala_id = e2.id
            )
          order by data_referencia
          limit p_lote
       );
      get diagnostics v_n = row_count;
      v_tot := v_tot + v_n;
      exit when v_n = 0;
      commit;
    end loop;
    v_res := v_res || jsonb_build_object('escalas_apagadas', v_tot);

    -- cru de importacao
    v_corte := now() - make_interval(days => p_dias_payload);
    delete from public.meli_rotas_payload where created_at < v_corte;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object('payload_apagado', v_n);

    -- telemetria do coletor
    v_corte := now() - make_interval(days => p_dias_execucoes);
    delete from public.meli_worker_execucoes where created_at < v_corte;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object('execucoes_apagadas', v_n);

    -- log de importacao
    v_corte := now() - make_interval(days => p_dias_importacoes);
    delete from public.meli_importacoes where created_at < v_corte;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object('importacoes_apagadas', v_n);

    -- trilha de devolucoes (auditoria mais longa)
    v_corte := now() - make_interval(days => p_dias_eventos);
    delete from public.meli_devolucoes_eventos where created_at < v_corte;
    get diagnostics v_n = row_count;
    v_res := v_res || jsonb_build_object('eventos_devolucao_apagados', v_n);
  end if;

  update public.meli_manutencao_log
     set status = 'concluido',
         resultado = v_res,
         finalizado_em = now(),
         duracao_ms = (extract(epoch from (clock_timestamp() - v_ini)) * 1000)::integer
   where id = v_log;

  return v_res;
end;
$$;

comment on function public.meli_manutencao_retencao(integer,integer,integer,integer,integer,integer,boolean,boolean) is
  'Rotina de retencao: consolida resumos e remove detalhe antigo em lotes. p_apagar=false roda em modo simulacao.';

-- Execucao apenas pelo agendamento (service_role / postgres). Sem grant para
-- authenticated: nenhum usuario comum consegue disparar a limpeza pela tela.
revoke all on function public.meli_manutencao_retencao(integer,integer,integer,integer,integer,integer,boolean,boolean) from public;
revoke all on function public.meli_manutencao_retencao(integer,integer,integer,integer,integer,integer,boolean,boolean) from authenticated;
grant execute on function public.meli_manutencao_retencao(integer,integer,integer,integer,integer,integer,boolean,boolean) to service_role;

commit;

-- -----------------------------------------------------------------------------
-- 5) Agendamento (rodar depois, em uma execucao separada)
-- -----------------------------------------------------------------------------
-- select cron.schedule(
--   'meli-retencao-enxuta',
--   '30 1 * * *',
--   $$select public.meli_manutencao_retencao(p_dias_detalhe => 7)$$
-- );
--
-- Primeira execucao (simulacao, nao apaga nada):
--   select public.meli_manutencao_retencao(p_apagar => false);
--
-- Liberar o espaco fisico no disco depois do primeiro apagao (rodar sozinho,
-- fora de qualquer trancao):
--   VACUUM FULL public.meli_pacotes;
--   VACUUM FULL public.escalas;
--   VACUUM FULL public.meli_devolucoes_eventos;
--   VACUUM FULL public.meli_importacoes;
--   VACUUM FULL public.meli_rotas_payload;
