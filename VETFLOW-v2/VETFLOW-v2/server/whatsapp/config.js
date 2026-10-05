'use strict';

// Todo viene de variables de entorno (nunca van credenciales en el código).
const env = process.env;

module.exports = {
  accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
  phoneId: env.WHATSAPP_PHONE_ID || '',
  verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
  appSecret: env.WHATSAPP_APP_SECRET || '',
  apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
  // Clave para cifrar el texto de los mensajes guardados (opcional). 32 bytes en hexadecimal (64 caracteres) o cualquier texto largo.
  logKey: env.WHATSAPP_LOG_KEY || '',
  // Plantillas aprobadas por Meta para avisos fuera de la ventana de 24 h (opcionales: sin plantilla se envía texto simple).
  templateLang: env.WHATSAPP_TEMPLATE_LANG || 'es_AR',
  templates: {
    vaccine_before: env.WHATSAPP_TPL_VACCINE_BEFORE || '',
    vaccine_after: env.WHATSAPP_TPL_VACCINE_AFTER || '',
    appt_24h: env.WHATSAPP_TPL_APPT_24H || '',
    appt_2h: env.WHATSAPP_TPL_APPT_2H || '',
  },
  prod: env.NODE_ENV === 'production',
  // Mensajes por minuto permitidos por número antes de ignorarlos.
  rateLimitPerMin: Number(env.WHATSAPP_RATE_LIMIT) || 20,
  remindersEnabled: env.WHATSAPP_REMINDERS !== 'false',
};
