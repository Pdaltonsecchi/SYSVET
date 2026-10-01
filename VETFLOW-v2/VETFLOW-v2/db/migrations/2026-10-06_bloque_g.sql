-- VETFLOW v2 · Bloque G (papelera e historial de peso)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque G (papelera, historial de peso)
-- ============================================================
-- G1: borrado lógico. Lo "borrado" queda con deleted_at y se ve en la Papelera 30 días.
ALTER TABLE patients              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE vaccines              ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE diagnoses             ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE complementary_studies ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE medications           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE charges               ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
-- Un cobro borrado también borra su ingreso en caja; esta marca permite recrearlo al restaurar.
ALTER TABLE charges               ADD COLUMN IF NOT EXISTS cash_was BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS patients_deleted_idx ON patients(deleted_at) WHERE deleted_at IS NOT NULL;

-- G3: historial de peso. El peso actual del paciente (patients.weight) es el del último registro.
CREATE TABLE IF NOT EXISTS weights (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  kg NUMERIC(6,2) NOT NULL CHECK (kg > 0 AND kg <= 150)
);
CREATE INDEX IF NOT EXISTS weights_patient_idx ON weights(patient_id, fecha);
-- Se migra el peso actual de cada paciente como primer registro (solo a quien todavía no tiene ninguno).
INSERT INTO weights (patient_id, fecha, kg)
  SELECT p.id, p.created_at::date, p.weight FROM patients p
  WHERE p.weight IS NOT NULL AND p.weight > 0 AND p.weight <= 150
    AND NOT EXISTS (SELECT 1 FROM weights w WHERE w.patient_id = p.id);
