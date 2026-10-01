-- VETFLOW v2 · Bloque F (pacientes y validaciones)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque F (pacientes y validaciones)
-- ============================================================
-- F1: teléfono normalizado (solo dígitos), para búsquedas y para un futuro link de WhatsApp.
ALTER TABLE patients  ADD COLUMN IF NOT EXISTS phone_norm TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone_norm TEXT NOT NULL DEFAULT '';
UPDATE patients  SET phone_norm = regexp_replace(phone, '\D', '', 'g') WHERE phone_norm = '' AND phone <> '';
UPDATE suppliers SET phone_norm = regexp_replace(phone, '\D', '', 'g') WHERE phone_norm = '' AND phone <> '';
