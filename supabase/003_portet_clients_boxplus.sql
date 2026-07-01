-- Compat gestion-manager : clients BOXPLUS (à exécuter dans Supabase SQL Editor)
ALTER TABLE portet_clients DROP CONSTRAINT IF EXISTS portet_clients_source_check;
ALTER TABLE portet_clients ADD CONSTRAINT portet_clients_source_check
  CHECK (source IN ('chatbot', 'csv', 'xls', 'manual', 'boxplus'));

ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS date_naissance DATE;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS adresse TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS code_postal TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS ville TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS contact_urgence TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS info_medicale TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS offre TEXT;
