# Turnos por la web: cómo usarlo

Guía corta para la veterinaria. No hace falta saber de computación.

## Qué es

Tus clientes pueden entrar a una página, ver los datos de la veterinaria y **pedir un turno** para una consulta o una vacuna.
El pedido no entra solo a la agenda: queda **pendiente** hasta que vos lo aceptes.

La página está en la misma dirección del sistema, agregando `/turnos.html` al final. Por ejemplo:
`https://tu-veterinaria.onrender.com/turnos.html`

Esa es la dirección que tenés que poner en la ficha de Google Maps.

## 1. Cargar los datos que ve el cliente

En el sistema, andá a **Configuración → General**.

| Dato | Dónde se carga | Qué ve el cliente |
|---|---|---|
| Nombre de la veterinaria | "Veterinaria" | El título de la página, la vista previa cuando compartís el enlace (por ejemplo por WhatsApp) y los datos que lee Google. Si no hay nombre, dice "Veterinaria". |
| Horario de atención | "Horario de atención" | Los horarios de cada día. **También define qué horarios se pueden pedir.** |
| Medios de pago | "Medios de pago" | "Formas de pago" |
| Nombre del profesional | "Página pública" | "A cargo de…" |
| Teléfono de la veterinaria | "Página pública" | El botón "Llamar", y el número que ve quien no puede entrar. Sin teléfono, ningún mensaje le dice "llamá". |
| Dirección | "Página pública" | "Dónde estamos", y el lugar del turno cuando el cliente lo agrega a su calendario |
| Enlace de Google Maps | "Página pública" | El botón "Ver en Google Maps" |
| Reseñas | "Página pública" | "Lo que dicen nuestros clientes" |
| Enlace para dejar una reseña | "Página pública" | La pregunta por la reseña en "Tus turnos", después de que vino a un turno |

Tocá **Guardar cambios** al terminar.

Cargá sí o sí el **teléfono**: es el que la página le muestra al cliente cuando no lo reconoce.

### El enlace de Google Maps

1. Abrí Google Maps y buscá tu veterinaria.
2. Tocá **Compartir** y después **Copiar enlace**.
3. Pegalo en "Enlace de Google Maps". Tiene que empezar con `https://`.

### Las reseñas

Se escriben a mano, **una por línea**, con este formato:

```
estrellas | autor | texto
```

Ejemplo:

```
5 | María P. | Muy buena atención con mi perro.
4 | Jorge L. | Buena atención, a veces hay que esperar un rato.
```

- Las estrellas van del 1 al 5.
- Podés mostrar hasta 6 reseñas.
- Copialas tal cual están en Google Maps, con el nombre como figura ahí.
- Conviene elegir reseñas que representen cómo atendés de verdad, no solo las de cinco estrellas: una página con todas perfectas genera menos confianza.

### El enlace para dejar una reseña

Es **distinto** del de Google Maps: el de Maps abre la ficha de tu veterinaria; este abre directo el formulario para escribir una reseña.

1. Entrá a Google con la cuenta que administra tu veterinaria y buscá el nombre de tu veterinaria.
2. En el panel de tu Perfil de Empresa, tocá **"Pedir reseñas"** (en algunos casos dice "Conseguir más reseñas").
3. Copiá el enlace que te da y pegalo en "Enlace para dejar una reseña". Tiene que empezar con `https://`.

**Cuándo pregunta:** en "Tus turnos", a quien ya vino a un turno confirmado (la fecha ya pasó). Se pregunta **una sola vez** por cliente en ese celular o computadora: si toca "Dejar reseña" o "Ahora no", no se le vuelve a preguntar. Antes se preguntaba al terminar de pedir un turno; se cambió para preguntarle a quien ya conoce la atención.

Si lo dejás vacío, la página no pregunta nada.

Dos reglas de Google que conviene respetar (si no, Google puede borrar reseñas):
- **Se le pregunta a todos por igual.** La página no elige a quién preguntarle según si quedó contento o no.
- **No se ofrece nada a cambio** (descuentos, regalos) por dejar una reseña.

## 2. Qué hace el cliente

1. Entra a la página y escribe **su teléfono** (el que le dio a la veterinaria). No importa si lo escribe con 011, con 15, con +54 9, con espacios o con guiones.
2. Si es cliente nuevo, toca **Soy cliente nuevo** y carga su nombre, apellido, teléfono y su mascota. Queda guardado como cliente en tu sistema.
3. Elige **consulta** o **vacuna** y la mascota. Después elige el **día** en un calendario del mes. Solo se pueden tocar los días con horarios libres, dentro de los **próximos 90 días** (unos tres meses): con las flechas pasa de mes (por ejemplo, de noviembre a diciembre) hasta el último mes con lugar. Abajo del calendario dice hasta qué día se puede pedir.
4. Elige la **hora** en dos pasos: primero ve solo las horas que tienen algo libre (09:00, 10:00, 11:00…), separadas en mañana y tarde; al tocar una, aparecen los **minutos libres de esa hora**. La **consulta** (20 minutos) se ofrece cada 20 minutos (:00, :20 y :40) y la **vacuna** (10 minutos) cada 10.
5. Antes de pedirlo ve un **resumen** (servicio, mascota, día y hora) y toca **Confirmar pedido**. Recién ahí te llega el pedido.
6. Ve un aviso grande: **"Tu turno quedó pendiente"**, con el día y la hora, que le explica que todavía no está confirmado y que vuelva a entrar con su teléfono para ver si lo aceptaste. Le sugiere guardar la página en favoritos y le muestra tu teléfono por si no puede esperar.
7. En **"Tus turnos"** ve cada turno con su estado explicado: **pendiente** (esperando que lo confirmes, en color ámbar), **confirmado** (te esperamos, con una tilde ✓ y borde verde) o **no se pudo confirmar** (lo rechazaste: ver más abajo).
   En un turno **confirmado** además ve:
   - el **mensaje** que le dejaste al aceptarlo, si escribiste uno (ver la sección 3);
   - el botón **"Agregar a Google Calendar"**, que le arma el evento en su calendario con el día, la hora de inicio y fin, la dirección de la veterinaria y tu mensaje; y un enlace chico **"Descargar archivo (.ics)"** para quien usa otro calendario (el del iPhone, Outlook). No es un aviso que mandás vos: es un recordatorio que guarda el cliente.
8. Los turnos que pidió por la página los puede **cancelar** él mismo; para cambiar uno, lo cancela y pide otro. Si el turno ya estaba confirmado, antes de cancelar le aparece: *"La veterinaria ya te estaba esperando. Si cancelás, el horario queda libre para otra persona. Si podés, avisale también."*
   Los turnos que cargaste vos (por ejemplo una cirugía) los ve, pero no los puede cancelar desde la página: le dice que te llame (o que te avise, si no cargaste teléfono).

Las cirugías no se pueden pedir por la página: las seguís agendando vos.

Si el teléfono **no está registrado**, la página le dice *"No encontramos ese número. Revisá que tenga el código de área o, si es tu primera vez, anotate como cliente nuevo."*, en un cuadro tranquilo (no un error rojo) con el botón **"Soy cliente nuevo"** ahí mismo. "Probar de nuevo" deja el número escrito para que lo corrija.
Si el número figura en la ficha de **más de un cliente**, no lo deja entrar y le pide que te llame. **Sin teléfono cargado, la página no muestra ningún botón de llamar ni le dice "llamá".**

Si alguien se anota como cliente nuevo con un teléfono que ya estaba registrado, la página le ofrece **"Entrar con este número"** y, al entrar, le pregunta si quiere agregar la mascota que había escrito (no tiene que escribirla de nuevo).

## 3. Aceptar o rechazar un pedido

1. Cuando hay pedidos esperando, en el menú aparece un aviso en **"Para revisar"**: un punto **naranja** con el texto *"2 turnos pedidos desde la web para confirmar"*. Tocalo y te lleva al calendario. En el celular, el aviso está dentro de **Más** (el botón queda marcado con un punto naranja).
   En el **Calendario**, los pedidos de la web tienen la palabra **"Pendiente"** adelante.
2. Tocá el pedido. Vas a ver la mascota, el dueño con su teléfono, **el tipo de turno** (consulta o vacuna) y el horario.
3. Si querés, escribí un **mensaje para el cliente** en el campo *"Mensaje para el cliente (opcional)"*, por ejemplo *"Traer al perro en ayunas."* o *"Traer la libreta de vacunas."* (hasta 300 letras). Si no escribís nada, no se muestra nada.
4. Elegí:
   - **Aceptar turno**: pasa a la agenda como cualquier otro turno. El cliente lo ve como "Confirmado" y, debajo, tu mensaje (cuando vuelva a entrar con su teléfono). Si ya tenías otro turno confirmado a esa hora, el sistema te avisa antes de aceptar; lo que escribiste no se pierde. El mensaje lo ve **solo ese cliente**, y lo podés releer tocando el turno en el calendario.
   - **Rechazar**: el horario queda libre para otra persona. Durante **7 días** el cliente lo sigue viendo en "Tus turnos" con el mensaje *"La veterinaria no pudo confirmar este horario. Probá con otro o llamanos"* (con tu teléfono) y un botón para pedir otro horario.

Mientras un pedido está pendiente, **ese horario queda reservado**: nadie más lo puede pedir.

### Cuando un cliente cancela

Si un cliente cancela desde la página un turno de **hoy o mañana**, en **"Para revisar"** aparece *"1 turno de hoy o mañana cancelado por el cliente"* (con un punto gris). Tocalo y te lleva a ese día en el calendario.
En el **Calendario**, los turnos que canceló el cliente se siguen viendo, **apagados y tachados**, con *"Cancelado por el cliente"*. Ese horario ya está libre: la página lo vuelve a ofrecer.

El sistema no manda avisos por email ni por WhatsApp. El aviso de "Para revisar" se actualiza solo cada minuto mientras tengas el sistema abierto (no hace falta recargar), y cuando entra un pedido nuevo aparece un cartel abajo. El cliente se entera de lo que decidiste **cuando vuelve a entrar a la página**: si es urgente, llamalo.

## 4. Clientes y mascotas que se anotaron por la web

Cuando alguien se registra solo desde la página, en el sistema su ficha y la de su mascota llevan la etiqueta **"Creado desde la web"**, en la lista de **Clientes**, en la de **Pacientes** y en cada ficha.

- Mientras **no haya tenido ninguna visita** (un cobro, una consulta, una vacuna, una medicación, un estudio, o un turno confirmado que ya llegó), la etiqueta se ve **resaltada en azul** y la ficha muestra la nota *"Se registró solo desde la página de turnos y todavía no tuvo ninguna visita. Completá los datos si vuelve."*
- Con la primera visita, la etiqueta queda (para que sepas de dónde vino) pero en gris, y la nota dice solo cuándo se registró.
- Esa nota la muestra el sistema: **no se escribe en tus notas** de la mascota.
- Los clientes que se anotaron por la web **antes de esta actualización** no llevan la etiqueta: el sistema no tenía cómo saberlo.

## 5. Reporte: clientes que hace mucho no vienen

En **Reportes**, al final, está **"Clientes que hace mucho no vienen"**. Sirve para revisar y limpiar fichas.

- Elegís el período: **4 meses** (el que aparece primero), **6 meses** o **1 año**.
- **Última actividad** es la fecha más reciente entre cobros, consultas, vacunas, medicación, estudios, registros de peso y turnos confirmados de cualquiera de sus mascotas. Si nunca tuvo nada, es el día en que se creó la ficha.
- **No aparecen** los que tienen un turno por venir ni una vacuna con próxima dosis a futuro: a esos los estás esperando.
- Están ordenados del que más tiempo lleva al que menos. Los que **se anotaron por la web y nunca vinieron** aparecen resaltados: son los más claros para borrar.
- **El reporte no borra ni cambia nada.** Tocá el nombre para abrir la ficha y decidir. Para eliminar una ficha: primero la mascota, desde su historia clínica (queda 30 días en la Papelera), y después el cliente.

## Topes para que nadie abuse de la página

La página es pública, así que tiene límites. Un cliente normal no los nota:

- Una mascota puede tener **un turno por día**.
- Cada cliente puede tener hasta **3 pedidos esperando** tu confirmación. Cuando aceptás o rechazás alguno, puede pedir otro.
- Cada cliente puede cargar hasta **10 mascotas** desde la página.
- Si alguien prueba muchos teléfonos que no existen, la página deja de aceptar ingresos por unos minutos y muestra "llamá a la veterinaria" (o "consultalo en la veterinaria", si no cargaste teléfono).
- Se aceptan hasta **20 clientes nuevos por día** desde la página, y hasta **60 pedidos sin responder** en total. Si se llega a alguno de esos topes, la página pide llamar.
- Estos topes **no cambiaron** al pasar de 14 a 90 días: un cliente sigue pudiendo tener hasta 3 pedidos esperando, aunque ahora los puede pedir para más adelante.

Si ves muchos pedidos raros juntos, rechazalos: al bajar la cantidad de pendientes, la página vuelve a aceptar pedidos.

## Preguntas comunes

**Un cliente dice que la página no lo deja entrar.**
Fijate en **Clientes** cómo está guardado su teléfono. Si está mal escrito, corregilo. Si el mismo número figura en dos clientes distintos, la página no deja entrar a ninguno: dejá el teléfono en una sola ficha.

**Aparecen horarios que no quiero ofrecer.**
Los horarios salen del "Horario de atención" de Configuración. Si un día no atendés, dejalo sin horario.

**¿Por qué la consulta solo se ofrece a las :00, :20 y :40?**
Así lo pediste: la consulta dura 20 minutos y se ofrece cada 20, sin huecos sueltos de 10 minutos. Si un turno que cargaste vos deja un hueco "torcido" (por ejemplo, de 9:30 a 10:00), la página ofrece la consulta a las 9:40 y la vacuna a las 9:30 o 9:50: nunca algo que se pise con otro turno.

**¿Hasta cuándo se pueden pedir turnos?**
Hasta 90 días para adelante. Si algún día querés cambiarlo, es un número en el sistema (`DAYS_AHEAD`): pedíselo a quien te ayuda con el sistema.

**Quiero bloquear un rato (por ejemplo, una cirugía larga).**
Cargá el turno en el calendario como siempre. La página no ofrece los horarios que ya están ocupados.

**Alguien cargó datos falsos.**
Rechazá el pedido en el calendario. Si la mascota no existe, eliminala desde **Pacientes** (va a la Papelera).
