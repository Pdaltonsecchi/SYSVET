'use strict';

/**
 * Adjuntos de estudios en Supabase Storage (bucket PRIVADO). Se usa la API REST con la clave
 * "service_role", que solo vive en el servidor: el navegador nunca habla con Storage. Los archivos se
 * ven con URLs firmadas de vencimiento corto, que genera el servidor solo para usuarios con sesión.
 *
 * Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y, opcionalmente, SUPABASE_BUCKET
 * (por defecto "estudios") y STORAGE_LIMIT_MB (por defecto 1024, el plan gratuito de Supabase).
 */
const crypto = require('crypto');
const U = require('./util');
const { HttpError } = U;

const BUCKET = process.env.SUPABASE_BUCKET || 'estudios';
const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const LIMIT_BYTES = (Number(process.env.STORAGE_LIMIT_MB) || 1024) * 1024 * 1024;

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_STUDY = 5;
const SIGNED_SECONDS = 600; // 10 minutos
// Tipos permitidos (por extensión; el tipo MIME que se guarda lo decide el servidor, no el navegador).
const TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  dcm: 'application/dicom',
};

const configured = () => !!(BASE && KEY);
function need() {
  if (!configured()) {
    throw new HttpError(503, 'Los adjuntos todavía no están configurados en el servidor (faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY).');
  }
}
const headers = (extra) => Object.assign({ Authorization: 'Bearer ' + KEY, apikey: KEY }, extra || {});
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function call(method, url, opts) {
  let res;
  try {
    res = await fetch(url, Object.assign({ method }, opts));
  } catch (e) {
    throw new HttpError(502, 'No se pudo conectar con el almacenamiento de archivos. Probá de nuevo en un momento.');
  }
  if (!res.ok) {
    let msg = '';
    try {
      msg = (await res.json()).message || '';
    } catch (e) {
      /* sin detalle */
    }
    console.error('Storage', method, res.status, msg);
    throw new HttpError(502, 'El almacenamiento de archivos respondió con un error (' + res.status + ').');
  }
  return res;
}

/** Sube un archivo al bucket (nunca pisa uno existente). */
async function upload(path, buf, mime) {
  need();
  await call('POST', BASE + '/storage/v1/object/' + BUCKET + '/' + encPath(path), {
    headers: headers({ 'Content-Type': mime, 'x-upsert': 'false', 'Cache-Control': 'max-age=3600' }),
    body: buf,
  });
}

/** URL firmada de vencimiento corto. Para DICOM (que no se puede mostrar) se pide como descarga. */
async function signedUrl(path, downloadName) {
  need();
  const res = await call('POST', BASE + '/storage/v1/object/sign/' + BUCKET + '/' + encPath(path), {
    headers: headers({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ expiresIn: SIGNED_SECONDS }),
  });
  const j = await res.json();
  if (!j.signedURL) throw new HttpError(502, 'No se pudo generar el enlace del archivo.');
  const rel = j.signedURL.startsWith('/') ? j.signedURL : '/' + j.signedURL;
  return BASE + '/storage/v1' + rel + (downloadName ? '&download=' + encodeURIComponent(downloadName) : '');
}

/** Borra archivos del bucket. No corta el flujo si falla: lo deja registrado (el archivo queda huérfano). */
async function remove(paths) {
  if (!paths.length || !configured()) return;
  try {
    await call('DELETE', BASE + '/storage/v1/object/' + BUCKET, {
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch (e) {
    console.error('No se pudieron borrar ' + paths.length + ' archivo(s) del bucket:', e.message);
  }
}

/** Crea el bucket privado si todavía no existe (no es obligatorio hacerlo a mano). */
async function ensureBucket() {
  if (!configured()) return;
  try {
    const r = await fetch(BASE + '/storage/v1/bucket/' + BUCKET, { headers: headers() });
    if (r.ok) return;
    if (r.status !== 400 && r.status !== 404) return;
    const c = await fetch(BASE + '/storage/v1/bucket', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_FILE_BYTES }),
    });
    console.log(c.ok ? 'Se creó el bucket privado "' + BUCKET + '".' : 'No se pudo crear el bucket "' + BUCKET + '" (' + c.status + '). Crealo a mano en Supabase.');
  } catch (e) {
    console.error('No se pudo verificar el bucket de adjuntos:', e.message);
  }
}

/* ---------- validación de archivos ---------- */
/** Nombre seguro: sin rutas, sin caracteres raros, con la extensión original, máximo ~100 caracteres. */
function sanitizeName(name) {
  let n = String(name || '').split(/[\\/]/).pop().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  n = n.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._]+/, '');
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 ? n.slice(dot).toLowerCase() : '';
  let base = dot > 0 ? n.slice(0, dot) : n;
  base = base.replace(/\.+/g, '_').slice(0, 90) || 'archivo';
  return base + ext;
}
const extOf = (name) => (name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

/** El contenido tiene que coincidir con el tipo declarado (no alcanza con cambiarle la extensión). */
function sniffOk(ext, b) {
  const at = (off, s) => b.length >= off + s.length && b.slice(off, off + s.length).toString('latin1') === s;
  if (ext === 'pdf') return at(0, '%PDF');
  if (ext === 'jpg' || ext === 'jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (ext === 'png') return b.length > 8 && b[0] === 0x89 && at(1, 'PNG');
  if (ext === 'webp') return at(0, 'RIFF') && at(8, 'WEBP');
  if (ext === 'heic') return at(4, 'ftyp');
  if (ext === 'dcm') return b.length > 0; // algunos DICOM no traen el encabezado "DICM"
  return false;
}

/** Valida un archivo recibido. Devuelve { name, mime, ext }. */
function checkFile(f) {
  const name = sanitizeName(f.filename);
  const ext = extOf(name);
  if (!TYPES[ext]) {
    throw U.bad('“' + f.filename + '”: tipo de archivo no permitido. Solo se aceptan PDF, JPG, PNG, WEBP, HEIC y DICOM (.dcm).');
  }
  if (!f.data.length) throw U.bad('“' + f.filename + '” está vacío.');
  if (f.data.length > MAX_FILE_BYTES) throw U.bad('“' + f.filename + '” pesa más de 10 MB.');
  if (!sniffOk(ext, f.data)) throw U.bad('“' + f.filename + '”: el contenido no coincide con el tipo de archivo.');
  return { name, mime: TYPES[ext], ext };
}
const newPath = (patientId, studyId, name) => patientId + '/' + studyId + '/' + crypto.randomUUID() + '-' + name;

/* ---------- multipart/form-data (sin dependencias) ---------- */
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m || !/multipart\/form-data/i.test(contentType)) throw new HttpError(415, 'Formato no permitido');
  const delim = Buffer.from('--' + (m[1] || m[2]).trim());
  const files = [];
  let pos = buf.indexOf(delim);
  while (pos !== -1) {
    let start = pos + delim.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    start += 2; // salta el \r\n que sigue al delimitador
    const next = buf.indexOf(delim, start);
    if (next === -1) break;
    const part = buf.slice(start, next - 2); // sin el \r\n previo al próximo delimitador
    const hEnd = part.indexOf('\r\n\r\n');
    if (hEnd !== -1) {
      const head = part.slice(0, hEnd).toString('utf8');
      const fn = /filename="((?:[^"\\]|\\.)*)"/i.exec(head);
      if (fn) files.push({ filename: fn[1].replace(/\\(.)/g, '$1'), data: part.slice(hEnd + 4) });
    }
    pos = next;
  }
  return files;
}

module.exports = {
  configured, need, upload, signedUrl, remove, ensureBucket,
  checkFile, newPath, parseMultipart, sanitizeName,
  MAX_FILE_BYTES, MAX_FILES_PER_STUDY, LIMIT_BYTES, SIGNED_SECONDS, BUCKET,
};
