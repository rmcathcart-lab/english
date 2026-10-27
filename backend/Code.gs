/**
 * Inkwell — Writing Studio backend
 * Google Apps Script, bound to a Google Sheet that stores all data.
 *
 * First-time setup:  run setup() once from the Apps Script editor (Run ▶),
 * then Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 * The front end (GitHub Pages) talks to the /exec URL with POST requests.
 */

const APP = { name: 'Inkwell', version: '1.0.0' };
const DEFAULT_PASSWORD = 'english2026';
const DEFAULT_TZ = 'America/Edmonton';

const SHEETS = {
  classes: ['id', 'name', 'schedule', 'demo', 'created'],
  students: ['id', 'classId', 'first', 'last', 'code', 'accom', 'active', 'created'],
  assignments: ['id', 'classIds', 'title', 'prompt', 'settings', 'override', 'created', 'updated', 'archived'],
  work: ['key', 'aid', 'sid', 'status', 'words', 'chars', 'startedAt', 'lastSaveAt', 'submittedAt',
    'keystrokes', 'deletions', 'activeSec', 'pasteBlocked', 'rev', 'sessionId', 'lastRevAt', 'cleanExit',
    'insertBlocked', 'updated',
    'locked', 'lockReason', 'lockedAt', 'lockCount', 'unlockedAt', 'lockSession'],
  docs: ['key', 'rev', 'updated', 'c1', 'c2', 'c3', 'c4', 'c5'],
  revisions: ['key', 'ts', 'words', 'chars', 'c1', 'c2', 'c3'],
  events: ['ts', 'key', 'aid', 'sid', 'type', 'detail']
};
const JSON_COLS = { schedule: 1, accom: 1, classIds: 1, settings: 1, override: 1 };
const W = {}; SHEETS.work.forEach(function (c, i) { W[c] = i + 1; });
const WCOLS = SHEETS.work.length;
const CHUNK = 45000;

/* ───────────────────────── Setup ───────────────────────── */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!/^Inkwell/.test(ss.getName()) || /\)nkwell|Untitled/.test(ss.getName())) ss.rename('Inkwell Writing Studio (data)');
  Object.keys(SHEETS).forEach(function (name) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = SHEETS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() <= 1) ss.deleteSheet(def);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('TEACHER_HASH')) setPassword_(DEFAULT_PASSWORD);
  if (!props.getProperty('TZ')) props.setProperty('TZ', DEFAULT_TZ);
  if (!readTable_('classes').length) demoSeed_();
  clearTableCache_();
  return 'Inkwell is set up. Teacher password: ' + (props.getProperty('PW_IS_DEFAULT') ? DEFAULT_PASSWORD : '(unchanged)');
}

/* ───────────────────────── HTTP ───────────────────────── */

function doGet() {
  return json_({ ok: true, app: APP.name, version: APP.version });
}

function doPost(e) {
  let out;
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = ROUTES[p.action];
    if (!fn) throw new Error('Unknown action: ' + p.action);
    out = Object.assign({ ok: true }, fn(p) || {});
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err), code: (err && err.code) || '' };
  }
  out.now = Date.now();
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

const ROUTES = {
  // students
  sLogin: sLogin, sHome: sHome, sStart: sStart, sSave: sSave, sPing: sPing, sLock: sLock,
  sStatus: sStatus, sSubmit: sSubmit, sExit: sExit, sView: sView,
  // teacher
  tLogin: tLogin, tBoot: tBoot, tSaveClass: tSaveClass, tDeleteClass: tDeleteClass,
  tAddStudents: tAddStudents, tSaveStudent: tSaveStudent, tDeleteStudent: tDeleteStudent, tRegenCode: tRegenCode,
  tSaveAssignment: tSaveAssignment, tDeleteAssignment: tDeleteAssignment, tOverride: tOverride,
  tMonitor: tMonitor, tWork: tWork, tRevision: tRevision, tUnlock: tUnlock, tLock: tLock,
  tReturn: tReturn, tExport: tExport, tPassword: tPassword, tDemoSeed: tDemoSeed, tDemoClear: tDemoClear,
  tDemoTick: tDemoTick
};

/* ───────────────────────── Errors / auth ───────────────────────── */

function err_(msg, code) { const e = new Error(msg); e.code = code || ''; return e; }

function secret_() { return PropertiesService.getScriptProperties().getProperty('SECRET'); }

function sign_(obj) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(obj));
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret_()));
  return body + '.' + sig;
}

function verify_(tok, role) {
  if (!tok || typeof tok !== 'string' || tok.indexOf('.') < 0) throw err_('Please sign in again.', 'AUTH');
  const parts = tok.split('.');
  const expect = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(parts[0], secret_()));
  if (expect !== parts[1]) throw err_('Please sign in again.', 'AUTH');
  const obj = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  if (!obj.exp || obj.exp < Date.now()) throw err_('Your sign-in expired. Please sign in again.', 'AUTH');
  if (role && obj.r !== role) throw err_('Not allowed.', 'AUTH');
  if (obj.r === 't' && obj.pv !== pwVersion_()) throw err_('Please sign in again.', 'AUTH');
  return obj;
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function setPassword_(pw) {
  const props = PropertiesService.getScriptProperties();
  const salt = Utilities.getUuid();
  props.setProperty('TEACHER_SALT', salt);
  props.setProperty('TEACHER_HASH', hash_(salt + pw));
  props.setProperty('PW_VERSION', String(Date.now()));
  if (pw === DEFAULT_PASSWORD) props.setProperty('PW_IS_DEFAULT', '1'); else props.deleteProperty('PW_IS_DEFAULT');
}

function pwVersion_() { return PropertiesService.getScriptProperties().getProperty('PW_VERSION') || '0'; }

function tz_() { return PropertiesService.getScriptProperties().getProperty('TZ') || DEFAULT_TZ; }

/* ───────────────────────── Sheet storage ───────────────────────── */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const s = ss_().getSheetByName(name);
  if (!s) throw err_('The data sheet "' + name + '" is missing. Run setup() in the Apps Script editor.');
  return s;
}

// Every string is stored with a leading "~" so Sheets never treats it as a number, date or formula.
function enc_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return '~' + v;
  return v;
}
function dec_(v) {
  if (typeof v === 'string' && v.charAt(0) === '~') return v.slice(1);
  return v;
}

function rowToObj_(name, row, rowNum) {
  const o = {};
  SHEETS[name].forEach(function (c, i) {
    let v = dec_(row[i]);
    if (JSON_COLS[c]) {
      try { v = v ? JSON.parse(v) : (c === 'classIds' ? [] : null); } catch (e) { v = null; }
    }
    o[c] = v;
  });
  if (rowNum) o._row = rowNum;
  return o;
}

function objToRow_(name, o) {
  return SHEETS[name].map(function (c) {
    let v = o[c];
    if (JSON_COLS[c]) v = (v === null || v === undefined || v === '') ? '' : JSON.stringify(v);
    return enc_(v);
  });
}

function cache_() { return CacheService.getScriptCache(); }

const TABLE_CACHED = { classes: 1, students: 1, assignments: 1 };

function readTable_(name) {
  const c = cache_();
  if (TABLE_CACHED[name]) {
    const hit = c.get('tbl2:' + name);
    if (hit) { try { return JSON.parse(hit); } catch (e) { /* fall through */ } }
  }
  const sh = sheet_(name);
  const last = sh.getLastRow();
  let out = [];
  if (last > 1) {
    const vals = sh.getRange(2, 1, last - 1, SHEETS[name].length).getValues();
    out = vals.map(function (r, i) { return rowToObj_(name, r, i + 2); }).filter(function (o) { return o[SHEETS[name][0]]; });
  }
  if (TABLE_CACHED[name]) {
    try { c.put('tbl2:' + name, JSON.stringify(out), 600); } catch (e) { /* too big to cache */ }
  }
  return out;
}

function clearTableCache_(name) {
  const names = name ? [name] : Object.keys(TABLE_CACHED);
  cache_().removeAll(names.map(function (n) { return 'tbl2:' + n; }));
}

function findById_(name, id) {
  const t = readTable_(name);
  for (let i = 0; i < t.length; i++) if (t[i].id === id) return t[i];
  return null;
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function upsert_(name, obj) {
  return withLock_(function () {
    clearTableCache_(name);
    const sh = sheet_(name);
    const t = readTable_(name);
    let row = 0;
    for (let i = 0; i < t.length; i++) if (t[i].id === obj.id) { row = t[i]._row; break; }
    if (!row) row = Math.max(sh.getLastRow(), 1) + 1;
    sh.getRange(row, 1, 1, SHEETS[name].length).setValues([objToRow_(name, obj)]);
    clearTableCache_(name);
    return obj;
  });
}

function deleteRowsWhere_(name, pred) {
  return withLock_(function () {
    clearTableCache_(name);
    const sh = sheet_(name);
    const t = readTable_(name).filter(pred).map(function (o) { return o._row; }).sort(function (a, b) { return b - a; });
    t.forEach(function (r) { sh.deleteRow(r); });
    clearTableCache_(name);
    return t.length;
  });
}

function newId_(prefix) { return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 10); }

/* ───────────────────────── Work rows (aligned with docs rows) ───────────────────────── */

function workKey_(aid, sid) { return aid + '|' + sid; }

function findWorkRow_(key) {
  const c = cache_();
  const hit = c.get('wr:' + key);
  if (hit) return Number(hit);
  const sh = sheet_('work');
  if (sh.getLastRow() < 2) return 0;
  const f = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder('~' + key).matchEntireCell(true).findNext();
  if (!f) return 0;
  c.put('wr:' + key, String(f.getRow()), 21600);
  return f.getRow();
}

function readWork_(row) {
  const v = sheet_('work').getRange(row, 1, 1, WCOLS).getValues()[0];
  const w = rowToObj_('work', v, row);
  ['words', 'chars', 'startedAt', 'lastSaveAt', 'submittedAt', 'keystrokes', 'deletions', 'activeSec', 'pasteBlocked',
    'rev', 'lastRevAt', 'insertBlocked', 'updated', 'lockedAt', 'lockCount', 'unlockedAt'].forEach(function (k) { w[k] = Number(w[k]) || 0; });
  w.locked = w.locked === true || w.locked === 'TRUE';
  w.cleanExit = w.cleanExit === true || w.cleanExit === 'TRUE';
  return w;
}

function createWork_(aid, sid) {
  const key = workKey_(aid, sid);
  return withLock_(function () {
    cache_().remove('wr:' + key);
    let row = findWorkRow_(key);
    if (row) return row;
    const sh = sheet_('work');
    const ds = sheet_('docs');
    row = Math.max(sh.getLastRow(), ds.getLastRow(), 1) + 1;
    const now = Date.now();
    const w = {
      key: key, aid: aid, sid: sid, status: 'draft', words: 0, chars: 0, startedAt: now, lastSaveAt: 0, submittedAt: 0,
      keystrokes: 0, deletions: 0, activeSec: 0, pasteBlocked: 0, rev: 0, sessionId: '', lastRevAt: 0, cleanExit: true,
      insertBlocked: 0, updated: now, locked: false, lockReason: '', lockedAt: 0, lockCount: 0, unlockedAt: 0, lockSession: ''
    };
    sh.getRange(row, 1, 1, WCOLS).setValues([objToRow_('work', w)]);
    ds.getRange(row, 1, 1, SHEETS.docs.length).setValues([objToRow_('docs', { key: key, rev: 0, updated: now })]);
    cache_().put('wr:' + key, String(row), 21600);
    return row;
  });
}

// Writes a contiguous block of work columns (so a save never overwrites lock fields and vice versa).
function writeWorkCols_(row, w, from, to) {
  const cols = SHEETS.work.slice(W[from] - 1, W[to]);
  const vals = cols.map(function (c) { return enc_(w[c]); });
  sheet_('work').getRange(row, W[from], 1, cols.length).setValues([vals]);
}
function writeMain_(row, w) { w.updated = Date.now(); writeWorkCols_(row, w, 'status', 'updated'); }
function writeLock_(row, w) { writeWorkCols_(row, w, 'locked', 'lockSession'); }

function readDoc_(row) {
  const v = sheet_('docs').getRange(row, 1, 1, SHEETS.docs.length).getValues()[0];
  let html = '';
  for (let i = 3; i < v.length; i++) html += (dec_(v[i]) || '');
  return { key: dec_(v[0]), rev: Number(v[1]) || 0, html: html };
}

function writeDoc_(row, key, rev, html) {
  html = String(html || '');
  if (html.length > CHUNK * 5) throw err_('This piece of writing is too long to save.');
  const chunks = [];
  for (let i = 0; i < 5; i++) chunks.push(html.slice(i * CHUNK, (i + 1) * CHUNK));
  const vals = [enc_(key), rev, Date.now()].concat(chunks.map(enc_));
  sheet_('docs').getRange(row, 1, 1, SHEETS.docs.length).setValues([vals]);
}

function addRevision_(key, words, chars, html) {
  html = String(html || '');
  const chunks = [html.slice(0, CHUNK), html.slice(CHUNK, CHUNK * 2), html.slice(CHUNK * 2, CHUNK * 3)];
  sheet_('revisions').appendRow([enc_(key), Date.now(), words, chars].concat(chunks.map(enc_)));
}

function logEvent_(aid, sid, type, detail, ts) {
  sheet_('events').appendRow([ts || Date.now(), enc_(workKey_(aid, sid)), enc_(aid), enc_(sid), enc_(type), enc_(detail || '')]);
}

function heartbeat_(key, focused) {
  cache_().put('hb:' + key, JSON.stringify({ t: Date.now(), f: focused === false ? 0 : 1 }), 600);
}

/* ───────────────────────── Time & availability ───────────────────────── */

function localParts_(ms) {
  const s = Utilities.formatDate(new Date(ms), tz_(), "yyyy-MM-dd'|'HH:mm'|'u'|'Z");
  const p = s.split('|');
  const z = p[3];
  const off = (z.charAt(0) === '-' ? -1 : 1) * (Number(z.substr(1, 2)) * 60 + Number(z.substr(3, 2)));
  return { date: p[0], hm: p[1], dow: Number(p[2]), offsetMin: off };
}

function localToMs_(dateStr, hm) {
  const d = dateStr.split('-').map(Number);
  const t = String(hm || '00:00').split(':').map(Number);
  const guess = Date.UTC(d[0], d[1] - 1, d[2], t[0] || 0, t[1] || 0);
  const off = localParts_(guess).offsetMin;
  let ms = guess - off * 60000;
  const off2 = localParts_(ms).offsetMin;
  if (off2 !== off) ms = guess - off2 * 60000;
  return ms;
}

function addDays_(dateStr, n) {
  const d = dateStr.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(d[0], d[1] - 1, d[2] + n, 12)), 'UTC', 'yyyy-MM-dd');
}

function dowOf_(dateStr) {
  const d = dateStr.split('-').map(Number);
  const w = new Date(Date.UTC(d[0], d[1] - 1, d[2], 12)).getUTCDay();
  return w === 0 ? 7 : w;
}

/**
 * Is an assignment open for a student (in a class) right now?
 * Returns { open, closesAt, opensAt, label, via }.
 */
function windowFor_(a, cls, stu, now) {
  const st = a.settings || {};
  if (a.archived) return { open: false, label: 'Archived' };
  const ov = a.override;
  if (ov && ov.mode && (!ov.until || ov.until > now)) {
    if (ov.mode === 'open') return { open: true, closesAt: ov.until || null, label: 'Opened by teacher', via: 'override' };
    if (ov.mode === 'closed') return { open: false, label: 'Closed by teacher', via: 'override' };
  }
  const today = localParts_(now).date;
  const startD = st.startDate || '';
  const endD = st.endDate || '';
  if (endD && today > endD) return { open: false, label: 'Closed', ended: true };
  const mode = st.openMode || 'class';
  if (mode === 'manual') return { open: false, label: 'Waiting for your teacher to open it' };
  const extended = !!(stu && stu.accom && stu.accom.extended);
  const grace = (Number(st.graceMin) || 0) * 60000;
  const periods = (cls && cls.schedule) || [];

  if (mode === 'always' || extended) {
    if (startD && today < startD) return { open: false, opensAt: localToMs_(startD, '00:00'), label: 'Not open yet' };
    return { open: true, closesAt: endD ? localToMs_(addDays_(endD, 1), '00:00') : null, label: extended && mode !== 'always' ? 'Open (extended access)' : 'Open' };
  }

  let next = 0;
  for (let k = 0; k < 21; k++) {
    const date = addDays_(today, k);
    if (endD && date > endD) break;
    if (startD && date < startD) continue;
    const dow = dowOf_(date);
    for (let i = 0; i < periods.length; i++) {
      const p = periods[i];
      if (Number(p.d) !== dow || !p.s || !p.e) continue;
      const s = localToMs_(date, p.s) - grace;
      const e = localToMs_(date, p.e) + grace;
      if (now >= s && now < e) return { open: true, closesAt: e, label: 'Open during class', via: 'class' };
      if (s > now && (!next || s < next)) next = s;
    }
    if (next) break;
  }
  return next ? { open: false, opensAt: next, label: 'Opens next class' } : { open: false, label: periods.length ? 'No more class time scheduled' : 'No class time set up yet' };
}

/* ───────────────────────── Student API ───────────────────────── */

function normCode_(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

function sLogin(p) {
  const code = normCode_(p.code);
  if (!code) throw err_('Enter your student code.');
  const stu = readTable_('students').filter(function (s) { return s.active !== false && normCode_(s.code) === code; })[0];
  if (!stu) { Utilities.sleep(600); throw err_("That code didn't match. Check it and try again."); }
  const cls = findById_('classes', stu.classId);
  return {
    token: sign_({ r: 's', id: stu.id, exp: Date.now() + 14 * 3600 * 1000 }),
    student: { id: stu.id, first: stu.first, last: stu.last, className: cls ? cls.name : '' }
  };
}

function studentFromToken_(p) {
  const t = verify_(p.token, 's');
  const stu = findById_('students', t.id);
  if (!stu || stu.active === false) throw err_('Your account is no longer active. Ask your teacher.', 'AUTH');
  return stu;
}

function ctx_(stu, aid) {
  const a = findById_('assignments', aid);
  if (!a || a.archived || (a.classIds || []).indexOf(stu.classId) < 0) throw err_('That assignment is not available.');
  const cls = findById_('classes', stu.classId);
  return { a: a, cls: cls, win: windowFor_(a, cls, stu, Date.now()) };
}

function goal_(a) {
  const st = a.settings || {};
  return { min: Number(st.minWords) || 0, max: Number(st.maxWords) || 0, show: st.showGoal !== false };
}

function sHome(p) {
  const stu = studentFromToken_(p);
  const cls = findById_('classes', stu.classId);
  const now = Date.now();
  const list = readTable_('assignments').filter(function (a) {
    return !a.archived && (a.classIds || []).indexOf(stu.classId) >= 0 && !(a.settings && a.settings.hidden);
  });
  const out = list.map(function (a) {
    const win = windowFor_(a, cls, stu, now);
    const row = findWorkRow_(workKey_(a.id, stu.id));
    let work = null;
    if (row) {
      const w = readWork_(row);
      work = { status: w.status, words: w.words, locked: w.locked, lastSaveAt: w.lastSaveAt, submittedAt: w.submittedAt };
    }
    return { id: a.id, title: a.title, win: win, work: work, goal: goal_(a), created: a.created };
  });
  out.sort(function (x, y) {
    const rank = function (z) { return z.win.open ? 0 : (z.win.opensAt ? 1 : 2); };
    return rank(x) - rank(y) || (y.created || 0) - (x.created || 0);
  });
  return { student: { id: stu.id, first: stu.first, last: stu.last, className: cls ? cls.name : '' }, assignments: out };
}

function lockWork_(row, w, reason, sessionId) {
  w.locked = true;
  w.lockReason = reason;
  w.lockedAt = Date.now();
  w.lockCount = (w.lockCount || 0) + 1;
  w.lockSession = sessionId || '';
  writeLock_(row, w);
  logEvent_(w.aid, w.sid, 'locked', reason);
}

function publicAssignment_(a) {
  const st = a.settings || {};
  return {
    id: a.id, title: a.title, prompt: a.prompt || '', goal: goal_(a),
    allowSelfPaste: st.allowSelfPaste !== false
  };
}

function sStart(p) {
  const stu = studentFromToken_(p);
  const c = ctx_(stu, p.aid);
  const key = workKey_(p.aid, stu.id);
  let row = findWorkRow_(key);
  let w = row ? readWork_(row) : null;
  const base = {
    assignment: publicAssignment_(c.a), win: c.win,
    student: { first: stu.first, last: stu.last }, relaxed: !!(stu.accom && stu.accom.relaxed)
  };
  if (w && w.status === 'submitted') {
    return Object.assign(base, { submitted: true, html: readDoc_(row).html, work: publicWork_(w) });
  }
  if (!c.win.open) {
    return Object.assign(base, { closed: true, html: row ? readDoc_(row).html : '', work: w ? publicWork_(w) : null });
  }
  const st = c.a.settings || {};
  if (!row) {
    row = createWork_(p.aid, stu.id);
    w = readWork_(row);
    logEvent_(p.aid, stu.id, 'start', 'Started writing');
  } else if (!w.locked && w.sessionId && w.sessionId !== p.sessionId) {
    const hb = JSON.parse(cache_().get('hb:' + key) || 'null');
    if (hb && Date.now() - hb.t < 40000 && !w.cleanExit) {
      lockWork_(row, w, 'Opened the assignment in a second tab or on another device', p.sessionId);
    } else if (!w.cleanExit && st.lockOnReentry !== false) {
      lockWork_(row, w, 'Came back after leaving unexpectedly (closed the tab, refreshed, or lost power)', p.sessionId);
    } else {
      logEvent_(p.aid, stu.id, 'resume', 'Opened the assignment');
    }
  } else if (!w.locked) {
    logEvent_(p.aid, stu.id, 'resume', 'Opened the assignment');
  }
  w.sessionId = p.sessionId;
  w.cleanExit = false;
  if (!w.startedAt) w.startedAt = Date.now();
  writeMain_(row, w);
  heartbeat_(key, true);
  const doc = readDoc_(row);
  return Object.assign(base, { html: doc.html, rev: w.rev, work: publicWork_(w), locked: w.locked, lockReason: w.lockReason, lockedAt: w.lockedAt });
}

function publicWork_(w) {
  return {
    status: w.status, words: w.words, chars: w.chars, rev: w.rev, locked: w.locked, lockReason: w.lockReason,
    lockedAt: w.lockedAt, lastSaveAt: w.lastSaveAt, submittedAt: w.submittedAt
  };
}

function clampDelta_(d) {
  d = d || {};
  const n = function (v, max) { v = Math.round(Number(v) || 0); return Math.max(0, Math.min(v, max)); };
  return { keys: n(d.keys, 20000), dels: n(d.dels, 20000), active: n(d.active, 600), paste: n(d.paste, 500), insert: n(d.insert, 500) };
}

// Shared by save / lock / submit / exit.  Returns { row, w, saved }.
function applySave_(stu, p, opts) {
  opts = opts || {};
  const key = workKey_(p.aid, stu.id);
  const row = findWorkRow_(key);
  if (!row) throw err_('Open the assignment first.');
  const w = readWork_(row);
  const res = { row: row, w: w, saved: false };
  if (w.sessionId && p.sessionId && w.sessionId !== p.sessionId) { res.superseded = true; return res; }
  if (w.status === 'submitted') { res.submitted = true; return res; }
  if (w.locked && !opts.allowLocked) { res.locked = true; return res; }

  const now = Date.now();
  const d = clampDelta_(p.d);
  const prevWords = w.words;
  const prevChars = w.chars;
  const prevSave = w.lastSaveAt;
  if (typeof p.html === 'string' && Number(p.rev) > w.rev) {
    writeDoc_(row, key, Number(p.rev), p.html);
    w.rev = Number(p.rev);
    w.words = Math.max(0, Number(p.words) || 0);
    w.chars = Math.max(0, Number(p.chars) || 0);
    w.lastSaveAt = now;
    res.saved = true;
    // Integrity signals for the teacher
    const dw = w.words - prevWords;
    const dt = prevSave ? (now - prevSave) / 1000 : 999;
    if (dw >= 60 && dt < 40) logEvent_(p.aid, stu.id, 'burst', '+' + dw + ' words in ' + Math.round(dt) + ' seconds');
    const dc = w.chars - prevChars;
    if (dc > 120 && dc > d.keys * 1.6 + 40) {
      logEvent_(p.aid, stu.id, 'unusual', dc + ' characters appeared with only ' + d.keys + ' keystrokes');
    }
    if (now - (w.lastRevAt || 0) >= 90000 || opts.forceRevision) {
      addRevision_(key, w.words, w.chars, p.html);
      w.lastRevAt = now;
    }
  } else if (opts.forceRevision && w.rev > 0) {
    // nothing new
  }
  w.keystrokes += d.keys;
  w.deletions += d.dels;
  w.activeSec += d.active;
  if (d.paste) { w.pasteBlocked += d.paste; logEvent_(p.aid, stu.id, 'paste', d.paste === 1 ? 'Tried to paste text from outside the assignment' : 'Tried to paste from outside the assignment (' + d.paste + ' times)'); }
  if (d.insert) { w.insertBlocked += d.insert; logEvent_(p.aid, stu.id, 'insert', 'A large block of text was inserted at once and blocked (autofill, AI writing tool, or dictation)'); }
  res.w = w;
  return res;
}

function respond_(res, c) {
  const out = { saved: !!res.saved, rev: res.w ? res.w.rev : 0, win: c ? c.win : null };
  if (res.superseded) out.superseded = true;
  if (res.submitted) out.submitted = true;
  if (res.locked || (res.w && res.w.locked)) { out.locked = true; out.lockReason = res.w.lockReason; out.lockedAt = res.w.lockedAt; }
  return out;
}

function sSave(p) {
  const stu = studentFromToken_(p);
  const c = ctx_(stu, p.aid);
  const key = workKey_(p.aid, stu.id);
  if (!c.win.open) {
    // Accept the last save that arrives just after class ends.
    const row0 = findWorkRow_(key);
    const w0 = row0 ? readWork_(row0) : null;
    const recent = w0 && (Date.now() - Math.max(w0.lastSaveAt, w0.updated)) < 5 * 60000;
    if (!recent) return { saved: false, closed: true, win: c.win };
  }
  const res = applySave_(stu, p);
  if (!res.superseded && !res.submitted && !res.locked) writeMain_(res.row, res.w);
  heartbeat_(key, p.focused !== false);
  const out = respond_(res, c);
  if (!c.win.open) out.closed = true;
  return out;
}

function sPing(p) {
  const stu = studentFromToken_(p);
  const c = ctx_(stu, p.aid);
  const key = workKey_(p.aid, stu.id);
  const row = findWorkRow_(key);
  if (!row) return { win: c.win };
  const w = readWork_(row);
  heartbeat_(key, p.focused !== false);
  const d = clampDelta_(p.d);
  if (d.active || d.keys || d.paste || d.insert) {
    if (!(w.sessionId && p.sessionId && w.sessionId !== p.sessionId) && w.status !== 'submitted') {
      const r = applySave_(stu, { aid: p.aid, sessionId: p.sessionId, d: p.d }, { allowLocked: true });
      writeMain_(row, r.w);
    }
  }
  const out = respond_({ w: w, superseded: w.sessionId && p.sessionId && w.sessionId !== p.sessionId, submitted: w.status === 'submitted' }, c);
  if (!c.win.open) out.closed = true;
  return out;
}

function sLock(p) {
  const stu = studentFromToken_(p);
  const key = workKey_(p.aid, stu.id);
  const res = applySave_(stu, p, { allowLocked: true, forceRevision: true });
  if (res.superseded || res.submitted) return respond_(res);
  writeMain_(res.row, res.w);
  if (!res.w.locked) lockWork_(res.row, res.w, String(p.reason || 'Left the assignment window').slice(0, 200), p.sessionId);
  heartbeat_(key, false);
  return respond_(res);
}

function sStatus(p) {
  const stu = studentFromToken_(p);
  const c = ctx_(stu, p.aid);
  const row = findWorkRow_(workKey_(p.aid, stu.id));
  if (!row) return { locked: false, win: c.win };
  const w = readWork_(row);
  heartbeat_(workKey_(p.aid, stu.id), false);
  return { locked: w.locked, lockReason: w.lockReason, lockedAt: w.lockedAt, submitted: w.status === 'submitted', win: c.win, superseded: !!(w.sessionId && p.sessionId && w.sessionId !== p.sessionId) };
}

function sSubmit(p) {
  const stu = studentFromToken_(p);
  ctx_(stu, p.aid);
  const res = applySave_(stu, p, { forceRevision: true });
  if (res.superseded || res.submitted || res.locked) return respond_(res);
  res.w.status = 'submitted';
  res.w.submittedAt = Date.now();
  res.w.cleanExit = true;
  writeMain_(res.row, res.w);
  logEvent_(p.aid, stu.id, 'submit', 'Submitted (' + res.w.words + ' words)');
  return { submitted: true, submittedAt: res.w.submittedAt, words: res.w.words };
}

function sExit(p) {
  const stu = studentFromToken_(p);
  const res = applySave_(stu, p, { forceRevision: true });
  if (res.superseded || res.submitted || res.locked) return respond_(res);
  res.w.cleanExit = true;
  writeMain_(res.row, res.w);
  logEvent_(p.aid, stu.id, 'exit', 'Saved and exited');
  return { exited: true, saved: res.saved };
}

function sView(p) {
  const stu = studentFromToken_(p);
  const c = ctx_(stu, p.aid);
  const row = findWorkRow_(workKey_(p.aid, stu.id));
  if (!row) return { html: '', work: null, assignment: publicAssignment_(c.a) };
  return { html: readDoc_(row).html, work: publicWork_(readWork_(row)), assignment: publicAssignment_(c.a) };
}

/* ───────────────────────── Teacher API ───────────────────────── */

function teacher_(p) { return verify_(p.token, 't'); }

function tLogin(p) {
  const props = PropertiesService.getScriptProperties();
  if (hash_(props.getProperty('TEACHER_SALT') + String(p.password || '')) !== props.getProperty('TEACHER_HASH')) {
    Utilities.sleep(800);
    throw err_('That password is not right.');
  }
  return { token: sign_({ r: 't', pv: pwVersion_(), exp: Date.now() + 30 * 24 * 3600 * 1000 }), defaultPassword: !!props.getProperty('PW_IS_DEFAULT') };
}

function tBoot(p) {
  teacher_(p);
  const now = Date.now();
  const classes = readTable_('classes');
  const assignments = readTable_('assignments').filter(function (a) { return !a.archived; });
  assignments.forEach(function (a) {
    a.windows = {};
    (a.classIds || []).forEach(function (cid) {
      const cls = classes.filter(function (c) { return c.id === cid; })[0];
      if (cls) a.windows[cid] = windowFor_(a, cls, null, now);
    });
  });
  return {
    classes: classes, students: readTable_('students'), assignments: assignments,
    settings: { tz: tz_(), defaultPassword: !!PropertiesService.getScriptProperties().getProperty('PW_IS_DEFAULT'), version: APP.version }
  };
}

function tSaveClass(p) {
  teacher_(p);
  const c = p.cls || {};
  const existing = c.id ? findById_('classes', c.id) : null;
  const obj = {
    id: c.id || newId_('c'), name: String(c.name || 'Untitled class').slice(0, 120),
    schedule: (c.schedule || []).filter(function (x) { return x && x.d && x.s && x.e; }).map(function (x) {
      return { d: Number(x.d), s: String(x.s).slice(0, 5), e: String(x.e).slice(0, 5) };
    }),
    demo: existing ? !!existing.demo : !!c.demo, created: existing ? existing.created : Date.now()
  };
  upsert_('classes', obj);
  return { cls: obj };
}

function tDeleteClass(p) {
  teacher_(p);
  deleteRowsWhere_('students', function (s) { return s.classId === p.id; });
  deleteRowsWhere_('classes', function (c) { return c.id === p.id; });
  readTable_('assignments').forEach(function (a) {
    if ((a.classIds || []).indexOf(p.id) >= 0) {
      a.classIds = a.classIds.filter(function (x) { return x !== p.id; });
      delete a._row; delete a.windows;
      upsert_('assignments', a);
    }
  });
  return {};
}

const CODE_WORDS = ['MAPLE', 'RIVER', 'CEDAR', 'COMET', 'PRAIRIE', 'FALCON', 'HARBOR', 'MEADOW', 'ORBIT', 'QUILL', 'SPRUCE', 'TUNDRA',
  'BISON', 'CANYON', 'EMBER', 'GLACIER', 'LANTERN', 'MOOSE', 'NOVA', 'OTTER', 'PEBBLE', 'RAVEN', 'SAGE', 'TIMBER', 'WILLOW',
  'ASPEN', 'BEACON', 'CLOVER', 'DELTA', 'FERN', 'GROVE', 'HAWK', 'IRIS', 'JUNIPER', 'KESTREL', 'LYNX', 'MARBLE', 'NORTH', 'OAK', 'PINE'];

function genCode_(taken) {
  for (let i = 0; i < 500; i++) {
    const code = CODE_WORDS[Math.floor(Math.random() * CODE_WORDS.length)] + '-' + (10 + Math.floor(Math.random() * 90));
    if (!taken[normCode_(code)]) { taken[normCode_(code)] = 1; return code; }
  }
  return 'INK-' + Math.floor(Math.random() * 1e6);
}

function takenCodes_() {
  const t = {};
  readTable_('students').forEach(function (s) { t[normCode_(s.code)] = 1; });
  return t;
}

function tAddStudents(p) {
  teacher_(p);
  if (!findById_('classes', p.classId)) throw err_('Class not found.');
  const lines = String(p.lines || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(String);
  const taken = takenCodes_();
  const sh = sheet_('students');
  const rows = [];
  const added = [];
  lines.forEach(function (line) {
    let first, last;
    if (line.indexOf(',') >= 0) { const q = line.split(','); last = q[0].trim(); first = q.slice(1).join(',').trim(); }
    else { const q = line.split(/\s+/); first = q[0]; last = q.slice(1).join(' '); }
    if (!first) return;
    const s = { id: newId_('s'), classId: p.classId, first: first, last: last || '', code: genCode_(taken), accom: {}, active: true, created: Date.now() };
    rows.push(objToRow_('students', s));
    added.push(s);
  });
  if (rows.length) {
    withLock_(function () {
      sh.getRange(Math.max(sh.getLastRow(), 1) + 1, 1, rows.length, SHEETS.students.length).setValues(rows);
    });
    clearTableCache_('students');
  }
  return { added: added };
}

function tSaveStudent(p) {
  teacher_(p);
  const s = p.student || {};
  const ex = findById_('students', s.id);
  if (!ex) throw err_('Student not found.');
  ex.first = String(s.first || ex.first).slice(0, 80);
  ex.last = String(s.last == null ? ex.last : s.last).slice(0, 80);
  ex.accom = s.accom || {};
  ex.active = s.active !== false;
  if (s.classId && findById_('classes', s.classId)) ex.classId = s.classId;
  delete ex._row;
  upsert_('students', ex);
  return { student: ex };
}

function tDeleteStudent(p) {
  teacher_(p);
  deleteRowsWhere_('students', function (s) { return s.id === p.id; });
  return {};
}

function tRegenCode(p) {
  teacher_(p);
  const ex = findById_('students', p.id);
  if (!ex) throw err_('Student not found.');
  ex.code = genCode_(takenCodes_());
  delete ex._row;
  upsert_('students', ex);
  return { student: ex };
}

function tSaveAssignment(p) {
  teacher_(p);
  const a = p.assignment || {};
  const ex = a.id ? findById_('assignments', a.id) : null;
  const st = a.settings || {};
  const obj = {
    id: a.id || newId_('a'),
    classIds: (a.classIds || []).filter(function (id) { return !!findById_('classes', id); }),
    title: String(a.title || 'Untitled assignment').slice(0, 200),
    prompt: String(a.prompt || '').slice(0, 40000),
    settings: {
      openMode: ['class', 'always', 'manual'].indexOf(st.openMode) >= 0 ? st.openMode : 'class',
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(st.startDate || '') ? st.startDate : '',
      endDate: /^\d{4}-\d{2}-\d{2}$/.test(st.endDate || '') ? st.endDate : '',
      graceMin: Math.max(0, Math.min(60, Number(st.graceMin) || 0)),
      minWords: Math.max(0, Number(st.minWords) || 0),
      maxWords: Math.max(0, Number(st.maxWords) || 0),
      showGoal: st.showGoal !== false,
      allowSelfPaste: st.allowSelfPaste !== false,
      lockOnReentry: st.lockOnReentry !== false,
      hidden: !!st.hidden
    },
    override: ex ? ex.override : '',
    created: ex ? ex.created : Date.now(),
    updated: Date.now(),
    archived: false
  };
  upsert_('assignments', obj);
  return { assignment: obj };
}

function tDeleteAssignment(p) {
  teacher_(p);
  const ex = findById_('assignments', p.id);
  if (!ex) return {};
  ex.archived = true;
  delete ex._row;
  upsert_('assignments', ex);
  return {};
}

function tOverride(p) {
  teacher_(p);
  const ex = findById_('assignments', p.aid);
  if (!ex) throw err_('Assignment not found.');
  if (p.mode === 'open' || p.mode === 'closed') {
    let until = 0;
    if (p.minutes) until = Date.now() + Number(p.minutes) * 60000;
    if (p.until === 'today') until = localToMs_(addDays_(localParts_(Date.now()).date, 1), '00:00');
    ex.override = { mode: p.mode, until: until };
  } else {
    ex.override = '';
  }
  delete ex._row;
  upsert_('assignments', ex);
  const cls = readTable_('classes');
  const windows = {};
  (ex.classIds || []).forEach(function (cid) {
    const c = cls.filter(function (x) { return x.id === cid; })[0];
    if (c) windows[cid] = windowFor_(ex, c, null, Date.now());
  });
  return { override: ex.override, windows: windows };
}

function readAllWork_(aid) {
  const sh = sheet_('work');
  const last = sh.getLastRow();
  if (last < 2) return {};
  const vals = sh.getRange(2, 1, last - 1, WCOLS).getValues();
  const map = {};
  const target = '~' + aid;
  vals.forEach(function (r, i) {
    if (r[W.aid - 1] !== target) return;
    const v = rowToObj_('work', r, i + 2);
    ['words', 'chars', 'startedAt', 'lastSaveAt', 'submittedAt', 'keystrokes', 'deletions', 'activeSec', 'pasteBlocked',
      'rev', 'lastRevAt', 'lockedAt', 'lockCount', 'insertBlocked', 'updated', 'unlockedAt'].forEach(function (k) { v[k] = Number(v[k]) || 0; });
    v.locked = v.locked === true || v.locked === 'TRUE';
    v.cleanExit = v.cleanExit === true || v.cleanExit === 'TRUE';
    map[v.sid] = v;
  });
  return map;
}

function recentEvents_(filter, limit) {
  const sh = sheet_('events');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(last - 1, 600);
  const vals = sh.getRange(last - n + 1, 1, n, SHEETS.events.length).getValues();
  const out = [];
  for (let i = vals.length - 1; i >= 0 && out.length < limit; i--) {
    const e = rowToObj_('events', vals[i]);
    if (filter(e)) out.push({ ts: Number(e.ts), sid: e.sid, aid: e.aid, type: e.type, detail: e.detail });
  }
  return out;
}

function tMonitor(p) {
  teacher_(p);
  const a = findById_('assignments', p.aid);
  if (!a) throw err_('Assignment not found.');
  const now = Date.now();
  const classes = readTable_('classes').filter(function (c) { return (a.classIds || []).indexOf(c.id) >= 0; });
  const students = readTable_('students').filter(function (s) { return s.active !== false && (a.classIds || []).indexOf(s.classId) >= 0; });
  const work = readAllWork_(a.id);
  const keys = students.map(function (s) { return 'hb:' + workKey_(a.id, s.id); });
  const hbs = keys.length ? cache_().getAll(keys) : {};
  const rows = students.map(function (s) {
    const w = work[s.id];
    const hbRaw = hbs['hb:' + workKey_(a.id, s.id)];
    const hb = hbRaw ? JSON.parse(hbRaw) : null;
    const r = { sid: s.id, first: s.first, last: s.last, classId: s.classId, accom: s.accom || {} };
    if (!w) { r.state = 'none'; return r; }
    const online = !!(hb && now - hb.t < 45000);
    let state;
    if (w.status === 'submitted') state = 'submitted';
    else if (w.locked) state = 'locked';
    else if (online) state = (now - w.lastSaveAt < 75000) ? 'writing' : 'idle';
    else state = 'offline';
    Object.assign(r, {
      state: state, online: online, lastSeen: hb ? hb.t : 0, focused: hb ? !!hb.f : false,
      words: w.words, chars: w.chars, startedAt: w.startedAt, lastSaveAt: w.lastSaveAt, submittedAt: w.submittedAt,
      keystrokes: w.keystrokes, deletions: w.deletions, activeSec: w.activeSec, pasteBlocked: w.pasteBlocked,
      insertBlocked: w.insertBlocked, locked: w.locked, lockReason: w.lockReason, lockedAt: w.lockedAt, lockCount: w.lockCount
    });
    return r;
  });
  const windows = {};
  classes.forEach(function (c) { windows[c.id] = windowFor_(a, c, null, now); });
  const sids = {};
  students.forEach(function (s) { sids[s.id] = 1; });
  const events = recentEvents_(function (e) { return e.aid === a.id && sids[e.sid]; }, 40);
  return { assignment: a, windows: windows, rows: rows, events: events, demo: classes.some(function (c) { return c.demo; }) };
}

function tWork(p) {
  teacher_(p);
  const key = workKey_(p.aid, p.sid);
  const row = findWorkRow_(key);
  const stu = findById_('students', p.sid);
  if (!row) return { work: null, html: '', revisions: [], events: [], student: stu };
  const w = readWork_(row);
  const doc = readDoc_(row);
  const out = { work: w, html: doc.html, student: stu };
  if (!p.light) {
    const sh = sheet_('revisions');
    const last = sh.getLastRow();
    const revs = [];
    if (last > 1) {
      const vals = sh.getRange(2, 1, last - 1, 4).getValues();
      const target = '~' + key;
      vals.forEach(function (r, i) { if (r[0] === target) revs.push({ row: i + 2, ts: Number(r[1]), words: Number(r[2]) }); });
    }
    out.revisions = revs;
    out.events = recentEvents_(function (e) { return e.aid === p.aid && e.sid === p.sid; }, 200).reverse();
  }
  return out;
}

function tRevision(p) {
  teacher_(p);
  const v = sheet_('revisions').getRange(Number(p.row), 1, 1, SHEETS.revisions.length).getValues()[0];
  if (dec_(v[0]) !== workKey_(p.aid, p.sid)) throw err_('Revision not found.');
  return { ts: Number(v[1]), words: Number(v[2]), html: (dec_(v[4]) || '') + (dec_(v[5]) || '') + (dec_(v[6]) || '') };
}

function tUnlock(p) {
  teacher_(p);
  let sids = p.sid ? [p.sid] : [];
  if (p.all) {
    const work = readAllWork_(p.aid);
    sids = Object.keys(work).filter(function (s) { return work[s].locked; });
  }
  sids.forEach(function (sid) {
    const row = findWorkRow_(workKey_(p.aid, sid));
    if (!row) return;
    const w = readWork_(row);
    if (!w.locked) return;
    w.locked = false;
    w.unlockedAt = Date.now();
    writeLock_(row, w);
    logEvent_(p.aid, sid, 'unlocked', 'Cleared by teacher');
  });
  return { cleared: sids.length };
}

function tLock(p) {
  teacher_(p);
  const row = findWorkRow_(workKey_(p.aid, p.sid));
  if (!row) throw err_('That student has not started yet.');
  const w = readWork_(row);
  if (!w.locked) lockWork_(row, w, 'Paused by your teacher', '');
  return {};
}

function tReturn(p) {
  teacher_(p);
  const row = findWorkRow_(workKey_(p.aid, p.sid));
  if (!row) throw err_('Nothing to return.');
  const w = readWork_(row);
  w.status = 'draft';
  w.cleanExit = true;
  writeMain_(row, w);
  logEvent_(p.aid, p.sid, 'returned', 'Reopened by teacher so the student can keep working');
  return {};
}

function tExport(p) {
  teacher_(p);
  const a = findById_('assignments', p.aid);
  if (!a) throw err_('Assignment not found.');
  const students = readTable_('students').filter(function (s) { return (a.classIds || []).indexOf(s.classId) >= 0; });
  const work = readAllWork_(a.id);
  const cls = {};
  readTable_('classes').forEach(function (c) { cls[c.id] = c.name; });
  const items = students.map(function (s) {
    const w = work[s.id];
    return {
      sid: s.id, first: s.first, last: s.last, className: cls[s.classId] || '',
      status: w ? w.status : 'none', words: w ? w.words : 0, submittedAt: w ? w.submittedAt : 0,
      html: w ? readDoc_(w._row).html : ''
    };
  });
  return { assignment: a, items: items };
}

function tPassword(p) {
  teacher_(p);
  const props = PropertiesService.getScriptProperties();
  if (hash_(props.getProperty('TEACHER_SALT') + String(p.current || '')) !== props.getProperty('TEACHER_HASH')) throw err_('Your current password is not right.');
  if (String(p.next || '').length < 6) throw err_('Choose a password with at least 6 characters.');
  setPassword_(String(p.next));
  return { token: sign_({ r: 't', pv: pwVersion_(), exp: Date.now() + 30 * 24 * 3600 * 1000 }) };
}

/* ───────────────────────── Demo data ───────────────────────── */

function tDemoSeed(p) { teacher_(p); tDemoClearInner_(); demoSeed_(); return tBoot(p); }
function tDemoClear(p) { teacher_(p); tDemoClearInner_(); return tBoot(p); }

function tDemoClearInner_() {
  const demoIds = readTable_('classes').filter(function (c) { return c.demo; }).map(function (c) { return c.id; });
  if (!demoIds.length) return;
  deleteRowsWhere_('students', function (s) { return demoIds.indexOf(s.classId) >= 0; });
  deleteRowsWhere_('classes', function (c) { return c.demo; });
  readTable_('assignments').forEach(function (a) {
    if ((a.classIds || []).some(function (id) { return demoIds.indexOf(id) >= 0; })) {
      a.archived = true; delete a._row; upsert_('assignments', a);
    }
  });
}

const DEMO_ESSAYS = [
  { title: 'The Night the Power Went Out', paras: [
    'I used to think silence was boring. Then, during the ice storm in grade seven, the power went out for three days and I learned that silence is actually full of things you never notice.',
    'The first night, my family dragged every blanket we owned into the living room. My dad built a fire in the old wood stove that we had only ever used as a shelf for plants. My little brother was convinced we were going to freeze, and honestly, so was I. The windows creaked every time the wind pushed against them, and the trees outside cracked like gunshots as the ice snapped their branches.',
    'Without the TV or our phones, we did not know what to do with ourselves at first. My mom found a deck of cards with two jacks missing and taught us a game her grandmother used to play. We made up rules for the missing cards. We laughed harder at that game than I had laughed at anything in months.',
    'On the second night, my dad told us stories about growing up on a farm near Lacombe, about the winter his family got snowed in for a week and survived on canned peaches and pancakes. I had never heard any of those stories before. I realized I knew almost nothing about who my parents were before they were my parents.',
    'When the lights finally flickered back on, everyone cheered, but part of me was disappointed. Within an hour we had all scattered to our own rooms again. Now, whenever the house gets too loud, I remember those three days. I learned that the things that matter most are usually hiding behind all the noise, waiting for someone to turn it off.'
  ] },
  { title: 'Learning to Lose', paras: [
    'For most of my life, I hated losing so much that I would rather not play at all. That changed the year I joined the junior high chess club, mostly because my best friend dared me to.',
    'At my first tournament, I lost every single game. The worst one was against a grade five kid who finished me off in eleven moves and then politely asked if I wanted to go over the game with him. I wanted to disappear into the gym floor. Instead, I sat down across from him and let him show me every mistake I had made.',
    'That conversation stuck with me. He was not bragging. He was excited, the way you get excited about a puzzle. He saw my mistakes as interesting instead of embarrassing, and I started to wonder what it would feel like to see my own failures that way.',
    'Over the next few months I kept a notebook of every game I lost. I wrote down the move where things went wrong and what I should have done instead. The notebook filled up fast. Slowly, though, the losses started to look different. They were not proof that I was bad at something. They were directions.',
    'By the spring tournament, I won four games out of six. I did not win a trophy, but I walked out of that gym feeling taller than I ever had. The biggest thing I won that year was not a chess game. It was the ability to be bad at something long enough to get good at it.'
  ] },
  { title: 'My Grandmother\'s Kitchen', paras: [
    'My grandmother\'s kitchen always smelled like cardamom and burnt toast. She burned the toast on purpose because she said it tasted like her childhood, and I never had the heart to tell her I hated it.',
    'Every Sunday, my cousins and I crowded around her small table while she cooked enough food for twenty people. She never used a recipe. When I asked her how much flour went into the bread, she held up her cupped hands and said, "This much, plus a little more if the dough is sad."',
    'The summer I turned fourteen, she asked me to help her make bread for my aunt\'s wedding. I thought it would take an hour. It took the entire day. We kneaded, waited, punched the dough down, and waited again. She told me about leaving her village, about arriving in Calgary in February with only a thin coat, and about the neighbour who brought her a casserole and became her friend for forty years.',
    'By the end of the day, my arms ached and my hair was covered in flour. The bread came out lopsided and a little too dark on the bottom. My grandmother tore off a piece, chewed it slowly, and declared it perfect.',
    'She passed away two winters ago. Last month, I tried to make her bread by myself. I did not have a recipe, so I used my hands to measure, plus a little more because the dough looked sad. It was not as good as hers, but when the kitchen filled with that smell, it felt like she was standing right next to me.'
  ] },
  { title: 'The Tryout', paras: [
    'The list was taped to the gym door at 3:15, and I could see it from the end of the hallway. I stopped walking. For two weeks I had been practicing every single night, and in about ten steps I would know whether any of it had mattered.',
    'I had wanted to make the senior volleyball team since grade nine, when I watched them win zones in front of the whole school. That summer I served against our garage door until the neighbours complained. I watched videos of professional players and tried to copy the way they moved their feet. I even started eating breakfast, which my mom said was a miracle.',
    'Tryouts were harder than I expected. On the second day, I shanked three passes in a row and heard someone laugh. I almost walked out. Instead, I remembered something my coach from club had told me: the next ball does not care about the last one. I took a breath and got ready for the next ball.',
    'When I finally reached the list, I read it three times. My name was not there. I felt my face go hot and I walked straight to the bathroom so nobody would see me cry.',
    'The next morning, the coach found me before class. She said I had been the last cut, and that she wanted me to keep practicing with the team as an alternate. I almost said no out of pride. I am glad I said yes. Not making the team taught me more than making it would have, because it showed me that I could keep going even when the outcome was not what I wanted.'
  ] },
  { title: 'Moving Day', paras: [
    'The moving truck was smaller than I expected. It seemed impossible that eleven years of my life could fit inside it, but by noon everything we owned was stacked inside, and our house in Red Deer was suddenly just a house again.',
    'I walked through every empty room before we left. My bedroom looked enormous without my bed in it. On the closet door frame were pencil marks where my parents had measured my height every birthday. I ran my finger over the lowest one and could not believe I had ever been that small.',
    'For the first month in Airdrie, I was miserable. I did not know anyone at my new school, and I ate lunch in the library pretending to read. I texted my old friends constantly, but their replies got slower as the weeks went by. I felt like I was disappearing from my old life without arriving in my new one.',
    'Then one day in science class, my lab partner asked if I wanted to join her robotics team because they needed someone who was good at writing the reports. I said yes mostly because I had nothing better to do. That team became my whole world. We stayed late building robots that mostly did not work, and we laughed until our stomachs hurt.',
    'Before we left Red Deer, my dad took a photo of the pencil marks on the closet door. Last week he started a new set of marks in my new room. The first one is already higher than the last one in the old house. I guess that is what moving is: you leave something behind, but you also keep growing.'
  ] }
];

const DEMO_QUICKWRITES = [
  'I think social media makes us lonelier because we compare ourselves to everyone else\'s highlight reels. When I scroll through photos of people at parties, I feel left out even when I chose to stay home. Real connection takes effort and time, and an app cannot replace sitting with a friend.',
  'Honestly, I do not think social media makes us lonelier by itself. It depends on how you use it. I talk to my cousins in the Philippines every day, and without social media we would barely know each other. The problem is when people use it instead of real friendships instead of in addition to them.',
  'Social media is designed to keep us scrolling, not to make us feel connected. The more time I spend on it, the worse I feel afterward. I tried deleting TikTok for a week and I noticed I talked to my family more at dinner. I think it can make people lonelier without them even realizing it.',
  'I disagree with the idea that social media is the cause of loneliness. People were lonely long before phones existed. For some people, especially people who feel different from everyone at their school, online communities are the first place they feel understood.',
  'It makes us lonelier in some ways and less lonely in others. Group chats help me make plans and feel included. But when I see a story of my friends hanging out without me, it hurts more than if I never knew. Social media makes both connection and exclusion more visible.',
  'I believe social media is making teenagers lonelier because likes and followers have replaced real conversations. We are always connected but rarely present. A notification gives you a small hit of attention, but it is not the same as someone actually listening to you.',
  'My answer is that social media is a tool, like a hammer. You can build something with it or you can hurt yourself. I use it to share my art, and I have met people who encourage me. But I also know people who feel worse every time they open the app.',
  'Social media makes us lonelier because it trains us to perform instead of share. People post what looks good, not what is real. If everyone is pretending, then nobody really knows each other, and that is a lonely way to live.'
];

const DEMO_STUDENTS_A = [
  ['Test', 'Student', 'TEST-0001'], ['Ava', 'Bergeron'], ['Liam', 'Chowdhury'], ['Sofia', 'Delgado'], ['Noah', 'Eagle Speaker'],
  ['Maya', 'Fong'], ['Ethan', 'Gauthier'], ['Zara', 'Hussain'], ['Owen', 'Kowalczyk'], ['Chloe', 'Larsen'],
  ['Arjun', 'Mehta'], ['Hannah', 'Nguyen'], ['Lucas', 'Okafor'], ['Ella', 'Petrov'], ['Mateo', 'Reyes']
];
const DEMO_STUDENTS_B = [
  ['Grace', 'Sandhu'], ['Jacob', 'Thibodeau'], ['Amira', 'Wolde'], ['Caleb', 'Yellowhorn'], ['Isla', 'MacKenzie'],
  ['Kai', 'Tanaka'], ['Nora', 'Lindqvist'], ['Ryan', 'Castillo']
];

function essayHtml_(e, paraCount, partialFrac) {
  let html = '<h1>' + e.title + '</h1>';
  for (let i = 0; i < paraCount && i < e.paras.length; i++) {
    let text = e.paras[i];
    if (i === paraCount - 1 && partialFrac && partialFrac < 1) {
      const words = text.split(' ');
      text = words.slice(0, Math.max(3, Math.round(words.length * partialFrac))).join(' ');
    }
    html += '<p class="fi">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
  }
  return html;
}

function countWords_(html) {
  const text = String(html).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<');
  const m = text.match(/[A-Za-z0-9À-ɏ'’-]+/g) || [];
  return m.filter(function (w) { return /[A-Za-z0-9À-ɏ]/.test(w); }).length;
}
function countChars_(html) {
  return String(html).replace(/<\/(p|h1|h2|li|blockquote)>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').length;
}

function demoSeed_() {
  const now = Date.now();
  const weekdayPeriods = function (s, e, fs, fe) {
    return [1, 2, 3, 4].map(function (d) { return { d: d, s: s, e: e }; }).concat([{ d: 5, s: fs, e: fe }]);
  };
  const clsA = { id: newId_('c'), name: 'English 10-1 · Block A (Demo)', schedule: weekdayPeriods('09:00', '10:28', '09:00', '09:58'), demo: true, created: now };
  const clsB = { id: newId_('c'), name: 'English 20-1 · Block C (Demo)', schedule: weekdayPeriods('12:45', '14:13', '11:05', '12:00'), demo: true, created: now + 1 };
  upsert_('classes', clsA);
  upsert_('classes', clsB);

  const taken = takenCodes_();
  const mk = function (cls, list) {
    return list.map(function (n, i) {
      const code = n[2] || genCode_(taken);
      taken[normCode_(code)] = 1;
      return { id: newId_('s'), classId: cls.id, first: n[0], last: n[1], code: code, accom: (n[0] === 'Owen' ? { extended: true } : {}), active: true, created: now + i };
    });
  };
  const studentsA = mk(clsA, DEMO_STUDENTS_A);
  const studentsB = mk(clsB, DEMO_STUDENTS_B);
  const ssh = sheet_('students');
  const allS = studentsA.concat(studentsB);
  ssh.getRange(Math.max(ssh.getLastRow(), 1) + 1, 1, allS.length, SHEETS.students.length).setValues(allS.map(function (s) { return objToRow_('students', s); }));
  clearTableCache_('students');

  const today = localParts_(now).date;
  const a1 = {
    id: newId_('a'), classIds: [clsA.id], title: 'Personal Narrative: A Moment That Changed Me',
    prompt: '<p>Write a personal narrative about a specific moment or experience that changed the way you see yourself, another person, or the world.</p>' +
      '<p><b>Your narrative should:</b></p><ul><li>Focus on <i>one</i> moment, not your whole life story</li><li>Use vivid sensory details and dialogue where it fits</li><li>Show (don\'t just tell) how you changed</li><li>End with a reflection on why this moment still matters</li></ul>' +
      '<p>Give your piece a title. Aim for 500–800 words.</p>',
    settings: { openMode: 'always', startDate: '', endDate: '', graceMin: 0, minWords: 500, maxWords: 800, showGoal: true, allowSelfPaste: true, lockOnReentry: true },
    override: '', created: now, updated: now, archived: false
  };
  const a2 = {
    id: newId_('a'), classIds: [clsA.id, clsB.id], title: 'Literary Response: Conflict in "The Lottery"',
    prompt: '<p>In a well-organized literary response, explain how Shirley Jackson uses <b>conflict</b> to develop a theme in "The Lottery."</p>' +
      '<p>Support your thesis with at least <b>three</b> pieces of textual evidence, and explain how each one connects to your theme.</p>',
    settings: { openMode: 'class', startDate: today, endDate: '', graceMin: 0, minWords: 400, maxWords: 0, showGoal: true, allowSelfPaste: true, lockOnReentry: true },
    override: '', created: now - 1000, updated: now, archived: false
  };
  const a3 = {
    id: newId_('a'), classIds: [clsA.id], title: 'Quickwrite: Is Social Media Making Us Lonelier?',
    prompt: '<p>Take a position: is social media making teenagers lonelier? Explain your thinking in one strong paragraph.</p>',
    settings: { openMode: 'class', startDate: addDays_(today, -7), endDate: addDays_(today, -1), graceMin: 0, minWords: 100, maxWords: 250, showGoal: true, allowSelfPaste: true, lockOnReentry: true },
    override: '', created: now - 7 * 86400000, updated: now, archived: false
  };
  [a1, a2, a3].forEach(function (a) { upsert_('assignments', a); });

  // ── Work for the live narrative (a1): a class in progress ──
  const plan = [
    // [studentIndex, essayIndex, paras, frac, state]
    [1, 0, 3, 0.6, 'writing'], [2, 1, 2, 0.4, 'writing'], [3, 2, 4, 0.7, 'locked'], [4, 3, 2, 0.9, 'writing'],
    [5, 4, 5, 1, 'submitted'], [6, 0, 1, 0.8, 'idle'], [7, 1, 3, 0.2, 'writing'], [8, 2, 1, 0.5, 'locked2'],
    [9, 3, 4, 0.5, 'writing'], [10, 4, 2, 0.3, 'writing'], [11, 1, 5, 1, 'submitted']
    // 12, 13, 14 not started; 0 (Test Student) untouched
  ];
  const wsh = sheet_('work');
  const dsh = sheet_('docs');
  const workRows = [];
  const docRows = [];
  const revRows = [];
  const evRows = [];
  let row = Math.max(wsh.getLastRow(), dsh.getLastRow(), 1) + 1;
  const startT = now - 38 * 60000;
  plan.forEach(function (pl) {
    const s = studentsA[pl[0]];
    const e = DEMO_ESSAYS[pl[1]];
    const html = essayHtml_(e, pl[2], pl[3]);
    const words = countWords_(html);
    const key = workKey_(a1.id, s.id);
    const started = startT + Math.floor(Math.random() * 4 * 60000);
    const state = pl[4];
    const lastSave = state === 'idle' ? now - 4 * 60000 : now - Math.floor(Math.random() * 25000);
    const w = {
      key: key, aid: a1.id, sid: s.id, status: state === 'submitted' ? 'submitted' : 'draft', words: words, chars: countChars_(html),
      startedAt: started, lastSaveAt: lastSave, submittedAt: state === 'submitted' ? now - 3 * 60000 : 0,
      keystrokes: Math.round(countChars_(html) * (1.15 + Math.random() * 0.3)), deletions: Math.round(words * (0.6 + Math.random())),
      activeSec: Math.round((lastSave - started) / 1000 * (0.75 + Math.random() * 0.2)), pasteBlocked: pl[0] === 8 ? 2 : 0,
      rev: 40 + Math.floor(Math.random() * 200), sessionId: 'demo-' + s.id, lastRevAt: lastSave, cleanExit: state === 'submitted',
      insertBlocked: 0, updated: lastSave, locked: state === 'locked' || state === 'locked2',
      lockReason: state === 'locked' ? 'Switched tabs or minimized the window' : (state === 'locked2' ? 'Exited full screen' : ''),
      lockedAt: state.indexOf('locked') === 0 ? now - Math.floor(30000 + Math.random() * 60000) : 0,
      lockCount: state.indexOf('locked') === 0 ? (pl[0] === 8 ? 2 : 1) : 0, unlockedAt: 0, lockSession: ''
    };
    workRows.push(objToRow_('work', w));
    docRows.push(objToRow_('docs', { key: key, rev: w.rev, updated: lastSave, c1: html, c2: '', c3: '', c4: '', c5: '' }));
    // Revisions: roughly every 2.5 minutes from start to now, growing the essay.
    const totalParas = pl[2];
    const steps = Math.max(2, Math.round((lastSave - started) / 150000));
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      const units = f * (totalParas - 1 + pl[3]);
      const pc = Math.floor(units) + 1;
      const pf = units - Math.floor(units);
      const h = essayHtml_(e, Math.min(pc, totalParas), pc >= totalParas ? pl[3] : Math.max(0.1, pf));
      const t = started + Math.round((lastSave - started) * f);
      revRows.push([enc_(key), t, countWords_(h), countChars_(h), enc_(h), '', '']);
    }
    evRows.push([started, enc_(key), enc_(a1.id), enc_(s.id), enc_('start'), enc_('Started writing')]);
    if (pl[0] === 8) {
      evRows.push([started + 9 * 60000, enc_(key), enc_(a1.id), enc_(s.id), enc_('paste'), enc_('Tried to paste from outside the assignment (2 times)')]);
      evRows.push([started + 14 * 60000, enc_(key), enc_(a1.id), enc_(s.id), enc_('locked'), enc_('Switched tabs or minimized the window')]);
      evRows.push([started + 16 * 60000, enc_(key), enc_(a1.id), enc_(s.id), enc_('unlocked'), enc_('Cleared by teacher')]);
    }
    if (pl[0] === 7) evRows.push([started + 20 * 60000, enc_(key), enc_(a1.id), enc_(s.id), enc_('burst'), enc_('+74 words in 21 seconds')]);
    if (w.locked) evRows.push([w.lockedAt, enc_(key), enc_(a1.id), enc_(s.id), enc_('locked'), enc_(w.lockReason)]);
    if (state === 'submitted') evRows.push([w.submittedAt, enc_(key), enc_(a1.id), enc_(s.id), enc_('submit'), enc_('Submitted (' + words + ' words)')]);
    if (state !== 'submitted') heartbeat_(key, state !== 'locked' && state !== 'locked2');
  });

  // ── Finished quickwrite (a3): everyone except two submitted ──
  studentsA.slice(1).forEach(function (s, i) {
    if (i === 6 || i === 12) return;
    const text = DEMO_QUICKWRITES[i % DEMO_QUICKWRITES.length];
    const html = '<p class="fi">' + text + '</p>';
    const key = workKey_(a3.id, s.id);
    const t = now - 2 * 86400000 + i * 60000;
    const words = countWords_(html);
    const w = {
      key: key, aid: a3.id, sid: s.id, status: i === 9 ? 'draft' : 'submitted', words: words, chars: countChars_(html), startedAt: t - 15 * 60000,
      lastSaveAt: t, submittedAt: i === 9 ? 0 : t, keystrokes: Math.round(countChars_(html) * 1.2), deletions: Math.round(words * 0.8),
      activeSec: 600 + i * 20, pasteBlocked: 0, rev: 30, sessionId: 'demo-' + s.id, lastRevAt: t, cleanExit: true, insertBlocked: 0, updated: t,
      locked: false, lockReason: '', lockedAt: 0, lockCount: 0, unlockedAt: 0, lockSession: ''
    };
    workRows.push(objToRow_('work', w));
    docRows.push(objToRow_('docs', { key: key, rev: 30, updated: t, c1: html, c2: '', c3: '', c4: '', c5: '' }));
    revRows.push([enc_(key), t, words, countChars_(html), enc_(html), '', '']);
    evRows.push([t, enc_(key), enc_(a3.id), enc_(s.id), enc_(i === 9 ? 'exit' : 'submit'), enc_(i === 9 ? 'Class ended before submitting' : 'Submitted (' + words + ' words)')]);
  });

  withLock_(function () {
    if (workRows.length) {
      wsh.getRange(row, 1, workRows.length, WCOLS).setValues(workRows);
      dsh.getRange(row, 1, docRows.length, SHEETS.docs.length).setValues(docRows);
    }
  });
  workRows.forEach(function (r, i) { cache_().put('wr:' + dec_(r[0]), String(row + i), 21600); });
  if (revRows.length) {
    const rsh = sheet_('revisions');
    rsh.getRange(Math.max(rsh.getLastRow(), 1) + 1, 1, revRows.length, SHEETS.revisions.length).setValues(revRows);
  }
  if (evRows.length) {
    evRows.sort(function (x, y) { return x[0] - y[0]; });
    const esh = sheet_('events');
    esh.getRange(Math.max(esh.getLastRow(), 1) + 1, 1, evRows.length, SHEETS.events.length).setValues(evRows);
  }
  clearTableCache_();
}

/**
 * Advances the fake students in demo classes a little, so the live dashboard moves.
 * Called by the teacher dashboard every few seconds while "Simulate class" is on.
 */
function tDemoTick(p) {
  teacher_(p);
  const a = findById_('assignments', p.aid);
  if (!a) throw err_('Assignment not found.');
  const demoClassIds = readTable_('classes').filter(function (c) { return c.demo && (a.classIds || []).indexOf(c.id) >= 0; }).map(function (c) { return c.id; });
  if (!demoClassIds.length) return { ticked: 0 };
  const students = readTable_('students').filter(function (s) { return demoClassIds.indexOf(s.classId) >= 0 && s.code !== 'TEST-0001'; });
  const work = readAllWork_(a.id);
  const now = Date.now();
  let ticked = 0;
  let budget = 6; // keep each tick fast: only a few students change per tick
  const order = students.map(function (s, i) { return { s: s, i: i, r: Math.random() }; }).sort(function (x, y) { return x.r - y.r; });
  order.forEach(function (o) {
    const s = o.s, idx = o.i;
    if (budget <= 0) { const w0 = work[s.id]; if (w0 && w0.status !== 'submitted') heartbeat_(workKey_(a.id, s.id), !w0.locked); return; }
    budget--;
    const key = workKey_(a.id, s.id);
    const w = work[s.id];
    const essay = DEMO_ESSAYS[idx % DEMO_ESSAYS.length];
    if (!w) {
      if (Math.random() < 0.12) {
        const row = createWork_(a.id, s.id);
        const nw = readWork_(row);
        nw.sessionId = 'demo-' + s.id; nw.cleanExit = false; nw.startedAt = now;
        const html = '<h1>' + essay.title + '</h1>';
        writeDoc_(row, key, 1, html); nw.rev = 1; nw.words = countWords_(html); nw.chars = countChars_(html); nw.lastSaveAt = now;
        writeMain_(row, nw);
        logEvent_(a.id, s.id, 'start', 'Started writing');
        heartbeat_(key, true);
        ticked++;
      }
      return;
    }
    if (w.status === 'submitted') return;
    if (w.locked) { heartbeat_(key, false); return; }
    heartbeat_(key, true);
    if (Math.random() < 0.25) return; // thinking / idle this tick
    const row = w._row;
    if (Math.random() < 0.025) {
      const reasons = ['Switched tabs or minimized the window', 'Exited full screen', 'Clicked or switched outside the assignment window'];
      lockWork_(row, w, reasons[Math.floor(Math.random() * reasons.length)], w.sessionId);
      ticked++;
      return;
    }
    // Grow the essay by a handful of words.
    const fullHtml = essayHtml_(essay, essay.paras.length, 1);
    const fullWords = countWords_(fullHtml);
    const target = Math.min(fullWords, w.words + 6 + Math.floor(Math.random() * 14));
    if (w.words >= fullWords) {
      if (Math.random() < 0.3) {
        w.status = 'submitted'; w.submittedAt = now; w.cleanExit = true;
        writeMain_(row, w);
        logEvent_(a.id, s.id, 'submit', 'Submitted (' + w.words + ' words)');
        ticked++;
      }
      return;
    }
    // Find the paragraph/fraction that gives ~target words.
    let html = '<h1>' + essay.title + '</h1>';
    let remaining = target - countWords_(html);
    for (let i = 0; i < essay.paras.length && remaining > 0; i++) {
      const ws = essay.paras[i].split(' ');
      const take = ws.slice(0, Math.min(ws.length, remaining));
      remaining -= take.length;
      html += '<p class="fi">' + take.join(' ').replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';
    }
    const newWords = countWords_(html);
    const dc = countChars_(html) - w.chars;
    w.rev = w.rev + 1;
    writeDoc_(row, key, w.rev, html);
    w.words = newWords; w.chars = countChars_(html); w.lastSaveAt = now;
    w.keystrokes += Math.max(0, Math.round(dc * 1.25)); w.deletions += Math.floor(Math.random() * 4); w.activeSec += 5;
    if (Math.random() < 0.02) { w.pasteBlocked += 1; logEvent_(a.id, s.id, 'paste', 'Tried to paste text from outside the assignment'); }
    if (now - (w.lastRevAt || 0) > 60000) { addRevision_(key, w.words, w.chars, html); w.lastRevAt = now; }
    writeMain_(row, w);
    ticked++;
  });
  return { ticked: ticked };
}
