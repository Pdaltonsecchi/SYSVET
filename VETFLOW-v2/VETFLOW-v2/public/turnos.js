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
    month: null, // mes que se está mirando, 'AAAA-MM'
    day: null, // día elegido
    time: null, // horario elegido (todavía sin confirmar)
    slotsLoaded: false,
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

  var STATUS_LABEL = { pendiente: 'Pendiente de confirmación', confirmado: 'Confirmado' };

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
    var name = info.clinic || 'Veterinaria';
    document.title = name;
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
      [['call-btn', 'Llamar ' + info.phone], ['call-link', 'Llamar a la veterinaria'], ['bar-call', 'Llamar'], ['phone-link', info.phone], ['footer-phone-link', info.phone]].forEach(function (x) {
        $(x[0]).href = tel;
        $(x[0]).textContent = x[1];
      });
      show('call-btn', true);
      show('bar-call', true);
      show('location-phone', true);
      show('footer-phone', true);
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
      ranges.forEach(function (r) { box.appendChild(el('span', r[0] + ' a ' + r[1] + ' hs')); });
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
    return t ? t.label + ' (' + t.duration + ' min)' : value;
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
  function showLoginError(message, notFound) {
    setText('login-error-text', message);
    // Guía para el caso más común: falta el código de área, o todavía no es cliente.
    show('login-help', !!notFound);
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
    state.time = null;
    state.days = {};
    state.lastDay = null;
    state.month = null;
    state.slotsLoaded = false;
    show('done', false);
    show('book-flow', true);
    closeAddPet();
    notice('pet-msg', '');
    notice('mine-msg', '');
  }

  // message = aviso corto ("Listo, entraste."). Sin mensaje (al recargar la página) no se mueve la pantalla.
  function enter(summary, token, message) {
    if (token) {
      state.token = token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sin sessionStorage: solo dura esta pestaña */ }
    }
    state.client = summary.client;
    state.pets = summary.pets || [];
    state.appointments = summary.appointments || [];
    resetFlow();
    show('login', false);
    show('register', false);
    show('home', true);
    if (message) animate($('home'));
    setText('hello', 'Hola, ' + state.client.firstName);
    renderPets();
    renderAppointments();
    showCalendar();
    loadSlots();
    notice('notice', message || '');
    if (message) {
      // Arriba de la sección queda a la vista el aviso; el foco pasa al saludo.
      $('reserva').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
      goTo($('hello'), { scroll: false });
    }
  }

  function leave(message, loginError) {
    state.token = null;
    state.client = null;
    state.pets = [];
    state.appointments = [];
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
    show('home', false);
    show('register', false);
    show('login', true);
    animate($('login'), true);
    setStep(1);
    $('phone').value = '';
    clearLoginError();
    notice('notice', message || '');
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
      renderPets();
      renderAppointments();
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
      showLoginError(err.message, err.status === 404);
    }));
  });
  clearOnInput($('login-form'));

  $('retry').addEventListener('click', function () {
    clearLoginError();
    $('phone').value = '';
    $('phone').focus();
  });

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

  // "Ese teléfono ya está registrado": un toque y queda en el ingreso con el número escrito.
  $('use-phone').addEventListener('click', function () {
    var phone = $('r-phone').value.trim();
    closeRegister();
    show('use-phone', false);
    fieldError($('r-phone'), '');
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
  $('toggle-add-pet').addEventListener('click', function () {
    var f = $('add-pet-form');
    if (!f.hidden) {
      closeAddPet();
      return;
    }
    f.hidden = false;
    this.textContent = 'Cancelar';
    this.setAttribute('aria-expanded', 'true');
    notice('pet-msg', '');
    $('a-pet-name').focus();
  });

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
      state.pets = summary.pets || [];
      renderPets();
      // La lista viene ordenada por nombre: la recién agregada es la de número más alto.
      $('pet').value = String(Math.max.apply(null, state.pets.map(function (p) { return p.id; })));
      notice('pet-msg', 'Listo, agregaste a ' + pet.name + '. Ahora elegí el día.');
      if (state.day) showDay(state.day, { keepFocus: true });
      else renderCalendar();
      goTo($('pet'), { block: 'center' });
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
    var items = state.appointments;
    $('no-appts').hidden = items.length > 0;
    items.forEach(function (a) {
      var item = el('li', null, 'ticket');
      item.appendChild(stubOf(a.date));
      var li = el('div', null, 'ticket-body');
      item.appendChild(li);
      var title = el('div', null, 'appt-title');
      title.appendChild(el('span', a.typeLabel + ' con ' + a.patientName));
      li.appendChild(title);
      li.appendChild(el('div', cap(fmtDay(a.date)) + ' a las ' + a.time + ' hs', 'appt-when'));
      li.appendChild(el('span', STATUS_LABEL[a.status] || a.status, 'badge' + (a.status === 'pendiente' ? ' pending' : '')));
      if (!a.canCancel) {
        // Lo agendó la veterinaria (o ya empezó): desde la página no se cancela.
        li.appendChild(el('div', 'Para cambiar o cancelar este turno, ' + (state.info && state.info.phone ? 'llamá a la veterinaria.' : 'avisale a la veterinaria.'), 'muted small-text'));
        list.appendChild(item);
        return;
      }
      var cancel = el('button', 'Cancelar turno', 'btn text danger');
      cancel.type = 'button';
      cancel.setAttribute('aria-label', 'Cancelar el turno de ' + a.patientName + ' del ' + fmtDay(a.date) + ' a las ' + a.time + ' hs');
      li.appendChild(cancel);

      // Confirmación dentro de la tarjeta (sin el cartel del navegador).
      var ask = el('div', null, 'confirm');
      ask.setAttribute('role', 'group');
      ask.hidden = true;
      var question = el('p', '¿Cancelás el turno?', 'confirm-text');
      question.id = 'cancel-q-' + a.id;
      ask.setAttribute('aria-labelledby', question.id);
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
      ask.appendChild(question);
      ask.appendChild(row);
      ask.appendChild(err);
      li.appendChild(ask);

      var close = function () {
        ask.hidden = true;
        cancel.hidden = false;
        cancel.focus();
      };
      cancel.addEventListener('click', function () {
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

  /** El turno (pendiente o confirmado) que la mascota elegida ya tiene ese día, o null. */
  function mineOn(iso) {
    var petId = $('pet').value;
    if (!petId) return null;
    for (var i = 0; i < state.appointments.length; i++) {
      var a = state.appointments[i];
      if (String(a.patientId) === String(petId) && a.date === iso) return a;
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

    // Se arranca en el mes del primer día con horarios; nunca fuera de los meses permitidos.
    if (!state.month || state.month < firstMonth || state.month > lastMonth) state.month = free[0].slice(0, 7);
    var month = state.month;
    setText('cal-month', fmtMonth(month));
    var prev = $('cal-prev');
    var next = $('cal-next');
    prev.disabled = month <= firstMonth;
    next.disabled = month >= lastMonth;
    prev.setAttribute('aria-label', prev.disabled ? 'Mes anterior (no se puede ir a meses pasados)' : 'Mes anterior: ' + fmtMonth(shiftMonth(month, -1)));
    next.setAttribute('aria-label', next.disabled ? 'Mes siguiente (todavía no se pueden pedir turnos)' : 'Mes siguiente: ' + fmtMonth(shiftMonth(month, 1)));

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

  $('cal-prev').addEventListener('click', function () {
    state.month = shiftMonth(state.month, -1);
    renderCalendar();
    animate($('cal-grid'), true);
  });
  $('cal-next').addEventListener('click', function () {
    state.month = shiftMonth(state.month, 1);
    renderCalendar();
    animate($('cal-grid'));
  });

  function showCalendar(focus) {
    state.day = null;
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

  /* ---------- hora: horarios del día elegido ---------- */
  function showDay(iso, opts) {
    opts = opts || {};
    state.day = iso;
    state.time = null;
    state.month = iso.slice(0, 7);
    show('cal-view', false);
    show('pick', false);
    show('day-view', true);
    show('summary', false);
    setStep(4);
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
      var groups = [['Mañana', times.filter(function (t) { return t < NOON; })], ['Tarde', times.filter(function (t) { return t >= NOON; })]];
      groups.forEach(function (g) {
        if (!g[1].length) return;
        var section = el('div', null, 'slot-group');
        var head = el('h5', null, 'slot-title');
        head.appendChild(el('span', g[0]));
        head.appendChild(el('span', g[1].length === 1 ? '1 horario' : g[1].length + ' horarios', 'muted small-text'));
        section.appendChild(head);
        var grid = el('div', null, 'slots-grid');
        g[1].forEach(function (t) {
          var b = el('button', t, 'slot');
          b.type = 'button';
          b.dataset.time = t;
          b.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-label', t + ' hs');
          b.addEventListener('click', function () { pickTime(t); });
          grid.appendChild(b);
        });
        section.appendChild(grid);
        box.appendChild(section);
      });
    }
    if (!opts.keepFocus) goTo($('day-title'), { block: 'center' });
  }

  function markTime(time) {
    Array.prototype.forEach.call(document.querySelectorAll('#slots .slot'), function (b) {
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
    setText('sum-time', time + ' hs');
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
    var chip = time && document.querySelector('#slots .slot[data-time="' + time + '"]');
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
      setText('done-text', 'Listo: pediste ' + (t ? t.label.toLowerCase() : 'turno') + ' para ' + pet.name + ' el ' + fmtDay(date) + ' a las ' + time +
        ' hs. Queda pendiente hasta que la veterinaria lo confirme.');
      show('book-flow', false);
      show('done', true);
      animate($('done'));
      setStep(6);
      state.day = null;
      state.time = null;
      show('day-view', false);
      show('summary', false);
      show('cal-view', true);
      goTo($('done'), { block: 'center' });
      return refresh().catch(function () { /* el pedido ya quedó hecho; la lista se actualiza al volver a entrar */ });
    }, function (err) {
      if (expired(err)) return;
      // El error se muestra arriba de los horarios, donde el cliente está mirando, y se vuelven a pedir los horarios.
      state.time = null;
      show('summary', false);
      setStep(4);
      setText('day-msg', err.message);
      show('day-msg', true);
      return refresh().catch(function () { /* se sigue con los horarios que había */ }).then(function () {
        if (state.day) showDay(state.day, { keepFocus: true, keepMsg: true });
        goTo($('day-msg'), { block: 'center' });
      });
    }));
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
    }).catch(function () {
      state.token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
    });
  });
})();
