// Página pública de turnos. Sin frameworks. Todo texto que viene del servidor se escribe con textContent (nunca innerHTML).
(function () {
  'use strict';

  var TOKEN_KEY = 'turnos-cliente-token';
  var TZ = 'America/Argentina/Buenos_Aires';
  var state = { token: null, info: null, client: null, pets: [], appointments: [], type: 'consulta', day: null };
  var $ = function (id) { return document.getElementById(id); };

  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  }
  function show(id, on) { $(id).hidden = !on; }
  function status(msg, isError) {
    var s = $('status');
    s.textContent = msg || '';
    s.className = 'status' + (isError && msg ? ' error' : '');
  }
  function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

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
    });
  }

  function fmtDay(iso) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
  }
  function fmtDayShort(iso) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: TZ });
  }
  function fmtWeekday(iso) {
    var d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-AR', { weekday: 'short', timeZone: TZ }).replace('.', '');
  }
  var STATUS_LABEL = { pendiente: 'Pendiente de confirmación', confirmado: 'Confirmado' };

  /* ---------- información de la veterinaria ---------- */
  var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DAY_NAME = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

  function setText(id, text) { $(id).textContent = text || ''; }

  function renderInfo(info) {
    var name = info.clinic || 'Veterinaria';
    document.title = name;
    setText('clinic', name);
    setText('footer-text', name + (info.address ? ' · ' + info.address : '') + (info.phone ? ' · Tel: ' + info.phone : ''));

    if (info.professionalName) {
      setText('professional', 'A cargo de ' + info.professionalName);
      show('professional', true);
    }
    if (info.address) {
      setText('address', info.address);
      show('address', true);
      setText('location-text', info.address);
      show('location-card', true);
    }
    if (info.mapsUrl) {
      $('maps-btn').href = info.mapsUrl;
      show('maps-btn', true);
      show('location-card', true);
    }
    if (info.phone) {
      var tel = 'tel:' + onlyDigits(info.phone);
      $('call-btn').href = tel;
      $('call-btn').textContent = 'Llamar ' + info.phone;
      show('call-btn', true);
      $('call-link').href = tel;
    }

    renderHours(info.hours);
    renderMethods(info.methods);
    renderReviews(info.reviews, info.mapsUrl);
    state.info = info;
    renderTypes();
  }

  // Horario: un día puede tener varias franjas. Acepta el formato viejo (una sola franja).
  function renderHours(hours) {
    var ul = $('hours');
    ul.textContent = '';
    DAY_ORDER.forEach(function (d) {
      var v = hours ? hours[d] : null;
      var ranges = [];
      if (Array.isArray(v) && v.length) {
        ranges = typeof v[0] === 'string' ? [v] : v;
      }
      var li = el('li');
      li.appendChild(el('span', DAY_NAME[d], 'day-name'));
      li.appendChild(el('span', ranges.length ? ranges.map(function (r) { return r[0] + ' a ' + r[1] + ' hs'; }).join(' · ') : 'Cerrado', ranges.length ? '' : 'muted'));
      ul.appendChild(li);
    });
  }

  function renderMethods(methods) {
    var ul = $('methods');
    ul.textContent = '';
    (methods || []).forEach(function (m) { ul.appendChild(el('li', m, 'chip')); });
    if (!ul.children.length) $('methods-card').hidden = true;
  }

  // Reseñas cargadas por la veterinaria desde Google Maps (texto y estrellas).
  function renderReviews(reviews, mapsUrl) {
    if (!reviews || !reviews.length) return;
    var ul = $('reviews');
    ul.textContent = '';
    reviews.forEach(function (r) {
      var li = el('li', null, 'review');
      li.appendChild(el('p', '★'.repeat(r.stars) + '☆'.repeat(5 - r.stars), 'stars'));
      li.setAttribute('aria-label', r.stars + ' de 5 estrellas');
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
      setText('footer-text', '');
    });
  }

  function renderTypes() {
    var box = $('types');
    box.textContent = '';
    (state.info.types || []).forEach(function (t) {
      var lab = el('label');
      var input = el('input');
      input.type = 'radio';
      input.name = 'type';
      input.value = t.value;
      input.checked = t.value === state.type;
      input.addEventListener('change', function () {
        state.type = t.value;
        loadSlots();
      });
      lab.appendChild(input);
      lab.appendChild(document.createTextNode(t.label + ' (' + t.duration + ' min)'));
      box.appendChild(lab);
    });
  }

  /* ---------- paso 1: entrar con el teléfono ---------- */
  function showLoginError(message, withCall) {
    $('login-error-text').textContent = message;
    $('login-error').hidden = false;
    $('call-link').hidden = !withCall;
  }
  function clearLoginError() {
    $('login-error').hidden = true;
  }

  function enter(summary, token) {
    if (token) {
      state.token = token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) { /* sin sessionStorage: solo dura esta pestaña */ }
    }
    state.client = summary.client;
    state.pets = summary.pets || [];
    state.appointments = summary.appointments || [];
    show('login', false);
    show('register', false);
    show('home', true);
    $('hello').textContent = 'Hola, ' + state.client.firstName;
    renderPets();
    renderAppointments();
    loadSlots();
    status('');
  }

  function leave() {
    state.token = null;
    state.client = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
    show('home', false);
    show('register', false);
    show('login', true);
    $('phone').value = '';
    clearLoginError();
    status('');
  }

  function refresh() {
    return api('/api/public/me').then(function (summary) {
      state.client = summary.client;
      state.pets = summary.pets || [];
      state.appointments = summary.appointments || [];
      renderPets();
      renderAppointments();
      loadSlots();
    });
  }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    clearLoginError();
    var phone = $('phone').value.trim();
    if (!onlyDigits(phone).length) {
      showLoginError('Ingresá tu teléfono.', false);
      return;
    }
    api('/api/public/login', { method: 'POST', body: { phone: phone } }).then(function (summary) {
      enter(summary, summary.token);
    }).catch(function (err) {
      if (err.status === 404) {
        showLoginError(err.message, true);
      } else {
        showLoginError(err.message, false);
      }
    });
  });

  $('retry').addEventListener('click', function () {
    clearLoginError();
    $('phone').value = '';
    $('phone').focus();
  });

  $('show-register').addEventListener('click', function () {
    show('login', false);
    show('register', true);
    $('r-phone').value = $('phone').value.trim();
    $('r-first').focus();
  });

  $('register-cancel').addEventListener('click', function () {
    show('register', false);
    show('login', true);
    $('register-error').hidden = true;
  });

  $('register-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var errBox = $('register-error');
    errBox.hidden = true;
    if (!f.reportValidity()) return;
    var body = {
      firstName: f.firstName.value.trim(),
      lastName: f.lastName.value.trim(),
      phone: f.phone.value.trim(),
      pet: { name: f.petName.value.trim(), species: f.species.value, sex: f.sex.value },
    };
    api('/api/public/register', { method: 'POST', body: body }).then(function (summary) {
      f.reset();
      enter(summary, summary.token);
    }).catch(function (err) {
      errBox.textContent = err.message;
      errBox.hidden = false;
    });
  });

  $('logout').addEventListener('click', leave);

  /* ---------- paso 2: turnos y mascotas ---------- */
  function renderPets() {
    var sel = $('pet');
    var previous = sel.value;
    sel.textContent = '';
    if (!state.pets.length) {
      var none = el('option', 'No tenés mascotas cargadas: agregá una abajo', '');
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
      if (previous && state.pets.some(function (p) { return String(p.id) === previous; })) sel.value = previous;
    }
  }

  function renderAppointments() {
    var list = $('my-appts');
    list.textContent = '';
    var items = state.appointments;
    $('no-appts').hidden = items.length > 0;
    items.forEach(function (a) {
      var li = el('li');
      var title = el('div', a.typeLabel + ' con ' + a.patientName);
      var when = el('div', fmtDay(a.date) + ' a las ' + a.time + ' hs', 'muted small-text');
      var badge = el('span', STATUS_LABEL[a.status] || a.status, 'badge' + (a.status === 'pendiente' ? ' pending' : ''));
      title.appendChild(badge);
      li.appendChild(title);
      li.appendChild(when);
      if (!a.canCancel) {
        // Lo agendó la veterinaria: desde la página no se cancela.
        li.appendChild(el('div', 'Para cambiar o cancelar este turno, llamá a la veterinaria.', 'muted small-text'));
        list.appendChild(li);
        return;
      }
      var cancel = el('button', 'Cancelar turno', 'btn danger small');
      cancel.type = 'button';
      cancel.addEventListener('click', function () {
        if (!window.confirm('¿Cancelar el turno de ' + a.patientName + ' del ' + fmtDay(a.date) + ' a las ' + a.time + ' hs?')) return;
        api('/api/public/appointments/' + a.id + '/cancel', { method: 'POST' }).then(function () {
          status('Turno cancelado. Si querés otro horario, elegilo abajo.');
          return refresh();
        }).catch(function (err) { status(err.message, true); });
      });
      li.appendChild(cancel);
      list.appendChild(li);
    });
  }

  function loadSlots() {
    var box = $('slots');
    var msg = $('slots-msg');
    box.textContent = '';
    msg.hidden = true;
    if (!state.info) return;
    api('/api/public/slots?type=' + encodeURIComponent(state.type)).then(function (res) {
      if (!res.days.length) {
        msg.textContent = 'No hay horarios libres en los próximos días. Llamá a la veterinaria para consultar.';
        msg.hidden = false;
        return;
      }
      // Primero se elige el día; abajo se ven solo los horarios de ese día.
      if (!res.days.some(function (d) { return d.date === state.day; })) state.day = res.days[0].date;
      var tabs = el('div', null, 'day-tabs');
      tabs.setAttribute('role', 'group');
      tabs.setAttribute('aria-label', 'Elegí el día');
      var wrap = el('div', null, 'day');
      function showDay(day) {
        state.day = day.date;
        Array.prototype.forEach.call(tabs.children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.date === day.date)); });
        wrap.textContent = '';
        wrap.appendChild(el('p', fmtDay(day.date), 'day-title'));
        var grid = el('div', null, 'slots-grid');
        day.times.forEach(function (t) {
          var b = el('button', t, 'slot');
          b.type = 'button';
          b.setAttribute('aria-label', 'Pedir turno el ' + fmtDayShort(day.date) + ' a las ' + t);
          b.addEventListener('click', function () { book(day.date, t); });
          grid.appendChild(b);
        });
        wrap.appendChild(grid);
      }
      res.days.forEach(function (day) {
        var b = el('button', null, 'day-tab');
        b.type = 'button';
        b.dataset.date = day.date;
        b.appendChild(el('span', fmtWeekday(day.date), 'day-tab-name'));
        b.appendChild(el('span', fmtDayShort(day.date), 'day-tab-date'));
        b.setAttribute('aria-label', fmtDay(day.date) + ', ' + day.times.length + (day.times.length === 1 ? ' horario libre' : ' horarios libres'));
        b.addEventListener('click', function () { showDay(day); });
        tabs.appendChild(b);
      });
      box.appendChild(tabs);
      box.appendChild(wrap);
      showDay(res.days.filter(function (d) { return d.date === state.day; })[0]);
      var on = tabs.querySelector('[aria-pressed="true"]');
      if (on && on.offsetLeft > tabs.clientWidth - on.offsetWidth) tabs.scrollLeft = on.offsetLeft - 8;
    }).catch(function (err) {
      msg.textContent = err.message;
      msg.hidden = false;
    });
  }

  function book(date, time) {
    var petId = $('pet').value;
    if (!petId) {
      status('Primero elegí la mascota, o agregá una abajo.', true);
      return;
    }
    status('Pidiendo el turno…');
    api('/api/public/appointments', {
      method: 'POST',
      body: { type: state.type, patientId: Number(petId), date: date, time: time },
    }).then(function () {
      status('Listo: pediste turno para el ' + fmtDay(date) + ' a las ' + time + ' hs. Queda pendiente hasta que la veterinaria lo confirme.');
      return refresh();
    }).catch(function (err) {
      status(err.message, true);
      loadSlots();
    });
  }

  $('toggle-add-pet').addEventListener('click', function () {
    var f = $('add-pet-form');
    f.hidden = !f.hidden;
    if (!f.hidden) $('a-pet-name').focus();
  });

  $('add-pet-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (!f.reportValidity()) return;
    var pet = { name: f.petName.value.trim(), species: f.species.value, sex: f.sex.value };
    api('/api/public/pets', { method: 'POST', body: { pet: pet } }).then(function (summary) {
      f.reset();
      f.hidden = true;
      state.pets = summary.pets || [];
      renderPets();
      // La lista viene ordenada por nombre: la recién agregada es la de número más alto.
      $('pet').value = String(Math.max.apply(null, state.pets.map(function (p) { return p.id; })));
      status('Mascota agregada. Ya podés elegir un horario.');
      loadSlots();
    }).catch(function (err) { status(err.message, true); });
  });

  /* ---------- arranque: si ya había entrado en esta pestaña, sigue ---------- */
  loadInfo().then(function () {
    var saved = null;
    try { saved = sessionStorage.getItem(TOKEN_KEY); } catch (e) { saved = null; }
    if (!saved) return;
    state.token = saved;
    api('/api/public/me').then(function (summary) {
      enter(summary, null);
    }).catch(function () {
      state.token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) { /* nada que borrar */ }
    });
  });
})();
