'use strict';
// Página pública de turnos (public/turnos.html): el servidor le escribe el nombre de la veterinaria en el título, la
// descripción y la vista previa al compartir el enlace (Open Graph), y un bloque de datos para Google (JSON-LD de tipo
// LocalBusiness). Todo sale de lo que el dueño cargó en Configuración: no se inventa nada. Sin nombre cargado, la
// página dice "Veterinaria" (nunca "SYSVET").
const fs = require('fs');
const path = require('path');
const settings = require('./settings');

const FILE = path.join(__dirname, '..', 'public', 'turnos.html');
const DAY_URLS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Texto seguro dentro de HTML (también dentro de un atributo entre comillas dobles). */
const escHtml = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/**
 * JSON dentro de <script type="application/ld+json">: además del escape de JSON, nada que pueda cerrar la etiqueta
 * (</script>) ni abrir un comentario (<!--). Se escapan <, >, & y los separadores de línea de Unicode.
 */
const escJsonInHtml = (obj) =>
  JSON.stringify(obj).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

/** Horario de atención para Google: una entrada por franja y día. */
function openingHours(hours) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const v = hours && hours[d];
    if (!Array.isArray(v)) continue;
    for (const r of v) {
      if (Array.isArray(r) && r.length === 2) out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: 'https://schema.org/' + DAY_URLS[d], opens: r[0], closes: r[1] });
    }
  }
  return out;
}

/** Arma el HTML de la página con los datos de la veterinaria. `template` es el contenido de turnos.html. */
function render(template, st) {
  const own = st.publicName || '';
  const name = own || 'Veterinaria';
  const title = own ? own + ' · Turnos online' : 'Veterinaria · Turnos online';
  const parts = [own ? own + ':' : 'Veterinaria:', 'turnos online para consultas y vacunas.'];
  if (st.address) parts.push(st.address + '.');
  const description = parts.join(' ').replace(/\.\.$/, '.');

  const head = [
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="es_AR">',
    '<meta property="og:site_name" content="' + escHtml(name) + '">',
    '<meta property="og:title" content="' + escHtml(title) + '">',
    '<meta property="og:description" content="' + escHtml(description) + '">',
  ];
  // Datos para Google solo con un nombre real cargado: una ficha "Veterinaria" sin nombre no ayuda a nadie.
  if (own) {
    const ld = { '@context': 'https://schema.org', '@type': 'LocalBusiness', name: own };
    if (st.address) ld.address = st.address;
    if (st.phone) ld.telephone = st.phone;
    if (st.mapsUrl) ld.hasMap = st.mapsUrl;
    const oh = openingHours(st.hours);
    if (oh.length) ld.openingHoursSpecification = oh;
    head.push('<script type="application/ld+json">' + escJsonInHtml(ld) + '</script>');
  }

  return template
    .replace(/<title>[^<]*<\/title>/, '<title>' + escHtml(title) + '</title>')
    .replace(/<meta name="description" content="[^"]*">/, '<meta name="description" content="' + escHtml(description) + '">')
    .replace('</head>', '  ' + head.join('\n  ') + '\n</head>');
}

let cached = null;
/** HTML listo para mandar. La plantilla se lee una vez por proceso (en producción no cambia). */
async function turnosHtml() {
  if (!cached || process.env.NODE_ENV !== 'production') cached = fs.readFileSync(FILE, 'utf8');
  return render(cached, await settings.getSettings());
}

module.exports = { render, turnosHtml, escHtml, escJsonInHtml };
