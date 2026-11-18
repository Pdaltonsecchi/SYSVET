// Página pública de turnos. Sin frameworks. Todo texto que viene del servidor se escribe con textContent (nunca innerHTML).
(function () {
  'use strict';

  var TOKEN_KEY = 'turnos-cliente-token';
  var TZ = 'America/Argentina/Buenos_Aires';
  // Los horarios antes de esta hora van bajo "Mañana"; el resto, bajo "Tarde".
  var NOON = '13:00';
  var state = {
    token: null, info: null, client: null, pets: [], appointments: [],
    type: 'consulta',
    days: {}, // fecha -> horarios libres (lo que manda el servidor para el tipo elegido)
    lastDay: null, // último día con horarios: hasta ahí llega el calendario
    lastDate: null, // último día que se puede pedir (lo dice el servidor: hoy + 90 días)
    month: null, // mes que se está mirando, 'AAAA-MM'
    day: null, // día elegido
    hour: null, // hora elegida ('09', '10'...): muestra los minutos libres de esa hora
    time: null, // horario elegido (todavía sin confirmar)
    slotsLoaded: false,
    hadVisit: false, // ya tuvo una atención (turno confirmado que pasó): se le puede preguntar por la reseña
    pendingPet: null, // mascota que escribió en "Cliente nuevo" antes de enterarse de que ya estaba registrado
  };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function show(id, on) { $(id).hidden = !on; }
  function setText(id, text) { $(id).textContent = text || ''; }
  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
  var reduceMotion = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };

  /** Lleva la pantalla hasta un elemento y le pone el foco del teclado (para lectores de pantalla y para seguir con Tab). */
  function goTo(node, opts) {
    if (!node) return;
    opts = opts || {};
    try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
    if (opts.scroll === false) return;
    node.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: opts.block || 'start' });
  }

  // Llamada a la API. Si el servidor responde un error, se lanza con el mensaje que tiene que ver el cliente.
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['X-Cliente-Token'] = state.token;
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || 'Algo salió mal. Probá de nuevo.');
          err.status = res.status;
          err.code = data.code || '';
          throw err;
        }
        return data;
      });
    }, function () {
      throw new Error('No pudimos conectarnos. Revisá tu conexión y probá de nuevo.');
    });
  }

  /** Mientras dura un pedido, el botón queda en espera: no se puede tocar dos veces. */
  function busy(btn, promise) {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    var done = function () {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
    };
    promise.then(done, done);
    return promise;
  }

  /* ---------- fechas (siempre en hora de Buenos Aires) ---------- */
  var WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };

  function todayAR() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var g = function (t) { return parts.filter(function (p) { return p.type === t; })[0].value; };
      return g('year') + '-' + g('month') + '-' + g('day');
    } catch (e) {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }
  }
  function ymd(iso) { return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) }; }
  function weekdayOf(iso) { var p = ymd(iso); return new Date(Date.UTC(p.y, p.m - 1, p.d, 12)).getUTCDay(); }
  /** "viernes 27 de noviembre" */
  function fmtDay(iso) { var p = ymd(iso); return WEEKDAYS[weekdayOf(iso)] + ' ' + p.d + ' de ' + MONTHS[p.m - 1]; }
  /** "Noviembre 2026" */
  function fmtMonth(month) { return cap(MONTHS[Number(month.slice(5, 7)) - 1]) + ' ' + month.slice(0, 4); }
  function shiftMonth(month, by) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7)) - 1 + by;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad(m + 1);
  }
  function daysIn(month) { return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0, 12)).getUTCDate(); }

  var STATUS_LABEL = { pendiente: 'Pendiente de confirmación', confirmado: 'Confirmado', rechazado: 'No se pudo confirmar' };
  var STATUS_CLASS = { pendiente: ' pending', confirmado: ' confirmed', rechazado: ' rejected' };
  // Qué significa cada estado, con palabras claras.
  var STATUS_HELP = {
    pendiente: 'Esperando que la veterinaria lo confirme. Volvé a entrar con tu teléfono para ver si lo aceptó.',
    confirmado: 'La veterinaria lo confirmó: te esperamos.',
  };
  // La pregunta por la reseña se hace una sola vez por cliente en este dispositivo.
  var REVIEW_KEY = 'turnos-resena-';

  /* ---------- en qué paso está el cliente: 1 ingresar, 2 mascota, 3 día, 4 hora, 5 confirmar (6 = terminado) ---------- */
  function setStep(n) {
    Array.prototype.forEach.call($('steps').children, function (li, i) {
      var name = li.querySelector('.step-name').textContent;
      var isDone = i < n - 1;
      var isNow = i === n - 1;
      li.classList.toggle('is-done', isDone);
      if (isNow) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
      li.setAttribute('aria-label', 'Paso ' + (i + 1) + ' de 5: ' + name + (isDone ? ', listo' : isNow ? ', paso actual' : ''));
    });
  }

  /** Entrada suave de la vista que aparece: hacia adelante o de vuelta. Sin movimiento si el sistema lo pide. */
  function animate(node, back) {
    if (reduceMotion()) return;
    node.classList.remove('in', 'in-back');
    void node.offsetWidth; // reinicia la animación si se repite
    node.classList.add(back ? 'in-back' : 'in');
  }

  /** La parte izquierda del talón: el día en grande y el mes. Es un adorno: la fecha completa va en texto al lado. */
  function fillStub(dayNode, monthNode, iso) {
    var p = ymd(iso);
    dayNode.textContent = String(p.d);
    monthNode.textContent = MONTHS[p.m - 1].slice(0, 3);
  }
  function stubOf(iso) {
    var box = el('div', null, 'stub');
    box.setAttribute('aria-hidden', 'true');
    var d = el('span', null, 'stub-day');
    var m = el('span', null, 'stub-month');
    fillStub(d, m, iso);
    box.appendChild(d);
    box.appendChild(m);
    return box;
  }

  /* ---------- avisos cortos ("Listo, entraste.") ---------- */
  function notice(id, msg) {
    var n = $(id);
    n.textContent = msg || '';
    n.hidden = !msg;
  }

  /* ---------- errores debajo de cada campo ---------- */
  function fieldError(input, msg) {
    var box = $(input.id + '-err');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  /** Revisa una lista de [campo, mensaje si está mal]. Marca cada error junto a su campo y enfoca el primero. */
  function validate(checks) {
    var first = null;
    checks.forEach(function (c) {
      fieldError(c[0], c[1]);
      if (c[1] && !first) first = c[0];
    });
    if (first) first.focus();
    return !first;
  }
  /** El error se borra apenas el cliente corrige el campo. */
  function clearOnInput(form) {
    var clear = function (e) { if (e.target.id && $(e.target.id + '-err')) fieldError(e.target, ''); };
    form.addEventListener('input', clear);
    form.addEventListener('change', clear);
  }
  function phoneProblem(v, emptyMsg) {
    var t = String(v || '').trim();
    if (!t) return emptyMsg;
    if (!/^[0-9 +()-]+$/.test(t)) return 'El teléfono solo puede tener números, espacios, +, - y paréntesis.';
    if (onlyDigits(t).length < 6) return 'Al teléfono le faltan números: tiene que tener al menos 6.';
    return '';
  }

  /* ---------- información de la veterinaria ---------- */
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

  function rangesOf(hours, dow) {
    var v = hours ? hours[dow] : null;
    if (!Array.isArray(v) || !v.length) return [];
    // Acepta el formato viejo (una sola franja).
    return typeof v[0] === 'string' ? [v] : v;
  }

  function renderInfo(info) {
    state.info = info;
    // El título de la pestaña (y la vista previa al compartir) ya lo escribe el servidor con el nombre de la veterinaria.
    var name = info.clinic || 'Veterinaria';
    setText('clinic', name);

    if (info.professionalName) {
      setText('professional', 'A cargo de ' + info.professionalName);
      show('professional', true);
    }
    if (info.address) {
      setText('address', info.address);
      show('address', true);
      setText('location-address', info.address);
      show('location-address', true);
      setText('footer-address', info.address);
      show('footer-address', true);
    }
    if (info.phone) {
      // Enlace tel: de verdad. Sin teléfono cargado, ningún botón de llamar se muestra.
      var tel = 'tel:' + onlyDigits(info.phone);
      [['call-btn', 'Llamar ' + info.phone], ['call-link', 'Llamar a la veterinaria'], ['bar-call', 'Llamar'], ['phone-link', info.phone], ['footer-phone-link', info.phone], ['done-call-link', info.phone]].forEach(function (x) {
        $(x[0]).href = tel;
        $(x[0]).textContent = x[1];
      });
      show('call-btn', true);
      show('bar-call', true);
      show('location-phone', true);
      show('footer-phone', true);
      show('done-call', true);
    }
    if (info.mapsUrl) {
      $('maps-btn').href = info.mapsUrl;
      show('maps-btn', true);
    }
    show('location-card', !!(info.address || info.phone || info.mapsUrl));
    setText('footer-name', name);

    renderServices(info.types);
    renderHours(info.hours);
    renderMethods(info.methods);
    renderReviews(info.reviews, info.mapsUrl);
    renderTypes();
  }

  // Qué se atiende: la misma lista de tipos de turno que después se puede pedir.
  function renderServices(types) {
    var ul = $('services');
    ul.textContent = '';
    (types || []).forEach(function (t) {
      var li = el('li');
      li.appendChild(el('span', t.label, 'service-name'));
      li.appendChild(el('span', t.duration + ' min', 'service-time'));
      ul.appendChild(li);
    });
    show('services-card', ul.children.length > 0);
  }

  // Horario: un día puede tener varias franjas.
  function renderHours(hours) {
    var ul = $('hours');
    ul.textContent = '';
    var todayDow = weekdayOf(todayAR());
    DAY_ORDER.forEach(function (d) {
      var ranges = rangesOf(hours, d);
      var li = el('li');
      var name = el('span', cap(WEEKDAYS[d]), 'day-name');
      if (d === todayDow) {
        li.className = 'today';
        name.appendChild(el('span', 'Hoy', 'today-tag'));
      }
      li.appendChild(name);
      var box = el('span', null, 'day-hours' + (ranges.length ? '' : ' muted'));
      if (!ranges.length) box.textContent = 'Cerrado';
      ranges.forEach(function (r) { box.appendChild(el('span', r[0] + ' a ' + r[1] + '\u00a0hs')); });
      li.appendChild(box);
      ul.appendChild(li);
    });
  }

  function renderMethods(methods) {
    var ul = $('methods');
    ul.textContent = '';
    (methods || []).forEach(function (m) { ul.appendChild(el('li', m, 'chip')); });
    $('methods-card').hidden = !ul.children.length;
  }

  // Reseñas cargadas a mano por la veterinaria (texto y estrellas).
  function renderReviews(reviews, mapsUrl) {
    if (!reviews || !reviews.length) return;
    var ul = $('reviews');
    ul.textContent = '';
    reviews.forEach(function (r) {
      var li = el('li', null, 'review');
      var stars = el('p', '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), 'stars');
      stars.setAttribute('aria-hidden', 'true');
      li.appendChild(stars);
      li.appendChild(el('span', r.stars + ' de 5 estrellas.', 'sr-only'));
      li.appendChild(el('p', '“' + r.text + '”', 'review-text'));
      li.appendChild(el('p', '— ' + r.author, 'review-author'));
      ul.appendChild(li);
    });
    show('reviews-card', true);
    if (mapsUrl) {
      var p = $('all-reviews');
      p.textContent = '';
      var a = el('a', 'Ver todas las reseñas en Google Maps');
      a.href = mapsUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      p.appendChild(a);
      p.hidden = false;
    }
  }

  function loadInfo() {
    return api('/api/public/info').then(renderInfo).catch(function () {
      setText('footer-name', '');
    });
  }

  function typeOf(value) {
    var list = (state.info && state.info.types) || [];
    for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i];
    return null;
  }
  function typeText(value) {
    var t = typeOf(value);
    return t ? t.label + ' · ' + t.duration + ' min' : value;
  }

  function renderTypes() {
    var box = $('types');
    box.textContent = '';
    var types = (state.info && state.info.types) || [];
    if (types.length && !typeOf(state.type)) state.type = types[0].value;
    types.forEach(function (t) {
      var lab = el('label');
      var input = el('input');
      input.type = 'radio';
      input.name = 'type';
      input.value = t.value;
      input.checked = t.value === state.type;
      input.addEventListener('change', function () {
        state.type = t.value;
        showCalendar();
        loadSlots();
      });
      lab.appendChild(input);
      lab.appendChild(el('span', typeText(t.value)));
      box.appendChild(lab);
    });
  }

  /* ---------- "Sacar turno": baja hasta la sección de turnos y deja el foco donde sigue el cliente ---------- */
  function goBook(e) {
    if (e) e.preventDefault();
    var target = !$('login').hidden ? $('phone') : !$('register').hidden ? $('r-first') : $('book-title');
    $('reserva').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    try { target.focus({ preventScroll: true }); } catch (err) { target.focus(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-book]'), function (a) { a.addEventListener('click', goBook); });

  /* ---------- paso 1: entrar con el teléfono ---------- */
  // notFound: el número no está registrado. El cuadro es tranquilo (no un error rojo) y trae "Soy cliente nuevo" adentro.
  function showLoginError(message, notFound) {
    setText('login-error-text', message);
    $('login-error').classList.toggle('soft', !!notFound);
    show('login-new', !!notFound);
    // "Llamar" solo si la veterinaria tiene teléfono cargado.
    show('call-link', !!notFound && !!(state.info && state.info.phone));
    show('login-error', true);
    goTo($('login-error'), { block: 'center' });
  }
  function clearLoginError() {
    show('login-error', false);
    fieldError($('phone'), '');
  }

  function resetFlow() {
    state.day = null;
    state.hour = null;
    state.time = null;
    state.days = {};
    state.lastDay = null;
    state.lastDate = null;
    state.month = null;
    state.slotsLoaded = false;
    show('done', false);
    show('book-flow', true);
    closeAddPet();
    notice('pet-msg', '');
    notice('mine-msg', '');
    show('pet-offer', false);
  }
  // En celular (una sola columna) "Pedir turno" queda debajo de "Tus turnos", fuera de la pantalla.
  var narrow = function () { return !!(window.matchMedia && window.matchMedia('(max-width: 699px)').matches); };

  // message = aviso corto ("Listo, entraste."). Sin mensaje (al recargar la página) no se mueve la pantalla.
  function enter(summary, token, message) {
    if (token) {
      state.token = token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sin sessionStorage: solo dura esta pestaña */ }
    }
    state.client = summary.client;
    state.pets = summary.pets || [];
    state.appointments = summary.appointments || [];
    state.hadVisit = !!summary.hadVisit;
    resetFlow();
    show('login', false);
    show('register', false);
    show('home', true);
    if (message) animate($('home'));
    setText('hello', 'Hola, ' + state.client.firstName);
    renderPets();
    renderAppointments();
    askReview();
    showCalendar();
    loadSlots();
    offerPendingPet();
    notice('notice', message || '');
    if (message) {
      var rejected = state.appointments.some(function (a) { return a.status === 'rechazado'; });
      if (narrow() && !rejected) {
        // Celular: se lleva la pantalla a "Pedir turno" (si hay un pedido rechazado, se queda arriba para verlo).
        goTo($('book-title'));
      } else {
        // Arriba de la sección queda a la vista el aviso; el foco pasa al saludo.
        $('reserva').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
        goTo($('hello'), { scroll: false });
      }
    }
  }

  /* ---------- la mascota que escribió en "Cliente nuevo" cuando su teléfono ya estaba registrado ---------- */
  function samePetName(a, b) { return String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); }
  function offerPendingPet() {
    var pet = state.pendingPet;
    state.pendingPet = null;
    show('pet-offer', false);
    if (!pet) return;
    $('register-form').reset();
    var had = state.pets.filter(function (p) { return samePetName(p.name, pet.name); })[0];
    if (had) {
      // Ya la tenía cargada: se elige esa y listo.
      $('pet').value = String(had.id);
      return;
    }
    state.offer = pet;
    setText('pet-offer-text', 'Escribiste a ' + pet.name + ' al anotarte. ¿Querés agregarla a tus mascotas?');
    setText('pet-offer-yes', 'Agregar a ' + pet.name);
    show('pet-offer-error', false);
    show('pet-offer', true);
  }
  $('pet-offer-no').addEventListener('click', function () {
    state.offer = null;
    show('pet-offer', false);
    $('pet').focus();
  });
  $('pet-offer-yes').addEventListener('click', function () {
    var pet = state.offer;
    if (!pet) return;
    if (!pet.sex) {
      // Falta el sexo: se abre el formulario de mascota con lo que ya escribió, para completar solo eso.
      show('pet-offer', false);
      openAddPet();
      var f = $('add-pet-form');
      f.petName.value = pet.name;
      f.species.value = pet.species;
      f.sex.focus();
      return;
    }
    busy($('pet-offer-yes'), api('/api/public/pets', { method: 'POST', body: { pet: pet } }).then(function (summary) {
      state.offer = null;
      show('pet-offer', false);
      petAdded(summary, pet.name);
    }, function (err) {
      if (expired(err)) return;
      setText('pet-offer-error', err.message);
      show('pet-offer-error', true);
    }));
  });

  function leave(message, loginError) {
    state.token = null;
    state.client = null;
    state.pets = [];
    state.appointments = [];
    state.hadVisit = false;
    state.pendingPet = null;
    state.offer = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
    show('home', false);
    show('register', false);
    show('login', true);
    animate($('login'), true);
    setStep(1);
    $('phone').value = '';
    clearLoginError();
    notice('notice', message || '');
    show('review-ask', false);
    if (loginError) showLoginError(loginError, false);
    else goTo($('login-title'), { scroll: false });
    $('reserva').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  /** Si la sesión venció, se vuelve al ingreso con el aviso. Devuelve true si se ocupó del error. */
  function expired(err) {
    if (!err || err.status !== 401) return false;
    leave('', err.message);
    return true;
  }

  function refresh() {
    return api('/api/public/me').then(function (summary) {
      state.client = summary.client;
      state.pets = summary.pets || [];
      state.appointments = summary.appointments || [];
      state.hadVisit = !!summary.hadVisit;
      renderPets();
      renderAppointments();
      askReview();
      return loadSlots();
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    clearLoginError();
    notice('notice', '');
    var input = $('phone');
    if (!validate([[input, phoneProblem(input.value, 'Escribí tu teléfono.')]])) return;
    busy($('login-submit'), api('/api/public/login', { method: 'POST', body: { phone: input.value.trim() } }).then(function (summary) {
      enter(summary, summary.token, 'Listo, entraste.');
    }, function (err) {
      showLoginError(err.message, err.status === 404 && err.code === 'no-registrado');
    }));
  });
  clearOnInput($('login-form'));

  // "Probar de nuevo" no borra el número: casi siempre hay que corregir un dígito o agregar la característica.
  $('retry').addEventListener('click', function () {
    clearLoginError();
    var input = $('phone');
    input.focus();
    try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* algunos tipos de campo no lo permiten */ }
  });
  $('login-new').addEventListener('click', function () { openRegister(); });

  function openRegister() {
    clearLoginError();
    notice('notice', '');
    show('login', false);
    show('register', true);
    animate($('register'));
    if (!$('r-phone').value) $('r-phone').value = $('phone').value.trim();
    goTo($('r-first'), { scroll: false });
    $('register').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }
  $('show-register').addEventListener('click', openRegister);

  function closeRegister() {
    show('register', false);
    show('login', true);
    animate($('login'), true);
    show('register-error', false);
  }
  $('register-cancel').addEventListener('click', function () {
    closeRegister();
    // El foco vuelve al botón desde el que se abrió el alta.
    goTo($('show-register'), { block: 'center' });
  });

  // "Ese teléfono ya está registrado": un toque y queda en el ingreso con el número escrito. Lo demás no se pierde: el
  // formulario queda como estaba (por si vuelve) y, al entrar, se le ofrece agregar la mascota que escribió.
  $('use-phone').addEventListener('click', function () {
    var f = $('register-form');
    var phone = f.phone.value.trim();
    var petName = f.petName.value.trim();
    state.pendingPet = petName ? { name: petName, species: f.species.value, sex: f.sex.value } : null;
    closeRegister();
    show('use-phone', false);
    fieldError(f.phone, '');
    $('phone').value = phone;
    goTo($('login-submit'), { block: 'center' });
  });

  $('register-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    show('register-error', false);
    show('use-phone', false);
    var ok = validate([
      [f.firstName, f.firstName.value.trim() ? '' : 'Falta tu nombre.'],
      [f.lastName, f.lastName.value.trim() ? '' : 'Falta tu apellido.'],
      [f.phone, phoneProblem(f.phone.value, 'Falta tu teléfono.')],
      [f.petName, f.petName.value.trim() ? '' : 'Falta el nombre de tu mascota.'],
      [f.sex, f.sex.value ? '' : 'Elegí el sexo de tu mascota.'],
    ]);
    if (!ok) return;
    var body = {
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      phone: f.phone.value.trim(),
      pet: { name: f.petName.value.trim(), species: f.species.value, sex: f.sex.value },
    };
    busy($('register-submit'), api('/api/public/register', { method: 'POST', body: body }).then(function (summary) {
      f.reset();
      state.pendingPet = null;
      enter(summary, summary.token, 'Listo, ya quedaste anotado. Ahora elegí el día y el horario.');
    }, function (err) {
      if (err.status === 409) {
        // El error del teléfono va junto al campo, con el atajo para entrar.
        fieldError(f.phone, err.message);
        show('use-phone', true);
        f.phone.focus();
        return;
      }
      if (/tel[eé]fono/i.test(err.message) && err.status === 400) {
        fieldError(f.phone, err.message);
        f.phone.focus();
        return;
      }
      setText('register-error', err.message);
      show('register-error', true);
      goTo($('register-error'), { block: 'center' });
    }));
  });
  clearOnInput($('register-form'));
  $('r-phone').addEventListener('input', function () { show('use-phone', false); });

  $('logout').addEventListener('click', function () { leave('Listo, saliste.'); });

  /* ---------- mascotas ---------- */
  function petOf(id) {
    for (var i = 0; i < state.pets.length; i++) if (String(state.pets[i].id) === String(id)) return state.pets[i];
    return null;
  }

  function renderPets() {
    var sel = $('pet');
    var previous = sel.value;
    sel.textContent = '';
    if (!state.pets.length) {
      var none = el('option', 'Todavía no cargaste ninguna mascota', '');
      none.value = '';
      sel.appendChild(none);
      sel.disabled = true;
    } else {
      sel.disabled = false;
      state.pets.forEach(function (p) {
        var o = el('option', p.name + ' (' + p.species + (p.breed ? ', ' + p.breed : '') + ')');
        o.value = String(p.id);
        sel.appendChild(o);
      });
      if (previous && petOf(previous)) sel.value = previous;
    }
  }
  $('pet').addEventListener('change', function () {
    notice('pet-msg', '');
    // Con otra mascota cambian los días marcados como "Ya tenés turno".
    if (state.day) showDay(state.day, { keepFocus: true });
    else renderCalendar();
  });

  function closeAddPet() {
    var f = $('add-pet-form');
    f.hidden = true;
    f.reset();
    show('add-pet-error', false);
    [f.petName, f.sex].forEach(function (x) { fieldError(x, ''); });
    var t = $('toggle-add-pet');
    t.textContent = '+ Agregar otra mascota';
    t.setAttribute('aria-expanded', 'false');
  }
  function openAddPet() {
    var t = $('toggle-add-pet');
    $('add-pet-form').hidden = false;
    t.textContent = 'Cancelar';
    t.setAttribute('aria-expanded', 'true');
    notice('pet-msg', '');
  }
  $('toggle-add-pet').addEventListener('click', function () {
    if (!$('add-pet-form').hidden) {
      closeAddPet();
      return;
    }
    openAddPet();
    $('a-pet-name').focus();
  });
  /** Mascota recién agregada: queda elegida y se sigue con el día. */
  function petAdded(summary, name) {
    state.pets = summary.pets || [];
    renderPets();
    // La lista viene ordenada por nombre: la recién agregada es la de número más alto.
    $('pet').value = String(Math.max.apply(null, state.pets.map(function (p) { return p.id; })));
    notice('pet-msg', 'Listo, agregaste a ' + name + '. Ahora elegí el día.');
    if (state.day) showDay(state.day, { keepFocus: true });
    else renderCalendar();
    goTo($('pet'), { block: 'center' });
  }

  $('add-pet-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    show('add-pet-error', false);
    var ok = validate([
      [f.petName, f.petName.value.trim() ? '' : 'Falta el nombre de tu mascota.'],
      [f.sex, f.sex.value ? '' : 'Elegí el sexo de tu mascota.'],
    ]);
    if (!ok) return;
    var pet = { name: f.petName.value.trim(), species: f.species.value, sex: f.sex.value };
    busy($('add-pet-submit'), api('/api/public/pets', { method: 'POST', body: { pet: pet } }).then(function (summary) {
      closeAddPet();
      petAdded(summary, pet.name);
    }, function (err) {
      if (expired(err)) return;
      setText('add-pet-error', err.message);
      show('add-pet-error', true);
    }));
  });
  clearOnInput($('add-pet-form'));
  $('add-pet-form').addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closeAddPet();
    $('toggle-add-pet').focus();
  });

  /* ---------- mis turnos ---------- */
  function renderAppointments() {
    var list = $('my-appts');
    list.textContent = '';
    var items = state.appointments.filter(function (a) { return a.status !== 'rechazado'; })
      .concat(state.appointments.filter(function (a) { return a.status === 'rechazado'; }));
    $('no-appts').hidden = items.length > 0;
    items.forEach(function (a) {
      var item = el('li', null, 'ticket' + (STATUS_CLASS[a.status] || ''));
      item.appendChild(stubOf(a.date));
      var li = el('div', null, 'ticket-body');
      item.appendChild(li);
      var title = el('div', null, 'appt-title');
      title.appendChild(el('span', a.typeLabel + ' con ' + a.patientName));
      li.appendChild(title);
      li.appendChild(el('div', cap(fmtDay(a.date)) + ' a las ' + a.time + '\u00a0hs', 'appt-when'));
      var badge = el('span', null, 'badge' + (STATUS_CLASS[a.status] || ''));
      // "Confirmado" se reconoce de un vistazo: tilde, borde verde y el talón con contorno (el ámbar es solo de "Pendiente").
      if (a.status === 'confirmado') badge.appendChild(el('span', '✓', 'badge-icon')).setAttribute('aria-hidden', 'true');
      badge.appendChild(document.createTextNode(STATUS_LABEL[a.status] || a.status));
      li.appendChild(badge);
      if (a.status === 'rechazado') {
        // Un pedido que la veterinaria rechazó en los últimos días: se explica y se ofrece pedir otro horario.
        var why = el('p', 'La veterinaria no pudo confirmar este horario. Probá con otro' + (state.info && state.info.phone ? ' o llamanos al ' : '.'), 'appt-help');
        if (state.info && state.info.phone) {
          var tel = el('a', state.info.phone);
          tel.href = 'tel:' + onlyDigits(state.info.phone);
          why.appendChild(tel);
          why.appendChild(document.createTextNode('.'));
        }
        li.appendChild(why);
        var again = el('button', 'Pedir otro horario', 'btn');
        again.type = 'button';
        again.addEventListener('click', function () {
          notice('notice', '');
          show('done', false);
          show('book-flow', true);
          showCalendar($('cal-heading'));
        });
        li.appendChild(again);
        list.appendChild(item);
        return;
      }
      if (STATUS_HELP[a.status]) li.appendChild(el('p', STATUS_HELP[a.status], 'appt-help'));
      if (a.status === 'confirmado') {
        // Mensaje que dejó la veterinaria al confirmar (por ejemplo, "Traer al perro en ayunas."). Siempre como texto.
        if (a.message) {
          var box = el('div', null, 'vet-msg');
          box.appendChild(el('p', 'Mensaje de la veterinaria', 'vet-msg-title'));
          box.appendChild(el('p', a.message, 'vet-msg-text'));
          li.appendChild(box);
        }
        li.appendChild(calendarLinks(a));
      }
      if (!a.canCancel) {
        // Lo agendó la veterinaria (o ya empezó): desde la página no se cancela.
        li.appendChild(el('div', 'Para cambiar o cancelar este turno, ' + (state.info && state.info.phone ? 'llamá a la veterinaria.' : 'avisale a la veterinaria.'), 'muted small-text'));
        list.appendChild(item);
        return;
      }
      var cancel = el('button', 'Cancelar turno', 'btn text danger');
      cancel.type = 'button';
      cancel.setAttribute('aria-label', 'Cancelar el turno de ' + a.patientName + ' del ' + fmtDay(a.date) + ' a las ' + a.time + '\u00a0hs');
      li.appendChild(cancel);

      // Confirmación dentro de la tarjeta (sin el cartel del navegador).
      var ask = el('div', null, 'confirm');
      ask.setAttribute('role', 'group');
      ask.hidden = true;
      var question = el('p', '¿Cancelás el turno?', 'confirm-text');
      question.id = 'cancel-q-' + a.id;
      ask.setAttribute('aria-labelledby', question.id);
      ask.appendChild(question);
      if (a.status === 'confirmado') {
        // Un turno ya confirmado: la veterinaria cuenta con él. Se dice claro antes de cancelar.
        var warn = el('p', 'La veterinaria ya te estaba esperando. Si cancelás, el horario queda libre para otra persona. Si podés, avisale también.', 'confirm-help');
        warn.id = 'cancel-h-' + a.id;
        ask.setAttribute('aria-describedby', warn.id);
        ask.appendChild(warn);
      }
      var yes = el('button', 'Sí, cancelar', 'btn danger');
      yes.type = 'button';
      var no = el('button', 'No', 'btn');
      no.type = 'button';
      var err = el('p', null, 'field-error');
      err.setAttribute('role', 'alert');
      err.hidden = true;
      var row = el('div', null, 'row');
      row.appendChild(no);
      row.appendChild(yes);
      ask.appendChild(row);
      ask.appendChild(err);
      li.appendChild(ask);

      var close = function () {
        ask.hidden = true;
        cancel.hidden = false;
        cancel.focus();
      };
      cancel.addEventListener('click', function () {
        notice('notice', '');
        notice('mine-msg', '');
        err.hidden = true;
        cancel.hidden = true;
        ask.hidden = false;
        animate(ask);
        no.focus();
      });
      no.addEventListener('click', close);
      ask.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      });
      yes.addEventListener('click', function () {
        busy(yes, api('/api/public/appointments/' + a.id + '/cancel', { method: 'POST' }).then(function () {
          return refresh().then(function () {
            notice('mine-msg', 'Listo, cancelaste el turno. Si querés otro horario, elegilo abajo.');
            goTo($('mine-title'), { block: 'center' });
          });
        }).catch(function (e2) {
          if (expired(e2)) return;
          err.textContent = e2.message;
          err.hidden = false;
        }));
      });
      list.appendChild(item);
    });
  }

  /* ---------- "Agregar al calendario" (turnos confirmados) ----------
     Google Calendar: un enlace que abre la plantilla de evento ya completa. Otros calendarios: un archivo .ics que arma
     el navegador (no hace falta pedirle nada al servidor). Todo sale de los datos reales: nombre, dirección y teléfono
     de la veterinaria (sin dirección, el evento va sin lugar) y el mensaje que dejó al confirmar. */
  function clinicName() { return (state.info && state.info.clinic) || 'Veterinaria'; }
  /** Inicio y fin del turno: en hora de Buenos Aires ('AAAAMMDDTHHMMSS') y en UTC (con Z, para el .ics). */
  function eventTimes(a) {
    var p = ymd(a.date);
    var start = Date.UTC(p.y, p.m - 1, p.d, Number(a.time.slice(0, 2)), Number(a.time.slice(3, 5)));
    var end = start + (Number(a.duration) || 30) * 60000;
    var fmt = function (t) {
      var d = new Date(t);
      return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00';
    };
    // Argentina está en UTC-3 todo el año (no usa horario de verano desde 2009).
    var AR = 3 * 3600000;
    return { start: fmt(start), end: fmt(end), startUtc: fmt(start + AR) + 'Z', endUtc: fmt(end + AR) + 'Z' };
  }
  function eventText(a) {
    var title = a.typeLabel + ' de ' + a.patientName + (state.info && state.info.clinic ? ' en ' + clinicName() : ' en la veterinaria');
    var details = ['Turno confirmado: ' + a.typeLabel.toLowerCase() + ' para ' + a.patientName + '.'];
    if (a.message) details.push('Mensaje de la veterinaria: ' + a.message);
    if (state.info && state.info.phone) details.push('Teléfono: ' + state.info.phone);
    return { title: title, details: details.join('\n'), location: (state.info && state.info.address) || '' };
  }
  function googleCalendarUrl(a) {
    var t = eventTimes(a);
    var x = eventText(a);
    var url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
      '&text=' + encodeURIComponent(x.title) +
      '&dates=' + t.start + '/' + t.end +
      '&ctz=' + encodeURIComponent(TZ) +
      '&details=' + encodeURIComponent(x.details);
    if (x.location) url += '&location=' + encodeURIComponent(x.location);
    return url;
  }
  /** Texto de un campo de .ics: se escapan \ ; , y los saltos de línea. */
  function icsText(v) { return String(v).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'); }
  /** Las líneas de un .ics no pueden pasar de 75 bytes: se cortan y siguen en la línea de abajo con un espacio. */
  function icsFold(line) {
    var out = '';
    var bytes = 0;
    for (var i = 0; i < line.length; i++) {
      var c = line.charCodeAt(i);
      var ch = line.charAt(i);
      var size = c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < line.length) { ch += line.charAt(++i); size = 4; }
      if (bytes + size > 74) { out += '\r\n '; bytes = 1; }
      out += ch;
      bytes += size;
    }
    return out;
  }
  function icsFile(a) {
    var t = eventTimes(a);
    var x = eventText(a);
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + 'Z';
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Turnos online//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:turno-' + a.id + '@' + (location.hostname || 'turnos'),
      'DTSTAMP:' + stamp,
      'DTSTART:' + t.startUtc,
      'DTEND:' + t.endUtc,
      'SUMMARY:' + icsText(x.title),
      'DESCRIPTION:' + icsText(x.details),
    ];
    if (x.location) lines.push('LOCATION:' + icsText(x.location));
    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.map(icsFold).join('\r\n') + '\r\n';
  }
  function calendarLinks(a) {
    var box = el('div', null, 'add-cal');
    var g = el('a', 'Agregar a Google Calendar', 'btn');
    g.href = googleCalendarUrl(a);
    g.target = '_blank';
    g.rel = 'noopener';
    g.setAttribute('aria-label', 'Agregar a Google Calendar el turno de ' + a.patientName + ' del ' + fmtDay(a.date) + ' (se abre en otra pestaña)');
    box.appendChild(g);
    var f = el('a', 'Descargar archivo (.ics)', 'ics-link');
    f.href = '#';
    f.download = 'turno-' + a.date + '-' + a.time.replace(':', '') + '.ics';
    f.setAttribute('aria-label', 'Descargar el turno de ' + a.patientName + ' del ' + fmtDay(a.date) + ' para otro calendario (archivo .ics)');
    // El archivo se arma al tocar el enlace (blob: no necesita estilos ni scripts en línea, así que la política de
    // seguridad del servidor no lo bloquea).
    f.addEventListener('click', function () {
      if (!window.Blob || !window.URL || !URL.createObjectURL) return;
      var url = URL.createObjectURL(new Blob([icsFile(a)], { type: 'text/calendar;charset=utf-8' }));
      f.href = url;
      setTimeout(function () { URL.revokeObjectURL(url); f.href = '#'; }, 30000);
    });
    box.appendChild(f);
    return box;
  }

  /** El turno (pendiente o confirmado) que la mascota elegida ya tiene ese día, o null. */
  function mineOn(iso) {
    var petId = $('pet').value;
    if (!petId) return null;
    for (var i = 0; i < state.appointments.length; i++) {
      var a = state.appointments[i];
      if (a.status !== 'rechazado' && String(a.patientId) === String(petId) && a.date === iso) return a;
    }
    return null;
  }

  /* ---------- día: calendario del mes ---------- */
  function loadSlots() {
    if (!state.info) return Promise.resolve();
    if (!state.slotsLoaded) {
      setText('cal-msg', 'Buscando horarios libres…');
      show('cal-msg', true);
      show('cal', false);
    }
    return api('/api/public/slots?type=' + encodeURIComponent(state.type)).then(function (res) {
      state.days = {};
      state.lastDay = null;
      state.lastDate = res.lastDate || null;
      (res.days || []).forEach(function (d) {
        state.days[d.date] = d.times;
        if (!state.lastDay || d.date > state.lastDay) state.lastDay = d.date;
      });
      state.slotsLoaded = true;
      if (state.day) showDay(state.day, { keepFocus: true });
      else renderCalendar();
    }, function (err) {
      if (expired(err)) return;
      state.slotsLoaded = false;
      setText('cal-msg', err.message);
      show('cal-msg', true);
      show('cal', false);
    });
  }

  function renderCalendar() {
    if (!state.slotsLoaded) return;
    var today = todayAR();
    var firstMonth = today.slice(0, 7);
    // Hacia adelante se llega hasta el último día en que el servidor ofrece horarios.
    var lastMonth = state.lastDay && state.lastDay.slice(0, 7) > firstMonth ? state.lastDay.slice(0, 7) : firstMonth;
    var hasPets = state.pets.length > 0;
    var free = Object.keys(state.days).sort();

    if (!hasPets || !free.length) {
      setText('cal-msg', !hasPets ? 'Primero agregá tu mascota con el botón de arriba.'
        : 'No hay horarios libres en los próximos días.' + (state.info.phone ? ' Llamá a la veterinaria para consultar.' : ''));
      show('cal-msg', true);
      show('cal', false);
      return;
    }
    show('cal-msg', false);
    show('cal', true);
    // Hasta cuándo se puede pedir (el servidor ofrece los próximos 90 días): así nadie busca más allá.
    // Si el límite cae en otro año, se dice el año ("hasta el lunes 15 de febrero de 2027").
    var limitYear = state.lastDate && state.lastDate.slice(0, 4) !== today.slice(0, 4) ? ' de ' + state.lastDate.slice(0, 4) : '';
    setText('cal-limit', state.lastDate ? 'Podés pedir turno hasta el ' + fmtDay(state.lastDate) + limitYear + '.' : '');
    show('cal-limit', !!state.lastDate);

    // Se arranca en el mes del primer día con horarios; nunca fuera de los meses permitidos.
    if (!state.month || state.month < firstMonth || state.month > lastMonth) state.month = free[0].slice(0, 7);
    var month = state.month;
    setText('cal-month', fmtMonth(month));
    var prev = $('cal-prev');
    var next = $('cal-next');
    prev.disabled = month <= firstMonth;
    next.disabled = month >= lastMonth;
    prev.setAttribute('aria-label', prev.disabled ? 'Mes anterior (no se puede ir a meses pasados)' : 'Mes anterior: ' + fmtMonth(shiftMonth(month, -1)));
    next.setAttribute('aria-label', next.disabled ? 'Mes siguiente (no hay turnos para pedir más adelante)' : 'Mes siguiente: ' + fmtMonth(shiftMonth(month, 1)));

    var grid = $('cal-grid');
    grid.textContent = '';
    // La semana empieza el lunes: se dejan huecos hasta el día 1.
    var offset = (weekdayOf(month + '-01') + 6) % 7;
    for (var i = 0; i < offset; i++) grid.appendChild(el('span', null, 'cal-empty'));
    var total = daysIn(month);
    for (var d = 1; d <= total; d++) grid.appendChild(dayCell(month + '-' + pad(d), d, today));
  }

  function dayCell(iso, num, today) {
    var b = el('button', null, 'cal-day');
    b.type = 'button';
    b.dataset.date = iso;
    b.appendChild(el('span', String(num), 'cal-num'));
    var times = state.days[iso];
    var mine = iso >= today ? mineOn(iso) : null;
    var what;
    if (iso < today) {
      b.disabled = true;
      b.classList.add('off');
      what = 'ya pasó';
    } else if (mine) {
      // Se puede tocar: explica qué turno tiene, en vez de ofrecer horarios que el servidor después rechaza.
      b.classList.add('mine');
      b.appendChild(el('span', 'Ya tenés turno', 'cal-tag'));
      what = 'ya tenés turno';
    } else if (times && times.length) {
      b.classList.add('free');
      what = times.length === 1 ? '1 horario libre' : times.length + ' horarios libres';
    } else {
      b.disabled = true;
      b.classList.add('off');
      what = rangesOf(state.info.hours, weekdayOf(iso)).length ? 'sin horarios libres' : 'cerrado';
    }
    if (iso === today) {
      b.classList.add('today');
      b.setAttribute('aria-current', 'date');
    }
    b.setAttribute('aria-label', cap(fmtDay(iso)) + (iso === today ? ' (hoy)' : '') + ': ' + what);
    if (!b.disabled) b.addEventListener('click', function () { showDay(iso); });
    return b;
  }

  function turnMonth(by) {
    state.month = shiftMonth(state.month, by);
    renderCalendar();
    animate($('cal-grid'), by < 0);
    // Si la flecha tocada quedó desactivada (se llegó al primer o al último mes), el foco pasa a la otra.
    var used = $(by < 0 ? 'cal-prev' : 'cal-next');
    var other = $(by < 0 ? 'cal-next' : 'cal-prev');
    if (used.disabled) (other.disabled ? $('cal-heading') : other).focus();
  }
  $('cal-prev').addEventListener('click', function () { turnMonth(-1); });
  $('cal-next').addEventListener('click', function () { turnMonth(1); });

  function showCalendar(focus) {
    state.day = null;
    state.hour = null;
    state.time = null;
    show('day-view', false);
    show('summary', false);
    show('day-msg', false);
    show('pick', true);
    show('cal-view', true);
    setStep(state.pets.length ? 3 : 2);
    renderCalendar();
    if (focus) goTo(focus, { block: 'center' });
  }
  $('back-to-cal').addEventListener('click', function () {
    var date = state.day;
    showCalendar();
    animate($('cal-view'), true);
    // El foco vuelve al día que se había abierto (o al título, si ese día ya no se puede tocar).
    var cell = date && document.querySelector('.cal-day[data-date="' + date + '"]:not([disabled])');
    goTo(cell || $('cal-heading'), { block: 'center' });
  });

  /* ---------- hora: primero la hora, después los minutos libres de esa hora ----------
     El día muestra solo las horas que tienen algo libre (separadas en Mañana y Tarde). Al tocar una hora aparecen sus
     minutos libres: la consulta cada 20 minutos (:00, :20, :40) y la vacuna cada 10 (eso lo decide el servidor). */
  function hoursOf(times) {
    var out = [];
    times.forEach(function (t) {
      var h = t.slice(0, 2);
      if (!out.length || out[out.length - 1].hour !== h) out.push({ hour: h, times: [] });
      out[out.length - 1].times.push(t);
    });
    return out;
  }
  function hourLabel(h) { return h + ':00'; }
  function nextHourLabel(h) { return pad((Number(h) + 1) % 24) + ':00'; }

  function showDay(iso, opts) {
    opts = opts || {};
    // Al volver a dibujar el mismo día (otra mascota, horarios recargados) se mantiene la hora abierta, si sigue libre.
    var keepHour = opts.keepFocus && state.day === iso ? state.hour : null;
    state.day = iso;
    state.hour = null;
    state.time = null;
    state.month = iso.slice(0, 7);
    show('cal-view', false);
    show('pick', false);
    show('day-view', true);
    show('summary', false);
    setStep(4);
    if (!opts.keepFocus) notice('notice', '');
    if (!opts.keepFocus) animate($('day-view'));
    if (!opts.keepMsg) show('day-msg', false);
    setText('day-title', cap(fmtDay(iso)));
    var who = petOf($('pet').value);
    setText('recap', typeText(state.type) + (who ? ' para ' + who.name : '') + '.');

    var box = $('slots');
    box.textContent = '';
    var mine = mineOn(iso);
    var note = $('day-mine');
    note.hidden = true;
    var times = state.days[iso] || [];
    if (mine) {
      var pet = petOf($('pet').value);
      note.textContent = (pet ? pet.name : 'Tu mascota') + ' ya tiene turno este día: ' + mine.typeLabel + ' a las ' + mine.time + ' hs. ' +
        (mine.canCancel ? 'Si querés cambiarlo, cancelalo en “Tus turnos” y pedí otro.' : 'Si querés cambiarlo, avisale a la veterinaria.');
      note.hidden = false;
    } else if (!times.length) {
      note.textContent = 'Ya no quedan horarios libres este día. Volvé al calendario y elegí otro.';
      note.hidden = false;
    } else {
      var hours = hoursOf(times);
      var groups = [['Mañana', hours.filter(function (h) { return h.hour + ':00' < NOON; })], ['Tarde', hours.filter(function (h) { return h.hour + ':00' >= NOON; })]];
      groups.forEach(function (g) {
        if (!g[1].length) return;
        var section = el('div', null, 'slot-group');
        var head = el('h5', null, 'slot-title');
        head.appendChild(el('span', g[0]));
        head.appendChild(el('span', g[1].length === 1 ? '1 hora con lugar' : g[1].length + ' horas con lugar', 'muted small-text'));
        section.appendChild(head);
        var grid = el('div', null, 'slots-grid hours-grid');
        g[1].forEach(function (h) {
          var b = el('button', null, 'slot hour');
          b.type = 'button';
          b.dataset.hour = h.hour;
          b.appendChild(el('span', hourLabel(h.hour), 'hour-time'));
          b.appendChild(el('span', h.times.length === 1 ? '1 libre' : h.times.length + ' libres', 'hour-count'));
          b.setAttribute('aria-expanded', 'false');
          b.setAttribute('aria-controls', 'minutes');
          b.setAttribute('aria-label', 'De ' + hourLabel(h.hour) + ' a ' + nextHourLabel(h.hour) + ': ' + (h.times.length === 1 ? '1 horario libre' : h.times.length + ' horarios libres'));
          b.addEventListener('click', function () { toggleHour(h.hour); });
          grid.appendChild(b);
        });
        section.appendChild(grid);
        box.appendChild(section);
      });
      if (keepHour && hours.some(function (h) { return h.hour === keepHour; })) openHour(keepHour, { focus: false });
    }
    if (!opts.keepFocus) goTo($('day-title'), { block: 'center' });
  }

  function hourButton(h) { return document.querySelector('#slots .hour[data-hour="' + h + '"]'); }

  /** Cierra los minutos abiertos (si los hay). */
  function closeHour() {
    var panel = $('minutes');
    if (panel) panel.parentNode.removeChild(panel);
    Array.prototype.forEach.call(document.querySelectorAll('#slots .hour'), function (b) {
      b.setAttribute('aria-expanded', 'false');
      b.classList.remove('open');
    });
    state.hour = null;
    state.time = null;
    show('summary', false);
    setStep(4);
  }

  function toggleHour(h) {
    if (state.hour === h) {
      closeHour();
      var b = hourButton(h);
      if (b) b.focus();
      return;
    }
    openHour(h, { focus: true });
  }

  /** Muestra los minutos libres de una hora, justo debajo de su grupo (Mañana o Tarde). */
  function openHour(h, opts) {
    closeHour();
    var btn = hourButton(h);
    var times = (state.days[state.day] || []).filter(function (t) { return t.slice(0, 2) === h; });
    if (!btn || !times.length) return;
    state.hour = h;
    btn.setAttribute('aria-expanded', 'true');
    btn.classList.add('open');

    var panel = el('div', null, 'minutes');
    panel.id = 'minutes';
    panel.setAttribute('role', 'group');
    var title = el('p', 'Horarios libres entre las ' + hourLabel(h) + ' y las ' + nextHourLabel(h), 'minutes-title');
    title.id = 'minutes-title';
    panel.setAttribute('aria-labelledby', title.id);
    panel.appendChild(title);
    var grid = el('div', null, 'slots-grid minutes-grid');
    times.forEach(function (t) {
      var b = el('button', t, 'slot minute');
      b.type = 'button';
      b.dataset.time = t;
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', t + '\u00a0hs');
      b.addEventListener('click', function () { pickTime(t); });
      grid.appendChild(b);
    });
    panel.appendChild(grid);
    // Escape cierra los minutos y el foco vuelve a la hora.
    panel.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      closeHour();
      var b = hourButton(h);
      if (b) b.focus();
    });
    btn.closest('.slot-group').appendChild(panel);
    if (opts && opts.focus) {
      animate(panel);
      var first = grid.querySelector('.minute');
      try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
      panel.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'nearest' });
    }
  }

  function markTime(time) {
    Array.prototype.forEach.call(document.querySelectorAll('#slots .minute'), function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.time === time));
    });
  }

  // Tocar un horario lo marca y muestra el resumen. El pedido recién se envía con "Confirmar pedido".
  function pickTime(time) {
    var pet = petOf($('pet').value);
    if (!pet) {
      setText('day-msg', 'Primero elegí la mascota, o agregá una con el botón de arriba.');
      show('day-msg', true);
      goTo($('day-msg'), { block: 'center' });
      return;
    }
    state.time = time;
    markTime(time);
    show('day-msg', false);
    setText('sum-type', typeText(state.type));
    setText('sum-pet', pet.name);
    setText('sum-day', cap(fmtDay(state.day)));
    setText('sum-time', time + '\u00a0hs');
    fillStub($('sum-stub-day'), $('sum-stub-month'), state.day);
    show('summary', true);
    animate($('summary'));
    setStep(5);
    goTo($('summary'), { block: 'center' });
  }

  function changeTime() {
    var time = state.time;
    state.time = null;
    markTime(null);
    show('summary', false);
    setStep(4);
    var chip = time && document.querySelector('#slots .minute[data-time="' + time + '"]');
    goTo(chip || $('day-title'), { block: 'center' });
  }
  $('sum-change').addEventListener('click', changeTime);
  $('summary').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') changeTime();
  });

  $('sum-confirm').addEventListener('click', function () {
    var petId = $('pet').value;
    var pet = petOf(petId);
    var date = state.day;
    var time = state.time;
    var type = state.type;
    if (!pet || !date || !time) return;
    busy(this, api('/api/public/appointments', {
      method: 'POST',
      body: { type: type, patientId: Number(petId), date: date, time: time },
    }).then(function () {
      var t = typeOf(type);
      setText('done-what', (t ? t.label : 'Turno') + ' para ' + pet.name);
      setText('done-when', cap(fmtDay(date)) + ' a las ' + time + '\u00a0hs');
      fillStub($('done-stub-day'), $('done-stub-month'), date);
      show('book-flow', false);
      show('done', true);
      animate($('done'));
      setStep(6);
      state.day = null;
      state.hour = null;
      state.time = null;
      show('day-view', false);
      show('summary', false);
      show('cal-view', true);
      goTo($('done'), { block: 'center' });
      return refresh().catch(function () { /* el pedido ya quedó hecho; la lista se actualiza al volver a entrar */ }).then(function () {
        // "Tus turnos" acaba de crecer con el turno nuevo y empuja el aviso: se vuelve a centrar.
        if (!$('done').hidden) goTo($('done'), { block: 'center' });
      });
    }, function (err) {
      if (expired(err)) return;
      // El error se muestra arriba de los horarios, donde el cliente está mirando, y se vuelven a pedir los horarios.
      state.time = null;
      show('summary', false);
      setStep(4);
      setText('day-msg', err.message);
      show('day-msg', true);
      var msg = err.message;
      return refresh().catch(function () { /* se sigue con los horarios que había */ }).then(function () {
        // Al recargar los horarios se vuelve a dibujar el día: el aviso se pone de nuevo, para que no se pierda.
        if (state.day) showDay(state.day, { keepFocus: true });
        setText('day-msg', msg);
        show('day-msg', true);
        goTo($('day-msg'), { block: 'center' });
      });
    }));
  });

  /* ---------- reseña: después de una atención ----------
     Se pregunta en "Tus turnos" a quien ya tuvo un turno confirmado cuya fecha pasó, a todos por igual (sin preguntar
     antes si les gustó y sin ofrecer nada a cambio, como pide Google), una sola vez por cliente en este dispositivo. */
  function reviewKey() { return REVIEW_KEY + (state.client ? state.client.id : ''); }
  function reviewAnswered() {
    try { return !!localStorage.getItem(reviewKey()); } catch (e) { return false; }
  }
  function askReview() {
    var url = state.info && state.info.reviewUrl;
    // Sin enlace cargado, sin una atención todavía, o si ya contestó en este dispositivo, no se pregunta.
    if (!url || !state.client || !state.hadVisit || reviewAnswered()) {
      show('review-ask', false);
      return;
    }
    $('review-yes').href = url;
    show('review-ask', true);
  }
  function closeReview(answer) {
    try { localStorage.setItem(reviewKey(), answer); } catch (e) { /* sin almacenamiento: se oculta igual */ }
    show('review-ask', false);
  }
  // "Dejar reseña" abre Google en otra pestaña (es un enlace); acá solo se guarda que ya contestó.
  $('review-yes').addEventListener('click', function () { closeReview('si'); });
  $('review-no').addEventListener('click', function () {
    closeReview('no');
    goTo($('mine-title'), { block: 'center' });
  });

  $('done-again').addEventListener('click', function () {
    show('done', false);
    show('book-flow', true);
    showCalendar($('cal-heading'));
  });

  /* ---------- celular: barra fija abajo, que se esconde al llegar a la sección de turnos ---------- */
  if ('IntersectionObserver' in window) {
    show('bar', true);
    new IntersectionObserver(function (entries) {
      $('bar').hidden = entries[0].isIntersecting;
    }, { threshold: 0 }).observe($('reserva'));
  }

  setStep(1);

  /* ---------- arranque: si ya había entrado en esta pestaña, sigue ---------- */
  loadInfo().then(function () {
    var saved = null;
    try { saved = sessionStorage.getItem(TOKEN_KEY); } catch (e) { saved = null; }
    if (!saved) return;
    state.token = saved;
    api('/api/public/me').then(function (summary) {
      enter(summary, null, '');
    }).catch(function (err) {
      state.token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
      if (err && err.status === 401) {
        setText('login-error-text', err.message);
        $('login-error').classList.remove('soft');
        show('login-new', false);
        show('call-link', false);
        show('login-error', true);
      }
    });
  });
})();
