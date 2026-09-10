-- Champs tuteur / documents inscriptions Portet (BOXPLUS)
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS tuteur_prenom TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS tuteur_nom TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS tuteur_telephone TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS tuteur_email TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE portet_clients ADD COLUMN IF NOT EXISTS id_document_url TEXT;
