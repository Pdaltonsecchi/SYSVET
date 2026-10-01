# Contexto del proyecto: sistema de gestión para una veterinaria

> **Nota:** este documento describe la v1 del sistema ("Mi veterinaria").
> Después se construyó una v2 llamada **VETFLOW** encima de esta misma base
> (nueva identidad visual, proveedores, estudios complementarios, calendario
> de turnos, precio unitario en compras de stock y vacunas vinculadas al
> stock). Todo lo de acá sigue siendo válido como descripción de la
> arquitectura de base; el detalle de qué cambió, por qué, y las decisiones
> de diseño de la v2 está en **`CAMBIOS_V2.md`**, léanse juntos.

Este documento es para otra IA (o para cualquier desarrollador) que reciba el
archivo `veterinaria-sistema.zip` y necesite entender qué es, cómo está armado
y por qué se tomó cada decisión, sin haber participado de la conversación
original. Está escrito para que sirva como contexto completo: origen del
pedido, arquitectura, contrato de la API, decisiones de diseño, qué está
probado, qué falta y qué cuidar si se lo modifica.

El dueño del proyecto **no es programador**. Es el dueño de una veterinaria en
Argentina (atiende perros y gatos) que fue pidiendo el sistema en lenguaje
llano, de a partes, dentro de una conversación de chat con un asistente de IA
(Claude) que actuó como programador. Todo el código, la base de datos y la
guía de despliegue fueron escritos por esa IA en esa conversación. Si esta IA
continúa el trabajo, debería mantener el mismo estilo: explicaciones simples,
sin jerga técnica, y cualquier mensaje de error que vea el usuario final en
español claro.

## 1. Cómo se llegó a este diseño (orden real del pedido)

1. **Pedido inicial:** un sistema con dos pantallas — (a) historias clínicas
   de perros y gatos (alta/baja de pacientes, diagnósticos, medicación,
   vacunas y sus vencimientos) y (b) farmacia (stock de medicamentos/vacunas/
   shampoos), ingresos y egresos de dinero, y una lista de precios de
   cirugías/vacunas/consultas asignable a un paciente.
2. Se entregó un **prototipo estático en un solo archivo HTML** (sin
   servidor ni base de datos, con `localStorage` del navegador) para que el
   usuario pudiera "tocarlo" y dar feedback antes de construir nada real.
   Ese prototipo ya no forma parte del sistema final, pero explica el origen
   de la interfaz visual (paleta de colores, tipografías, layout) que se
   reutilizó en la versión definitiva.
3. Iteraciones sobre el prototipo, agregando: reportes (servicios más
   vendidos, ingresos por mes, productos que más rotan), copias de
   seguridad, campo de email del dueño, forma de pago en cada cobro
   (efectivo/transferencia/débito/crédito), separación de "efectivo en
   caja" vs. transferencias vs. tarjetas en el resumen de ingresos, y un
   flujo de "agregar stock" que pregunta cantidad y costo y lo carga como
   egreso.
4. El usuario preguntó si el sistema final debía ser "una API o una página
   web": se le explicó que son partes de una misma arquitectura (frontend +
   backend con API), no alternativas.
5. Se decidió usar **PostgreSQL en Supabase, plan gratuito**, por bajo
   volumen de datos esperado (una veterinaria de barrio). Se le explicaron
   las limitaciones del plan free (pausa por inactividad, sin backups
   propios) y se compensó esa falta de backups con backups propios dentro
   del sistema (ver sección 7).
6. Pedido final: **el sistema completo y ya desplegable**, sin ningún dato
   de ejemplo (el usuario quiere cargar él mismo a sus pacientes reales
   desde cero), con usuarios con contraseña y HTTPS, y con el flujo de
   "agregar stock" (cantidad + costo → egreso en caja).
7. Se armó el proyecto final (backend Node.js + frontend estático +
   PostgreSQL), se probó de punta a punta con pruebas automatizadas propias
   (no hay framework de testing instalado; ver sección 9), y se escribió una
   guía paso a paso en español (`README.md`) para que el usuario, sin
   conocimientos técnicos, despliegue todo con Supabase + GitHub + Render.
8. Preguntas de seguimiento del usuario ya resueltas en el `README.md`:
   - Puede hacer el despliegue desde cualquier computadora; el sistema queda
     accesible por internet (URL de Render) desde cualquier dispositivo
     después. Lo único "local" es un aviso de "hace cuánto no descargás un
     backup", que se guarda en `localStorage` del navegador usado.
   - Cómo encontrar la cadena de conexión "Session pooler" en el panel
     "Connect" de Supabase (la ubicación exacta de este botón cambia con
     el tiempo en el dashboard de Supabase; si volvió a moverse, buscar
     "Session pooler" o, como alternativa, tomar la cadena del "Transaction
     pooler" — puerto `6543` — y cambiar el puerto a `5432`).
   - Al subir el proyecto a GitHub, se debe subir el **contenido** de la
     carpeta `veterinaria-sistema/` (las carpetas `server/`, `public/`,
     `db/` y los archivos sueltos como `package.json`), no la carpeta
     contenedora ni el `.zip` en sí.

## 2. Qué es y qué no es este proyecto

- Es un sistema de gestión integral para una veterinaria pequeña: historias
  clínicas, stock/farmacia, caja (ingresos/egresos con forma de pago),
  lista de precios, reportes y backups.
- **No** es un sistema multi-tenant (una sola veterinaria por despliegue).
- **No** tiene build step ni framework de frontend: es HTML/CSS/JS plano
  servido como archivos estáticos.
- **No** usa ningún framework de backend (Express, Fastify, etc.): es un
  servidor HTTP de Node.js puro (`http.createServer`), con un router
  hecho a mano.
- **No** trae datos de ejemplo/semilla. El primer usuario administrador se
  crea a partir de variables de entorno la primera vez que arranca.

## 3. Arquitectura general

```
Navegador (HTML + CSS + JS plano, sin build)
        │  fetch() a /api/... (JSON, mismo origen, cookie de sesión)
        ▼
Servidor Node.js (http nativo, sin framework)
  server/index.js  → arranque, servidor HTTP, archivos estáticos, seguridad
  server/api.js    → router y TODAS las rutas /api/*
  server/auth.js   → contraseñas (scrypt), sesiones (cookie firmada HMAC), rate limit
  server/db.js     → pool de conexión a Postgres (usa el driver "pg"), migraciones
  server/backup.js → snapshots de datos (gzip + base64) guardados en la propia BD
  server/util.js   → validaciones, helpers de fecha/dinero, envoltorio HTTP
        │  SQL (driver "pg", pool con SSL)
        ▼
PostgreSQL (Supabase, plan gratuito, vía "Session pooler" en :5432)
  db/schema.sql → CREATE TABLE IF NOT EXISTS ... (se corre solo al iniciar)
```

Hosting recomendado en el `README.md` (elegido por ser gratis y simple, no
por ser la única opción):
- **Supabase** → solo se usa como base de datos Postgres (no se usan sus
  otras features: Auth, Storage, Edge Functions, Realtime, etc. — la
  autenticación es propia, ver sección 5).
- **GitHub** → repositorio privado con el código.
- **Render** (Web Service, plan Free) → build (`npm install`) y arranque
  (`npm start`) del servidor Node; provee HTTPS y dominio público solos.

No hay contenedores/Docker, ni CI/CD configurado, ni variables de entorno
gestionadas fuera de las que exige `render.yaml`/`.env.example`.

## 4. Estructura de archivos (dentro del zip)

```
veterinaria-sistema/
├─ package.json        # nombre, scripts (start), única dependencia: "pg"
├─ render.yaml          # Blueprint opcional para Render (ver sección 8)
├─ .env.example          # plantilla de variables de entorno (no tiene secretos reales)
├─ .gitignore
├─ README.md             # guía paso a paso EN ESPAÑOL para el usuario final (no técnico)
├─ db/
│  └─ schema.sql         # DDL completo; se ejecuta con "CREATE TABLE IF NOT EXISTS"
│                         # en cada arranque (ver server/db.js → migrate())
├─ server/
│  ├─ index.js           # servidor HTTP, cabeceras de seguridad, archivos estáticos,
│  │                       redirección forzada a HTTPS en producción, /healthz
│  ├─ api.js             # TODAS las rutas /api/*, autorización por rol, lógica de negocio
│  ├─ auth.js            # hash de contraseñas (scrypt), sesiones (cookie firmada),
│  │                       bloqueo tras intentos fallidos, alta del primer admin
│  ├─ backup.js          # snapshot/list/load/remove/restore/exportAll de backups
│  ├─ db.js              # Pool de "pg", parseo de tipos (NUMERIC→number, etc.), tx()
│  └─ util.js            # validaciones (reqStr, reqDate, money, oneOf, idParam, etc.),
│                          constantes de dominio (categorías, formas de pago),
│                          helpers de fecha en horario de Argentina, sendJson/readBody
└─ public/
   ├─ index.html          # esqueleto de la página (login + shell de la app)
   ├─ styles.css          # todo el CSS (tema claro/oscuro automático, responsive)
   └─ app.js              # TODA la lógica de frontend: estado en memoria, fetch a la
                            API, render de las pantallas, formularios, acciones
```

No hay `node_modules/` en el zip (se genera con `npm install` en el
despliegue). La única dependencia de producción es `pg` (driver oficial de
PostgreSQL para Node).

## 5. Autenticación, sesiones y roles

- **Dos roles:** `admin` y `staff` (mostrado al usuario como "Administrador"
  y "Ayudante").
  - `admin`: acceso total, incluida la caja, reportes, backups y gestión de
    usuarios.
  - `staff`: puede ver y cargar pacientes (historias clínicas), cobrar
    servicios y vender productos del stock, pero **no** ve la pantalla de
    caja, reportes, backups ni usuarios, y no puede borrar pacientes,
    cobros, ni editar precios/productos (eso está bloqueado a nivel de
    rutas en el servidor, no solo ocultado en la interfaz).
- **Contraseñas:** hasheadas con `scrypt` (Node `crypto`), sal aleatoria por
  usuario, formato guardado: `scrypt$<saltHex>$<hashHex>`. Comparación con
  `timingSafeEqual`. Hay una `dummyHash()` para que el tiempo de respuesta
  no delate si un email existe o no (mitiga user enumeration por timing).
- **Sesiones:** cookie `vet_session`, **no** son JWT de librería ni tokens en
  una tabla: es un payload JSON `{uid, ph, exp}` codificado en base64url y
  firmado con HMAC-SHA256 usando `SESSION_SECRET`. `ph` es un hash corto del
  `password_hash` actual del usuario: si el usuario cambia su contraseña,
  todas las sesiones viejas (en cualquier dispositivo) quedan inválidas al
  instante, sin necesidad de una tabla de sesiones ni de invalidación
  explícita. Cookie con `HttpOnly`, `SameSite=Strict`, y `Secure` cuando
  `NODE_ENV=production`. Duración: 7 días.
- **Rate limiting de login:** en memoria del proceso (`Map` por
  `ip|email`), bloquea 15 minutos tras 5 intentos fallidos. Esto se pierde
  si el proceso reinicia (aceptable para este tamaño de proyecto; no hay
  Redis ni nada persistente para esto).
- **Primer usuario administrador:** `auth.ensureAdmin()` se corre al iniciar
  el servidor; si la tabla `users` está vacía, crea un admin con
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` (variables de entorno). Si esas variables
  no están seteadas o la contraseña es muy corta, el servidor arranca igual
  pero queda sin usuarios (y por lo tanto inaccesible) hasta que se
  configuren y se reinicie.
- **Protección CSRF simple:** en escrituras (todo método que no sea GET),
  `api.js` verifica que el header `Origin` (si viene) coincida con el
  `Host` de la petición; si no coincide, `403`.
- **Cabeceras de seguridad** (en `server/index.js`, aplicadas a toda
  respuesta): `X-Content-Type-Options`, `X-Frame-Options: DENY`,
  `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`
  (restrictiva: solo permite estilos propios + Google Fonts, sin scripts
  externos), y `Strict-Transport-Security` en producción.

## 6. Modelo de datos (ver `db/schema.sql` para el detalle exacto)

Tablas principales y sus relaciones (todas con `id SERIAL PRIMARY KEY`):

- `users` — email único, nombre, `password_hash`, `role` (`admin`/`staff`),
  `active`.
- `patients` — nombre, especie (`Perro`/`Gato`), raza, sexo, castrado,
  fecha de nacimiento, peso, dueño (nombre, teléfono, **email**), notas.
- `vaccines`, `diagnoses`, `medications`, `charges` — cada una con
  `patient_id REFERENCES patients(id) ON DELETE CASCADE` (si se borra un
  paciente, se borra toda su historia clínica asociada, **excepto** los
  movimientos de caja ya generados por sus cobros, que quedan).
- `services` — lista de precios (nombre, categoría, precio). Categorías
  fijas: `Consultas`, `Vacunas`, `Cirugías`, `Otros`.
- `products` — stock (nombre, categoría, `stock`, `min_stock`, `price`).
  Categorías fijas: `Medicamentos`, `Vacunas`, `Higiene`, `Otros`.
- `cash_movements` — el libro de caja: fecha, `kind` (`in`/`out`),
  concepto, categoría, **método de pago** (`Efectivo`, `Transferencia`,
  `Tarjeta de débito`, `Tarjeta de crédito`), monto, quién lo cargó.
- `charges` — un cobro a un paciente por un servicio; tiene `cash_id`
  (nullable) apuntando al `cash_movements` que generó, para poder
  revertir ambos juntos si se borra el cobro.
- `stock_movements` — cada alta/baja de stock queda registrada (compra,
  venta, medicación administrada, ajuste manual, stock inicial), con
  cantidad (positiva o negativa) y motivo. Esto es lo que alimenta el
  reporte de "productos que más rotan".
- `backups` — snapshots completos de los datos de negocio (no incluye la
  tabla `users`), comprimidos con gzip y guardados en base64 dentro de la
  misma base. Ver sección 7.

Puntos de diseño importantes:
- El dinero se guarda como `NUMERIC(12,2)` en la base y se parsea a
  `number` de JS en `db.js` (`types.setTypeParser`), redondeado a 2
  decimales con `util.round2` en cada operación de negocio.
- Las fechas de negocio (vacunas, diagnósticos, cobros, caja) son `DATE`
  (sin hora), tratadas como strings `AAAA-MM-DD` de punta a punta (no se
  usan objetos `Date` de JS para evitar corrimientos de zona horaria). "Hoy"
  se calcula explícitamente en horario de Argentina
  (`America/Argentina/Buenos_Aires`) en `util.todayAR()`.
- El esquema se aplica con `CREATE TABLE IF NOT EXISTS` (no hay sistema de
  migraciones versionado tipo Prisma/Knex/Flyway). Si en el futuro se
  necesita cambiar una tabla existente (agregar columna, cambiar tipo),
  **hay que hacerlo a mano** (ALTER TABLE) porque `schema.sql` no lo va a
  hacer solo — solo crea lo que falta, no modifica lo que ya existe.

## 7. Backups (por qué existen y cómo funcionan)

El plan gratuito de Supabase **no incluye backups automáticos propios** (eso
es un feature pago). Por eso se implementó un sistema de backups propio dentro
de la aplicación:

- `backup.snapshot(label, auto)`: junta todas las tablas de negocio (lista
  fija en `backup.js`, **no incluye `users`** por seguridad de contraseñas),
  las serializa a JSON, comprime con gzip y guarda como fila en la tabla
  `backups` (columna `data`, base64).
- `backup.ensureDaily()`: se llama al iniciar el servidor y cada 1 hora
  (`setInterval` en `index.js`) y también después de cada login; crea un
  snapshot automático (`auto=true`) si todavía no hay uno de hoy (huso
  horario de Argentina). Se retienen las últimas 14 automáticas y las
  últimas 20 manuales (`KEEP_AUTO`/`KEEP_MANUAL` en `backup.js`).
- `backup.restore(data)`: **valida** la estructura de los datos entrantes
  (`validate()`), guarda automáticamente un snapshot de "antes de
  restaurar" y luego, **dentro de una transacción** (`db.tx`), borra todas
  las tablas de negocio (en orden inverso de dependencias) y las vuelve a
  poblar con los datos del backup, reseteando las secuencias de
  autoincremento (`resetSequence`) para que los próximos `id` no choquen.
  Si algo falla a mitad de camino, la transacción hace rollback completo:
  los datos originales del usuario nunca quedan a medio borrar.
- **Limitación clave, explicada al usuario en el `README.md`:** como estos
  backups viven *dentro* de la misma base de datos de Supabase, **no
  protegen si se pierde la base entera**. Por eso la interfaz también
  ofrece "Descargar copia a mi computadora" (`GET /api/backup/export`, con
  `Content-Disposition: attachment`) y "Cargar desde archivo" (sube un
  `.json` y llama a `POST /api/restore`). El frontend guarda en
  `localStorage` (por navegador, no por servidor) la fecha de la última
  descarga y muestra una alerta si pasó más de una semana sin descargar un
  archivo.

## 8. Cómo se despliega (resumen; el detalle paso a paso está en `README.md`)

1. **Supabase** (gratis): crear proyecto → esperar aprovisionamiento →
   copiar la cadena de conexión del **Session pooler** (puerto `5432`, no
   el Transaction pooler de `6543`, porque este último no soporta
   *prepared statements* que el driver `pg` puede usar) → esa cadena es
   `DATABASE_URL`.
2. **GitHub**: subir el **contenido** de la carpeta del proyecto a un
   repositorio (puede ser privado).
3. **Render** (gratis, plan Web Service): conectar el repo, build
   `npm install`, start `npm start`, healthcheck `/healthz`. Variables de
   entorno requeridas: `DATABASE_URL`, `SESSION_SECRET` (≥32 caracteres
   aleatorios), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (≥8 caracteres),
   `NODE_ENV=production`. Hay un `render.yaml` (Blueprint) que automatiza
   casi todo esto salvo los tres valores marcados `sync: false`.
4. Render provee HTTPS y dominio público automáticamente. El servidor
   además fuerza HTTPS mirando el header `x-forwarded-proto` que agrega el
   proxy de Render.

Limitaciones conocidas del hosting gratuito (documentadas para el usuario en
el `README.md`, importante tenerlas en cuenta si se sugieren cambios):
- Render Free "duerme" el servicio tras ~15 min de inactividad; el primer
  request después tarda hasta ~1 minuto en responder (cold start).
- Supabase Free pausa el proyecto tras ~7 días sin actividad (se reactiva a
  mano desde el dashboard de Supabase; los datos no se pierden).
- Límite de 500 MB de base de datos en el plan gratuito de Supabase (se
  estimó que alcanza de sobra para el volumen de una veterinaria chica que
  solo guarda texto/números, no imágenes).

## 9. Qué está probado y cómo (importante: no hay test suite en el repo)

Durante el desarrollo se escribieron **scripts de prueba ad-hoc en Node**
(no incluidos en el zip, viven solo en el entorno de trabajo del asistente)
que:
- Levantan el servidor real (`server/index.js`) contra una base de datos
  SQLite en memoria, sustituyendo el módulo `pg` por un shim minimalista
  que traduce las consultas SQL usadas por este proyecto (no es un
  reemplazo general de `pg`).
- Ejercitan la API completa vía `fetch()` real contra el servidor: login,
  rate limiting, permisos por rol (admin vs. staff en cada ruta sensible),
  alta/edición/borrado de pacientes con su historia clínica completa,
  ventas y compras de stock (incluyendo que no se pueda vender más stock
  del que hay, ni ajustar a negativo), cobros con forma de pago y su
  impacto en caja, cálculo del "efectivo que debería haber en caja",
  reportes mensuales/servicios/productos, y el ciclo completo de backup →
  borrar todo → restaurar → verificar que la historia clínica y la caja
  quedaron idénticas.
- Un segundo script carga `public/app.js` con un DOM simulado a mano
  (stubs, sin jsdom) contra el mismo servidor real, y simula clicks/envíos
  de formulario para probar la interfaz de punta a punta (login incorrecto
  y correcto, pantallas vacías sin datos de ejemplo, alta de paciente con
  vacuna/diagnóstico/medicación/cobro, impacto en stock y caja, filtros,
  búsqueda, reportes, backups, alta de usuario staff y verificación de que
  ese rol no ve ni puede tocar lo que no debe).
- Resultado en el momento de la entrega: 83 verificaciones de backend y 38
  de frontend, todas en verde. **Estas pruebas no quedaron en el
  repositorio**; si se quiere tener regresión automática a futuro, hay que
  reconstruirlas o escribir una suite nueva (por ejemplo con `node:test`,
  que ya viene incluido en Node 18+).
- **No probado en la práctica:** la conexión real contra un proyecto
  Supabase de verdad y un despliegue real en Render (las pruebas fueron
  contra el shim de SQLite). Es el paso más probable donde puede aparecer
  un problema de configuración (formato de `DATABASE_URL`, SSL, etc.).

## 10. Contrato de la API (para referencia rápida)

Todas las rutas cuelgan de `/api`. Devuelven JSON. Los errores tienen forma
`{ "error": "mensaje en español" }` con el status code correspondiente
(400 validación, 401 sin sesión, 403 sin permiso u origen inválido, 404 no
encontrado, 409 conflicto de stock/email duplicado, 413 payload muy grande,
415 content-type inválido, 429 rate limit, 500 error interno genérico).

- **Sesión:** `POST /login`, `POST /logout`, `GET /me`, `POST /me/password`.
- **Usuarios** (solo admin): `GET/POST /users`, `PATCH /users/:id`.
- **Arranque de pantalla:** `GET /bootstrap` → `{user, patients, products,
  services, summary?}` (summary solo si es admin). Es lo que pide el
  frontend al loguearse y después de cada escritura (patrón simple de
  "recargar todo" en vez de actualizaciones optimistas — ver sección 11).
- **Pacientes:** `POST/GET/PUT/DELETE /patients[/:id]`, y anidadas
  `POST /patients/:id/vaccines|diagnoses|medications|charges` +
  `DELETE /vaccines|diagnoses|medications/:id` + `DELETE /charges/:id`
  (solo admin, porque revierte el movimiento de caja asociado).
- **Stock:** `POST/PUT/DELETE /products[/:id]` (solo admin),
  `POST /products/:id/purchase` (solo admin — llegó mercadería, cantidad +
  costo → suma stock y opcionalmente egreso en caja),
  `POST /products/:id/adjust` (solo admin — corrección +/-, no toca caja),
  `POST /products/:id/sell` (cualquier rol — venta de mostrador, resta
  stock y genera ingreso en caja).
- **Precios:** `POST/PUT/DELETE /services[/:id]` (solo admin).
- **Caja** (solo admin): `GET /cash` (filtros `period`, `type`, `group`),
  `GET /cash/summary`, `POST /cash`, `DELETE /cash/:id`.
- **Reportes** (solo admin): `GET /reports/monthly`,
  `GET /reports/services?days=30|90|365`, `GET /reports/products?days=...`.
- **Backups** (solo admin): `GET/POST /backups`, `DELETE /backups/:id`,
  `POST /backups/:id/restore`, `GET /backup/export` (descarga archivo),
  `POST /restore` (sube un backup exportado).

## 11. Convenciones de código y decisiones de estilo (para mantener consistencia)

- **Sin frameworks a propósito**, para minimizar dependencias y superficie
  de mantenimiento (un proyecto chico, para una sola veterinaria, sin
  equipo de desarrollo detrás). Si se decide migrar a Express/Fastify o a
  un frontend con framework (React/Vue), es un cambio de fondo, no un
  ajuste incremental.
- **Frontend "recarga todo" tras cada escritura:** casi todas las acciones
  de `app.js` llaman a `reload()`, que vuelve a pedir `/bootstrap` (y la
  vista actual si hace falta) y re-renderiza. No hay estado optimista ni
  websockets ni polling. Es simple e intencional para este tamaño de app;
  no está pensado para muchos usuarios concurrentes escribiendo a la vez
  (no habría conflictos de datos graves porque las operaciones son atómicas
  en el servidor, pero la interfaz de otro usuario no se actualiza sola).
- **Validación centralizada en `util.js`:** cualquier ruta nueva en
  `api.js` debería reusar `reqStr/optStr/reqDate/optDate/reqNum/reqInt/
  money/oneOf/idParam/checkEmail` en vez de validar a mano, para mantener
  los mismos mensajes de error en español y los mismos límites.
- **Todos los mensajes de error orientados al usuario final están en
  español, sin tecnicismos** (ej.: "No se pudo restaurar: la copia tiene
  datos dañados o incompatibles" en vez de exponer el error de Postgres).
  Esto es intencional porque quien usa el sistema no es técnico.
- **Categorías de producto/servicio/caja y formas de pago son listas fijas**
  (`util.js`: `PROD_CATS`, `SERV_CATS`, `CASH_CATS`, `METHODS`), validadas
  con `oneOf` tanto en frontend como en backend. Si se quiere hacerlas
  configurables por el usuario, hay que cambiarlas en ambos lados y en el
  `CHECK` de `schema.sql` si se agregara una restricción a nivel de base
  (hoy esas columnas son `TEXT` sin `CHECK`, la validación es solo de
  aplicación).
- **Identidad visual:** paleta verde-azulado ("teal") oscuro para la barra
  lateral, tipografía `Bricolage Grotesque` para títulos y `Figtree` para
  texto (cargadas desde Google Fonts), tema claro/oscuro automático según
  preferencia del sistema operativo (`prefers-color-scheme`), diseño
  responsive con un quiebre a los 820px (en mobile, la lista de pacientes y
  el detalle se muestran uno a la vez con un botón "Volver").

## 12. Qué falta o quedó pendiente (mencionado explícitamente al usuario)

Estas son mejoras que se sugirieron pero **no se implementaron** (quedaron
como posible trabajo futuro si el usuario o esta IA las retoman):

- Turnos/agenda con recordatorios (WhatsApp) de vacunas y controles.
- Ficha de "dueño" separada de "paciente" (hoy el dueño es solo texto
  suelto dentro de cada paciente; un mismo dueño con varias mascotas no
  está modelado como entidad única, así que sus datos se repiten en cada
  paciente y no hay cuenta corriente ni saldo consolidado por dueño).
- Cuentas corrientes / pagos parciales o en cuotas.
- Seguimiento de peso a lo largo del tiempo y de antiparasitarios con
  vencimiento (hoy solo las vacunas tienen fecha de "próxima dosis").
- Adjuntar fotos o estudios (radiografías, análisis) a la historia clínica.
- Registro específico de cirugías/internaciones (hoy se tratan como un
  diagnóstico + un cobro más, no como su propia entidad).
- Proveedores, compras con número de lote y vencimiento por lote de
  producto (hoy el stock es un contador simple por producto, sin lotes).
- Impresión de carnet de vacunación, recetas o presupuestos en PDF.
- Suite de pruebas automatizadas versionada dentro del repositorio (ver
  sección 9: las pruebas usadas durante el desarrollo no se incluyeron).
- Nunca se probó una conexión real a un proyecto Supabase ni un despliegue
  real en Render; solo se probó contra un shim local de SQLite.
- No se implementó ningún control específico de cumplimiento de la ley
  argentina de protección de datos personales más allá de las buenas
  prácticas generales de seguridad (contraseñas hasheadas, HTTPS, control
  de acceso por rol); se le recomendó al usuario consultar a un
  profesional sobre ese tema.

## 13. Si esta IA va a modificar o extender el proyecto

- Leer primero `README.md` (dirigido al usuario final) y este archivo
  (dirigido a quien programa) antes de tocar código.
- Si se agrega una tabla o columna nueva, actualizar `db/schema.sql` (con
  `IF NOT EXISTS`/`ADD COLUMN IF NOT EXISTS` para no romper instalaciones
  ya desplegadas) y, si la tabla es de negocio, agregarla también a la
  lista `TABLES` de `server/backup.js` para que quede incluida en los
  backups y en restore/export.
- Si se agrega una ruta nueva en `server/api.js`, decidir explícitamente su
  nivel de acceso (`public`, sesión requerida, o `admin: true`) y replicar
  esa misma restricción en qué botones/pantallas muestra `public/app.js`
  para el rol `staff` (hoy la ocultación en frontend y el bloqueo real en
  backend se mantienen sincronizados a mano, no hay una fuente única de
  verdad de permisos).
- Cualquier variable de entorno nueva debe agregarse a `.env.example` (con
  explicación en español) y, si es obligatoria, a la validación de
  `checkEnv()` en `server/index.js` y a `render.yaml`.
- Mantener los mensajes de cara al usuario en español simple: este
  proyecto está pensado para alguien sin formación técnica.
