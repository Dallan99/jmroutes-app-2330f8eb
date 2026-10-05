-- Pagamentos de Motoristas — estrutura (PROPOSTA, NÃO APLICADA)
-- Aplicar no banco novo (Novo JMRoutes) depois do replay 01..09.
-- Etapa 1 usa: tarifas, veículos por placa, adicionais.
-- Fechamento/aprovação/auditoria: tabelas criadas, sem fluxo no app ainda.

create table if not exists public.pagamento_tarifas (
  id uuid primary key default gen_random_uuid(),
  tipo_veiculo text not null check (tipo_veiculo in ('carro','utilitario','vuc')),
  base_id uuid references public.bases(id),
  regiao text,
  valor numeric(12,2) not null check (valor >= 0),
  vigencia_inicio date not null default '2026-01-01',
  vigencia_fim date,
  ativo boolean not null default true,
  criado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists pagamento_tarifas_uk
  on public.pagamento_tarifas (tipo_veiculo, coalesce(base_id,'00000000-0000-0000-0000-000000000000'::uuid), coalesce(regiao,''), vigencia_inicio);

-- Classificação por placa com vigência: mudar categoria = nova linha (histórico preservado).
create table if not exists public.pagamento_veiculos (
  id uuid primary key default gen_random_uuid(),
  placa text not null check (placa ~ '^[A-Z0-9]{5,8}$'),
  tipo_veiculo text not null check (tipo_veiculo in ('carro','utilitario','vuc')),
  base_padrao_id uuid references public.bases(id),
  descricao text,
  ativo boolean not null default true,
  vigencia_inicio date not null default current_date,
  observacao text,
  criado_por uuid not null default auth.uid(),
  atualizado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (placa, vigencia_inicio)
);

create or replace function public.pagamento_veiculos_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.tipo_veiculo is distinct from old.tipo_veiculo or new.vigencia_inicio is distinct from old.vigencia_inicio then
      raise exception 'Categoria e vigência não podem ser alteradas: cadastre uma nova vigência.';
    end if;
    new.updated_at := now();
    new.atualizado_por := auth.uid();
  end if;
  insert into public.pagamento_auditoria (entidade, entidade_id, acao, motivo, antes, depois, base_id, usuario_id)
  values ('pagamento_veiculos', new.placa, lower(tg_op), new.observacao,
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new), new.base_padrao_id, auth.uid());
  return new;
end $$;

create table if not exists public.pagamento_adicionais (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  base_id uuid not null references public.bases(id),
  motorista_chave text not null,
  motorista_nome text,
  valor numeric(12,2) not null,
  motivo text not null check (motivo in ('domingo','feriado','rota_extra','ajuda_custo','ajuste','outro')),
  observacao text,
  data_relacionada date,
  lancado_por uuid not null default auth.uid(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Estrutura futura: fechamento versionado e imutável após aprovação
create table if not exists public.pagamento_fechamentos (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  semana_fim date not null,
  pagamento_previsto date not null,
  versao int not null default 1,
  status text not null default 'em_apuracao' check (status in ('em_apuracao','conferido','aprovado','programado','pago','bloqueado')),
  total_rotas numeric(14,2) not null default 0,
  total_adicionais numeric(14,2) not null default 0,
  total_geral numeric(14,2) not null default 0,
  conferido_por uuid, conferido_em timestamptz,
  aprovado_por uuid, aprovado_em timestamptz,
  criado_por uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (semana_inicio, versao)
);

create table if not exists public.pagamento_fechamento_rotas (
  id uuid primary key default gen_random_uuid(),
  fechamento_id uuid not null references public.pagamento_fechamentos(id) on delete restrict,
  semana_inicio date not null,
  route_id text not null,
  motorista_chave text not null,
  motorista_nome text,
  base_id uuid references public.bases(id),
  placa text,
  tipo_veiculo text,
  data_rota date,
  total_pedidos int,
  entregues int,
  percentual numeric(6,2),
  pagavel boolean not null,
  tarifa_aplicada numeric(12,2),
  valor numeric(12,2) not null default 0,
  origem text not null default 'meli_rotas',
  created_at timestamptz not null default now(),
  unique (fechamento_id, motorista_chave, route_id)
);

create table if not exists public.pagamento_auditoria (
  id uuid primary key default gen_random_uuid(),
  entidade text not null,
  entidade_id text not null,
  acao text not null,
  motivo text,
  antes jsonb,
  depois jsonb,
  base_id uuid,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_pagamento_veiculos_auditar on public.pagamento_veiculos;
create trigger trg_pagamento_veiculos_auditar before insert or update on public.pagamento_veiculos
  for each row execute function public.pagamento_veiculos_auditar();

grant select, insert, update on public.pagamento_tarifas, public.pagamento_veiculos, public.pagamento_adicionais, public.pagamento_fechamentos, public.pagamento_fechamento_rotas to authenticated;
grant select, insert on public.pagamento_auditoria to authenticated;
grant all on public.pagamento_tarifas, public.pagamento_veiculos, public.pagamento_adicionais, public.pagamento_fechamentos, public.pagamento_fechamento_rotas, public.pagamento_auditoria to service_role;

alter table public.pagamento_tarifas enable row level security;
alter table public.pagamento_veiculos enable row level security;
alter table public.pagamento_adicionais enable row level security;
alter table public.pagamento_fechamentos enable row level security;
alter table public.pagamento_fechamento_rotas enable row level security;
alter table public.pagamento_auditoria enable row level security;

-- Gestão (admin/gerente/supervisor) lê; só admin/gerente altera tarifas e placas.
do $$
declare t text;
begin
  foreach t in array array['pagamento_tarifas','pagamento_adicionais','pagamento_fechamentos','pagamento_fechamento_rotas','pagamento_auditoria'] loop
    execute format('drop policy if exists "gestao le %1$s" on public.%1$s', t);
    execute format($p$create policy "gestao le %1$s" on public.%1$s for select to authenticated using (
      public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente') or public.has_role(auth.uid(),'supervisor'))$p$, t);
  end loop;
end $$;

create policy "gestao edita tarifas" on public.pagamento_tarifas for all to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente'));
-- Veículos: qualquer usuário autenticado lê; admin/gerente/supervisor cadastram e editam (sem apagar).
create policy "autenticados leem veiculos" on public.pagamento_veiculos for select to authenticated using (true);
create policy "gestao cadastra veiculos" on public.pagamento_veiculos for insert to authenticated
  with check (criado_por = auth.uid() and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente') or public.has_role(auth.uid(),'supervisor')));
create policy "gestao edita veiculos" on public.pagamento_veiculos for update to authenticated
  using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente') or public.has_role(auth.uid(),'supervisor'))
  with check (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente') or public.has_role(auth.uid(),'supervisor'));
create policy "gestao lanca adicionais" on public.pagamento_adicionais for insert to authenticated
  with check (lancado_por = auth.uid() and (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'gerente') or public.has_role(auth.uid(),'supervisor')));
create policy "auditoria insere" on public.pagamento_auditoria for insert to authenticated
  with check (usuario_id = auth.uid());
-- Fechamentos: sem política de escrita até a etapa 2 (só leitura).

-- Tarifas iniciais gerais
insert into public.pagamento_tarifas (tipo_veiculo, valor) values
  ('carro',200),('utilitario',300),('vuc',500)
on conflict do nothing;
