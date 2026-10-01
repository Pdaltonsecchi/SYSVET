-- VETFLOW v2 · Bloque A (integridad de datos)
-- Es el mismo bloque que está al final de db/schema.sql (que el servidor ejecuta solo al arrancar).
-- Podés pegarlo en Supabase > SQL Editor antes de desplegar; es seguro correrlo más de una vez.
-- No borra datos.

-- ============================================================
-- Bloque A (integridad de datos). Todo es idempotente: se puede ejecutar muchas veces.
-- ============================================================

-- A2: vacunas y medicación guardan qué producto descontaron, cuántas unidades y con qué
-- movimiento de stock, para poder devolver el stock al quitarlas.
ALTER TABLE vaccines    ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE vaccines    ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vaccines    ADD COLUMN IF NOT EXISTS stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS stock_qty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE medications ADD COLUMN IF NOT EXISTS stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL;

-- A3: el movimiento de caja generado por una venta o una compra de stock apunta al
-- movimiento de stock correspondiente. "voided" marca los movimientos de stock anulados
-- (para que los reportes no cuenten ventas o usos que ya se revirtieron).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS voided BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cash_movements  ADD COLUMN IF NOT EXISTS stock_movement_id INTEGER REFERENCES stock_movements(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cash_stock_mov_idx ON cash_movements(stock_movement_id);

-- A1: defensa extra en la base. Solo se agrega si hoy ningún producto tiene stock negativo
-- (si alguno lo tiene, corregilo con "Ajustar" en Stock y se agrega en el próximo arranque).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_stock_nonneg')
     AND NOT EXISTS (SELECT 1 FROM products WHERE stock < 0) THEN
    ALTER TABLE products ADD CONSTRAINT products_stock_nonneg CHECK (stock >= 0);
  END IF;
END $$;

-- Para revisar si quedó algún producto con stock negativo de antes:
--   SELECT id, name, stock FROM products WHERE stock < 0;
-- (corregilo desde la app con Stock > Ajustar)
