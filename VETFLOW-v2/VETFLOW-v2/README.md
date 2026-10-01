# VETFLOW — guía para ponerlo en marcha

Este proyecto tiene todo lo necesario: la página web, el servidor con su API, la conexión a la base de datos, usuarios con contraseña y conexión segura (HTTPS). **No trae ningún dato de ejemplo**: arranca vacío para que cargues tus pacientes, productos y precios.

Vas a usar tres servicios gratuitos:

| Servicio | Para qué sirve |
|---|---|
| **Supabase** | Guarda todos los datos (la base de datos) |
| **GitHub** | Guarda estos archivos para que Render los pueda leer |
| **Render** | Hace funcionar el sistema en internet y le pone HTTPS solo |

Tiempo estimado: 30 a 45 minutos. Si algo te trabás, no pasa nada: pedile ayuda a quien te armó el sistema o a alguien de confianza que sepa de computación.

---

## Paso 1 · Crear la base de datos (Supabase)

1. Entrá a **supabase.com** y creá una cuenta.
2. Tocá **New project**. Poné el nombre `veterinaria`.
3. En **Database password** elegí una contraseña **solo con letras y números** (sin símbolos como @ # / %) y **guardala**: la vas a necesitar.
4. En **Region** elegí la más cercana (por ejemplo *South America (São Paulo)*).
5. Esperá unos minutos a que termine de crearse.
6. Tocá el botón **Connect** (arriba, en la barra de tu proyecto). Se abre un panel con las formas de conectarse: elegí **Session pooler** (puede aparecer dentro de la pestaña *Direct*, como una opción o desplegable de "método"). La dirección se muestra abajo: copiala. Tiene que empezar con `postgresql://postgres.` y contener `pooler.supabase.com`.
   - Si no encontrás *Session pooler*: copiá la dirección de **Transaction pooler** (termina en `:6543/postgres`) y cambiá `6543` por `5432`. Con ese cambio es la misma que la del Session pooler.
   - No uses la dirección que tiene `db.` seguido de tu código y `.supabase.co`: esa es la conexión directa y desde Render no funciona.
7. Pegala en un bloc de notas y reemplazá `[YOUR-PASSWORD]` por la contraseña del paso 3 (sin los corchetes).

Esa dirección es tu `DATABASE_URL`. **No hace falta crear tablas**: el sistema las crea solo la primera vez.

> Importante: usá el **Session pooler** y no la conexión directa. La conexión directa no funciona desde Render.

## Paso 2 · Subir los archivos a GitHub

1. Entrá a **github.com** y creá una cuenta.
2. Tocá **New repository**. Poné el nombre `veterinaria` y elegí **Private** (privado).
3. Descomprimí el archivo `veterinaria-sistema.zip` en tu computadora.
4. En la página del repositorio tocá **uploading an existing file** y arrastrá **todo el contenido de la carpeta** (las carpetas `server`, `public`, `db` y los archivos sueltos como `package.json`).
5. Tocá **Commit changes**.

## Paso 3 · Poner el sistema en internet (Render)

1. Entrá a **render.com** y creá una cuenta (podés entrar con tu cuenta de GitHub).
2. Tocá **New +** → **Web Service** y conectá tu repositorio `veterinaria`.
3. Completá:
   - **Language / Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. En **Environment Variables** agregá estas cinco:

| Nombre | Qué poner |
|---|---|
| `DATABASE_URL` | La dirección del Paso 1 (con tu contraseña) |
| `SESSION_SECRET` | Un texto largo al azar, de 40 caracteres o más (por ejemplo, tecleá letras y números sin sentido) |
| `ADMIN_EMAIL` | Tu email (va a ser tu usuario para ingresar) |
| `ADMIN_PASSWORD` | La contraseña con la que vas a ingresar (mínimo 8 caracteres) |
| `NODE_ENV` | `production` |

5. En **Advanced** poné **Health Check Path:** `/healthz`.
6. Tocá **Create Web Service** y esperá unos minutos. Cuando diga *Live*, Render te muestra la dirección de tu sistema: algo como `https://veterinaria.onrender.com`.

Esa dirección ya funciona con **HTTPS** (el candadito del navegador): Render lo activa solo y el sistema redirige cualquier acceso sin HTTPS.

> Atajo opcional: el proyecto trae un archivo `render.yaml`. Si en Render elegís **New +** → **Blueprint**, carga esta configuración solo y solo te pide las variables `DATABASE_URL`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

## Paso 4 · Primer ingreso

1. Abrí la dirección de tu sistema.
2. Ingresá con el `ADMIN_EMAIL` y el `ADMIN_PASSWORD` que pusiste en Render.
3. Tocá **Cambiar contraseña** (abajo a la izquierda) y poné una que solo vos sepas.
4. En **Farmacia y caja → Lista de precios** cargá tus consultas, vacunas y cirugías.
5. En **Farmacia y caja → Stock** cargá tus productos. Si completás cuánto pagaste por el stock inicial, se suma a egresos.
6. En **Usuarios** creá a tus ayudantes. Ellos ven pacientes, cobran y venden, pero no ven la caja, los reportes ni las copias, y no pueden borrar pacientes ni cambiar precios.
7. En **Pacientes** empezá a cargar.

> Después de que el sistema crea tu usuario, cambiar `ADMIN_PASSWORD` en Render ya no tiene efecto. Para cambiar la contraseña usá el botón dentro del sistema.

---

## Copias de seguridad (leer con atención)

La base de datos gratuita **no incluye copias de seguridad propias**. Por eso el sistema hace lo siguiente:

- **Una copia automática por día**, guardada dentro de la misma base de datos (se conservan las últimas 14). Sirve para recuperarte de un error, por ejemplo si borrás algo sin querer.
- **Descarga a un archivo** (Copias de seguridad → *Descargar copia a mi computadora*). Esto es lo que te protege de verdad si se perdiera la base.

**Hábito recomendado: descargá una copia por lo menos una vez por semana** y guardala en un pendrive o en tu correo. El sistema te avisa a la izquierda si pasaron más de 7 días.

Para volver atrás, entrá a **Copias de seguridad** y tocá **Restaurar** en una copia guardada, o **Cargar desde archivo**. Antes de restaurar, el sistema guarda automáticamente una copia de lo que hay.

---

## Cosas que tenés que saber del plan gratuito

- **Render (gratis):** si nadie usa el sistema durante 15 minutos, se "duerme". La próxima vez que alguien lo abra, tarda cerca de un minuto en despertar. Después anda normal. Render indica que el plan gratuito está pensado para pruebas y no para uso en producción; si la demora te molesta, pasar al plan pago más chico (Starter) lo deja siempre encendido.
- **Supabase (gratis):** el proyecto se pausa si pasa una semana sin usarse. Usándolo todos los días no pasa. Si alguna vez se pausa, tus datos siguen ahí y lo reactivás desde el panel de Supabase.
- **Espacio:** el plan gratuito de Supabase incluye 500 MB. Para texto (pacientes, cobros, stock) alcanza para muchísimo tiempo.

## Seguridad

- Las contraseñas se guardan cifradas (nadie puede leerlas, ni siquiera el administrador).
- Las sesiones duran 7 días y se cierran solas si cambiás la contraseña.
- Después de 5 intentos fallidos de ingreso, ese usuario se bloquea 15 minutos.
- Toda la comunicación va por HTTPS.
- Guardás nombres, teléfonos y mails de tus clientes: conviene tener en cuenta la ley argentina de protección de datos personales. Un profesional puede confirmarte qué te corresponde.

## Actualizar el sistema

Si algún día cambian los archivos, subilos al repositorio de GitHub y Render vuelve a publicar solo.

## Si algo no anda

- **Render dice "Deploy failed" o la página no abre:** entrá a Render → tu servicio → **Logs**. Ahí aparece el motivo. Los más comunes:
  - Falta `DATABASE_URL` o `SESSION_SECRET`, o `SESSION_SECRET` es demasiado corto.
  - La contraseña de la base tiene símbolos y la dirección quedó mal. Cambiala en Supabase por una solo con letras y números.
  - Se usó la conexión directa en vez del *Session pooler*.
- **"Email o contraseña incorrectos" con tu usuario administrador:** revisá que `ADMIN_EMAIL` y `ADMIN_PASSWORD` estén bien escritos en Render.
- **Se olvidó la contraseña de administrador:** otro administrador puede cambiarla desde **Usuarios**. Si eras el único, hay que pedir ayuda técnica.

## Para quien lo mantenga (técnico)

- Node 18 o superior. Única dependencia: `pg`. Sin framework: servidor HTTP propio en `server/`, página estática en `public/`.
- Las tablas están en `db/schema.sql` y se crean solas al iniciar (es seguro correrlo varias veces).
- Probarlo en una computadora: copiar `.env.example` como `.env`, cargar las variables, usar `DATABASE_SSL=false` si la base es local y ejecutar `npm start`.
- Las sesiones son cookies firmadas (HttpOnly, SameSite=Strict, Secure en producción). Las contraseñas usan scrypt.
- Los movimientos de stock y de caja son registros individuales; el stock de cada producto se actualiza en la misma transacción.
