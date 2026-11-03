/* Inkwell — accommodations: read aloud (speech synthesis) and speech-to-text (speech recognition). */
(function () {
  const T = Ink.Text;
  const synth = window.speechSynthesis || null;
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;

  /* ───────────── Read aloud ───────────── */
  function pickVoice() {
    if (!synth) return null;
    const vs = synth.getVoices().filter(function (v) { return /^en/i.test(v.lang); });
    const pref = ['en-CA', 'en-US', 'en-GB'];
    const score = function (v) {
      let s = 0;
      if (/Google|Natural|Neural|Premium|Enhanced/i.test(v.name)) s += 5;
      const i = pref.indexOf(v.lang);
      if (i >= 0) s += 3 - i;
      if (v.localService) s += 1;
      return s;
    };
    vs.sort(function (a, b) { return score(b) - score(a); });
    return vs[0] || null;
  }
  if (synth && synth.onvoiceschanged !== undefined) synth.onvoiceschanged = function () { /* warm the list */ synth.getVoices(); };

  function sentences(text, from, to) {
    const out = [];
    const re = /[^.!?\n]+[.!?]*["”’)]*\s*|\n+/g;
    let m;
    re.lastIndex = from;
    while ((m = re.exec(text)) && m.index < to) {
      const s = m.index, e = Math.min(to, m.index + m[0].length);
      if (text.slice(s, e).trim()) out.push({ start: s, end: e });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    return out;
  }

  /**
   * Ink.Speech.reader({ onState(state) }) → { read(el, {fromCaret}), stop(), pause(), resume(), state, setRate }
   * Highlights the word being read (CSS highlight 'ink-tts').
   */
  function reader(opts) {
    opts = opts || {};
    let state = 'idle', queue = [], idx = 0, el = null, rate = Number(Ink.store.get('inkwell_tts_rate')) || 1;
    function set(s) { state = s; if (opts.onState) opts.onState(s); }
    function speakNext() {
      if (state !== 'playing') return;
      if (idx >= queue.length) { stop(); return; }
      const m = T.model(el);
      const seg = queue[idx];
      const text = m.text.slice(seg.start, seg.end);
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.lang = v ? v.lang : 'en-CA';
      u.rate = rate;
      u.onboundary = function (ev) {
        if (ev.name && ev.name !== 'word') return;
        const w = T.wordAt(m, seg.start + ev.charIndex + (/\s/.test(text[ev.charIndex] || '') ? 1 : 0));
        if (w) T.paint('ink-tts', [T.rangeOf(m, w.start, w.end)]);
        else T.paint('ink-tts', [T.rangeOf(m, seg.start, seg.end)]);
      };
      u.onstart = function () { T.paint('ink-tts', [T.rangeOf(m, seg.start, seg.end)]); };
      u.onend = function () { if (state === 'playing') { idx++; speakNext(); } };
      u.onerror = function (e) { if (e.error !== 'interrupted' && e.error !== 'canceled') { idx++; speakNext(); } };
      synth.speak(u);
    }
    function read(target, o) {
      if (!synth) { Ink.toast('Read aloud isn\'t available in this browser.', 'warn'); return; }
      stop();
      el = target;
      const m = T.model(el);
      let from = 0, to = m.text.length;
      const sel = T.selection(m);
      if (sel && !sel.collapsed) { from = sel.start; to = sel.end; }
      else if (o && o.fromCaret && sel && sel.start < m.text.length - 1) from = Math.max(0, m.text.lastIndexOf('\n', sel.start - 1) + 1);
      queue = sentences(m.text, from, to);
      if (!queue.length) { Ink.toast('There\'s nothing to read yet.'); return; }
      idx = 0;
      set('playing');
      speakNext();
    }
    function stop() {
      if (!synth) return;
      const was = state;
      state = 'idle';
      synth.cancel();
      T.clear('ink-tts');
      if (was !== 'idle' && opts.onState) opts.onState('idle');
    }
    function pause() { if (state === 'playing') { synth.pause(); set('paused'); } }
    function resume() { if (state === 'paused') { synth.resume(); set('playing'); } }
    return {
      read: read, stop: stop, pause: pause, resume: resume,
      get state() { return state; },
      setRate: function (r) { rate = r; Ink.store.set('inkwell_tts_rate', r); },
      get rate() { return rate; },
      available: !!synth
    };
  }

  /* ───────────── Speech to text ───────────── */
  const COMMANDS = [
    [/\s*\b(new paragraph|next paragraph)\b\s*/gi, '\n\n'],
    [/\s*\b(new line|next line)\b\s*/gi, '\n'],
    [/\s*\b(full stop|period)\b/gi, '.'],
    [/\s*\bcomma\b/gi, ','],
    [/\s*\bquestion mark\b/gi, '?'],
    [/\s*\b(exclamation mark|exclamation point)\b/gi, '!'],
    [/\s*\bcolon\b/gi, ':'],
    [/\s*\bsemicolon\b/gi, ';'],
    [/\b(open quote|quote)\s*/gi, '“'],
    [/\s*\b(close quote|end quote|unquote)\b/gi, '”']
  ];

  /**
   * Ink.Speech.dictation({ onText(text), onInterim(text), onState(state), lang })
   * → { start(), stop(), active, available }
   */
  function dictation(opts) {
    opts = opts || {};
    let rec = null, want = false, state = 'idle';
    function set(s) { state = s; if (opts.onState) opts.onState(s); }
    function make() {
      const r = new Rec();
      r.lang = opts.lang || 'en-CA';
      r.continuous = true;
      r.interimResults = true;
      r.maxAlternatives = 1;
      r.onstart = function () { set('listening'); };
      r.onresult = function (e) {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) {
            let t = res[0].transcript;
            COMMANDS.forEach(function (c) { t = t.replace(c[0], c[1]); });
            if (t.trim() || /\n/.test(t)) opts.onText && opts.onText(t);
          } else interim += res[0].transcript;
        }
        if (opts.onInterim) opts.onInterim(interim);
      };
      r.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          want = false;
          set('blocked');
          Ink.toast('The microphone is blocked. Ask your teacher to help you allow it for this site.', 'bad', 6000);
        } else if (e.error === 'network') {
          Ink.toast('Speech-to-text needs the internet. Check your connection.', 'warn', 4000);
        }
      };
      r.onend = function () {
        if (opts.onInterim) opts.onInterim('');
        if (want) { try { r.start(); } catch (x) { setTimeout(function () { if (want) try { r.start(); } catch (y) { /* give up */ } }, 400); } }
        else set('idle');
      };
      return r;
    }
    return {
      available: !!Rec,
      start: function () {
        if (!Rec) { Ink.toast('Speech-to-text isn\'t available in this browser. Try Chrome.', 'warn'); return; }
        want = true;
        rec = rec || make();
        set('starting');
        try { rec.start(); } catch (e) { /* already started */ }
      },
      stop: function () { want = false; if (rec) try { rec.stop(); } catch (e) { /* ignore */ } set('idle'); },
      get active() { return want; },
      get state() { return state; }
    };
  }

  /** Smart join: capitalize after sentence ends, add spaces as needed. */
  function fitText(before, raw) {
    let t = raw.replace(/\s+([.,?!:;”])/g, '$1').replace(/“\s+/g, '“');
    const prev = before.replace(/[ \t]+$/, '');
    const lastCh = prev.slice(-1);
    const startOfSentence = !prev || /[.!?\n]$/.test(prev) || /[.!?]["”’]$/.test(prev);
    t = t.replace(/^\s+/, '');
    if (startOfSentence) t = t.charAt(0).toUpperCase() + t.slice(1);
    t = t.replace(/([.!?]\s+)([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
    t = t.replace(/\bi\b/g, 'I');
    const needsSpace = prev && !/[\s“(\n]$/.test(before) && !/^[.,?!:;”\n]/.test(t);
    return { text: (needsSpace ? ' ' : '') + t, lastCh: lastCh };
  }

  window.Ink.Speech = { reader: reader, dictation: dictation, fitText: fitText, ttsAvailable: !!synth, sttAvailable: !!Rec };
})();
