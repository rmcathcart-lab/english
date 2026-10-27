/* Inkwell — shared helpers: API, sanitizing, word counts, UI bits. */
(function () {
  const Ink = (window.Ink = {});

  /* ── API ── */
  Ink.apiUrl = function () {
    try {
      const q = new URLSearchParams(location.search).get('api');
      if (q && /^https:\/\/script\.google(usercontent)?\.com\//.test(q)) localStorage.setItem('inkwell_api', q);
    } catch (e) { /* ignore */ }
    let stored = '';
    try { stored = localStorage.getItem('inkwell_api') || ''; } catch (e) { /* ignore */ }
    return (window.INKWELL_CONFIG && window.INKWELL_CONFIG.apiUrl) || stored;
  };

  Ink.call = async function (action, data, opts) {
    opts = opts || {};
    const url = Ink.apiUrl();
    if (!url) throw Object.assign(new Error('This site has not been connected to its Google backend yet.'), { code: 'CONFIG' });
    const body = JSON.stringify(Object.assign({ action }, data || {}));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 30000);
    let res;
    try {
      res = await fetch(url, {
        method: 'POST', body, redirect: 'follow', keepalive: !!opts.keepalive && body.length < 60000,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: ctrl.signal
      });
    } catch (e) {
      throw Object.assign(new Error('Could not reach the server. Check your internet connection.'), { code: 'NET' });
    } finally { clearTimeout(timer); }
    let j;
    try { j = await res.json(); } catch (e) { throw Object.assign(new Error('The server sent an unexpected reply.'), { code: 'NET' }); }
    if (!j.ok) throw Object.assign(new Error(j.error || 'Something went wrong.'), { code: j.code || '' });
    return j;
  };

  // Fire-and-forget (used while the page is closing).
  Ink.beacon = function (action, data) {
    const url = Ink.apiUrl();
    if (!url) return false;
    const body = JSON.stringify(Object.assign({ action }, data || {}));
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=utf-8' }))) return true;
    } catch (e) { /* fall through */ }
    try { fetch(url, { method: 'POST', body, keepalive: body.length < 60000, headers: { 'Content-Type': 'text/plain;charset=utf-8' } }); } catch (e) { /* ignore */ }
    return true;
  };

  /* ── Storage ── */
  Ink.store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  /* ── Sanitizer: only the formatting the editor can make ── */
  const ALLOWED = { P: 1, BR: 1, H1: 1, H2: 1, H3: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, OL: 1, UL: 1, LI: 1, BLOCKQUOTE: 1, DIV: 1 };
  const DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, LINK: 1, META: 1, SVG: 1, MATH: 1, TEMPLATE: 1, NOSCRIPT: 1, IMG: 1, VIDEO: 1, AUDIO: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1 };
  function cleanNode(node) {
    Array.from(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) return;
      if (ch.nodeType !== 1) { ch.remove(); return; }
      const tag = ch.tagName.toUpperCase();
      if (DROP[tag]) { ch.remove(); return; }
      cleanNode(ch);
      if (!ALLOWED[tag]) {
        while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
        ch.remove();
        return;
      }
      const align = (ch.style && ch.style.textAlign) || '';
      const fi = ch.classList && ch.classList.contains('fi');
      Array.from(ch.attributes).forEach(function (a) { ch.removeAttribute(a.name); });
      if (/^(left|center|right|justify)$/.test(align) && align !== 'left') ch.setAttribute('style', 'text-align: ' + align + ';');
      if (fi) ch.setAttribute('class', 'fi');
    });
  }
  Ink.sanitize = function (html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body><div id="r">' + (html || '') + '</div>', 'text/html');
    const root = doc.getElementById('r');
    if (!root) return '';
    cleanNode(root);
    return root.innerHTML;
  };

  /* ── Counting ── */
  Ink.textOf = function (el) {
    return (el.innerText || el.textContent || '').replace(/ /g, ' ');
  };
  Ink.countWords = function (text) {
    const m = String(text).match(/[A-Za-z0-9À-ɏЀ-ӿ'’-]+/g) || [];
    return m.filter(function (w) { return /[A-Za-z0-9À-ɏЀ-ӿ]/.test(w); }).length;
  };
  Ink.countChars = function (text) { return String(text).replace(/\n/g, '').length; };
  Ink.countCharsNoSpaces = function (text) { return String(text).replace(/\s/g, '').length; };
  Ink.htmlWords = function (html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    return Ink.countWords(d.textContent || '');
  };

  /* ── Formatting ── */
  Ink.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  };
  Ink.fmtTime = function (ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };
  Ink.fmtTimeSec = function (ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  };
  Ink.fmtDateTime = function (ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const tm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (sameDay) return 'today at ' + tm;
    const tmr = new Date(today.getTime() + 86400000);
    if (d.toDateString() === tmr.toDateString()) return 'tomorrow at ' + tm;
    const yst = new Date(today.getTime() - 86400000);
    if (d.toDateString() === yst.toDateString()) return 'yesterday at ' + tm;
    return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ' at ' + tm;
  };
  Ink.ago = function (ms, now) {
    if (!ms) return 'never';
    const s = Math.max(0, Math.round(((now || Date.now()) - ms) / 1000));
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  };
  Ink.dur = function (sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm' + (m < 10 && s ? ' ' + s + 's' : '');
    return s + 's';
  };
  Ink.countdown = function (ms) {
    ms = Math.max(0, ms);
    const t = Math.floor(ms / 1000);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  };
  Ink.goalText = function (words, goal) {
    if (!goal || (!goal.min && !goal.max)) return '';
    if (goal.min && goal.max) return goal.min + '–' + goal.max + ' words';
    if (goal.min) return 'at least ' + goal.min + ' words';
    return 'up to ' + goal.max + ' words';
  };
  Ink.goalPct = function (words, goal) {
    if (!goal) return 0;
    const target = goal.min || goal.max;
    if (!target) return 0;
    return Math.min(100, Math.round((words / target) * 100));
  };

  /* ── Toasts & modals ── */
  Ink.toast = function (msg, kind, ms) {
    let box = document.getElementById('toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, ms || 3200);
  };

  Ink.modal = function (opts) {
    return new Promise(function (resolve) {
      const back = document.createElement('div');
      back.className = 'modal-back';
      back.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><h3></h3><div class="m-body"></div><div class="actions"></div></div>';
      back.querySelector('h3').textContent = opts.title || '';
      const body = back.querySelector('.m-body');
      if (opts.html) body.innerHTML = opts.html; else body.textContent = opts.text || '';
      const actions = back.querySelector('.actions');
      const close = function (v) { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
      (opts.buttons || [{ label: 'OK', value: true, cls: 'primary' }]).forEach(function (b) {
        const btn = document.createElement('button');
        btn.className = 'btn ' + (b.cls || '');
        btn.textContent = b.label;
        btn.onclick = function () {
          if (b.collect) { const v = b.collect(body); if (v === false) return; close(v); } else close(b.value);
        };
        actions.appendChild(btn);
      });
      const onKey = function (e) { if (e.key === 'Escape' && opts.dismissable !== false) { e.preventDefault(); close(null); } };
      document.addEventListener('keydown', onKey, true);
      back.addEventListener('mousedown', function (e) { if (e.target === back && opts.dismissable !== false) close(null); });
      (opts.container || document.body).appendChild(back);
      const first = body.querySelector('input, textarea, select');
      if (first) setTimeout(function () { first.focus(); }, 30);
      if (opts.onOpen) opts.onOpen(body);
    });
  };
  Ink.confirm = function (title, text, okLabel, danger, container) {
    return Ink.modal({ title: title, text: text, container: container, buttons: [{ label: 'Cancel', value: false }, { label: okLabel || 'OK', value: true, cls: danger ? 'primary' : 'teal' }] });
  };

  /* ── Icons ── */
  const P = {
    mark: '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="2" y="2" width="36" height="36" rx="10" fill="#8a2c37"/><path d="M13 29c3-1 5-4 7-8l5-10c.6-1.3 2.4-.9 2.4.5 0 4-2.7 9.6-6.4 13.3-2.1 2.1-4.6 3.5-8 4.2Z" fill="#fff"/><path d="M12 31h16" stroke="#f3d7a7" stroke-width="2.2" stroke-linecap="round"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bellOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.7 21a2 2 0 0 1-3.4 0M18.6 13A17.9 17.9 0 0 1 18 8M6.3 6.3A5.9 5.9 0 0 0 6 8c0 7-3 9-3 9h14M18 8a6 6 0 0 0-9.3-5M1 1l22 22"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8Z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'
  };
  Ink.icon = function (name) { return P[name] || ''; };

  Ink.uuid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2);
  };
})();
