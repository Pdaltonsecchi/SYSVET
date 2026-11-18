# Página de turnos: qué se probó y qué se podría mejorar

Revisión de la página pública de turnos (noviembre de 2026), hecha en un navegador real en celular (390 px), tablet (820 px) y computadora (1280 px), con datos de prueba.

## Estado después de la ronda 2 (rama `mejoras-turnos-2`)

| # | Sugerencia | Estado |
|---|---|---|
| 1 | Menos botones de hora | **Hecha, como la pediste:** primero la hora y después los minutos; consulta cada 20 minutos y vacuna cada 10. No se agregó "Primer horario libre". |
| 2 | Nombre en el título, al compartir y datos para Google | **Hecha.** Sin nombre cargado dice "Veterinaria", nunca "SYSVET". |
| 3 | Reseña después de una atención | **Hecha.** Cambia lo que habías pedido antes: ya no se pregunta al terminar de pedir un turno, sino en "Tus turnos" a quien ya vino a un turno confirmado, una vez por cliente en ese dispositivo. |
| 4 | Cuidado al cancelar un confirmado | **Hecha:** aviso más claro al cliente y, para vos, aviso en "Para revisar" y marca "Cancelado por el cliente" en el calendario (hoy y mañana). Se sigue pudiendo cancelar desde la página. |
| 5 | "Agregar al calendario" | **Hecha:** "Agregar a Google Calendar" y archivo .ics. |
| 6 | Texto antes de la vacuna | **Reemplazada** por lo que pediste: un mensaje opcional que escribís al aceptar cada pedido. |
| 7 | Errores más amables | **Hecha.** |
| 8 | En celular, ir a "Pedir turno" al entrar | **Hecha.** |
| 9 | Detalles en celular | **Hecha.** |
| 10 | "Confirmado" más reconocible | **Hecha** (tilde y borde verde; el ámbar sigue siendo solo de "Pendiente"). |
| 11 | Calendario más corto | **No se hace** (la descartaste): se mantiene el mes completo y ahora se puede avanzar hasta 90 días. |
| 12 | No perder la mascota escrita | **Hecha.** |

Siguen pendientes de una decisión tuya: el color de los mensajes de error de los formularios (hoy rojo) y "Otra especie" (el servidor solo acepta Perro y Gato).

## Lo que se probó y anduvo bien

- **Portada:** con los datos cargados se ve el nombre, el profesional, la dirección, los servicios, "Sacar turno" y "Llamar". En computadora el formulario se ve sin bajar.
- **"Sacar turno"** baja al formulario y deja el cursor en el teléfono. La **barra fija de abajo** en celular aparece al bajar a los datos de la clínica y se esconde en la sección de turnos.
- **Ingreso con teléfono:** entra con el número escrito de todas las formas probadas (con 0, con 15, con +54 9, con espacios, guiones o paréntesis). Un número que no está da "no registrado", con mensajes claros.
- **Cliente nuevo:** cada error aparece debajo de su campo. Si el teléfono ya existe, ofrece "Entrar con este número".
- **Pedir turno:** calendario, horarios, resumen y confirmación funcionan. Un día en que la mascota ya tiene turno lo explica.
- **Aviso de pendiente, reseña, "Tus turnos" y cancelar** funcionan como se pidió.
- **Teclado:** se puede hacer todo sin mouse.

## Problema que encontró y ya está arreglado

**Si otro cliente tomaba el mismo horario mientras el cliente revisaba su pedido, al confirmar no aparecía ningún mensaje** y podía creer que su turno había quedado hecho. Ahora aparece "Ese horario ya no está disponible. Elegí otro." arriba de los horarios. Probado en celular y computadora.

## Sugerencias originales, de mayor a menor impacto

| # | Qué | Para quién | Qué resuelve | Esfuerzo | ¿Toca una decisión tuya? |
|---|---|---|---|---|---|
| 1 | **Menos botones de hora.** Hoy un día muestra hasta 59 horarios (cada 10 minutos). Ofrecerlos cada 20 o 30 minutos según el servicio, o agruparlos por hora con solo la primera abierta, y un botón "Primer horario libre". | Los dos | En celular es una pared de botones. Para vos, evita huecos sueltos de 10 minutos. | Medio (toca el servidor) | No |
| 2 | **El nombre de la veterinaria en el título y en la vista previa al compartir**, y datos para Google (nombre, dirección, teléfono, horarios), sacados solo de lo que ya cargaste. Si no hay nombre, que diga "Veterinaria" y nunca "SYSVET". | Vos | Al compartir el enlace por WhatsApp hoy se ve "Veterinaria". Ayuda a que Google muestre la ficha. | Medio | No |
| 3 | **Preguntar por la reseña después de una atención**, por ejemplo en "Tus turnos" pasada la fecha de un turno confirmado, y una sola vez. | Los dos | Hoy se le pregunta "¿Ya nos conocés?" a quien todavía no vino, y al cliente de siempre en cada visita. | Medio | Cambia cuándo se pregunta (lo pediste al terminar de agendar). Se sigue sin leer reseñas de Google. |
| 4 | **Cuidado al cancelar un turno ya confirmado:** un aviso más claro ("La veterinaria ya te estaba esperando") y que la cancelación se vea bien en el sistema, con los cancelados de hoy y mañana. O que un confirmado se cancele solo llamando. | Vos | Hoy se puede cancelar un confirmado y te enterás solo si mirás el calendario. | Chico a medio | No (sin email ni WhatsApp) |
| 5 | **"Agregar al calendario"** del celular para los turnos confirmados, con la dirección como lugar. | El cliente | Menos olvidos y faltazos. | Chico | No: es un archivo que guarda el cliente, no un aviso. |
| 6 | **Texto antes de la vacuna** que escribís vos en Configuración (por ejemplo, qué traer). Si no lo cargás, no se muestra nada. | Los dos | El cliente llega preparado. | Medio | No (el texto es tuyo, nada inventado) |
| 7 | **Errores más amables:** sin teléfono cargado, no decir "llamá a la veterinaria"; que "Probar de nuevo" no borre el número escrito; para un número que no está, "No encontramos ese número. ¿Es tu primera vez? Anotate acá". | El cliente | Menos frustración al entrar. | Chico | No |
| 8 | **En celular, después de entrar, llevar la pantalla a "Pedir turno"** (hoy el calendario queda abajo, fuera de la pantalla). | El cliente | Un paso menos. | Chico | No |
| 9 | **Detalles en celular:** que el teléfono no se corte en dos renglones, "Vacuna · 10 min" en una línea, y en el resumen las etiquetas arriba de los datos. | El cliente | Se lee mejor. | Chico | No |
| 10 | **"Confirmado" más reconocible** que "Pendiente" (hoy cambia solo la pastilla). | El cliente | Se distingue de un vistazo. | Chico | No |
| 11 | **Calendario más corto:** mostrar solo los próximos 14 días en vez del mes entero (con días pasados en gris y un mes siguiente con un solo día). | El cliente | Menos ruido. | Medio | No |
| 12 | **Si el teléfono ya estaba registrado, no perder la mascota escrita** en el alta: ofrecer agregarla después de entrar. | El cliente | No hay que escribir todo de nuevo. | Chico | No |

## Las cinco de mayor impacto

1. Menos botones de hora (1).
2. Nombre de la veterinaria al compartir y datos para Google (2).
3. La reseña después de una atención (3).
4. Cuidado al cancelar un turno confirmado (4).
5. "Agregar al calendario" (5).

## Lo que no haría

- **Contraseñas o códigos por SMS:** van contra tu decisión de entrar solo con el teléfono y complican a la gente mayor.
- **Avisos por WhatsApp o email** y **reseñas leídas automáticamente de Google:** decisiones tuyas ya tomadas.
- **Precios, promociones o fotos del equipo:** no hay datos reales para mostrar.
- **Animaciones, carruseles o un mapa dentro de la página:** pesan y no ayudan a sacar un turno; el botón a Google Maps alcanza.
- **Un chat o asistente:** más mantenimiento que beneficio para una veterinaria chica.

## Estilo

Mantener la línea actual (fondo crema, un solo color para las acciones, el talón del turno, letra grande). Las mejoras van por **mostrar menos cosas a la vez** y **estados más fáciles de distinguir**, no por decorar.

Queda una decisión tuya pendiente: los mensajes de error de los formularios usan rojo, y vos pediste el rojo solo para cancelar.

## Para tener en cuenta

- **Con solo los últimos 8 dígitos (sin código de área) también se entra.** Dos clientes de distintas ciudades con el mismo número local podrían confundirse. Es parte de entrar solo con el teléfono; se anota para que lo sepas.
- **Desde la página no se pueden pedir consulta y vacuna el mismo día para la misma mascota** (es el tope de un turno por mascota por día).

## Lo que no se pudo probar

- Que se oculten los horarios ya pasados del día (la prueba fue de madrugada).
- Sesión vencida o conexión caída (los mensajes se revisaron leyendo el código).
- Un lector de pantalla real, un iPhone o un Android de verdad (se simuló el celular en Edge).
- Feriados: la página no los conoce. Para cerrar un día puntual hoy hay que cambiar el horario de atención.
- El efecto real en Google de los datos sugeridos en el punto 2.
