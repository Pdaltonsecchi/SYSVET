-- VETFLOW v2 · Bloque C (farmacia, stock y caja)
-- Mismo bloque que está al final de db/schema.sql (el servidor lo ejecuta solo al arrancar).
-- Seguro de correr más de una vez; no borra datos.

-- ============================================================
-- Bloque C (farmacia, stock y caja)
-- ============================================================
-- C5: nota opcional en los movimientos de stock (motivo de un ajuste, etc.).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';
-- C9/C10: movimiento de stock generado por un cobro (producto vendido o producto vinculado a un servicio).
-- Sin FOREIGN KEY a propósito: así las copias de seguridad se restauran sin ciclos entre tablas.
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS charge_id INTEGER;
CREATE INDEX IF NOT EXISTS stock_mov_charge_idx ON stock_movements(charge_id);
-- C9: cada línea de un cobro es un servicio o un producto (los reportes de servicios solo cuentan servicios).
ALTER TABLE charges ADD COLUMN IF NOT EXISTS line_type TEXT NOT NULL DEFAULT 'service';
-- C10: productos del stock (con cantidad) que se descuentan al cobrar un servicio.
CREATE TABLE IF NOT EXISTS service_items (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INTEGER NOT NULL DEFAULT 1 CHECK (qty >= 1)
);
CREATE INDEX IF NOT EXISTS service_items_service_idx ON service_items(service_id);
