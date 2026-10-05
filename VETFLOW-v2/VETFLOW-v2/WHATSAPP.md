# Chatbot de WhatsApp

El bot vive **dentro del mismo servidor** del sistema (`server/whatsapp/`): no hay un servicio aparte. Lee y escribe directamente en las mismas tablas (`clients`, `patients`, `vaccines`, `diagnoses`, `medications`, `weights`, `appointments`), así que lo que se agenda por WhatsApp aparece al instante en el calendario, y viceversa. Funciona solo por WhatsApp (Cloud API de Meta).

> Decisión de diseño: el pedido original proponía Express + MySQL y una API REST aparte (`/api/turnos/...`). El sistema real usa Node sin Express y Postgres, y el bot necesita exactamente los mismos datos, así que se integró como módulo en vez de duplicar tablas y endpoints. No hay dependencias nuevas (usa `fetch` de Node 18+).

## Qué hace

| Función | Cómo |
|---|---|
| Sacar turno (consulta o vacuna) | Ofrece los próximos horarios libres (según horario de atención, duración del turno y agenda). Cliente nuevo: pide mascota, especie, sexo, nombre y dirección (opcional) y **recién al confirmar** crea cliente + mascota + turno. Devuelve el número de turno (`#id`). |
| Reprogramar / cancelar | Solo sobre turnos de mascotas del cliente dueño de ese número. Reprogramar conserva el número de turno. Cancelar pide motivo (opcional) y borra el turno. |
| Confirmación | Aviso 24 h antes pidiendo confirmación; si no confirmó, segundo aviso 2 h antes. Un turno sacado con menos de 24 h de anticipación no recibe el de 24 h. |
| Vacunas | Aviso 7 días antes (o menos, si la fecha se cargó tarde) y otro después de vencida (hasta 30 días). No avisa si la vacuna ya se renovó o si ya hay turno de vacuna agendado. Solo entre las 9 y las 20 h. |
| Información del consultorio | Dirección, teléfono, veterinario, horarios, medios de pago y servicios. |
| Consultas médicas | Detecta síntomas, no diagnostica: deriva al teléfono del veterinario y ofrece turno de consulta. Si detecta una urgencia, lo dice primero. |
| Historial de la mascota | Última vacuna y próximo vencimiento, consultas, medicación y peso. Solo para el dueño (se identifica por el teléfono). |

Todos los mensajes (entrantes y salientes) se guardan en `chat_logs`.

## Puesta en marcha

1. **Datos del consultorio.** Ya vienen cargados de fábrica (nombre, dirección, teléfono, horarios y enlace de Google Maps, que el bot también usa para "cómo llegar" y reseñas): se guardan en la tabla `clinic_settings` la primera vez que arranca el servidor y no se pisan después. El bot no inventa nada: lo que no esté cargado, no lo informa; y sin horarios no ofrece turnos. Para cambiarlos más adelante, como administrador, `PUT /api/whatsapp/settings` (campos: `name`, `address`, `phone`, `vet`, `mapsUrl`, `hours`, `payments`, `services`). `hours`: 0 = domingo … 6 = sábado; lista vacía = cerrado; admite varias franjas por día, ej. `"1": [["10:00","13:00"],["17:00","19:00"]]`. `GET /api/whatsapp/status` dice qué falta configurar. El nombre del veterinario todavía no está cargado (el bot lo omite hasta que se agregue).
2. **Meta.** Creá la app de WhatsApp Business en developers.facebook.com y obtené el *Phone number ID* y un *token permanente* (usuario del sistema).
3. **Variables de entorno** (en Render):

   | Variable | Para qué |
   |---|---|
   | `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_ID` | Enviar mensajes |
   | `WHATSAPP_VERIFY_TOKEN` | Texto que vos elegís; se usa al configurar el webhook |
   | `WHATSAPP_APP_SECRET` | Firma de Meta. **Obligatoria en producción**: sin ella se rechazan todos los avisos |
   | `WHATSAPP_LOG_KEY` | (Recomendada) cifra con AES-256-GCM el texto guardado en `chat_logs` |
   | `WHATSAPP_RATE_LIMIT` | Mensajes por minuto por número (20 por defecto) |
   | `WHATSAPP_REMINDERS=false` | Apaga los recordatorios automáticos |
   | `WHATSAPP_TPL_*`, `WHATSAPP_TEMPLATE_LANG` | Plantillas (ver abajo) |

4. **Webhook en Meta:** URL `https://TU-DOMINIO/webhook/whatsapp`, token de verificación = `WHATSAPP_VERIFY_TOKEN`, y suscribite al campo **messages**.
5. Escribile al número desde un celular para probar.

## Importante: plantillas para los recordatorios

WhatsApp solo permite mensajes de texto libres dentro de las **24 h posteriores al último mensaje del cliente**. Los recordatorios los inicia el consultorio, así que **en producción necesitan plantillas aprobadas por Meta** (categoría *Utility*). Si no configurás plantilla, el bot intenta enviar texto simple, que Meta rechaza fuera de esa ventana (el aviso se reintenta 3 veces y queda en `failed`).

Creá una plantilla por tipo (idioma `es_AR`, o el de `WHATSAPP_TEMPLATE_LANG`) y poné su nombre en la variable:

| Variable | Parámetros del cuerpo |
|---|---|
| `WHATSAPP_TPL_VACCINE_BEFORE` | `{{1}}` cliente, `{{2}}` mascota, `{{3}}` fecha de vencimiento |
| `WHATSAPP_TPL_VACCINE_AFTER` | `{{1}}` cliente, `{{2}}` mascota, `{{3}}` fecha de vencimiento |
| `WHATSAPP_TPL_APPT_24H` | `{{1}}` cliente, `{{2}}` mascota, `{{3}}` fecha, `{{4}}` hora |
| `WHATSAPP_TPL_APPT_2H` | `{{1}}` cliente, `{{2}}` mascota, `{{3}}` fecha, `{{4}}` hora |

Cuando el cliente responde, se abre la ventana de 24 h y el bot continúa la conversación con texto normal.

## Cómo reconoce al cliente

Por el teléfono: se compara el número de WhatsApp con `clients.phone` aceptando las variantes argentinas (`+54 9 11…`, `011 15…`, con guiones, etc.). Para que el bot reconozca a un cliente y le mande recordatorios, su teléfono tiene que estar cargado con **código de área** (10 dígitos). Un número de otro país o sin área no se puede asociar.

## Seguridad

- Cada aviso de Meta se valida con `X-Hub-Signature-256` (HMAC-SHA256, comparación en tiempo constante).
- Límite de mensajes por número; mensajes duplicados de Meta se descartan (`chat_logs.wa_message_id` único).
- Un cliente solo ve y modifica turnos y datos de **sus** mascotas.
- Los dos turnos simultáneos al mismo horario se resuelven con un candado en la base: gana uno, al otro se le ofrecen otros horarios.
- Credenciales solo por variables de entorno. HTTPS lo fuerza el servidor en producción.

## Pruebas

```
TEST_DATABASE_URL=postgres://... DATABASE_SSL=false npm test
```
**Usá una base de pruebas: el test vacía las tablas.** Sin `TEST_DATABASE_URL` corren solo las pruebas de interpretación de texto.

## Pendiente / fuera de alcance

- No hay pantalla para editar los datos del consultorio: se cargan por la API (arriba).
- El bot entiende texto por reglas y palabras clave (rápido, sin costo ni dependencias), no un modelo de lenguaje. Si dice "no te entendí" muestra el menú.
- Imágenes, audios y ubicaciones se responden pidiendo texto.

## Guía paso a paso (lo que tiene que hacer la veterinaria)

1. **Conseguir el número de WhatsApp del bot.** Tiene que ser un número **que no esté usado en la app de WhatsApp o WhatsApp Business del celular** (si lo está, hay que borrar esa cuenta antes de registrarlo en la API). Lo más simple: un chip nuevo solo para esto. También se puede usar el fijo de la clínica, porque Meta permite verificar por llamada de voz, pero ese número dejaría de poder usarse en WhatsApp común.
2. **Crear la cuenta de Meta Business** en business.facebook.com con el nombre de la clínica. Conviene hacer la **verificación del negocio** (pide datos y documentación fiscal): sin ella los límites de envío son bajos.
3. **Crear la app** en developers.facebook.com → *Crear app* → tipo *Empresa* → agregar el producto **WhatsApp**.
4. **Registrar el número** en *WhatsApp → Configuración de la API* → *Agregar número de teléfono*: nombre visible (ej. "Cats & Dogs Dr Dalton"), y verificarlo con el código que llega por SMS o llamada.
5. **Cargar un método de pago** en la cuenta de WhatsApp Business (Meta cobra los mensajes que inicia el negocio, o sea los recordatorios; las respuestas dentro de las 24 h siguientes a un mensaje del cliente tienen otra tarifa. Revisar las tarifas vigentes en Meta).
6. **Obtener las credenciales:**
   - *Phone number ID*: en *Configuración de la API* → `WHATSAPP_PHONE_ID`.
   - *App Secret*: *Configuración de la app → Básica* → `WHATSAPP_APP_SECRET`.
   - *Token permanente*: Business Settings → *Usuarios del sistema* → crear uno (admin) → asignarle la app y la cuenta de WhatsApp → *Generar token* con los permisos `whatsapp_business_messaging` y `whatsapp_business_management` → `WHATSAPP_ACCESS_TOKEN`. (El token temporal de 24 h sirve solo para probar.)
   - Inventar un texto cualquiera para `WHATSAPP_VERIFY_TOKEN`.
7. **Cargar las variables en Render** (más `WHATSAPP_LOG_KEY` con un texto largo al azar) y esperar a que se reinicie el servicio. Las tablas nuevas y los datos del consultorio se crean solos.
8. **Conectar el webhook** en Meta → *WhatsApp → Configuración* → *Webhook*: URL `https://TU-DOMINIO/webhook/whatsapp`, token de verificación = `WHATSAPP_VERIFY_TOKEN`, y suscribirse al campo **messages**.
9. **Crear y aprobar las 4 plantillas** de los recordatorios (sección anterior) en *WhatsApp Manager → Plantillas de mensajes*, categoría *Utilidad*. La aprobación tarda desde minutos hasta un par de días. Cuando estén, poner sus nombres en las variables `WHATSAPP_TPL_*`.
10. **Que el servicio no se duerma.** El plan gratuito de Render se suspende tras unos minutos sin tráfico: el bot tardaría en contestar y **los recordatorios no saldrían** mientras esté dormido. Para uso real, usar un plan pago de Render (o un servicio externo que visite `/healthz` cada 5 minutos).
11. **Cargar bien los teléfonos de los clientes** (con código de área, 10 dígitos), porque así el bot los reconoce y les manda los recordatorios.
12. **Probar** con tu celular antes de avisar a los clientes: sacar un turno, reprogramar, cancelar, preguntar la dirección. Mientras la app de Meta está en modo desarrollo, solo reciben mensajes los números agregados como testers; para atender a cualquier cliente hay que pasar la app a modo *Live*.
13. **Completar el perfil de WhatsApp Business** (foto, descripción, dirección, horarios) y recién ahí **difundir el número** (cartel en el local, redes, Google Maps).
