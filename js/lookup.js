/* Inkwell — dictionary + thesaurus panel.
   Definitions: Free Dictionary API (dictionaryapi.dev). Synonyms/antonyms: Datamuse. Both free, no key, CORS-enabled. */
(function () {
  const cache = new Map();

  async function getJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(function () { ctrl.abort(); }, 8000);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  function shape(word, dictJson, syn, ml, ant) {
    const w = word.toLowerCase();
    const out = { word: word, defs: [], syn: [], rel: [], ant: [], phonetic: '', error: false };
    if (Array.isArray(dictJson)) {
      const synSeen = new Set();
      dictJson.forEach(function (entry) {
        if (!out.phonetic && entry.phonetic) out.phonetic = entry.phonetic;
        (entry.meanings || []).forEach(function (mn) {
          let group = out.defs.find(function (g) { return g.pos === mn.partOfSpeech; });
          if (!group) { group = { pos: mn.partOfSpeech, items: [] }; out.defs.push(group); }
          (mn.definitions || []).slice(0, 4).forEach(function (d) {
            if (group.items.length < 4) group.items.push({ def: d.definition, ex: d.example || '' });
            (d.synonyms || []).forEach(function (x) { synSeen.add(x); });
            (d.antonyms || []).forEach(function (x) { if (out.ant.indexOf(x) < 0) out.ant.push(x); });
          });
          (mn.synonyms || []).forEach(function (x) { synSeen.add(x); });
          (mn.antonyms || []).forEach(function (x) { if (out.ant.indexOf(x) < 0) out.ant.push(x); });
        });
      });
      out.syn = Array.from(synSeen);
    }
    const ok = function (x) { return x && x.split(' ').length <= 2; };
    (syn || []).filter(ok).forEach(function (x) { if (out.syn.indexOf(x) < 0) out.syn.push(x); });
    const synSet = new Set(out.syn);
    out.rel = (ml || []).filter(ok).filter(function (x) { return !synSet.has(x) && x.toLowerCase() !== w; }).slice(0, 18);
    (ant || []).filter(ok).forEach(function (x) { if (out.ant.indexOf(x) < 0) out.ant.push(x); });
    out.syn = out.syn.filter(function (x) { return x.toLowerCase() !== w; }).slice(0, 30);
    out.ant = out.ant.slice(0, 14);
    return out;
  }

  const words = function (j) { return Array.isArray(j) ? j.map(function (x) { return x.word; }) : null; };

  /** proxy(word) → server copy { syn, ml, ant, dict } — used when the browser can't reach a service. */
  async function lookup(word, proxy) {
    const w = word.toLowerCase();
    if (cache.has(w)) return cache.get(w);
    const p = (async function () {
      const enc = encodeURIComponent(w);
      const r = await Promise.all([
        getJSON('https://api.dictionaryapi.dev/api/v2/entries/en/' + enc).then(function (j) { return j === null ? [] : j; }).catch(function () { return 'ERR'; }),
        getJSON('https://api.datamuse.com/words?rel_syn=' + enc + '&max=40').catch(function () { return 'ERR'; }),
        getJSON('https://api.datamuse.com/words?ml=' + enc + '&max=24').catch(function () { return 'ERR'; }),
        getJSON('https://api.datamuse.com/words?rel_ant=' + enc + '&max=16').catch(function () { return 'ERR'; })
      ]);
      let dict = r[0], syn = words(r[1]), ml = words(r[2]), ant = words(r[3]);
      if ((dict === 'ERR' || syn === null) && proxy) {
        try {
          const s = await proxy(word);
          if (dict === 'ERR' && s.dict) dict = s.dict;
          if (syn === null) { syn = s.syn; ml = s.ml; ant = s.ant; }
        } catch (e) { /* fall through with what we have */ }
      }
      if (dict === 'ERR' && syn === null) return { word: word, error: true };
      return shape(word, dict === 'ERR' ? null : dict, syn, ml, ant);
    })();
    cache.set(w, p);
    p.then(function (x) { if (x.error) cache.delete(w); }, function () { cache.delete(w); });
    return p;
  }

  function matchCase(src, word) {
    if (src === src.toUpperCase() && src.length > 1) return word.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return word.charAt(0).toUpperCase() + word.slice(1);
    return word;
  }

  /**
   * Ink.Lookup.panel(host, { onUse(word, range), onLookup() })
   * → { show(word, range), el }
   */
  function panel(host, opts) {
    opts = opts || {};
    host.innerHTML =
      '<form class="lk-form" autocomplete="off"><input class="input lk-input" placeholder="Look up a word" maxlength="40" spellcheck="false" aria-label="Word to look up"><button class="btn sm icon-only" type="submit" aria-label="Look up" title="Look up">' + Ink.icon('search') + '</button></form>' +
      '<div class="lk-body"><div class="muted small">Type a word, or right-click a word in your writing and choose <b>Look up</b>.</div></div>';
    const input = host.querySelector('.lk-input');
    const body = host.querySelector('.lk-body');
    let target = null; // { word, range }
    let tab = 'def';
    let current = null;

    host.querySelector('.lk-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const w = input.value.trim();
      if (w) show(w, null);
    });

    async function show(word, range) {
      word = String(word || '').trim().replace(/[^A-Za-zÀ-ɏ' -]/g, '').slice(0, 40);
      if (!word) return;
      input.value = word;
      target = range ? { word: word, range: range } : (target && target.word.toLowerCase() === word.toLowerCase() ? target : null);
      body.innerHTML = '<div class="muted small"><span class="spin sm"></span> Looking up “' + Ink.esc(word) + '”…</div>';
      if (opts.onLookup) opts.onLookup(word);
      let r;
      try { r = await lookup(word, opts.proxy); } catch (e) { r = { error: true }; }
      if (input.value.trim().toLowerCase() !== word.toLowerCase()) return;
      current = r;
      render();
    }

    function chip(s, canUse) {
      return '<button type="button" class="lk-chip" data-w="' + Ink.esc(s) + '"' + (canUse ? ' title="Use this word in your writing"' : ' title="Look this word up"') + '>' + Ink.esc(s) + '</button>';
    }

    function render() {
      const r = current;
      if (!r) return;
      if (r.error) { body.innerHTML = '<div class="lk-err">The dictionary couldn\'t be reached. Check the internet connection and try again.</div>'; return; }
      const canUse = !!(target && opts.onUse);
      let html = '<div class="lk-word"><b>' + Ink.esc(r.word) + '</b>' + (r.phonetic ? ' <span class="muted">' + Ink.esc(r.phonetic) + '</span>' : '') + '</div>' +
        '<div class="lk-tabs" role="tablist"><button type="button" data-tab="def" class="' + (tab === 'def' ? 'on' : '') + '">Dictionary</button><button type="button" data-tab="syn" class="' + (tab === 'syn' ? 'on' : '') + '">Thesaurus</button></div>';
      if (tab === 'def') {
        if (!r.defs.length) html += '<div class="muted small">No definition found. Check the spelling.</div>';
        r.defs.forEach(function (g) {
          html += '<div class="lk-pos">' + Ink.esc(g.pos) + '</div><ol class="lk-defs">' + g.items.map(function (d) {
            return '<li>' + Ink.esc(d.def) + (d.ex ? '<div class="lk-ex">“' + Ink.esc(d.ex) + '”</div>' : '') + '</li>';
          }).join('') + '</ol>';
        });
      } else {
        if (canUse) html += '<div class="muted small" style="margin-bottom:8px">Click a word to swap it in for “' + Ink.esc(target.word) + '”.</div>';
        html += '<div class="lk-pos">Synonyms</div><div class="lk-chips">' + (r.syn.length ? r.syn.map(function (s) { return chip(s, canUse); }).join('') : '<span class="muted small">None found</span>') + '</div>';
        if (r.rel.length) html += '<div class="lk-pos">Related</div><div class="lk-chips">' + r.rel.map(function (s) { return chip(s, canUse); }).join('') + '</div>';
        if (r.ant.length) html += '<div class="lk-pos">Antonyms</div><div class="lk-chips">' + r.ant.map(function (s) { return chip(s, canUse); }).join('') + '</div>';
      }
      body.innerHTML = html;
      body.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { tab = b.dataset.tab; render(); }; });
      body.querySelectorAll('.lk-chip').forEach(function (b) {
        b.onmousedown = function (e) { e.preventDefault(); };
        b.onclick = function () {
          const w = b.dataset.w;
          if (canUse && target && target.range && opts.onUse) {
            const word = matchCase(target.word, w);
            if (opts.onUse(word, target.range) !== false) { Ink.toast('Replaced “' + target.word + '” with “' + word + '”.', 'good', 2200); target = null; render(); }
          } else show(w, null);
        };
      });
    }

    return { show: show, el: host, focus: function () { input.focus(); } };
  }

  window.Ink.Lookup = { panel: panel, lookup: lookup };
})();
