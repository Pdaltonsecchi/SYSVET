-- Estas tablas se crean solas cuando arranca el servidor. Es seguro ejecutarlo muchas veces.

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS patients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('Perro', 'Gato')),
  breed TEXT NOT NULL DEFAULT '',
  sex TEXT NOT NULL CHECK (sex IN ('Macho', 'Hembra')),
  neutered BOOLEAN NOT NULL DEFAULT FALSE,
  birth DATE,
  weight NUMERIC(6,2),
  owner_name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vaccines (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  applied_on DATE NOT NULL,
  next_on DATE
);
CREATE INDEX IF NOT EXISTS vaccines_patient_idx ON vaccines(patient_id);

CREATE TABLE IF NOT EXISTS diagnoses (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  on_date DATE NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS diagnoses_patient_idx ON diagnoses(patient_id);

CREATE TABLE IF NOT EXISTS medications (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  on_date DATE NOT NULL,
  name TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS medications_patient_idx ON medications(patient_id);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price >= 0)
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  -- El stock nunca puede quedar negativo: lo valida el servidor (server/api.js) y, si no hay
  -- productos con stock negativo, también lo garantiza la base (ver "products_stock_nonneg" abajo).
  stock INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0)
);
-- (instalaciones v1: se quita la restricción con su nombre por defecto; la reemplaza
-- "products_stock_nonneg", definida al final de este archivo.)
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_check;

-- v2: nota interna sobre las categorías de producto — 'Pulguicidas' y 'Antiparasitarios' se
-- suman a la lista, pero como "category" es TEXT libre (sin CHECK), no hace falta ALTER acá;
-- la validación de categorías permitidas vive en server/util.js (PROD_CATS).

-- v2: vacuna de la lista de precios vinculada a un producto del stock. Se guarda acá (y no en
-- "vaccines") porque el vínculo es entre el SERVICIO "Vacuna X" de la lista de precios y el
-- PRODUCTO "Vacuna X" del stock; cada aplicación a un paciente elige ese servicio para saber
-- qué producto descontar.
ALTER TABLE services ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS cash_movements (
  id SERIAL PRIMARY KEY,
  on_date DATE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
  concept TEXT NOT NULL,
  category TEXT NOT NULL,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cash_date_idx ON cash_movements(on_date);

CREATE TABLE IF NOT EXISTS charges (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  on_date DATE NOT NULL,
  concept TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  method TEXT NOT NULL,
  cash_id INTEGER REFERENCES cash_movements(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS charges_patient_idx ON charges(patient_id);
CREATE INDEX IF NOT EXISTS charges_date_idx ON charges(on_date);

-- Cada entrada o salida de stock queda registrada (fecha, cantidad y motivo).
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  on_date DATE NOT NULL,
  qty INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS stock_mov_product_idx ON stock_movements(product_id);
-- v2: precio pagado por unidad en compras (0 en movimientos que no son compras, como ventas o ajustes).
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) NOT NULL DEFAULT 0;

-- v2: proveedores de la farmacia (a quién se le compra cada cosa).
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2: estudios complementarios (ecografía, radiografía, análisis, etc.) de la historia clínica.
CREATE TABLE IF NOT EXISTS complementary_studies (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  on_date DATE NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS studies_patient_idx ON complementary_studies(patient_id);

-- v2: turnos del calendario.
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  appointment_date DATE NOT NULL,
  appointment_time TIME NOT NULL,
  appointment_type TEXT NOT NULL CHECK (appointment_type IN ('consulta', 'vacuna', 'cirugia', 'otro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appt_patient_idx ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS appt_date_idx ON appointments(appointment_date);

-- Copias de seguridad comprimidas (una automática por día).
CREATE TABLE IF NOT EXISTS backups (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  label TEXT NOT NULL,
  auto BOOLEAN NOT NULL DEFAULT FALSE,
  counts TEXT NOT NULL DEFAULT '{}',
  data TEXT NOT NULL
);

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
