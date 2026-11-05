/* Agenda · Documental Soy Digital — utilidades compartidas */
(function () {
  var CFG = window.SD_CONFIG || {};
  var API = (CFG.API_URL || '').trim();
  var DEMO = !API;

  var SLOTS = [
    { id: '08-10', a: '8:00', b: '10:00 a. m.' },
    { id: '10-12', a: '10:00 a. m.', b: '12:00 m.' },
    { id: '12-14', a: '12:00 m.', b: '2:00 p. m.' },
    { id: '14-16', a: '2:00', b: '4:00 p. m.' },
    { id: '16-18', a: '4:00', b: '6:00 p. m.' }
  ];
  // Horarios extra que solo ve el equipo
  var TEAM_SLOTS = [{ id: '06-08', a: '6:00', b: '8:00 a. m.' }].concat(SLOTS, [
    { id: '18-21', a: '6:00', b: '9:00 p. m.' },
    { id: '21-23', a: '9:00', b: '11:00 p. m.' }
  ]);
  var TYPES = [
    { id: 'entrevista', label: 'Entrevista', cls: 'busy team' },
    { id: 'jornada', label: 'Jornada de grabación', cls: 'jor' },
    { id: 'traslado', label: 'Traslado', cls: 'tra' },
    { id: 'traslado_int', label: 'Traslado internacional', cls: 'tri' },
    { id: 'hospedaje', label: 'Hospedaje', cls: 'hos' }
  ];
  function type(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[1]; }
  var DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  var DOW_S = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  function range(from, to, includeSat) {
    var out = [], d = new Date(from + 'T12:00:00'), end = new Date(to + 'T12:00:00');
    while (d <= end) {
      var w = d.getDay();
      if (w !== 0 && (includeSat || w !== 6)) out.push(iso(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayInfo(s) { var d = new Date(s + 'T12:00:00'); return { dow: DOW[d.getDay()], dowS: DOW_S[d.getDay()], day: d.getDate() }; }
  function slot(id) { return TEAM_SLOTS.filter(function (s) { return s.id === id; })[0]; }
  function slotLabel(id) { var s = slot(id); return s ? s.a + ' a ' + s.b : id; }
  function longDate(s) { var i = dayInfo(s); return i.dow + ' ' + i.day + ' de noviembre'; }
  function isPast(fecha, franja) {
    var end = new Date(fecha + 'T' + franja.slice(3) + ':00:00');
    return end < new Date();
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Almacenamiento demo ---------- */
  var mem = null;
  function demoLoad() {
    if (mem) return mem;
    try { mem = JSON.parse(localStorage.getItem('sd-agenda-demo') || '[]'); } catch (e) { mem = []; }
    return mem;
  }
  function demoSave() { try { localStorage.setItem('sd-agenda-demo', JSON.stringify(mem)); } catch (e) { } }
  function wait(v) { return new Promise(function (r) { setTimeout(function () { r(v); }, 450); }); }
  function uid() { return 'd' + Math.random().toString(36).slice(2, 10); }

  /* ---------- Cliente API ---------- */
  function get(params) {
    var q = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    return fetch(API + (API.indexOf('?') >= 0 ? '&' : '?') + q, { method: 'GET', redirect: 'follow' })
      .then(function (r) { return r.json(); }).then(check);
  }
  function post(body) {
    return fetch(API, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); }).then(check);
  }
  // La hoja de Google a veces convierte "10-12" en fecha (10 dic): lo devolvemos a su forma original.
  function fixSlot(f) {
    var m = /^\d{4}-(\d{2})-(\d{2})T/.exec(String(f || ''));
    return m ? m[2] + '-' + m[1] : f;
  }
  function check(res) {
    if (res && res.items) res.items.forEach(function (r) { r.franja = fixSlot(r.franja); });
    if (!res || !res.ok) { var e = new Error((res && res.error) || 'No pudimos conectar con la agenda.'); e.code = res && res.code; throw e; }
    return res;
  }
  function takenErr(msg) { var e = new Error(msg); e.code = 'taken'; return e; }

  var api = {
    demo: DEMO,
    getPublic: function () {
      if (DEMO) return wait({ ok: true, items: demoLoad().map(function (r) { return { fecha: r.fecha, franja: r.franja, entidad: r.entidad }; }) });
      return get({ action: 'public', t: Date.now() });
    },
    getTeam: function (key) {
      if (DEMO) return key === 'demo' ? wait({ ok: true, items: demoLoad().slice() }) : wait(null).then(function () { throw new Error('Clave del equipo no válida.'); });
      return get({ action: 'team', key: key, t: Date.now() });
    },
    book: function (data) {
      if (DEMO) {
        var rows = demoLoad();
        if (rows.some(function (r) { return r.fecha === data.fecha && r.franja === data.franja; })) return wait(null).then(function () { throw takenErr('Este horario acaba de ser reservado por otra persona.'); });
        rows.push(Object.assign({ id: uid(), tipo: 'entrevista', actividad: 'Entrevista documental', origen: 'publico' }, data));
        demoSave();
        return wait({ ok: true });
      }
      return post(Object.assign({ action: 'book' }, data));
    },
    save: function (key, item) {
      if (DEMO) {
        var rows = demoLoad();
        if (rows.some(function (r) { return r.fecha === item.fecha && r.franja === item.franja && r.id !== item.id; })) return wait(null).then(function () { throw takenErr('Ese horario ya está ocupado.'); });
        if (item.id) { rows.forEach(function (r, i) { if (r.id === item.id) rows[i] = Object.assign({}, r, item); }); }
        else rows.push(Object.assign({}, item, { id: uid(), origen: 'equipo' }));
        demoSave();
        return wait({ ok: true });
      }
      return post({ action: 'save', key: key, item: item });
    },
    remove: function (key, id) {
      if (DEMO) { mem = demoLoad().filter(function (r) { return r.id !== id; }); demoSave(); return wait({ ok: true }); }
      return post({ action: 'delete', key: key, id: id });
    }
  };

  /* ---------- UI ---------- */
  var toastEl;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('show');
    clearTimeout(toastEl._t); toastEl._t = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }
  function demoBanner() {
    if (!DEMO) return;
    var b = document.createElement('div'); b.className = 'banner';
    b.textContent = 'Modo demostración: las reservas solo se guardan en este navegador. Conecta la hoja de Google en config.js para publicarla.';
    document.body.insertBefore(b, document.body.firstChild);
  }
  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    x: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2"/></svg>'
  };

  /* Calendario: days[], cellFn(fecha, slot) -> HTML del bloque */
  function renderGrid(el, days, cellFn, state, slots) {
    slots = slots || SLOTS;
    var sel = state.day && days.indexOf(state.day) >= 0 ? state.day : days[0];
    state.day = sel;
    var h = '<div class="grid" style="--cols:' + days.length + '"><div class="hd corner">Horario</div>';
    days.forEach(function (d) {
      var i = dayInfo(d);
      h += '<div class="hd' + (d === sel ? ' on' : '') + '"><div class="dow">' + i.dowS + '</div><div class="day">' + i.day + '</div><div class="mon">nov</div></div>';
    });
    slots.forEach(function (s) {
      h += '<div class="time">' + s.a + '<small>a ' + s.b + '</small></div>';
      days.forEach(function (d) { h += '<div class="cell' + (d === sel ? ' on' : '') + '">' + cellFn(d, s) + '</div>'; });
    });
    el.innerHTML = h + '</div>';
  }
  function renderDayPicker(el, days, state, onPick) {
    el.innerHTML = days.map(function (d) {
      var i = dayInfo(d);
      return '<button type="button" data-day="' + d + '" aria-pressed="' + (d === state.day) + '"><span>' + i.dowS + '</span><b>' + i.day + '</b></button>';
    }).join('');
    el.onclick = function (e) { var b = e.target.closest('button[data-day]'); if (b) onPick(b.dataset.day); };
  }

  function openDialog(dlg) { if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', ''); }
  function closeDialog(dlg) { if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open'); }

  window.SD = {
    cfg: CFG, api: api, SLOTS: SLOTS, TEAM_SLOTS: TEAM_SLOTS, TYPES: TYPES, type: type, range: range, dayInfo: dayInfo, slotLabel: slotLabel, longDate: longDate,
    isPast: isPast, esc: esc, toast: toast, demoBanner: demoBanner, ICON: ICON, renderGrid: renderGrid,
    renderDayPicker: renderDayPicker, openDialog: openDialog, closeDialog: closeDialog
  };
})();
