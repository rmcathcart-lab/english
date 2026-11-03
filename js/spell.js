/* Inkwell — built-in spell check: wavy underlines (CSS highlights), click/right-click for suggestions. */
(function () {
  const T = Ink.Text;

  /**
   * Ink.Spell.attach(el, opts) → controller
   * opts: { userKey, onReplace(range, text), onLookup(word, range), isEditable() }
   */
  function attach(el, opts) {
    opts = opts || {};
    let worker = null, ready = false, failed = false, seq = 0, on = true;
    const known = new Map(); // normalized word → true (ok) / false (bad)
    const pending = new Map();
    const userKey = 'inkwell_words_' + (opts.userKey || 'anon');
    const userWords = new Set(Ink.store.get(userKey) || []);
    const ignored = new Set();
    let lastInputAt = 0;
    let bad = []; // current misspellings [{w,start,end}]
    let pop = null;

    try {
      worker = new Worker('js/spell-worker.js?v=2');
      worker.onmessage = function (e) {
        const m = e.data;
        if (m.type === 'ready') { ready = true; run(); }
        else if (m.type === 'error') { failed = true; if (opts.onStatus) opts.onStatus('unavailable'); }
        else { const cb = pending.get(m.id); pending.delete(m.id); if (cb) cb(m); }
      };
      worker.onerror = function () { failed = true; if (opts.onStatus) opts.onStatus('unavailable'); };
    } catch (e) { failed = true; }

    function ask(msg) {
      return new Promise(function (res) { const id = ++seq; pending.set(id, res); worker.postMessage(Object.assign({ id: id }, msg)); });
    }
    const norm = function (w) { return w.replace(/’/g, "'"); };

    async function run() {
      if (!on || !ready || failed) { paint(); return; }
      const m = T.model(el);
      const ws = T.words(m);
      const unknown = [];
      ws.forEach(function (x) { const n = norm(x.w); if (!known.has(n) && unknown.indexOf(n) < 0) unknown.push(n); });
      if (unknown.length) {
        const r = await ask({ type: 'check', words: unknown });
        const badSet = new Set(r.bad);
        unknown.forEach(function (n) { known.set(n, !badSet.has(n)); });
      }
      // Don't flag the word being typed right now.
      const sel = T.selection(m);
      const typing = Date.now() - lastInputAt < 1500 && sel && sel.collapsed ? sel.start : -1;
      bad = ws.filter(function (x) {
        const n = norm(x.w);
        if (known.get(n) !== false) return false;
        if (userWords.has(n.toLowerCase()) || ignored.has(n)) return false;
        if (typing >= x.start && typing <= x.end) return false;
        return true;
      });
      paint(m);
      if (opts.onStatus) opts.onStatus(bad.length);
    }
    const schedule = Ink.debounce(run, 450);

    function paint(m) {
      if (!on) { T.clear('ink-spell'); return; }
      m = m || T.model(el);
      T.paint('ink-spell', bad.map(function (x) { return T.rangeOf(m, x.start, x.end); }));
    }

    el.addEventListener('input', function () { lastInputAt = Date.now(); closePop(); schedule(); });
    el.addEventListener('keyup', function (e) { if (e.key === ' ' || e.key === 'Enter' || /^[.,;:!?)]$/.test(e.key)) schedule(); });
    el.addEventListener('blur', function () { setTimeout(run, 100); });

    function badAt(i) { return bad.filter(function (x) { return i >= x.start && i <= x.end; })[0]; }

    el.addEventListener('click', function (e) {
      if (!on) return;
      const m = T.model(el);
      const i = T.indexAtPoint(m, e.clientX, e.clientY);
      const b = i >= 0 ? badAt(i) : null;
      if (b) openPop(b, m, e);
      else closePop();
    });
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault(); // our own menu (also keeps "Paste" out of reach)
      const m = T.model(el);
      const i = T.indexAtPoint(m, e.clientX, e.clientY);
      if (i < 0) return;
      const b = on ? badAt(i) : null;
      const w = b || T.wordAt(m, i);
      if (w) openPop(w, m, e, !b);
    });

    function closePop() { if (pop) { pop.remove(); pop = null; } }
    document.addEventListener('mousedown', function (e) { if (pop && !pop.contains(e.target)) closePop(); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePop(); });

    async function openPop(word, m, e, lookupOnly) {
      closePop();
      const range = T.rangeOf(m, word.start, word.end);
      if (!range) return;
      const rect = range.getBoundingClientRect();
      pop = document.createElement('div');
      pop.className = 'word-pop';
      pop.innerHTML = (lookupOnly ? '' : '<div class="wp-head">Not in the dictionary</div><div class="wp-sugg"><span class="muted small"><span class="spin sm"></span> Finding suggestions…</span></div>') +
        '<div class="wp-actions"></div>';
      const acts = pop.querySelector('.wp-actions');
      const add = function (icon, label, fn) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wp-btn'; b.innerHTML = Ink.bi(icon, label);
        b.onmousedown = function (ev) { ev.preventDefault(); };
        b.onclick = function () { closePop(); fn(); };
        acts.appendChild(b);
      };
      if (opts.onLookup && opts.lookupEnabled !== false) add('book', 'Look up “' + Ink.esc(word.w) + '”', function () { opts.onLookup(word.w, T.rangeOf(T.model(el), word.start, word.end)); });
      if (!lookupOnly) {
        add('check', 'Ignore', function () { ignored.add(norm(word.w)); run(); });
        add('plus', 'Add to my dictionary', function () { userWords.add(norm(word.w).toLowerCase()); Ink.store.set(userKey, Array.from(userWords)); run(); });
      }
      if (!acts.children.length) return;
      document.body.appendChild(pop);
      const pw = pop.offsetWidth;
      pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, rect.left)) + 'px';
      pop.style.top = (rect.bottom + 6 + pop.offsetHeight > window.innerHeight ? rect.top - pop.offsetHeight - 6 : rect.bottom + 6) + 'px';
      if (lookupOnly) return;
      const mine = pop;
      const r = await ask({ type: 'suggest', word: norm(word.w) });
      if (pop !== mine) return;
      const box = pop.querySelector('.wp-sugg');
      box.innerHTML = '';
      if (!r.list.length) { box.innerHTML = '<span class="muted small">No suggestions</span>'; return; }
      r.list.forEach(function (s) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wp-s'; b.textContent = s;
        b.onmousedown = function (ev) { ev.preventDefault(); };
        b.onclick = function () {
          closePop();
          const mm = T.model(el);
          // the text may have shifted: find this word again near where it was
          const loc = T.locate(mm, { quote: word.w, prefix: m.text.slice(Math.max(0, word.start - 32), word.start), suffix: m.text.slice(word.end, word.end + 32), offset: word.start });
          if (!loc) return;
          const rg = T.rangeOf(mm, loc.start, loc.end);
          if (rg && opts.onReplace) opts.onReplace(rg, s);
          schedule();
        };
        box.appendChild(b);
      });
    }

    function next() {
      if (!bad.length) return false;
      const m = T.model(el);
      const sel = T.selection(m);
      const from = sel ? sel.end : 0;
      const b = bad.filter(function (x) { return x.start >= from; })[0] || bad[0];
      const r = T.rangeOf(m, b.start, b.end);
      if (!r) return false;
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      const n = r.startContainer.parentElement;
      if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setTimeout(function () {
        const rect = r.getBoundingClientRect();
        openPop(b, m, { clientX: rect.left, clientY: rect.top });
      }, 250);
      return true;
    }

    return {
      refresh: run,
      count: function () { return bad.length; },
      next: next,
      setOn: function (v) { on = !!v; closePop(); run(); },
      isOn: function () { return on; },
      available: function () { return !failed; },
      close: closePop
    };
  }

  window.Ink.Spell = { attach: attach };
})();
