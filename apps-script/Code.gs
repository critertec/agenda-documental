/**
 * Agenda · Documental de cierre Soy Digital 2026
 * Backend en Google Apps Script + Google Sheets.
 *
 * Endpoints (implementar como "Aplicación web", acceso: "Cualquier persona"):
 *   GET  ?action=public                 -> horarios ocupados 23–27 nov (solo entidad)
 *   GET  ?action=team&key=CLAVE         -> todas las reservas con detalle
 *   POST {action:"book", ...}           -> reserva pública (23–27 nov, L–V)
 *   POST {action:"save", key, item}     -> crear/editar (equipo)
 *   POST {action:"delete", key, id}     -> eliminar (equipo)
 *
 * Propiedades del script (Configuración del proyecto › Propiedades del script):
 *   TEAM_KEY      clave larga del enlace interno (obligatoria)
 *   NOTIFY_EMAIL  correo(s) que reciben aviso de cada reserva pública, separados por coma (opcional)
 *   CONFIRM_TO_GUEST  "true" para enviar confirmación a la persona que agenda (opcional)
 */

var SHEET_NAME = 'Reservas';
var HEADERS = ['id', 'fecha', 'franja', 'tipo', 'entidad', 'actividad', 'nombre', 'apellido', 'cargo',
  'direccion_minerd', 'telefono', 'email', 'lugar', 'notas', 'origen', 'creado', 'actualizado'];

var SLOTS = ['08-10', '10-12', '12-14', '14-16', '16-18'];
var SLOT_LABEL = { '08-10': '8:00 a 10:00 a. m.', '10-12': '10:00 a. m. a 12:00 m.', '12-14': '12:00 m. a 2:00 p. m.',
  '14-16': '2:00 a 4:00 p. m.', '16-18': '4:00 a 6:00 p. m.' };
var PUBLIC_DATES = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27'];
var TEAM_DATES = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21',
  '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
var TYPES = ['entrevista', 'jornada'];

/* ---------- Instalación: ejecutar una vez desde el editor ---------- */
function setup() {
  var sh = getSheet_();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('NOTIFY_EMAIL')) {
    props.setProperty('NOTIFY_EMAIL', 'carlos.cespedes@critertec.com,sarahi.alvarez@critertec.com,sandra.chica@critertec.com,isabel.orrego@critertec.com,evis.german@critertec.com');
  }
  if (!props.getProperty('CONFIRM_TO_GUEST')) props.setProperty('CONFIRM_TO_GUEST', 'true');
  if (!props.getProperty('TEAM_KEY')) {
    var key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('TEAM_KEY', key);
  }
  Logger.log('Hoja lista: ' + sh.getParent().getUrl());
  Logger.log('TEAM_KEY (clave del enlace interno): ' + props.getProperty('TEAM_KEY'));
}

/* ---------- HTTP ---------- */
function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (p.action === 'public') return json_({ ok: true, items: publicItems_() });
    if (p.action === 'team') {
      checkKey_(p.key);
      return json_({ ok: true, items: readAll_() });
    }
    return json_({ ok: true, service: 'agenda-documental-soy-digital' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.action === 'book') return json_(book_(body));
    if (body.action === 'save') { checkKey_(body.key); return json_(save_(body.item || {})); }
    if (body.action === 'delete') { checkKey_(body.key); return json_(remove_(body.id)); }
    return json_({ ok: false, error: 'Acción no válida.' });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

/* ---------- Lógica ---------- */
function publicItems_() {
  return readAll_()
    .filter(function (r) { return PUBLIC_DATES.indexOf(r.fecha) >= 0; })
    .map(function (r) { return { fecha: r.fecha, franja: r.franja, entidad: r.entidad }; });
}

function book_(b) {
  if (b.website) return { ok: true }; // trampa anti-spam (campo oculto)
  var f = {
    fecha: clean_(b.fecha, 10), franja: clean_(b.franja, 5),
    nombre: clean_(b.nombre, 80), apellido: clean_(b.apellido, 80), cargo: clean_(b.cargo, 120),
    entidad: clean_(b.entidad, 120), direccion_minerd: clean_(b.direccion_minerd, 160),
    telefono: clean_(b.telefono, 40), email: clean_(b.email, 120), lugar: clean_(b.lugar, 300),
    notas: clean_(b.notas, 600)
  };
  if (PUBLIC_DATES.indexOf(f.fecha) < 0 || SLOTS.indexOf(f.franja) < 0) throw new Error('Ese horario no está disponible para agendar.');
  ['nombre', 'apellido', 'entidad', 'telefono', 'email', 'lugar'].forEach(function (k) {
    if (!f[k]) throw new Error('Falta completar: ' + k + '.');
  });
  if (/minerd/i.test(f.entidad) && !f.direccion_minerd) throw new Error('Indica la dirección o área del MINERD.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) throw new Error('El correo no parece válido.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (isTaken_(f.fecha, f.franja, null)) return { ok: false, code: 'taken', error: 'Este horario acaba de ser reservado por otra persona.' };
    var now = new Date().toISOString();
    var row = Object.assign({ id: Utilities.getUuid(), tipo: 'entrevista', actividad: 'Entrevista documental',
      origen: 'publico', creado: now, actualizado: now }, f);
    append_(row);
  } finally {
    lock.releaseLock();
  }
  notify_(f);
  return { ok: true };
}

function save_(it) {
  var f = {
    id: clean_(it.id, 60), fecha: clean_(it.fecha, 10), franja: clean_(it.franja, 5),
    tipo: TYPES.indexOf(it.tipo) >= 0 ? it.tipo : 'jornada',
    entidad: clean_(it.entidad, 120), actividad: clean_(it.actividad, 160),
    nombre: clean_(it.nombre, 80), apellido: clean_(it.apellido, 80), cargo: clean_(it.cargo, 120),
    direccion_minerd: clean_(it.direccion_minerd, 160), telefono: clean_(it.telefono, 40),
    email: clean_(it.email, 120), lugar: clean_(it.lugar, 300), notas: clean_(it.notas, 600)
  };
  if (TEAM_DATES.indexOf(f.fecha) < 0 || SLOTS.indexOf(f.franja) < 0) throw new Error('Fecha u horario fuera del cronograma.');
  if (!f.entidad) throw new Error('Indica la entidad.');

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (isTaken_(f.fecha, f.franja, f.id || null)) return { ok: false, code: 'taken', error: 'Ese horario ya está ocupado.' };
    var sh = getSheet_();
    var now = new Date().toISOString();
    if (f.id) {
      var idx = findRow_(f.id);
      if (idx < 0) throw new Error('No se encontró la reserva.');
      var cur = rowToObj_(sh.getRange(idx, 1, 1, HEADERS.length).getValues()[0]);
      var merged = Object.assign(cur, f, { actualizado: now });
      sh.getRange(idx, 1, 1, HEADERS.length).setValues([objToRow_(merged)]);
    } else {
      append_(Object.assign(f, { id: Utilities.getUuid(), origen: 'equipo', creado: now, actualizado: now }));
    }
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

function remove_(id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var idx = findRow_(String(id || ''));
    if (idx < 0) throw new Error('No se encontró la reserva.');
    getSheet_().deleteRow(idx);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/* ---------- Avisos por correo ---------- */
function notify_(f) {
  var props = PropertiesService.getScriptProperties();
  var when = fmtDate_(f.fecha) + ', ' + SLOT_LABEL[f.franja];
  var to = props.getProperty('NOTIFY_EMAIL');
  try {
    if (to) {
      MailApp.sendEmail({
        to: to,
        subject: 'Nueva reserva · Documental Soy Digital · ' + f.entidad + ' · ' + when,
        body: 'Se agendó una entrevista desde la página pública.\n\n' +
          'Horario: ' + when + '\nEntidad: ' + f.entidad +
          (f.direccion_minerd ? '\nDirección MINERD: ' + f.direccion_minerd : '') +
          '\nPersona: ' + f.nombre + ' ' + f.apellido + (f.cargo ? ' (' + f.cargo + ')' : '') +
          '\nTeléfono: ' + f.telefono + '\nCorreo: ' + f.email + '\nLugar: ' + f.lugar +
          (f.notas ? '\nComentarios: ' + f.notas : '')
      });
    }
    if (props.getProperty('CONFIRM_TO_GUEST') === 'true') {
      MailApp.sendEmail({
        to: f.email,
        subject: 'Tu entrevista para el documental Soy Digital · ' + when,
        body: 'Hola, ' + f.nombre + ':\n\nGracias por agendar tu entrevista para el documental de cierre de Soy Digital.\n\n' +
          'Horario: ' + when + '\nLugar: ' + f.lugar +
          '\n\nNuestro equipo te contactará para confirmar los detalles. Si necesitas cambiar el horario, responde a este correo.\n\n' +
          'Equipo Soy Digital'
      });
    }
  } catch (err) {
    console.error('No se pudo enviar el correo: ' + err);
  }
}

/* ---------- Utilidades de hoja ---------- */
function getSheet_() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  var id = props.getProperty('SHEET_ID');
  if (id) ss = SpreadsheetApp.openById(id);
  else {
    ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) { ss = SpreadsheetApp.create('Agenda Documental Soy Digital 2026'); }
    props.setProperty('SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:Q').setNumberFormat('@');
  }
  return sh;
}

function readAll_() {
  var sh = getSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, HEADERS.length).getValues().map(rowToObj_).filter(function (r) { return r.id; });
}

function append_(obj) { getSheet_().appendRow(objToRow_(obj)); }

function findRow_(id) {
  var sh = getSheet_();
  var n = sh.getLastRow() - 1;
  if (n < 1 || !id) return -1;
  var ids = sh.getRange(2, 1, n, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return -1;
}

function isTaken_(fecha, franja, exceptId) {
  return readAll_().some(function (r) { return r.fecha === fecha && r.franja === franja && r.id !== exceptId; });
}

function rowToObj_(row) {
  var o = {};
  HEADERS.forEach(function (h, i) {
    var v = row[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'America/Santo_Domingo', h === 'fecha' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
    o[h] = v === null || v === undefined ? '' : String(v);
  });
  return o;
}

function objToRow_(o) { return HEADERS.map(function (h) { return o[h] || ''; }); }

function checkKey_(key) {
  var real = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  if (!real || !key || String(key) !== real) throw new Error('Clave del equipo no válida.');
}

function clean_(v, max) {
  // Quita espacios extra y evita que la hoja interprete fórmulas.
  var s = String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function fmtDate_(iso) {
  var days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  var d = new Date(iso + 'T12:00:00');
  return days[d.getDay()] + ' ' + d.getDate() + ' de noviembre';
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
