# VETFLOW v2 — qué cambió respecto de la v1

Este documento resume todo lo que se agregó y modificó al pasar de la v1 ("Mi
veterinaria") a VETFLOW v2, para quien continúe el proyecto (persona o IA).
Se armó siguiendo un pedido de funcionalidades escrito como prompt para otra
IA; abajo se explican también los puntos donde se se apartó deliberadamente
de ese pedido, y por qué.

## 0. Antes de nada: una aclaración sobre la arquitectura

El pedido daba por sentado una estructura de archivos que no es exactamente
la real. En particular:

- **La navegación (el menú lateral) no vive en `server/index.js`.** Ese
  archivo solo sirve los archivos estáticos, aplica cabeceras de seguridad y
  fuerza HTTPS. Toda la interfaz —incluida la barra de navegación— la arma
  `public/app.js` en tiempo de ejecución (es una SPA de una sola página:
  `public/index.html` es apenas un esqueleto). Por eso el menú nuevo
  ("Calendario", "Proveedores") se agregó en `app.js` (función `navItems()`),
  no en `server/index.js`. `server/index.js` no se tocó salvo por lo que ya
  estaba (nada relacionado a v2).
- **No existen "pantallas" como archivos HTML separados.** Todo el contenido
  de cada sección se genera como texto HTML dentro de `app.js` y se inyecta
  en un único `<main id="main">`. Por eso "Proveedores" y "Calendario" son
  funciones de JavaScript (`viewProveedores()`, `viewCalendario()`) y no
  bloques nuevos en `index.html`. `index.html` solo cambió en el texto de
  marca (título, favicon, nombre en el login y en el panel lateral).

El resto del pedido se implementó tal cual, dentro de esta arquitectura real.

## 1. Cambio de identidad → VETFLOW

- `public/index.html`: `<title>`, el nombre en la pantalla de login y el
  nombre en el panel lateral pasaron de "Mi veterinaria" a "VETFLOW".
- El ícono (favicon) se dejó igual (la pata 🐾): sigue siendo un ícono
  genérico de veterinaria, no decía "Mi veterinaria" en ningún lado, así que
  no hacía falta cambiarlo para que deje de referenciar el nombre viejo.
- **Paleta de colores nueva** en `public/styles.css`: se reemplazó la
  paleta verde-azulada ("teal") por una gris-azulada / índigo (`--brand:
  #4C4FE0` en modo claro, `#8A8DF0` en modo oscuro), manteniendo la misma
  estructura de variables CSS (`--bg`, `--panel`, `--brand`, `--side`,
  `--ok`, `--warn`, `--bad`, etc.) para no tener que tocar el resto de las
  reglas. También se ajustaron a mano los tonos de texto del panel lateral
  (antes eran verdosos, pensados para el fondo verde-azulado anterior) para
  que combinen con el nuevo fondo índigo oscuro.
- `README.md`: se actualizó el título a "VETFLOW".

## 2. Categorías de stock expandidas

Se agregaron `'Pulguicidas'` y `'Antiparasitarios'` a la lista de categorías
de producto. Como la columna `products.category` es `TEXT` libre (nunca
tuvo un `CHECK` de base de datos con la lista de valores permitidos), el
cambio fue **solo de aplicación**, en dos lugares que tienen que estar
siempre sincronizados:
- `server/util.js` → `PROD_CATS` (valida lo que llega a la API)
- `public/app.js` → `PROD_CATS` (arma los `<select>` y el filtro de la
  pantalla de stock)

## 3. Proveedores (módulo nuevo)

- **Tabla `suppliers`** (`db/schema.sql`): `name`, `phone`, `email`,
  `description`, `created_at`.
- **Endpoints** (`server/api.js`): `GET/POST /api/suppliers`,
  `PUT/DELETE /api/suppliers/:id`.
- **Permisos** (decisión no especificada por el pedido original): **ver**
  la lista de proveedores está abierto a cualquier usuario logueado
  (administrador o ayudante) — es información de contacto que el ayudante
  también puede necesitar para llamar a reponer algo. **Crear, editar y
  eliminar** proveedores es solo del administrador, con el mismo criterio
  que ya regía para productos y precios.
- **Pantalla** (`public/app.js` → `viewProveedores()`): tabla con nombre,
  teléfono, email y una descripción opcional de qué se le compra a cada
  uno; botones de editar/eliminar solo visibles para el administrador.
- Se agregó a la lista de tablas de `server/backup.js`, así que ya queda
  incluida en las copias de seguridad, la exportación y la restauración.

## 4. Estudios complementarios en la historia clínica

- **Tabla `complementary_studies`**: `patient_id`, `on_date`, `title`,
  `notes`. Estructuralmente es un calco de `diagnoses`.
- **Endpoints**: `POST /api/patients/:id/studies`,
  `DELETE /api/studies/:id`. (Se usó `studies` como nombre de ruta corto en
  vez de repetir el nombre completo de la tabla; ver nota de convención en
  el punto 9).
- **Permisos**: iguales a diagnósticos y medicación (cualquier usuario
  logueado puede agregar y quitar), no solo el administrador.
- **Pantalla**: nueva sección "Estudios complementarios" en la ficha del
  paciente (`detailHTML()`), ubicada entre "Diagnósticos y consultas" y
  "Medicación".
- Se agregó a `server/backup.js`.

## 5. Precio unitario en las compras de stock

Esto es un **cambio de contrato de la API**, no aditivo: los endpoints que
suman stock ya no reciben `cost` (el costo total), sino `qty` +
`unitPrice`; el costo total lo calcula el servidor (`qty × unitPrice`) y es
el que se guarda en el movimiento de caja. Afecta a:

- `POST /api/products` (alta de producto con stock inicial): antes
  `{ stock, cost, method }`, ahora `{ stock, unitPrice, method }`.
- `POST /api/products/:id/purchase` ("agregó stock"): antes
  `{ qty, cost, method }`, ahora `{ qty, unitPrice, method }`. La respuesta
  ahora incluye `cost` (el total calculado), para que la pantalla lo pueda
  mostrar sin recalcularlo por su cuenta.
- **Base de datos**: se agregó la columna `stock_movements.unit_price`
  (`NUMERIC(12,2) NOT NULL DEFAULT 0`, vía `ALTER TABLE ... ADD COLUMN IF
  NOT EXISTS`, así que no rompe instalaciones ya desplegadas). Los
  movimientos que no son compras (ventas, ajustes, medicación, vacunas)
  simplemente no informan esta columna y queda en su valor por defecto (0).
- **Historial de stock (pantalla nueva, no pedida explícitamente pero
  necesaria para cumplir el pedido):** el pedido original pedía "mostrar
  ambos valores (unitario y total) en la tabla de historial", pero la v1
  no tenía ninguna tabla de historial de movimientos de stock (solo el
  reporte agregado de "productos que más rotan"). Se agregó:
  - Endpoint `GET /api/products/:id/movements` (solo administrador):
    devuelve los últimos 200 movimientos de ese producto con fecha,
    cantidad, motivo, precio unitario y total.
  - Un botón "Historial" en la fila de cada producto (pantalla de Stock,
    solo administrador) que abre una ventana con esa tabla.

### Un bug real que apareció al construir esto (y ya está corregido)

La tabla `products` tenía, desde la v1, `stock INTEGER ... CHECK (stock >=
0)`. Esa restricción es correcta para ventas y ajustes (nunca deberían
dejar el stock negativo), pero **choca directamente con el punto 7 de este
mismo pedido** ("el stock puede quedar en números negativos" al aplicar una
vacuna vinculada). Se sacó ese `CHECK` de `db/schema.sql` y se agregó
`ALTER TABLE products DROP CONSTRAINT IF EXISTS products_stock_check;` para
que también se quite en una base ya desplegada (ese es el nombre que
Postgres le da por defecto a un `CHECK` inline sin nombre propio). La regla
de "no negativo" para ventas y ajustes se sigue cumpliendo, pero ahora vive
solo en el código (`server/api.js`, con `WHERE stock >= $1` en esas dos
rutas), no en la base. Esto se encontró recién al escribir las pruebas
automatizadas — quedó como ejemplo de por qué se probó todo de punta a
punta antes de entregar esto.

## 6. Calendario de turnos (módulo nuevo)

- **Tabla `appointments`**: `patient_id`, `title`, `description`,
  `appointment_date`, `appointment_time`, `appointment_type` (CHECK:
  `consulta`, `vacuna`, `cirugia`, `otro`).
- **Endpoints**: `GET /api/appointments?from=&to=` (rango de fechas
  inclusive, valida que `from <= to`), `POST/PUT/DELETE /api/appointments`.
  Cada turno devuelto incluye `patientName` (se resuelve con un `JOIN` a
  `patients`, así la pantalla no tiene que cruzar los datos por su cuenta).
- **Permisos**: abierto por completo a cualquier usuario logueado (crear,
  editar y eliminar), administrador o ayudante. Se decidió así porque
  agendar y reprogramar turnos es una tarea de mostrador del día a día,
  igual que cargar pacientes — no se restringió a admin porque el pedido
  no lo pedía y hacerlo habría sido más una traba que una protección.
- **Pantalla** (`viewCalendario()`): selector de vista (Semana / 2 semanas
  / 3 semanas / Mes) con navegación (‹ Hoy ›), una leyenda de colores y la
  grilla correspondiente:
  - **Semana / 2 semanas / 3 semanas**: columnas por día (con scroll
    horizontal en pantallas chicas), cada turno como un bloque de color
    según su tipo, con hora y nombre del paciente.
  - **Mes**: grilla clásica de semanas completas (incluye los días del mes
    anterior/siguiente que completan la primera y la última semana), hasta
    3 turnos por día como chips y un "+N más" que cambia a la vista semana
    centrada en ese día si hay más.
  - Cada columna/celda tiene un botón "+" para cargar un turno directo en
    ese día.
  - Click en un turno abre una ventana de detalle con **Editar** y
    **Eliminar** como dos acciones independientes — por eso, a diferencia
    del resto de los formularios (que usan el helper genérico `openForm`,
    pensado para un único botón "Guardar"), esta ventana arma el diálogo a
    mano (`appointmentDetails()` en `app.js`).
  - **Colores por tipo** (`public/styles.css`, variables `--appt-consulta`
    `#4A90E2`, `--appt-vacuna` `#2ECC71`, `--appt-cirugia` `#B03A2E`,
    `--appt-otro` `#8892A6`): son colores fijos, iguales en modo claro y
    oscuro, para que el tipo de turno se reconozca siempre igual.
- Se agregó a `server/backup.js`.
- **Nota de diseño sobre la fecha "ancla" del calendario**: al principio, al
  volver de la vista "Mes" a "Semana" el calendario se quedaba mirando la
  semana del día 1° del mes en vez del día que se estaba viendo antes. Se
  corrigió para que cambiar de vista nunca mueva la fecha de referencia —
  solo la mueven, a propósito, los botones ‹ › y "Hoy".

## 7. Vacunas con control de stock

- **`services.product_id`** (nullable, `ON DELETE SET NULL`): vincula un
  precio de la lista (categoría "Vacunas") con el producto del stock que
  hay que descontar cada vez que se aplica.
- **Pantalla de precios**: al crear o editar un precio aparece un selector
  "Vacuna del stock que descuenta (opcional)", con los productos de
  categoría "Vacunas". Si está vinculado, se lo indica en la fila
  ("Descuenta: <producto>").
- **Al agregar una vacuna a un paciente** (`Pacientes → Vacunas`): aparece
  un selector opcional "Vacuna de la lista de precios". Si se elige una que
  tiene producto vinculado, el servidor descuenta 1 unidad de ese producto
  en la misma operación que guarda la vacuna (ambas cosas ocurren en una
  sola transacción: o se hacen las dos, o ninguna).
- **El stock puede quedar en negativo** a propósito en este único camino
  (ver el punto 5 sobre el `CHECK` que había que sacar). Si al descontar
  queda en 0 o menos, la respuesta del servidor incluye
  `stockWarning: true` y la pantalla lo muestra como un aviso en rojo
  (se le agregó a la función `toast()` un segundo parámetro para pintarlo
  de rojo; ver `#toast.warn` en `styles.css`). La vacuna se guarda igual
  — el aviso es informativo, no bloquea nada.
- **Reportes**: la consulta de "productos que más rotan"
  (`GET /api/reports/products`) solo contaba movimientos con motivo
  `'Venta'` o `'Medicación'`. Se agregó también `'Vacuna aplicada a %'`
  (el motivo que se graba en `stock_movements` para este descuento), para
  que las vacunas aplicadas por este camino también cuenten ahí.

## 8. Resumen de tablas y columnas nuevas (`db/schema.sql`)

| Cambio | Detalle |
|---|---|
| Tabla nueva | `suppliers` |
| Tabla nueva | `complementary_studies` |
| Tabla nueva | `appointments` |
| Columna nueva | `services.product_id` (nullable, FK a `products`) |
| Columna nueva | `stock_movements.unit_price` (`NUMERIC(12,2) DEFAULT 0`) |
| Restricción quitada | `products.stock`: se sacó `CHECK (stock >= 0)` |
| Categorías nuevas | `PROD_CATS`: `Pulguicidas`, `Antiparasitarios` (solo en el código, la columna ya era `TEXT` libre) |

Todo lo anterior se aplica con `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE
... ADD COLUMN IF NOT EXISTS` / `DROP CONSTRAINT IF EXISTS`, así que es
seguro correr `db/schema.sql` tanto en una base nueva como en una que ya
tenía la v1 instalada — nada se pisa ni se duplica.

**Compatibilidad de las copias de seguridad:** una copia (backup) hecha con
la v1, que no tiene las secciones `suppliers`, `complementary_studies` ni
`appointments`, ni las columnas `unit_price`/`product_id`, se puede
restaurar igual en la v2 sin errores: esas partes quedan vacías o en su
valor por defecto (se probó explícitamente; ver sección de pruebas).

## 9. Otras decisiones de nomenclatura (menores)

- Las rutas de estudios complementarios usan `/patients/:id/studies` y
  `/studies/:id` en vez de repetir `complementary_studies` en la URL (es
  más corto y sigue leyéndose bien; la tabla igual se llama
  `complementary_studies`).
- El campo que en el pedido se llamaba `cost` (costo total) pasó a llamarse
  `unitPrice` en el cuerpo de la petición, porque ahora el total se calcula
  del lado del servidor a partir de cantidad × precio unitario (ver punto
  5). Esto es intencional y no un error de tipeo.

## 10. Cómo se probó

Se extendieron los mismos scripts de prueba ad-hoc en Node usados para la
v1 (no forman parte del repositorio entregado; ver la sección
correspondiente de `CONTEXTO-IA.md` sobre por qué no se incluyen y cómo
reconstruirlos con `node:test` si se quiere dejarlos versionados):

- **Backend**: 83 verificaciones de la v1 (adaptadas únicamente en los dos
  puntos donde el campo `cost` pasó a `unitPrice`, con eso vuelven a pasar
  sin más cambios) + 50 verificaciones nuevas específicas de v2 (stock por
  categoría nueva, servicio vinculado a producto, las cuatro vacunas
  aplicadas seguidas hasta dejar el stock en -1 con el aviso correspondiente,
  que el reporte de rotación las cuenta, compra con precio unitario,
  historial de movimientos, proveedores, turnos —incluida la validación de
  hora y tipo inválidos y de rango de fechas invertido—, permisos del
  ayudante en cada módulo nuevo, y que restaurar un backup "viejo" sin las
  tablas/columnas de v2 no rompe nada). **133 en total, todas en verde.**
- **Frontend** (con un DOM simulado a mano, sin jsdom, contra el servidor
  real): 38 verificaciones de la v1 (mismo ajuste de nombre de campo) + 25
  nuevas de v2 (producto de vacuna con stock inicial y precio unitario,
  precio vinculado mostrando el producto, apertura del historial de stock,
  las cuatro aplicaciones de vacuna con el descuento y el stock en
  negativo, estudio complementario visible en la ficha, alta y listado de
  proveedores, pantalla de calendario con su leyenda, alta de turno y
  visualización en la grilla, cambio de vista semana↔mes sin perder la
  fecha, apertura del detalle de un turno, que el reporte de productos
  incluya la vacuna, y los permisos del rol ayudante en Proveedores y
  Calendario). **63 en total, todas en verde.**

En el camino, esta batería encontró y permitió corregir dos problemas reales
antes de entregar el código: el `CHECK` de stock que bloqueaba el punto 7
(sección 5) y un bug de navegación del calendario (sección 6).

**Lo que no se probó** (mismo alcance que ya estaba aclarado para la v1 en
`CONTEXTO-IA.md`): una conexión real contra un proyecto Supabase de verdad
ni un despliegue real en Render. Todo lo de arriba se probó contra el mismo
shim de SQLite en memoria que se usó para la v1.

## 11. Qué NO se tocó

Tal como pedía el prompt original, se dejaron intactos (más allá de lo
estrictamente necesario para lo de arriba): `server/index.js`,
`server/db.js`, `server/auth.js`. `server/util.js` y `server/backup.js` sí
se modificaron, porque era imposible cumplir el pedido sin hacerlo
(categorías/tipos/validaciones nuevas en el primero; tablas nuevas en el
segundo) — el pedido ya preveía esta excepción ("a menos que sea
absolutamente necesario").
