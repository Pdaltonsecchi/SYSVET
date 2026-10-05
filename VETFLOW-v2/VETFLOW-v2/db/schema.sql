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

-- ============================================================
-- Bloque F (pacientes y validaciones)
-- ============================================================
-- F1: teléfono normalizado (solo dígitos), para búsquedas y para un futuro link de WhatsApp.
ALTER TABLE patients  ADD COLUMN IF NOT EXISTS phone_norm TEXT NOT NULL DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone_norm TEXT NOT NULL DEFAULT '';
UPDATE patients  SET phone_norm = regexp_replace(phone, '\D', '', 'g') WHERE phone_norm = '' AND phone <> '';
UPDATE suppliers SET phone_norm = regexp_replace(phone, '\D', '', 'g') WHERE phone_norm = '' AND phone <> '';

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

-- ============================================================
-- Nueva etapa: historias clínicas numeradas
-- ============================================================
-- Cada paciente (mascota) tiene un número de historia clínica correlativo, asignado solo al crearlo. Los
-- pacientes que ya existían se numeran por fecha de alta. Los números no se reutilizan aunque se borre un paciente.
CREATE SEQUENCE IF NOT EXISTS patients_hc_seq;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS hc_number INTEGER;
CREATE OR REPLACE FUNCTION assign_patient_hc() RETURNS void AS $$
DECLARE r RECORD;
BEGIN
  PERFORM setval('patients_hc_seq', COALESCE((SELECT MAX(hc_number) FROM patients), 0) + 1, false);
  FOR r IN SELECT id FROM patients WHERE hc_number IS NULL ORDER BY created_at, id LOOP
    UPDATE patients SET hc_number = nextval('patients_hc_seq') WHERE id = r.id;
  END LOOP;
  PERFORM setval('patients_hc_seq', COALESCE((SELECT MAX(hc_number) FROM patients), 0) + 1, false);
END
$$ LANGUAGE plpgsql;
SELECT assign_patient_hc();
ALTER TABLE patients ALTER COLUMN hc_number SET DEFAULT nextval('patients_hc_seq');
CREATE UNIQUE INDEX IF NOT EXISTS patients_hc_idx ON patients(hc_number);

-- ============================================================
-- Nueva etapa: clientes (dueños) con varias mascotas
-- ============================================================
-- Los datos de contacto viven en el cliente (una sola vez); la mascota solo apunta a su cliente. Las columnas
-- viejas patients.owner_name / phone / email quedan por compatibilidad (owner_name se mantiene igual al nombre del
-- cliente; teléfono y email ya no se usan), y no se borra ningún dato.
CREATE TABLE IF NOT EXISTS clients (
  id SERIAL PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone_norm TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE patients ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS patients_client_idx ON patients(client_id);

-- Crea los clientes que faltan a partir de los datos de las mascotas (una sola vez por dueño): mismo nombre y mismo
-- teléfono = mismo cliente. El apellido es la última palabra del nombre. Se puede corregir después desde la app.
CREATE OR REPLACE FUNCTION ensure_clients() RETURNS void AS $$
DECLARE g RECORD; cid INTEGER; nm TEXT; fn TEXT; ln TEXT;
BEGIN
  FOR g IN
    SELECT lower(btrim(owner_name)) AS k, phone_norm AS ph,
           (array_agg(owner_name ORDER BY id))[1] AS oname,
           (array_agg(phone ORDER BY id))[1] AS phone,
           (array_agg(email ORDER BY (email = ''), id))[1] AS email
    FROM patients WHERE client_id IS NULL
    GROUP BY lower(btrim(owner_name)), phone_norm
  LOOP
    nm := btrim(regexp_replace(g.oname, '\s+', ' ', 'g'));
    IF nm = '' THEN nm := 'Sin nombre'; END IF;
    IF position(' ' IN nm) > 0 THEN
      fn := substring(nm FROM '^(.*) [^ ]+$');
      ln := substring(nm FROM '([^ ]+)$');
    ELSE
      fn := nm;
      ln := '';
    END IF;
    INSERT INTO clients (first_name, last_name, email, phone, phone_norm) VALUES (fn, ln, g.email, g.phone, g.ph) RETURNING id INTO cid;
    UPDATE patients SET client_id = cid WHERE client_id IS NULL AND lower(btrim(owner_name)) = g.k AND phone_norm = g.ph;
  END LOOP;
END
$$ LANGUAGE plpgsql;
SELECT ensure_clients();

-- ============================================================
-- Nueva etapa: código de barras opcional en los productos
-- ============================================================
-- Sirve para reconocer el producto con la cámara (o un lector USB) al vender o ingresar stock. Es opcional;
-- si se carga, no puede repetirse entre productos.
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS products_barcode_idx ON products(barcode) WHERE barcode IS NOT NULL;

-- ============================================================
-- Nueva etapa: chatbot de WhatsApp
-- ============================================================
-- Datos del consultorio que el bot informa (dirección, teléfono, veterinario, horarios, etc.). Clave/valor en JSON.
CREATE TABLE IF NOT EXISTS clinic_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estado de cada conversación (una por número de WhatsApp). client_id es NULL mientras el número no sea de un cliente.
CREATE TABLE IF NOT EXISTS chat_sessions (
  id SERIAL PRIMARY KEY,
  phone TEXT NOT NULL UNIQUE,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  state TEXT NOT NULL DEFAULT 'idle',
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_interaction TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro de todos los mensajes. wa_message_id evita procesar dos veces un mensaje que Meta reenvía.
-- "body" va cifrado (AES-256-GCM) si el servidor tiene WHATSAPP_LOG_KEY.
CREATE TABLE IF NOT EXISTS chat_logs (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES chat_sessions(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  msg_type TEXT NOT NULL DEFAULT 'text',
  body TEXT NOT NULL DEFAULT '',
  wa_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_logs_wamid_idx ON chat_logs(wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_logs_phone_idx ON chat_logs(phone, created_at);

-- Recordatorios automáticos. dedupe_key impide enviar dos veces el mismo aviso (ej. 'vb:15' = vacuna 15, 7 días antes).
CREATE TABLE IF NOT EXISTS whatsapp_reminders (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('vaccine_before', 'vaccine_after', 'appt_24h', 'appt_2h')),
  client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  patient_id INTEGER REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id INTEGER REFERENCES appointments(id) ON DELETE CASCADE,
  vaccine_id INTEGER REFERENCES vaccines(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL UNIQUE,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wa_reminders_due_idx ON whatsapp_reminders(scheduled_for) WHERE status = 'pending';

-- Turnos: cuándo confirmó el cliente por WhatsApp (NULL = sin confirmar) y quién lo cargó.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'staff';
