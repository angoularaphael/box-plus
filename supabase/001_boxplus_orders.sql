-- Commandes tunnel inscription (persistance Vercel serverless)
create table if not exists public.boxplus_orders (
  order_id text primary key,
  access_token text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists boxplus_orders_updated_at_idx on public.boxplus_orders (updated_at desc);

-- Config boutique (merchandising admin) — persistance Vercel
create table if not exists public.boxplus_store_config (
  key text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.boxplus_store_config enable row level security;
