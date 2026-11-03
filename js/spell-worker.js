/* Inkwell — spell check worker (Canadian English Hunspell dictionary via Typo.js). */
/* global Typo, importScripts */
importScripts('../vendor/typo.js?v=1');
let dict = null;
const ready = Promise.all([
  fetch('../vendor/dict/en_CA.aff?v=1').then(function (r) { return r.text(); }),
  fetch('../vendor/dict/en_CA.dic?v=1').then(function (r) { return r.text(); })
]).then(function (d) {
  dict = new Typo('en_CA', d[0], d[1]);
  self.postMessage({ type: 'ready' });
}).catch(function (e) { self.postMessage({ type: 'error', error: String(e) }); });

const cache = new Map();
function ok(w) {
  if (cache.has(w)) return cache.get(w);
  let r = dict.check(w);
  if (!r && /[A-Z]/.test(w[0]) && w.toUpperCase() !== w) r = dict.check(w.toLowerCase()) || false;
  if (!r && w.toUpperCase() === w && w.length > 1) r = true; // acronyms like NASA, CBC
  if (!r && /'s$/.test(w)) r = dict.check(w.slice(0, -2));
  cache.set(w, r);
  return r;
}

// Damerau–Levenshtein distance (optimal string alignment)
function dl(a, b) {
  const d = [];
  for (let i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}

self.onmessage = function (e) {
  const m = e.data;
  ready.then(function () {
    if (!dict) return;
    if (m.type === 'check') {
      self.postMessage({ type: 'check', id: m.id, bad: m.words.filter(function (w) { return !ok(w); }) });
    } else if (m.type === 'suggest') {
      let list = [];
      try { list = dict.suggest(m.word, 8); } catch (x) { list = []; }
      const w = m.word.toLowerCase();
      const sorted = function (x) { return x.split('').sort().join(''); };
      list = list.map(function (sg, i) { return { s: sg, d: dl(w, sg.toLowerCase()) - (sorted(w) === sorted(sg.toLowerCase()) ? 0.5 : 0) + i * 0.01 }; })
        .sort(function (a, b) { return a.d - b.d; }).map(function (x) { return x.s; });
      if (/^[A-Z]/.test(m.word)) list = list.map(function (s) { return s.charAt(0).toUpperCase() + s.slice(1); });
      list = list.filter(function (s, i) { return list.indexOf(s) === i; });
      self.postMessage({ type: 'suggest', id: m.id, list: list.slice(0, 6) });
    }
  });
};
