-- Soft delete boutique : on ne detruit plus les lignes, on les archive.
-- Table d'archive + deleted_at sur les tables metier.

create table if not exists public.deleted_records (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id text not null,
  payload jsonb not null,
  deleted_at timestamptz not null default now(),
  deleted_by text
);

create index if not exists deleted_records_source_idx
  on public.deleted_records (source_table, source_id, deleted_at desc);

alter table public.deleted_records enable row level security;

alter table public.boxplus_orders add column if not exists deleted_at timestamptz;
alter table public.boxplus_materiel_orders add column if not exists deleted_at timestamptz;

create index if not exists boxplus_orders_alive_idx
  on public.boxplus_orders (updated_at desc)
  where deleted_at is null;

create index if not exists boxplus_materiel_orders_alive_idx
  on public.boxplus_materiel_orders (updated_at desc)
  where deleted_at is null;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'tunnel_leads'
  ) then
    execute 'alter table public.tunnel_leads add column if not exists deleted_at timestamptz';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'seance_offerte_leads'
  ) then
    execute 'alter table public.seance_offerte_leads add column if not exists deleted_at timestamptz';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'boxplus_billets'
  ) then
    execute 'alter table public.boxplus_billets add column if not exists deleted_at timestamptz';
  end if;
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'portet_clients'
  ) then
    execute 'alter table public.portet_clients add column if not exists deleted_at timestamptz';
  end if;
end $$;
