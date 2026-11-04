create table if not exists public.meli_monitoramento_rotas (
  id uuid primary key default gen_random_uuid(),
  data_operacional date not null,
  base_codigo text not null,
  service_center_id text not null,
  route_id text not null,
  nome_rota text,
  motorista text,
  placa text,
  status text,
  substatus text,
  total integer not null default 0 check (total >= 0),
  entregues integer not null default 0 check (entregues >= 0),
  falhas integer not null default 0 check (falhas >= 0),
  pendentes integer not null default 0 check (pendentes >= 0),
  sacas integer not null default 0 check (sacas >= 0),
  saida_xpt_em timestamptz,
  primeira_entrega_em timestamptz,
  coletado_em timestamptz not null,
  constraint meli_monitoramento_rotas_unica unique (data_operacional, base_codigo, route_id)
);

alter table public.meli_monitoramento_rotas enable row level security;
revoke all on table public.meli_monitoramento_rotas from public, anon, authenticated;
grant select, insert, update, delete on table public.meli_monitoramento_rotas to service_role;

create index if not exists meli_monitoramento_rotas_base_dia_idx
  on public.meli_monitoramento_rotas (base_codigo, data_operacional, coletado_em desc)
  include (route_id, total, entregues, falhas, pendentes, status);

create index if not exists meli_monitoramento_rotas_retencao_idx
  on public.meli_monitoramento_rotas (data_operacional);

create or replace function public.meli_monitoramento_rotas_upsert(
  p_data_operacional date,
  p_base_codigo text,
  p_service_center_id text,
  p_coletado_em timestamptz,
  p_rotas jsonb
) returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_quantidade integer := 0;
begin
  if jsonb_typeof(p_rotas) <> 'array' then
    raise exception 'p_rotas deve ser uma lista';
  end if;

  insert into public.meli_monitoramento_rotas (
    data_operacional, base_codigo, service_center_id, route_id, nome_rota,
    motorista, placa, status, substatus, total, entregues, falhas, pendentes,
    sacas, saida_xpt_em, primeira_entrega_em, coletado_em
  )
  select
    p_data_operacional,
    upper(trim(p_base_codigo)),
    upper(trim(p_service_center_id)),
    r.route_id,
    nullif(trim(r.nome_rota), ''),
    nullif(trim(r.motorista), ''),
    nullif(trim(r.placa), ''),
    nullif(trim(r.status), ''),
    nullif(trim(r.substatus), ''),
    greatest(coalesce(r.total, 0), 0),
    greatest(coalesce(r.entregues, 0), 0),
    greatest(coalesce(r.falhas, 0), 0),
    greatest(coalesce(r.pendentes, 0), 0),
    greatest(coalesce(r.sacas, 0), 0),
    coalesce(
      r.saida_xpt_em,
      case when lower(coalesce(r.status, '')) in ('active', 'in_route', 'started') then p_coletado_em end
    ),
    coalesce(
      r.primeira_entrega_em,
      case when coalesce(r.entregues, 0) > 0 then p_coletado_em end
    ),
    p_coletado_em
  from jsonb_to_recordset(p_rotas) as r(
    route_id text,
    nome_rota text,
    motorista text,
    placa text,
    status text,
    substatus text,
    total integer,
    entregues integer,
    falhas integer,
    pendentes integer,
    sacas integer,
    saida_xpt_em timestamptz,
    primeira_entrega_em timestamptz
  )
  where nullif(trim(r.route_id), '') is not null
  on conflict (data_operacional, base_codigo, route_id) do update set
    service_center_id = excluded.service_center_id,
    nome_rota = coalesce(excluded.nome_rota, meli_monitoramento_rotas.nome_rota),
    motorista = coalesce(excluded.motorista, meli_monitoramento_rotas.motorista),
    placa = coalesce(excluded.placa, meli_monitoramento_rotas.placa),
    status = coalesce(excluded.status, meli_monitoramento_rotas.status),
    substatus = coalesce(excluded.substatus, meli_monitoramento_rotas.substatus),
    total = excluded.total,
    entregues = excluded.entregues,
    falhas = excluded.falhas,
    pendentes = excluded.pendentes,
    sacas = excluded.sacas,
    saida_xpt_em = coalesce(meli_monitoramento_rotas.saida_xpt_em, excluded.saida_xpt_em),
    primeira_entrega_em = coalesce(
      meli_monitoramento_rotas.primeira_entrega_em,
      case
        when meli_monitoramento_rotas.entregues = 0 and excluded.entregues > 0 then excluded.coletado_em
        else excluded.primeira_entrega_em
      end
    ),
    coletado_em = excluded.coletado_em;

  get diagnostics v_quantidade = row_count;

  -- Retenção curta: um registro atual por rota/dia e somente os últimos 10 dias.
  delete from public.meli_monitoramento_rotas
  where data_operacional < current_date - 10;

  return v_quantidade;
end;
$$;

revoke all on function public.meli_monitoramento_rotas_upsert(date, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.meli_monitoramento_rotas_upsert(date, text, text, timestamptz, jsonb)
  to service_role;

