-- VETFLOW v2 · Bloque B (historia clínica)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque B (historia clínica)
-- ============================================================
-- B4: especie opcional (Perro / Gato / Ambos) en productos y servicios de vacunas. NULL = se ofrece siempre.
ALTER TABLE products ADD COLUMN IF NOT EXISTS species TEXT;
ALTER TABLE services ADD COLUMN IF NOT EXISTS species TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_species_check') THEN
    ALTER TABLE products ADD CONSTRAINT products_species_check CHECK (species IS NULL OR species IN ('Perro', 'Gato', 'Ambos'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_species_check') THEN
    ALTER TABLE services ADD CONSTRAINT services_species_check CHECK (species IS NULL OR species IN ('Perro', 'Gato', 'Ambos'));
  END IF;
END $$;
