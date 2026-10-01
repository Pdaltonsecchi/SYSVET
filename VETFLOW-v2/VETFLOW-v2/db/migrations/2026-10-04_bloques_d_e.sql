-- VETFLOW v2 · Bloques D (proveedores) y E (calendario)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque D (proveedores) y E (calendario)
-- ============================================================
-- D1: proveedor habitual de un producto, y proveedor de cada compra (movimiento de stock y de caja).
-- Si se elimina el proveedor, las compras y productos quedan sin proveedor (no se borran).
ALTER TABLE products        ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE cash_movements  ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS products_supplier_idx ON products(supplier_id);
CREATE INDEX IF NOT EXISTS stock_mov_supplier_idx ON stock_movements(supplier_id);
CREATE INDEX IF NOT EXISTS cash_supplier_idx ON cash_movements(supplier_id);

-- E3: duración del turno en minutos. Los turnos que ya existían toman la duración habitual de su tipo
-- (esto se hace una sola vez, cuando se crea la columna).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'appointments' AND column_name = 'duration_min') THEN
    ALTER TABLE appointments ADD COLUMN duration_min INTEGER NOT NULL DEFAULT 30;
    UPDATE appointments SET duration_min = CASE appointment_type WHEN 'consulta' THEN 20 WHEN 'vacuna' THEN 10 WHEN 'cirugia' THEN 120 ELSE 30 END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_duration_check') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_duration_check CHECK (duration_min BETWEEN 5 AND 720);
  END IF;
END $$;
