'use strict';

const U = require('../util');
const T = require('./text');
const { M, historyText } = require('./messages');
const { getClinic, serviceNames } = require('./clinic');
const S = require('./scheduleService');
const D = require('./dataService');

/* ---------- reconocimiento de intenciones ---------- */
const RE = {
  cancel: /(cancel|anular|dar de baja|dar de baja)/,
  resched: /(reprogram|cambiar|cambio|mover|modificar|posponer|adelantar|otro dia|otra fecha|otro horario)/,
  myAppts: /(mis turnos|tengo (algun )?turno|cuando es (mi|el) turno|proximo turno|ver (mi )?turno)/,
  book: /(turno|agendar|reservar|\bcita\b|sacar hora|pedir hora|quiero (una |un )?(consulta|vacun)|necesito (una |un )?(consulta|vacun)|quisiera (una |un )?(consulta|vacun)|queria (una |un )?(consulta|vacun)|vacunar|castrar|operar)/,
  history: /(historial|ficha|ultima (vacuna|consulta|visita)|cuando (fue|le toca|vence)|vencimiento|vence|proxima vacuna|vacunas? (de|tiene|le)|\bpeso\b|pesa\b|kilos?|medicament|receta|remedio|medicacion|diagnostic)/,
  medical: /(vomit|diarrea|\btos\b|tose|estornud|cojea|renguea|fiebre|no (quiere )?come|no come|decaid|apatic|sangr|herida|picadura|mordid|convulsi|intoxic|envenen|atropell|hinchad|rasca|picazon|pulgas|garrapata|dolor|llora|temblor|respira|enferm|alergia|ojo|oido|cojera|infeccion|lastim|se (cayo|golpeo)|embarazada|celo|parto|come (algo|veneno)|diabetes|muy flaco|adelgaz)/,
  urgent: /(convulsi|envenen|intoxic|atropell|no respira|sangr|hemorrag|desmay|se (cayo|golpeo)|parto)/,
  infoLocation: /(direcci|donde (esta|estan|queda|quedan|encuentran)|ubicaci|como llego|horario|hora(s)? de atencion|atienden|abierto|abren|cierran|telefono|llamar|contacto|veterinari[oa] (es|se llama)|doctor|doctora|\bdra?\b)/,
  infoPayments: /(pago|pagar|tarjeta|efectivo|transferencia|debito|credito|mercado pago)/,
  infoServices: /(servicio|ofrecen|que hacen|hacen (cirugia|ecografia)|cirugia|laboratorio|ecografia|radiograf|analisis)/,
  infoGeneric: /(informacion|\binfo\b|datos del consultorio|consultorio)/,
};
// Las palabras clave tienen que empezar una palabra (así "celo" no se confunde con "Marcelo").
for (const k of Object.keys(RE)) RE[k] = new RegExp('\\b(?:' + RE[k].source + ')');
const URGENT_WORDS = RE.urgent;
const GREET_PREFIX = /^(hola+|holis|buen(as|os)?( dias| tardes| noches)?|hey|hello)( |$)/;
const MENU_WORDS = /^(menu|inicio|ayuda|empezar|comenzar|que tal|como estas|todo bien)$/;
const BACK = ['menu', 'inicio', 'volver', 'salir', 'cancelar', '0', 'empezar de nuevo'];

const apptId = (text) => {
  const m = String(text).match(/#\s*(\d{1,9})/) || T.norm(text).match(/turno (?:numero |nro |n )?(\d{1,9})/);
  return m ? Number(m[1]) : null;
};
const typeFromText = (n) => (/(vacun)/.test(n) ? 'vacuna' : /(consulta|control|revision|chequeo)/.test(n) ? 'consulta' : null);
const topicFromText = (n) =>
  /(\bpeso\b|pesa\b|kilo)/.test(n) ? 'weight' : /(medicament|receta|remedio|medicacion)/.test(n) ? 'meds' : /(vacun|vence|vencimiento|inmuniz)/.test(n) ? 'vaccines' : /(consulta|visita|diagnostic)/.test(n) ? 'consults' : 'summary';

/* ---------- helpers de estado ---------- */
const say = (x, t) => x.replies.push(t);
const go = (x, state, patch) => {
  x.s.state = state;
  x.s.context = { ...x.s.context, ...(patch || {}), tries: 0 };
};
const reset = (x) => {
  x.s.state = 'idle';
  x.s.context = {};
};
function reprompt(x, text) {
  x.s.context.tries = (x.s.context.tries || 0) + 1;
  say(x, text);
  if (x.s.context.tries >= 3) say(x, 'Si querés empezar de nuevo, escribí "menu" 🙂');
}
function showMenu(x) {
  say(x, M.menu(x.clinic, x.client ? x.client.first : x.name));
  go(x, 'menu', {});
  x.s.context = { tries: 0 };
}

/* ---------- turnos: elegir horario ---------- */
async function toSlots(x, intro) {
  const c = x.s.context;
  if (!x.clinic.hours) {
    say(x, M.noHours(x.clinic));
    return reset(x);
  }
  const days = await S.nextSlots(c.type, T.nowAR().date, { exceptId: c.apptId });
  if (!days.length) {
    say(x, M.noSlots());
    return go(x, 'slot', { slots: [] });
  }
  const l = M.slotList(days, intro);
  say(x, l.text);
  go(x, 'slot', { slots: l.flat });
}

async function afterType(x) {
  const c = x.s.context;
  if (c.patientId) return toSlots(x);
  if (x.client) {
    const pets = await D.petsOfClient(x.client.id);
    if (pets.length === 1) {
      go(x, 'slot', { patientId: pets[0].id, petName: pets[0].name, species: pets[0].species });
      return toSlots(x);
    }
    if (pets.length > 1) {
      say(x, M.askPet(pets));
      return go(x, 'book_pet', { pets });
    }
  }
  say(x, M.askPetName());
  go(x, 'new_pet_name', {});
}

async function startBook(x, type, extra) {
  x.s.context = { flow: 'book', type: type || null, ...(extra || {}) };
  if (!type) {
    say(x, M.askType());
    return go(x, 'book_type', {});
  }
  return afterType(x);
}

async function onSlot(x) {
  const c = x.s.context;
  const type = c.type;
  const today = T.nowAR().date;
  const k = T.parseChoice(x.text, (c.slots || []).length);
  let chosen = k ? c.slots[k - 1] : null;
  if (!chosen) {
    const date = T.parseDate(x.text, today);
    const time = T.parseTime(x.text);
    if (date) {
      const free = await S.slotsForDate(date, type, { clinic: x.clinic, exceptId: c.apptId });
      if (time && free.includes(time)) chosen = { date, time };
      else if (!free.length) return say(x, M.noSlotsDay(date));
      else {
        const l = M.slotList([{ date, slots: S.spread(free, 8) }], (time ? 'Ese horario no está libre. ' : '') + 'Horarios disponibles para el ' + T.fmtDate(date).toLowerCase() + ':');
        say(x, l.text);
        return go(x, 'slot', { slots: l.flat });
      }
    } else if (time) {
      chosen = (c.slots || []).find((s) => s.time === time) || null;
      if (!chosen) return reprompt(x, 'Ese horario no está en la lista. Elegí un número o escribime el día y la hora (ej: "martes 10:20").');
    } else return reprompt(x, 'No pude entender el horario 😅 Respondé con el número de la lista o escribime un día (ej: "viernes" o "15/10").');
  }
  if (c.flow === 'resched') return doReschedule(x, chosen);
  const pet = c.petName || (c.newPet && c.newPet.name);
  say(
    x,
    M.confirmBook({
      petName: pet,
      species: c.species || (c.newPet && c.newPet.species),
      owner: x.client ? x.client.name : c.owner ? (c.owner.first + ' ' + c.owner.last).trim() : '',
      service: S.SERVICE_LABEL[type],
      date: chosen.date,
      time: chosen.time,
      clinic: x.clinic,
    })
  );
  go(x, 'book_confirm', { chosen });
}

async function doBook(x) {
  const c = x.s.context;
  let patientId = c.patientId;
  if (!patientId) {
    const n = c.newPet;
    const r = await D.createPet({
      clientId: x.client ? x.client.id : null,
      phone: x.s.phone,
      first: c.owner && c.owner.first,
      last: c.owner && c.owner.last,
      address: c.owner && c.owner.address,
      petName: n.name,
      species: n.species,
      sex: n.sex,
    });
    patientId = r.patientId;
    x.s.clientId = r.clientId;
    x.s.context = { ...c, patientId, petName: n.name, species: n.species, newPet: null, owner: null };
    x.client = x.client || { id: r.clientId };
  }
  const { chosen, type } = x.s.context;
  const r = await S.book({ patientId, type, date: chosen.date, time: chosen.time });
  if (!r) {
    say(x, M.slotTaken());
    return toSlots(x);
  }
  say(x, M.booked({ id: r.id, petName: x.s.context.petName, service: S.SERVICE_LABEL[type], date: chosen.date, time: chosen.time, clinic: x.clinic }));
  reset(x);
}

/* ---------- reprogramar y cancelar ---------- */
async function pickAppt(x, verb, text) {
  if (!x.client) {
    say(x, M.noAppts(x.clinic));
    return null;
  }
  const wanted = apptId(text || '');
  if (wanted) {
    const a = await S.getForClient(wanted, x.client.id);
    if (a) return a;
  }
  const list = await S.upcomingForClient(x.client.id);
  if (!list.length) {
    say(x, M.noAppts(x.clinic));
    return null;
  }
  if (list.length === 1 && !wanted) return list[0];
  if (wanted) say(x, 'No encontré el turno #' + wanted + ' entre los tuyos.');
  say(x, M.pickAppt(list, verb));
  return list;
}
async function startResched(x, text, appt) {
  const r = appt || (await pickAppt(x, 'reprogramar', text));
  if (!r) return reset(x);
  if (Array.isArray(r)) return go(x, 'resched_pick', { appts: r });
  x.s.context = { flow: 'resched', apptId: r.id, type: r.type, petName: r.petName, appt: r };
  await toSlots(x, M.foundAppt(r) + '\n\n¿Para qué fecha te gustaría reprogramar? Estos son los próximos horarios libres:');
}
async function doReschedule(x, chosen) {
  const c = x.s.context;
  const r = await S.reschedule(c.apptId, chosen.date, chosen.time);
  if (r.error === 'missing') {
    say(x, 'No encontré ese turno, puede que ya se haya cancelado. Escribime "turno" para sacar uno nuevo.');
    return reset(x);
  }
  if (r.error === 'taken') {
    say(x, M.slotTaken());
    return toSlots(x);
  }
  say(x, M.rescheduled({ id: c.apptId, petName: c.petName, date: chosen.date, time: chosen.time }, x.clinic));
  reset(x);
}
async function startCancel(x, text, appt) {
  const r = appt || (await pickAppt(x, 'cancelar', text));
  if (!r) return reset(x);
  if (Array.isArray(r)) return go(x, 'cancel_pick', { appts: r });
  x.s.context = {};
  say(x, M.foundAppt(r) + '\n\n' + M.askReason());
  go(x, 'cancel_reason', { apptId: r.id, appt: r });
}

/* ---------- consultas sobre la mascota ---------- */
async function startHistory(x, topic, text) {
  if (!x.client) {
    say(x, M.unknownClient(x.clinic));
    return reset(x);
  }
  const pets = await D.petsOfClient(x.client.id);
  if (!pets.length) {
    say(x, M.noPets());
    return reset(x);
  }
  const n = T.norm(text || '');
  const named = pets.filter((p) => new RegExp('(^| )' + T.norm(p.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '( |$)').test(n));
  const pet = named.length === 1 ? named[0] : pets.length === 1 ? pets[0] : null;
  if (!pet) {
    say(x, M.askWhichPet(pets));
    return go(x, 'pet_pick', { topic, pets });
  }
  await answerHistory(x, topic, pet);
}
async function answerHistory(x, topic, pet) {
  const h = await D.petHistory(pet.id);
  say(x, historyText(topic, pet, h));
  const v = h.vaccines[0];
  const soon = v && v.next_on && v.next_on <= U.addDays(T.nowAR().date, 30);
  if ((topic === 'vaccines' || topic === 'summary') && soon) {
    say(x, '¿Te gustaría agendar el turno ahora?\n1️⃣ Sí\n2️⃣ No');
    return go(x, 'vaccine_offer', { opts: 'yn', patientId: pet.id, petName: pet.name, species: pet.species });
  }
  reset(x);
}

/* ---------- ruteo de un mensaje "suelto" ---------- */
async function route(x) {
  let n = x.n;
  const rest = n.replace(GREET_PREFIX, '').trim();
  if (!rest || MENU_WORDS.test(rest)) return showMenu(x);
  x.n = n = rest;
  if (RE.cancel.test(n)) return startCancel(x, x.text);
  if (RE.resched.test(n) && /(turno|cita|hora|reprogram|fecha)/.test(n)) return startResched(x, x.text);
  if (RE.myAppts.test(n)) {
    const list = x.client ? await S.upcomingForClient(x.client.id) : [];
    say(x, list.length ? 'Tus próximos turnos:\n' + list.map((a) => M.apptLine(a)).join('\n') + '\n\n¿Querés cambiar o cancelar alguno? Escribime "reprogramar" o "cancelar".' : M.noAppts(x.clinic));
    return reset(x);
  }
  if (RE.book.test(n)) return startBook(x, typeFromText(n));
  if (RE.history.test(n)) return startHistory(x, topicFromText(n), x.text);
  if (RE.medical.test(n)) {
    say(x, M.medical(x.clinic, URGENT_WORDS.test(n)));
    return go(x, 'medical_offer', {});
  }
  const topic = RE.infoPayments.test(n) ? 'payments' : RE.infoServices.test(n) ? 'services' : RE.infoLocation.test(n) ? 'location' : RE.infoGeneric.test(n) ? 'all' : null;
  if (topic) {
    say(x, M.info(x.clinic, topic, topic === 'payments' || topic === 'location' ? [] : await serviceNames(x.clinic)));
    return reset(x);
  }
  say(x, M.notUnderstood(x.clinic));
  go(x, 'menu', {});
}

/* ---------- respuestas según el estado de la conversación ---------- */
const H = {
  async menu(x) {
    const k = T.parseChoice(x.text, 4);
    if (k === 1) return startBook(x, null);
    if (k === 2) {
      say(x, '¿Qué querés hacer?\n1️⃣ Reprogramar un turno\n2️⃣ Cancelar un turno');
      return go(x, 'change_kind', {});
    }
    if (k === 3) {
      say(x, M.info(x.clinic, 'all', await serviceNames(x.clinic)));
      return reset(x);
    }
    if (k === 4) return startHistory(x, 'summary', '');
    return route(x);
  },
  async change_kind(x) {
    const k = T.parseChoice(x.text, 2);
    if (k === 1 || /reprogram|cambiar/.test(x.n)) return startResched(x, x.text);
    if (k === 2 || /cancel/.test(x.n)) return startCancel(x, x.text);
    return route(x);
  },
  async book_type(x) {
    const k = T.parseChoice(x.text, 2);
    const type = k === 1 ? 'consulta' : k === 2 ? 'vacuna' : typeFromText(x.n);
    if (!type) return reprompt(x, 'Elegí una opción:\n1️⃣ Consulta general\n2️⃣ Vacunación');
    x.s.context.type = type;
    return afterType(x);
  },
  async book_pet(x) {
    const pets = x.s.context.pets || [];
    const k = T.parseChoice(x.text, pets.length + 1);
    const byName = pets.find((p) => T.norm(p.name) === x.n);
    if (k && k <= pets.length) {
      const p = pets[k - 1];
      go(x, 'slot', { patientId: p.id, petName: p.name, species: p.species, pets: null });
      return toSlots(x);
    }
    if (byName) {
      go(x, 'slot', { patientId: byName.id, petName: byName.name, species: byName.species, pets: null });
      return toSlots(x);
    }
    if (k === pets.length + 1) {
      say(x, M.askPetName());
      return go(x, 'new_pet_name', { pets: null });
    }
    return reprompt(x, 'Respondé con el número de la mascota (1 a ' + (pets.length + 1) + ').');
  },
  async new_pet_name(x) {
    const name = x.text.trim();
    if (name.length < 1 || name.length > 60 || /^\d+$/.test(name)) return reprompt(x, 'No pude entender el nombre 🐾 ¿Cómo se llama tu mascota?');
    const pet = T.cap(name);
    say(x, M.askSpecies(pet));
    return go(x, 'new_species', { newPet: { name: pet } });
  },
  async new_species(x) {
    const k = T.parseChoice(x.text, 2);
    const sp = k === 1 || /(perro|perra|can)/.test(x.n) ? 'Perro' : k === 2 || /(gato|gata|felino)/.test(x.n) ? 'Gato' : null;
    if (!sp) return reprompt(x, '¿Es perro o gato?\n1️⃣ Perro\n2️⃣ Gato');
    const np = { ...x.s.context.newPet, species: sp };
    say(x, M.askSex(np.name));
    return go(x, 'new_sex', { newPet: np });
  },
  async new_sex(x) {
    const k = T.parseChoice(x.text, 2);
    const sex = k === 1 || /macho/.test(x.n) ? 'Macho' : k === 2 || /hembra/.test(x.n) ? 'Hembra' : null;
    if (!sex) return reprompt(x, '¿Es macho o hembra?\n1️⃣ Macho\n2️⃣ Hembra');
    go(x, 'slot', { newPet: { ...x.s.context.newPet, sex }, species: x.s.context.newPet.species });
    if (x.client) return toSlots(x);
    say(x, M.askOwner());
    return go(x, 'owner_name', {});
  },
  async owner_name(x) {
    const nm = x.text.trim().replace(/\s+/g, ' ');
    if (nm.length < 2 || nm.length > 100 || !/[a-záéíóúñ]/i.test(nm)) return reprompt(x, 'Necesito tu nombre y apellido para registrar el turno 🙂');
    const parts = nm.split(' ');
    const last = parts.length > 1 ? parts.pop() : '';
    say(x, M.askAddress());
    return go(x, 'owner_address', { owner: { first: T.cap(parts.join(' ')), last: T.cap(last), address: '' } });
  },
  async owner_address(x) {
    const owner = { ...x.s.context.owner };
    if (T.parseYesNo(x.text) !== 'no') owner.address = x.text.trim().slice(0, 200);
    go(x, 'slot', { owner });
    return toSlots(x);
  },
  slot: onSlot,
  async book_confirm(x) {
    const a = T.parseYesNo(x.text);
    if (a === 'yes') return doBook(x);
    if (a === 'no') return toSlots(x);
    return reprompt(x, '¿Confirmás el turno?\n1️⃣ Sí, confirmar\n2️⃣ No, elegir otro horario');
  },
  async resched_pick(x) {
    const list = x.s.context.appts || [];
    const k = T.parseChoice(x.text, list.length);
    const id = apptId(x.text);
    const a = k ? list[k - 1] : list.find((y) => y.id === id);
    if (!a) return reprompt(x, 'Respondé con el número de la lista o con el # del turno.');
    return startResched(x, '', a);
  },
  async cancel_pick(x) {
    const list = x.s.context.appts || [];
    const k = T.parseChoice(x.text, list.length);
    const id = apptId(x.text);
    const a = k ? list[k - 1] : list.find((y) => y.id === id);
    if (!a) return reprompt(x, 'Respondé con el número de la lista o con el # del turno.');
    return startCancel(x, '', a);
  },
  async cancel_reason(x) {
    const c = x.s.context;
    const reason = T.parseYesNo(x.text) === 'no' ? '' : x.text.trim().slice(0, 300);
    const ok = await S.cancel(c.apptId);
    if (reason) console.log('Turno #' + c.apptId + ' cancelado por WhatsApp. Motivo:', reason);
    say(x, ok ? M.cancelled(c.appt) : 'Ese turno ya no figura en la agenda.');
    reset(x);
  },
  async appt_confirm(x) {
    const c = x.s.context;
    const a = T.parseYesNo(x.text);
    if (a === 'yes') {
      const appt = await S.getForClient(c.apptId, x.client ? x.client.id : 0);
      if (!appt) {
        say(x, 'No encontré ese turno, puede que ya no esté en la agenda. Escribime "turno" para sacar uno nuevo.');
        return reset(x);
      }
      await S.confirm(c.apptId);
      say(x, M.apptConfirmed(appt));
      return reset(x);
    }
    if (a === 'no') {
      say(x, M.apptChangeAsk());
      return go(x, 'appt_change', {});
    }
    return route(x);
  },
  async appt_change(x) {
    const c = x.s.context;
    const appt = x.client ? await S.getForClient(c.apptId, x.client.id) : null;
    if (!appt) {
      say(x, M.noAppts(x.clinic));
      return reset(x);
    }
    const k = T.parseChoice(x.text, 2);
    if (k === 1 || /reprogram|cambiar/.test(x.n)) return startResched(x, '', appt);
    if (k === 2 || /cancel/.test(x.n)) return startCancel(x, '', appt);
    return reprompt(x, '¿Qué querés hacer?\n1️⃣ Reprogramar\n2️⃣ Cancelar');
  },
  async vaccine_offer(x) {
    const c = x.s.context;
    const k = T.parseChoice(x.text, c.opts === 'yin' ? 3 : 2);
    const yn = T.parseYesNo(x.text);
    const wantsInfo = /(informacion|\binfo\b)/.test(x.n) || (c.opts === 'yin' && k === 2);
    if (wantsInfo) {
      say(x, M.vaccineInfo(x.clinic));
      return go(x, 'vaccine_info', {});
    }
    const no = (c.opts === 'yin' && k === 3) || (c.opts !== 'yin' && k === 2) || yn === 'no';
    const yes = k === 1 || yn === 'yes';
    if (yes && !no) return startBook(x, 'vacuna', { patientId: c.patientId, petName: c.petName, species: c.species });
    if (no) {
      say(x, M.later());
      return reset(x);
    }
    return route(x);
  },
  async vaccine_info(x) {
    const c = x.s.context;
    const a = T.parseYesNo(x.text);
    if (a === 'yes') return startBook(x, 'vacuna', { patientId: c.patientId, petName: c.petName, species: c.species });
    if (a === 'no') {
      say(x, M.later());
      return reset(x);
    }
    return route(x);
  },
  async medical_offer(x) {
    const a = T.parseYesNo(x.text);
    if (a === 'yes') return startBook(x, 'consulta');
    if (a === 'no') {
      say(x, 'Está bien. Si cambia algo o empeora, no dudes en escribirnos o llamar 🐾');
      return reset(x);
    }
    return route(x);
  },
  async pet_pick(x) {
    const c = x.s.context;
    const pets = c.pets || [];
    const k = T.parseChoice(x.text, pets.length);
    const pet = k ? pets[k - 1] : pets.find((p) => T.norm(p.name) === x.n);
    if (!pet) return reprompt(x, 'Respondé con el número de la mascota.');
    return answerHistory(x, c.topic, pet);
  },
};

/**
 * Procesa un mensaje entrante. `s` es la sesión (se modifica: state, context, clientId; quien llama la guarda).
 * Devuelve la lista de textos a responder.
 */
async function handle(s, text, profileName) {
  const clinic = await getClinic();
  const client = await D.findClientByPhone(s.phone);
  s.clientId = client ? client.id : null;
  const x = { s, clinic, client, text: String(text || '').slice(0, 1000), n: T.norm(text), name: profileName || '', replies: [] };
  if (s.state !== 'idle' && s.state !== 'menu' && BACK.includes(x.n)) {
    reset(x);
    if (x.n === 'cancelar') say(x, 'Listo, lo dejamos acá 🙂');
    showMenu(x);
    return x.replies;
  }
  const h = H[s.state];
  if (h) await h(x);
  else await route(x);
  return x.replies;
}

module.exports = { handle, route, RE };
