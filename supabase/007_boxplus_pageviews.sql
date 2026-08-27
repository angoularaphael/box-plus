-- Visites boutique (persistance Vercel — le JSONL /tmp disparaît à chaque cold start)
-- À coller dans le SQL Editor si PostgREST ne trouve pas public.boxplus_pageviews.
-- Sans cette table, BOXPLUS écrit en repli dans boxplus_store_config (clés pv:…).

create extension if not exists pgcrypto;

create table if not exists public.boxplus_pageviews (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'pageview',
  path text not null default '/',
  referrer text,
  vid text,
  name text,
  props jsonb,
  ua text,
  created_at timestamptz not null default now()
);

create index if not exists boxplus_pageviews_created_idx
  on public.boxplus_pageviews (created_at desc);

create index if not exists boxplus_pageviews_type_created_idx
  on public.boxplus_pageviews (type, created_at desc);

alter table public.boxplus_pageviews enable row level security;
grant all on public.boxplus_pageviews to service_role;
notify pgrst, 'reload schema';
