-- VETFLOW v2 · Bloque H (adjuntos de estudios)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque H (adjuntos de estudios, en Supabase Storage)
-- ============================================================
-- Metadatos de los archivos adjuntos a un estudio complementario. Los archivos están en el bucket privado
-- "estudios". Si el estudio va a la Papelera (G1), sus adjuntos quedan guardados con él y vuelven al restaurarlo;
-- al eliminar el estudio (o el paciente) definitivamente, se borran también los archivos del bucket.
CREATE TABLE IF NOT EXISTS study_attachments (
  id SERIAL PRIMARY KEY,
  study_id INTEGER NOT NULL REFERENCES complementary_studies(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS study_attachments_study_idx ON study_attachments(study_id);

-- Bucket PRIVADO para los archivos (opcional: el servidor también lo crea solo al arrancar si tiene
-- SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY; o podés crearlo desde Storage > New bucket).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('estudios', 'estudios', false, 10485760)
ON CONFLICT (id) DO NOTHING;
-- No hace falta ninguna política (policy): solo el servidor accede, con la clave service_role (que se
-- salta RLS). Sin políticas, nadie más puede leer ni escribir en ese bucket.
