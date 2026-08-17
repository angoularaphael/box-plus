-- Optionnel : table dédiée séance offerte (même projet que tunnel_leads).
-- Les leads partent déjà dans public.tunnel_leads (tunnel = seance_essai).
-- À coller dans le SQL Editor si on veut une table séparée.

create extension if not exists pgcrypto;

create table if not exists public.seance_offerte_leads (
  id text primary key,
  prenom text,
  nom text,
  email text,
  tel text,
  naissance text,
  sexe text,
  salle text,
  salle_label text,
  jour text,
  jour_nom text,
  visit_date date,
  src text,
  ami jsonb,
  jobs jsonb,
  dry_run boolean default false,
  has_sale boolean default false,
  status text,
  deciplus_member_id text,
  prospect_relance_at timestamptz,
  manager_relance_at timestamptz,
  last_error text,
  last_check_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists seance_offerte_leads_visit_idx
  on public.seance_offerte_leads (visit_date, status);

alter table public.seance_offerte_leads enable row level security;
grant all on public.seance_offerte_leads to service_role;
notify pgrst, 'reload schema';
