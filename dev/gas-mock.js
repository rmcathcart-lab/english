// Minimal in-memory stand-ins for the Apps Script services Code.gs uses.
// Lets us run the backend locally (tests + a local dev server). Not deployed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeSheet(name) {
  const data = []; // array of rows (arrays)
  const sh = {
    name,
    data,
    getName: () => name,
    getLastRow: () => {
      for (let i = data.length - 1; i >= 0; i--) if (data[i] && data[i].some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
      return 0;
    },
    getRange(a, b, c, d) {
      if (typeof a === 'string') { // 'A:A'
        return sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1);
      }
      const r0 = a, c0 = b, nr = c || 1, nc = d || 1;
      const range = {
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = data[r0 - 1 + i] || [];
            const o = [];
            for (let j = 0; j < nc; j++) { const v = row[c0 - 1 + j]; o.push(v === undefined || v === null ? '' : v); }
            out.push(o);
          }
          return out;
        },
        setValues(vals) {
          if (vals.length !== nr || vals[0].length !== nc) throw new Error(`setValues size mismatch on ${name}: range ${nr}x${nc} vs data ${vals.length}x${vals[0].length}`);
          for (let i = 0; i < nr; i++) {
            const ri = r0 - 1 + i;
            while (data.length <= ri) data.push([]);
            for (let j = 0; j < nc; j++) {
              let v = vals[i][j];
              if (typeof v === 'string' && v.length > 50000) throw new Error('Cell over 50000 chars');
              if (typeof v === 'string' && v[0] === '=') throw new Error('Formula injection: ' + v.slice(0, 20));
              data[ri][c0 - 1 + j] = v;
            }
          }
          return range;
        },
        setValue(v) { return range.setValues([[v]]); },
        setFontWeight() { return range; },
        createTextFinder(text) {
          let whole = false;
          const f = {
            matchEntireCell(x) { whole = x; return f; },
            findNext() {
              for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
                const row = data[r0 - 1 + i] || [];
                const v = String(row[c0 - 1 + j] === undefined ? '' : row[c0 - 1 + j]);
                if (whole ? v === text : v.indexOf(text) >= 0) return { getRow: () => r0 + i, getColumn: () => c0 + j };
              }
              return null;
            }
          };
          return f;
        }
      };
      return range;
    },
    appendRow(vals) { const r = sh.getLastRow() + 1; sh.getRange(r, 1, 1, vals.length).setValues([vals]); },
    deleteRow(r) { data.splice(r - 1, 1); },
    setFrozenRows() {}
  };
  return sh;
}

function makeSpreadsheet() {
  const sheets = [makeSheet('Sheet1')];
  let title = 'Untitled spreadsheet';
  return {
    sheets,
    getName: () => title,
    rename: n => { title = n; },
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = makeSheet(n); sheets.push(s); return s; },
    getSheets: () => sheets,
    deleteSheet: s => { sheets.splice(sheets.indexOf(s), 1); }
  };
}

function makeCache() {
  const m = new Map();
  const live = k => { const e = m.get(k); if (!e) return null; if (e.exp < Date.now()) { m.delete(k); return null; } return e.v; };
  return {
    _m: m,
    get: k => live(k),
    put: (k, v, ttl) => { if (String(v).length > 100000) throw new Error('Cache value too large'); m.set(k, { v: String(v), exp: Date.now() + (ttl || 600) * 1000 }); },
    remove: k => m.delete(k),
    removeAll: ks => ks.forEach(k => m.delete(k)),
    getAll: ks => { const o = {}; ks.forEach(k => { const v = live(k); if (v != null) o[k] = v; }); return o; }
  };
}

function formatDate(date, tz, pattern) {
  const parts = {};
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short', timeZoneName: 'longOffset' });
  fmt.formatToParts(date).forEach(p => { parts[p.type] = p.value; });
  const dowMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  let off = (parts.timeZoneName || 'GMT').replace('GMT', '');
  if (!off) off = '+00:00';
  const Z = off.replace(':', '');
  const hour = parts.hour === '24' ? '00' : parts.hour;
  // handle quoted literals '|'
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "'") { const j = pattern.indexOf("'", i + 1); out += pattern.slice(i + 1, j); i = j; continue; }
    if (pattern.startsWith('yyyy', i)) { out += parts.year; i += 3; continue; }
    if (pattern.startsWith('MM', i)) { out += parts.month; i += 1; continue; }
    if (pattern.startsWith('dd', i)) { out += parts.day; i += 1; continue; }
    if (pattern.startsWith('HH', i)) { out += hour; i += 1; continue; }
    if (pattern.startsWith('mm', i)) { out += parts.minute; i += 1; continue; }
    if (ch === 'u') { out += dowMap[parts.weekday]; continue; }
    if (ch === 'Z') { out += Z; continue; }
    out += ch;
  }
  return out;
}

function makeContext() {
  const ss = makeSpreadsheet();
  const cache = makeCache();
  const props = new Map();
  const toSigned = buf => Array.from(buf).map(b => (b > 127 ? b - 256 : b));
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)), deleteProperty: k => props.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; }, getContent() { return s; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      base64EncodeWebSafe: x => Buffer.from(typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x.map(b => b & 255))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toSigned(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: bytes => ({ getDataAsString: () => Buffer.from(bytes.map(b => b & 255)).toString('utf8') }),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', k).update(v).digest()),
      computeDigest: (alg, s) => toSigned(crypto.createHash('sha256').update(s, 'utf8').digest()),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      formatDate
    },
    Date, Math, JSON, Object, Array, String, Number, Error, RegExp, Buffer
  };
  vm.createContext(ctx);
  const code = fs.readFileSync(path.join(__dirname, '..', 'backend', 'Code.gs'), 'utf8');
  vm.runInContext(code, ctx, { filename: 'Code.gs' });
  ctx._ss = ss; ctx._cache = cache; ctx._props = props;
  ctx.call = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).getContent());
  return ctx;
}

module.exports = { makeContext };
