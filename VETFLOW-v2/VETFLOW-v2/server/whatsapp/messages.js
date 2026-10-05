'use strict';

const T = require('./text');
const U = require('../util');
const { hoursLines } = require('./clinic');

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
const phoneLine = (c) => (c.phone ? '☎️ Tel: ' + c.phone : '');
const join = (...lines) => lines.filter((l) => l !== '' && l != null && l !== false).join('\n');

const M = {
  menu: (c, name) =>
    join(
      '¡Hola' + (name ? ' ' + first(name) : '') + '! 👋 Bienvenido a ' + c.name + '.',
      '¿En qué puedo ayudarte hoy?',
      '',
      '1️⃣ Sacar un turno',
      '2️⃣ Cambiar o cancelar un turno',
      '3️⃣ Datos del consultorio (dirección, horarios, pagos)',
      '4️⃣ Vacunas e historial de mi mascota',
      '',
      'Podés escribirme con tus palabras, por ejemplo: "quiero un turno para vacunar".'
    ),
  notUnderstood: (c) => join('No te entendí del todo 😅', 'Elegí una opción o contame con otras palabras:', '', '1️⃣ Sacar un turno', '2️⃣ Cambiar o cancelar un turno', '3️⃣ Datos del consultorio', '4️⃣ Vacunas e historial', c.phone ? '\nO llamanos al ' + c.phone + '.' : ''),
  askType: () => join('¡Perfecto! ¿Qué tipo de servicio necesitás?', '1️⃣ Consulta general', '2️⃣ Vacunación'),
  askPet: (pets) => ['¿Para qué mascota es el turno?', ...pets.map((p, i) => i + 1 + '. ' + p.name), pets.length + 1 + '. Otra mascota (nueva)'].join('\n'),
  askPetName: () => '¿Cuál es el nombre de tu perro/gato? 🐾',
  askSpecies: (pet) => join('Hermoso nombre, ' + pet + ' 🐾', '¿Es perro o gato?', '1️⃣ Perro', '2️⃣ Gato'),
  askSex: (pet) => join('¿' + pet + ' es macho o hembra?', '1️⃣ Macho', '2️⃣ Hembra'),
  askOwner: () => '¿Cuál es tu nombre y apellido?',
  askAddress: () => 'Si querés, dejanos tu dirección. Si no, escribí "no" para omitirla.',
  noSlots: () => 'Lo sentimos, no hay turnos disponibles en esas fechas. ¿Querés probar otra fecha? Escribime el día (ej: "viernes" o "15/10").',
  noSlotsDay: (date) => 'No hay turnos libres el ' + T.fmtDate(date).toLowerCase() + ' 😕 Probá con otro día (ej: "lunes" o "20/10").',
  noHours: (c) => join('Por el momento no puedo mostrarte horarios automáticamente.', c.phone ? 'Por favor llamanos al ' + c.phone + ' para coordinar tu turno.' : 'Por favor comunicate con el consultorio.'),
  slotList: (days, intro) => {
    const lines = [intro || 'Estos son los próximos turnos disponibles:', ''];
    let n = 0;
    const flat = [];
    days.forEach((d) => {
      d.slots.forEach((s) => {
        n++;
        flat.push({ date: d.date, time: s });
        lines.push(n + '. 📅 ' + T.fmtDate(d.date) + ' - ' + s);
      });
    });
    lines.push('', 'Respondé con el número, o escribime otro día (ej: "viernes" o "15/10") y/o una hora (ej: "martes 10:20").');
    return { text: lines.join('\n'), flat };
  },
  confirmBook: (o) =>
    join(
      'Revisá tu turno:',
      '',
      (o.species === 'Gato' ? '🐈' : '🐕') + ' Mascota: ' + o.petName,
      '👤 Cliente: ' + o.owner,
      '🩺 Servicio: ' + o.service,
      '📅 Fecha: ' + T.fmtDate(o.date),
      '⏰ Hora: ' + o.time,
      o.clinic.address ? '🏥 Lugar: ' + o.clinic.address : '',
      '',
      '¿Es correcto?',
      '1️⃣ Sí, confirmar',
      '2️⃣ No, elegir otro horario'
    ),
  booked: (o) =>
    join(
      '✅ ¡Turno confirmado!',
      '',
      '📌 Número de turno: #' + o.id,
      '🐾 ' + o.petName + ' - ' + o.service,
      '📅 ' + T.fmtDate(o.date) + ' a las ' + o.time,
      o.clinic.address ? '🏥 ' + o.clinic.address : '',
      '',
      'Te vamos a enviar recordatorios 24 horas y 2 horas antes.',
      'Cualquier cambio, escribime por acá' + (o.clinic.phone ? ' o llamá al ' + o.clinic.phone : '') + '.'
    ),
  slotTaken: () => 'Uy, ese horario acaba de ser ocupado por otra persona 😕 Elegí otro de la lista:',
  apptLine: (a, i) => (i != null ? i + 1 + '. ' : '') + '🐾 ' + a.petName + ' - ' + (a.type === 'vacuna' ? 'Vacunación' : 'Consulta') + ' - ' + T.fmtDate(a.date) + ' ' + a.time + ' (#' + a.id + ')',
  noAppts: (c) => join('No encontré turnos próximos asociados a este número.', c.phone ? 'Si el turno está a nombre de otra persona, llamanos al ' + c.phone + '.' : ''),
  pickAppt: (list, verb) => join('¿Cuál turno querés ' + verb + '?', ...list.map((a, i) => M.apptLine(a, i)), '', 'Respondé con el número de la lista o con el # del turno.'),
  foundAppt: (a) => join('Encontré tu turno:', '🐾 ' + a.petName, '📅 ' + T.fmtDate(a.date) + ' a las ' + a.time + ' (#' + a.id + ')'),
  rescheduled: (a, clinic) =>
    join('✅ Turno reprogramado', '', '📌 Turno #' + a.id, '🐾 ' + a.petName, '📅 ' + T.fmtDate(a.date), '⏰ ' + a.time, clinic.address ? '🏥 ' + clinic.address : '', '', 'Te vamos a recordar el turno antes de la fecha.'),
  askReason: () => 'Entendido. ¿Me contás el motivo de la cancelación? (es opcional, escribí "no" para omitir)',
  cancelled: (a) => join('✅ Turno #' + a.id + ' cancelado (' + a.petName + ', ' + T.fmtDate(a.date) + ' ' + a.time + ').', 'Cuando quieras sacar uno nuevo, escribime "turno" 🐾'),
  apptReminder: (kind, o) =>
    join(
      kind === 'appt_24h' ? '⏰ Recordatorio de turno' : '⏰ Tu turno es hoy',
      '',
      'Hola ' + first(o.owner) + ', te recordamos el turno de ' + o.petName + ':',
      '📅 ' + T.fmtDate(o.date) + ' a las ' + o.time,
      o.clinic.address ? '🏥 ' + o.clinic.address : '',
      '',
      '¿Confirmás que vas a asistir?',
      '1️⃣ Sí, confirmo',
      '2️⃣ No puedo'
    ),
  apptConfirmed: (a) => '✅ ¡Gracias! Quedó confirmado el turno #' + a.id + ' para ' + T.fmtDate(a.date) + ' a las ' + a.time + '. Te esperamos 🐾',
  apptChangeAsk: () => join('Gracias por avisar. ¿Qué querés hacer con el turno?', '1️⃣ Reprogramarlo', '2️⃣ Cancelarlo'),
  vaccineBefore: (o) =>
    join(
      '⏰ Recordatorio importante',
      '',
      'Hola ' + first(o.owner) + ', queremos recordarte que la vacuna de ' + o.petName + ' vence ' + (o.days === 1 ? 'mañana' : 'en ' + o.days + ' días') + ' (📅 ' + T.fmtDateLong(o.next) + ').',
      '💉 ¿Te gustaría agendar un turno de vacunación? 🐾',
      '',
      '1️⃣ Sí, ver horarios',
      '2️⃣ Quiero información',
      '3️⃣ Ahora no'
    ),
  vaccineAfter: (o) =>
    join(
      '⚠️ Hola ' + first(o.owner) + ', la vacuna de ' + o.petName + ' venció el ' + T.fmtDateLong(o.next) + '. Es importante renovarla cuanto antes. 💉',
      '¿Deseas agendar un turno ahora?',
      '',
      '1️⃣ Sí, ver horarios',
      '2️⃣ Quiero información',
      '3️⃣ Ahora no'
    ),
  vaccineInfo: (c) =>
    join(
      '💉 Sobre la vacunación',
      '',
      'Las vacunas protegen a tu mascota de enfermedades graves y contagiosas. Para mantener la protección hay que aplicar los refuerzos en la fecha indicada: si pasa mucho tiempo, la defensa baja y puede ser necesario retomar el esquema.',
      'El veterinario' + (c.vet ? ' (' + c.vet + ')' : '') + ' te indica qué vacunas corresponden según la especie, la edad y el estilo de vida.',
      phoneLine(c),
      '',
      '¿Querés agendar un turno de vacunación?',
      '1️⃣ Sí, ver horarios',
      '2️⃣ Ahora no'
    ),
  later: () => 'Perfecto 🐾 Cuando quieras agendar, escribime "turno".',
  info: (c, topic, services) => {
    const loc = join(
      c.address ? '📍 Nos encontramos en ' + c.address + '.' : '',
      c.vet ? '👩‍⚕️ Veterinario/a: ' + c.vet : '',
      hoursLines(c.hours).length ? '🕘 Horarios:\n' + hoursLines(c.hours).map((l) => '   ' + l).join('\n') : '',
      phoneLine(c)
    );
    const pay = '💳 Medios de pago:\n' + c.payments.map((p) => '   • ' + p).join('\n');
    const srv = services.length ? '🩺 Servicios:\n' + services.map((p) => '   • ' + p).join('\n') : '';
    const parts = topic === 'payments' ? [pay] : topic === 'services' ? [srv] : topic === 'location' ? [loc] : [loc, pay, srv];
    const body = parts.filter(Boolean).join('\n\n');
    return (body || 'Todavía no tengo cargados esos datos' + (c.phone ? ', llamanos al ' + c.phone : '') + '.') + '\n\n¿Necesitás algo más? Escribí "turno" para sacar uno 🐾';
  },
  medical: (c, urgent) =>
    join(
      urgent ? '🚨 Si es una urgencia, no esperes: ' + (c.phone ? 'llamá ahora al ' + c.phone : 'comunicate con el consultorio ahora') + ' o acercate a la veterinaria.' : '',
      urgent ? '' : null,
      'Entiendo tu preocupación 🐾 Por chat no puedo darte un diagnóstico: cada animal es distinto y lo más seguro es que lo vea el veterinario.',
      '',
      'Para una consulta personalizada, te recomendamos:',
      c.phone ? '📞 Llamar al veterinario: ' + c.phone : '',
      '',
      '¿Deseas agendar un turno de consulta?',
      '1️⃣ Sí, ver horarios',
      '2️⃣ No, gracias'
    ),
  unknownClient: (c) => join('No encontré tu número en nuestros registros 🤔', 'Si ya sos cliente, es posible que tengamos otro teléfono tuyo.', c.phone ? 'Llamanos al ' + c.phone + ' y lo actualizamos.' : '', '', 'Si querés sacar un turno, escribime "turno" y te registro.'),
  askWhichPet: (pets) => join('¿De cuál mascota?', ...pets.map((p, i) => i + 1 + '. ' + p.name)),
  tooManyAnswers: () => 'Para seguir, respondé con el número de una de las opciones 🙂 (o escribí "menu" para volver al inicio).',
  dbError: () => 'Disculpa, estamos teniendo problemas. Intenta nuevamente en unos momentos 🙏',
  noPets: () => 'Todavía no tengo mascotas registradas a tu nombre.',
  nonText: () => 'Por ahora solo puedo leer mensajes de texto 🙂 Escribime en qué te puedo ayudar o "menu" para ver las opciones.',
};

function historyText(kind, pet, h) {
  const flags = (next) => {
    if (!next) return '';
    const today = T.nowAR().date;
    return next < today ? ' (⚠️ vencida)' : next <= U.addDays(today, 30) ? ' (⚠️ vence pronto)' : '';
  };
  if (kind === 'vaccines') {
    if (!h.vaccines.length) return 'No tengo vacunas registradas para ' + pet.name + ' todavía.';
    const v = h.vaccines[0];
    return join(
      'La última vacuna de ' + pet.name + ' fue el ' + T.fmtDateLong(v.applied_on) + '.',
      '💉 Tipo: ' + v.name,
      v.next_on ? '📅 Próximo vencimiento: ' + T.fmtDateLong(v.next_on) + flags(v.next_on) : '',
      h.vaccines.length > 1 ? '\nHistorial:' : '',
      ...(h.vaccines.length > 1 ? h.vaccines.slice(0, 5).map((x) => '• ' + T.fmtDateLong(x.applied_on) + ' - ' + x.name) : [])
    );
  }
  if (kind === 'consults') {
    if (!h.consults.length) return 'No tengo consultas registradas para ' + pet.name + ' todavía.';
    return join('Últimas consultas de ' + pet.name + ':', ...h.consults.map((x) => '🩺 ' + T.fmtDateLong(x.on_date) + ' - ' + x.title));
  }
  if (kind === 'meds') {
    if (!h.meds.length) return 'No tengo medicamentos recetados registrados para ' + pet.name + '.';
    return join('Medicación de ' + pet.name + ':', ...h.meds.map((x) => '💊 ' + T.fmtDateLong(x.on_date) + ' - ' + x.name + (x.dose ? ' (' + x.dose + (x.duration ? ', ' + x.duration : '') + ')' : '')));
  }
  if (kind === 'weight') {
    if (!h.weights.length) return 'No tengo el peso de ' + pet.name + ' registrado todavía.';
    return join('Peso de ' + pet.name + ':', ...h.weights.map((x) => '⚖️ ' + T.fmtDateLong(x.fecha) + ' - ' + x.kg + ' kg'));
  }
  return join(
    'Resumen de ' + pet.name + ' 🐾',
    '',
    historyText('vaccines', pet, h),
    '',
    historyText('consults', pet, h),
    '',
    historyText('meds', pet, h),
    '',
    historyText('weight', pet, h)
  );
}

module.exports = { M, historyText, first };
