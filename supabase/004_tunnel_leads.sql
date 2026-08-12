-- Leads tunnels marketing (offre 29€, 259€, séance d'essai, parrainage pote)
-- Même schéma que gestion-manager/supabase/015_tunnel_leads.sql (projet Supabase partagé).
-- À exécuter dans le SQL Editor Supabase si l'erreur PostgREST
-- « Could not find the table 'public.tunnel_leads' in the schema cache » apparaît.

CREATE TABLE IF NOT EXISTS public.tunnel_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tunnel TEXT NOT NULL
    CHECK (tunnel IN ('offre_29', 'offre_259', 'seance_essai', 'referral_pote')),
  prenom TEXT,
  nom TEXT,
  telephone TEXT,
  email TEXT,
  salle TEXT,
  referrer_prenom TEXT,
  referrer_nom TEXT,
  referrer_phone TEXT,
  meta JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tunnel_leads_tunnel_created_idx
  ON public.tunnel_leads (tunnel, created_at DESC);

CREATE INDEX IF NOT EXISTS tunnel_leads_telephone_idx
  ON public.tunnel_leads (telephone)
  WHERE telephone IS NOT NULL AND telephone <> '';

-- Service role (BOXPLUS) bypasse RLS ; pas de policies anon.
ALTER TABLE public.tunnel_leads ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
