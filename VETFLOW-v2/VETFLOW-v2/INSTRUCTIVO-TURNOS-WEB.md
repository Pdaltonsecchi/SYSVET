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
2. Si es cliente nuevo, toca **Cliente nuevo** y carga su nombre, apellido, teléfono y su mascota. Queda guardado como cliente en tu sistema.
3. Elige **consulta** o **vacuna**, la mascota y un horario libre de los próximos 14 días.
4. Ve sus turnos y puede **cancelarlos**. Para cambiar un turno, lo cancela y pide otro.

Las cirugías no se pueden pedir por la página: las seguís agendando vos.

Si el teléfono no está registrado, o figura en la ficha de más de un cliente, la página no lo deja entrar y le muestra el teléfono de la veterinaria para que llame.

## 3. Aceptar o rechazar un pedido

1. Abrí **Calendario**. Los pedidos de la web aparecen con la palabra **"Pendiente"** adelante.
2. Tocá el pedido. Vas a ver la mascota, el dueño con su teléfono, el tipo y el horario.
3. Elegí:
   - **Aceptar turno**: pasa a la agenda como cualquier otro turno. El cliente lo ve como "Confirmado".
   - **Rechazar**: el pedido desaparece y el horario queda libre para otra persona.

Mientras un pedido está pendiente, **ese horario queda reservado**: nadie más lo puede pedir.

El sistema no manda avisos por email ni por WhatsApp. Conviene mirar el calendario una o dos veces por día para aceptar o rechazar lo que haya llegado. Si rechazás un pedido, llamá al cliente: en su página el turno simplemente deja de aparecer.

## Preguntas comunes

**Un cliente dice que la página no lo deja entrar.**
Fijate en **Clientes** cómo está guardado su teléfono. Si está mal escrito, corregilo. Si el mismo número figura en dos clientes distintos, la página no deja entrar a ninguno: dejá el teléfono en una sola ficha.

**Aparecen horarios que no quiero ofrecer.**
Los horarios salen del "Horario de atención" de Configuración. Si un día no atendés, dejalo sin horario.

**Quiero bloquear un rato (por ejemplo, una cirugía larga).**
Cargá el turno en el calendario como siempre. La página no ofrece los horarios que ya están ocupados.

**Alguien cargó datos falsos.**
Rechazá el pedido en el calendario. Si la mascota no existe, eliminala desde **Pacientes** (va a la Papelera).
