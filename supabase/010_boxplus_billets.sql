-- Billetterie FIGHT & Furious (Boxing Center x Moteka, 11-13 decembre 2026)
create table if not exists public.boxplus_billets (
  order_id text primary key,
  payload jsonb not null,
  email text,
  produit text,
  status text not null default 'pending',
  quantite int not null default 1,
  total_cents int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boxplus_billets_status_idx
  on public.boxplus_billets (status, updated_at desc);
create index if not exists boxplus_billets_email_idx
  on public.boxplus_billets (email);

alter table public.boxplus_billets enable row level security;

notify pgrst, 'reload schema';
