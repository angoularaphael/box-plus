-- Commandes matériel (persistance Vercel serverless)
create table if not exists public.boxplus_materiel_orders (
  order_id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boxplus_materiel_orders_updated_at_idx
  on public.boxplus_materiel_orders (updated_at desc);

alter table public.boxplus_materiel_orders enable row level security;
