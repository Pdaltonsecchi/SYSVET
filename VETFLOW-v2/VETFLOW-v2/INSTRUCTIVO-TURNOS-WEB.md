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
| Nombre de la veterinaria | "Veterinaria" | El título de la página |
| Horario de atención | "Horario de atención" | Los horarios de cada día. **También define qué horarios se pueden pedir.** |
| Medios de pago | "Medios de pago" | "Formas de pago" |
| Nombre del profesional | "Página pública" | "A cargo de…" |
| Teléfono de la veterinaria | "Página pública" | El botón "Llamar", y el número que ve quien no puede entrar |
| Dirección | "Página pública" | "Cómo llegar" |
| Enlace de Google Maps | "Página pública" | El botón "Ver en Google Maps" |
| Reseñas | "Página pública" | "Lo que dicen nuestros clientes" |

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

## 2. Qué hace el cliente

1. Entra a la página y escribe **su teléfono** (el que le dio a la veterinaria). No importa si lo escribe con 011, con 15, con +54 9, con espacios o con guiones.
2. Si es cliente nuevo, toca **Soy cliente nuevo** y carga su nombre, apellido, teléfono y su mascota. Queda guardado como cliente en tu sistema.
3. Elige **consulta** o **vacuna** y la mascota. Después elige el **día** en un calendario del mes (solo se pueden tocar los días con horarios libres, dentro de los próximos 14) y la **hora**, separada en mañana y tarde.
4. Antes de pedirlo ve un **resumen** (servicio, mascota, día y hora) y toca **Confirmar pedido**. Recién ahí te llega el pedido.
5. Ve sus turnos. Los que pidió por la página los puede **cancelar** él mismo; para cambiar uno, lo cancela y pide otro.
   Los turnos que cargaste vos (por ejemplo una cirugía) los ve, pero no los puede cancelar desde la página: le dice que llame.

Las cirugías no se pueden pedir por la página: las seguís agendando vos.

Si el teléfono no está registrado, o figura en la ficha de más de un cliente, la página no lo deja entrar. Le sugiere revisar el código de área o anotarse como cliente nuevo y, si cargaste el teléfono de la veterinaria, le muestra el botón para llamar. **Sin teléfono cargado, la página no muestra ningún botón de llamar.**

## 3. Aceptar o rechazar un pedido

1. Cuando hay pedidos esperando, en el menú aparece un aviso en **"Para revisar"**: un punto **naranja** con el texto *"2 turnos pedidos desde la web para confirmar"*. Tocalo y te lleva al calendario. En el celular, el aviso está dentro de **Más** (el botón queda marcado con un punto naranja).
   En el **Calendario**, los pedidos de la web tienen la palabra **"Pendiente"** adelante.
2. Tocá el pedido. Vas a ver la mascota, el dueño con su teléfono, el tipo y el horario.
3. Elegí:
   - **Aceptar turno**: pasa a la agenda como cualquier otro turno. El cliente lo ve como "Confirmado". Si ya tenías otro turno confirmado a esa hora, el sistema te avisa antes de aceptar.
   - **Rechazar**: el pedido desaparece y el horario queda libre para otra persona.

Mientras un pedido está pendiente, **ese horario queda reservado**: nadie más lo puede pedir.

El sistema no manda avisos por email ni por WhatsApp. El aviso de "Para revisar" se actualiza solo cada minuto mientras tengas el sistema abierto (no hace falta recargar), y cuando entra un pedido nuevo aparece un cartel abajo. Si rechazás un pedido, llamá al cliente: en su página el turno simplemente deja de aparecer.

## Topes para que nadie abuse de la página

La página es pública, así que tiene límites. Un cliente normal no los nota:

- Una mascota puede tener **un turno por día**.
- Cada cliente puede tener hasta **3 pedidos esperando** tu confirmación. Cuando aceptás o rechazás alguno, puede pedir otro.
- Cada cliente puede cargar hasta **10 mascotas** desde la página.
- Si alguien prueba muchos teléfonos que no existen, la página deja de aceptar ingresos por unos minutos y muestra "llamá a la veterinaria".
- Se aceptan hasta **20 clientes nuevos por día** desde la página, y hasta **60 pedidos sin responder** en total. Si se llega a alguno de esos topes, la página pide llamar.

Si ves muchos pedidos raros juntos, rechazalos: al bajar la cantidad de pendientes, la página vuelve a aceptar pedidos.

## Preguntas comunes

**Un cliente dice que la página no lo deja entrar.**
Fijate en **Clientes** cómo está guardado su teléfono. Si está mal escrito, corregilo. Si el mismo número figura en dos clientes distintos, la página no deja entrar a ninguno: dejá el teléfono en una sola ficha.

**Aparecen horarios que no quiero ofrecer.**
Los horarios salen del "Horario de atención" de Configuración. Si un día no atendés, dejalo sin horario.

**Quiero bloquear un rato (por ejemplo, una cirugía larga).**
Cargá el turno en el calendario como siempre. La página no ofrece los horarios que ya están ocupados.

**Alguien cargó datos falsos.**
Rechazá el pedido en el calendario. Si la mascota no existe, eliminala desde **Pacientes** (va a la Papelera).
