# Lenguaje visual de SYSVET

Fuente de verdad del diseño del sistema interno (`public/styles.css`) y base de la página pública de turnos.
Si cambiás un valor acá, cambialo también en las variables de `:root`.

**Idea:** una herramienta de trabajo calma y prolija, con aire "iOS": fondo gris muy claro, tarjetas blancas de
esquinas amplias, sombras casi invisibles, controles grandes y barras translúcidas en celular. Nada decorativo:
el color se usa para decir algo (acción principal, estado, tipo de turno).

**Identidad:** se mantiene (verde salvia `--brand`, huella, menú oscuro). Dos ajustes, con su motivo:
- El grafito azulado pasó a un **grafito verdoso** (`#2E3833`) y el fondo crema a un **gris fresco** (`#F3F5F1`),
  para que el verde salvia, el menú y el fondo sean de la misma familia y el blanco de las tarjetas resalte.
- El texto usa la **fuente del dispositivo** (San Francisco en iPhone/Mac, Segoe en Windows, Roboto en Android) y los
  títulos siguen en Bricolage Grotesque, ahora **servida desde el propio sistema** (`/vendor`). Ya no se pide nada a
  Google Fonts: carga más rápido y no se comparte la visita con terceros.

## Tokens

| Grupo | Variable | Valor | Uso |
|---|---|---|---|
| Fondo | `--bg` | `#F3F5F1` | Fondo de la aplicación |
| | `--panel` | `#FFFFFF` | Tarjetas, tablas, campos, ventanas |
| | `--fill` / `--fill-soft` | `#E2E7E0` / `#F6F8F5` | Pista de pestañas, presionado / encabezado de tabla, hover |
| Texto | `--ink` | `#26302B` | Texto principal (12,4:1 sobre el fondo) |
| | `--muted` | `#58615C` | Texto secundario (≥5,1:1 en todos los fondos) |
| Líneas | `--line` | `#E1E5DF` | Solo separadores |
| | `--line-strong` | `#7C847F` | Bordes de campos y controles (≥3:1) |
| Marca | `--brand` | `#56785B` | Acción principal, selección (4,96:1 con texto blanco) |
| | `--brand-dark` / `--brand-soft` | derivado / `#DDE8DC` | Enlaces y texto de marca / fondo de lo seleccionado |
| Menú | `--side` | `#2E3833` | Menú lateral y hoja "Más" |
| Estados | `--ok` `--warn` `--bad` `--info` (+ `-bg`) | sin cambios | Siempre con texto, nunca solo color |
| Avisos | `--dot-*`, `--dot-pedido` (naranja) | sin cambios | Puntos de "Para revisar" |
| Turnos | `--appt-*` | sin cambios | **Reservados** para identificar tipos de turno |
| Radios | `--r-sm` `--r` `--r-lg` `--r-xl` | 8 / 12 / 16 / 22 px | Detalles / controles / tarjetas / ventanas y hojas |
| Sombras | `--sh-1` `--sh-2` `--sh-3` | ver CSS | Tarjeta apoyada / menús y carteles / ventanas |
| Movimiento | `--ease` | `cubic-bezier(.2,.8,.2,1)` | 120–280 ms, solo como respuesta a una acción |

Tipografía: títulos `--f-head` (700; h1 1,75 rem, h2 1,4 rem, h3 1,08 rem, interletra negativa leve); texto `--f-body`
16 px / 1,5. Números tabulares en toda la interfaz. Sin mayúsculas sostenidas.

Espaciado: múltiplos de 0,25 rem. Margen de página 1,75 rem arriba y `clamp(1rem, 3vw, 2.5rem)` a los lados; entre
bloques 1–1,5 rem; dentro de una tarjeta 1,1–1,25 rem.

## Componentes

- **Botones** (`.btn`): 40 px de alto (44 px en celular y pantallas táctiles), radio 12. *Principal* (`.primary`): verde
  lleno, uno por pantalla o ventana. *Común*: blanco con borde. *Fantasma* (`.ghost`): solo texto verde oscuro, para
  Cerrar/Cancelar. *Peligro* (`.danger`, `.danger-o`): rojo. Hover oscurece; presionado se achica a 97 %; deshabilitado
  al 50 % con cursor "no permitido". Foco: contorno verde de 3 px separado 2 px (en todo elemento enfocable).
- **Campos**: blancos, borde `--line-strong`, radio 12, 40/44 px. Al enfocar: borde verde + halo suave. Las listas
  desplegables llevan su flechita. Etiqueta siempre arriba, en negrita chica.
- **Tarjetas** (`.panel`, `.tbl-wrap`, `.summary`, `.cstrip`, `.rep-kpis`, días del calendario): blancas, radio 16,
  línea `--line` y sombra `--sh-1`. No se anidan tarjetas dentro de tarjetas.
- **Tablas**: dentro de una tarjeta; encabezado chico en `--muted` sobre `--fill-soft`; filas separadas por `--line`;
  números a la derecha. En celular cada fila es una tarjeta "título — valor".
- **Pestañas** (`.tabs`): control segmentado; pista `--fill`, la elegida es una ficha blanca con borde y texto en tinta.
- **Filtros y vistas** (`.seg`): pastillas; la elegida con fondo `--brand-soft`, borde verde y texto más pesado.
- **Etiquetas de estado** (`.chip`): pastilla con fondo suave y texto del color del estado.
- **Ventanas** (`dialog`): radio 22, sombra `--sh-3`, fondo oscurecido. En celular (≤640 px) son una **hoja que sube
  desde abajo**, a todo el ancho, con los botones grandes. Acciones abajo a la derecha: la principal al final.
- **Menú lateral**: grafito verdoso; la sección actual tiene fondo más claro y una barrita verde clara. "Para revisar"
  muestra los avisos con punto de color + texto.
- **Barra inferior (celular)**: translúcida con desenfoque (opaca si el navegador no lo soporta); la sección actual en
  verde oscuro con una marca arriba; punto de avisos en "Más". "Más" abre el menú como hoja inferior con agarre.
- **Carteles** (`#toast`): pastilla oscura flotante, sube 8 px al aparecer.

## Reglas que no se rompen

- Contraste WCAG AA: texto ≥4,5:1, bordes de controles y marcas de estado ≥3:1. El color nunca es la única señal.
- Objetivos táctiles ≥44 px en celular y pantallas táctiles.
- `prefers-reduced-motion`: sin animaciones.
- La impresión (`#print`) tiene su propio estilo y no depende de nada de esto.
- La política de seguridad del servidor no permite estilos en línea ni recursos de otros sitios.
