/* Inkwell — student side: sign in, assignment list, read-only view, locked-down writing mode with tools. */
(function () {
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const esc = Ink.esc;
  const TX = Ink.Text;
  const TOKEN_KEY = 'inkwell_student';
  const FS_OK = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);
  const ACTIVE_WINDOW = 15000; // a second counts as "typing" if a key was pressed in the last 15 s

  let auth = Ink.store.get(TOKEN_KEY); // { token, student }
  let home = null;
  let homeTimer = null;
  let W = null; // the active writing session

  function paintIcons(root) { (root || document).querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = Ink.icon(el.dataset.icon); }); }
  paintIcons();

  function show(view) {
    ['login', 'home', 'read', 'write'].forEach(function (v) { $('#view-' + v).hidden = v !== view; });
    document.title = view === 'write' && W ? W.assignment.title + ' · Inkwell' : 'Inkwell · Student Writing';
  }
  function overlay(id, on) { $('#' + id).hidden = !on; }

  /* ───────────── Sign in ───────────── */
  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = $('#login-btn');
    $('#login-err').textContent = '';
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>';
    try {
      const r = await Ink.call('sLogin', { code: $('#code').value });
      auth = { token: r.token, student: r.student };
      Ink.store.set(TOKEN_KEY, auth);
      $('#code').value = '';
      loadHome();
    } catch (err) {
      $('#login-err').textContent = err.message;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });

  $('#logout-btn').addEventListener('click', function () {
    Ink.store.del(TOKEN_KEY);
    auth = null;
    clearInterval(homeTimer);
    show('login');
    setTimeout(function () { $('#code').focus(); }, 50);
  });

  function handleAuthError(err) {
    if (err && err.code === 'AUTH') {
      Ink.store.del(TOKEN_KEY);
      auth = null;
      show('login');
      $('#login-err').textContent = err.message;
      return true;
    }
    return false;
  }

  /* ───────────── Assignment list ───────────── */
  async function loadHome(quiet) {
    if (!auth) { show('login'); return; }
    if (!quiet) {
      show('home');
      $('#who-name').textContent = auth.student.first + ' ' + (auth.student.last || '');
      $('#who-class').textContent = auth.student.className ? '· ' + auth.student.className : '';
      $('#hello').textContent = 'Hi, ' + auth.student.first;
      if (!home) $('#assign-list').innerHTML = '<div class="empty"><span class="spin"></span></div>';
    }
    try {
      home = await Ink.call('sHome', { token: auth.token });
      renderHome();
    } catch (err) {
      if (handleAuthError(err)) return;
      if (!quiet) $('#assign-list').innerHTML = '<div class="empty"><div class="display">Couldn\'t load assignments</div>' + esc(err.message) + '<br><br><button class="btn" onclick="location.reload()">Try again</button></div>';
    }
    clearInterval(homeTimer);
    homeTimer = setInterval(function () { if (!W && !$('#view-home').hidden) loadHome(true); }, 45000);
  }

  function winLabel(a) {
    const w = a.win;
    if (a.work && a.work.status === 'submitted') return '<span class="pill submitted">Submitted ' + esc(Ink.fmtDateTime(a.work.submittedAt)) + '</span>';
    if (w.absent) return '<span class="pill closed">Closed — marked absent today</span>';
    if (a.work && a.work.locked && w.open) return '<span class="pill locked">Locked — ask your teacher</span>';
    if (w.open) return '<span class="pill open">Open now' + (w.closesAt ? ' · until ' + esc(Ink.fmtTime(w.closesAt)) : '') + '</span>';
    if (w.opensAt) return '<span class="pill soon">Opens ' + esc(Ink.fmtDateTime(w.opensAt)) + '</span>';
    return '<span class="pill closed">' + esc(w.label || 'Closed') + '</span>';
  }

  function renderHome() {
    const list = $('#assign-list');
    const items = (home && home.assignments) || [];
    $('#absent-banner').hidden = !home.absent;
    if (!items.length) {
      list.innerHTML = '<div class="empty"><div class="display">Nothing assigned yet</div>When your teacher posts an assignment, it will show up here.</div>';
      return;
    }
    list.innerHTML = '';
    items.forEach(function (a) {
      const done = a.work && a.work.status === 'submitted';
      const card = document.createElement('div');
      card.className = 'card assign' + (done ? ' is-done' : (a.work && a.work.locked && a.win.open ? ' is-locked' : (a.win.open ? ' is-open' : '')));
      const goal = Ink.goalText(0, a.goal);
      let meta = winLabel(a);
      if (a.feedback) meta += '<span class="pill fb">' + Ink.icon('grade') + 'Feedback ready</span>';
      if (a.openComments) meta += '<span class="pill cm">' + Ink.icon('comment') + a.openComments + ' comment' + (a.openComments > 1 ? 's' : '') + '</span>';
      if (a.goal && a.goal.show && goal) meta += '<span>Goal: ' + esc(goal) + '</span>';
      if (a.work && a.work.words) meta += '<span>' + a.work.words + ' words written</span>';
      if (a.work && a.work.lastSaveAt && !done) meta += '<span>Last saved ' + esc(Ink.fmtDateTime(a.work.lastSaveAt)) + '</span>';
      let action = '';
      if (done) action = '<button class="btn" data-act="view">' + Ink.bi('eye', a.feedback ? 'View feedback' : 'View') + '</button>';
      else if (a.win.open) action = '<button class="btn primary" data-act="write">' + Ink.bi('pen', a.work ? 'Continue writing' : 'Start writing') + '</button>';
      else if (a.work) action = '<button class="btn" data-act="view">' + Ink.bi('eye', 'View my work') + '</button>';
      card.innerHTML = '<div><h3>' + esc(a.title) + '</h3><div class="meta">' + meta + '</div></div><div class="assign-act">' + action + '</div>';
      const b = card.querySelector('[data-act]');
      if (b) b.addEventListener('click', function () { b.dataset.act === 'view' ? openRead(a) : askStart(a); });
      list.appendChild(card);
    });
  }

  /* ───────────── Comments (shared by read-only and writing views) ───────────── */
  function commentCards(list, opts) {
    // list: comments; opts: { onToggle(c, done), onFocus(c), activeId, located: {id:bool}, showDone }
    const shown = list.filter(function (c) { return opts.showDone || !c.resolved; });
    if (!shown.length) return '<div class="muted small">' + (list.length ? 'All comments are done. ' : 'No comments yet.') + '</div>';
    return shown.map(function (c) {
      const gone = opts.located && opts.located[c.id] === false;
      return '<div class="cmt' + (c.resolved ? ' done' : '') + (opts.activeId === c.id ? ' on' : '') + '" data-cid="' + esc(c.id) + '">' +
        '<div class="cmt-q">' + (gone ? '<span class="muted">(text changed)</span> ' : '') + '“' + esc(c.quote.length > 90 ? c.quote.slice(0, 88) + '…' : c.quote) + '”</div>' +
        '<div class="cmt-t">' + esc(c.text) + '</div>' +
        '<label class="cmt-done"><input type="checkbox"' + (c.resolved ? ' checked' : '') + '> Done</label></div>';
    }).join('');
  }

  function paintComments(m, comments, activeId) {
    const located = {};
    const ranges = [], active = [];
    comments.forEach(function (c) {
      const loc = TX.locate(m, c);
      located[c.id] = !!loc;
      if (!loc || c.resolved) return;
      const r = TX.rangeOf(m, loc.start, loc.end);
      if (!r) return;
      (c.id === activeId ? active : ranges).push(r);
    });
    TX.paint('ink-cmt', ranges);
    TX.paint('ink-cmt-active', active);
    return located;
  }

  async function toggleComment(c, done) {
    try {
      await Ink.call('sResolveComment', { token: auth.token, id: c.id, resolved: done });
      c.resolved = done;
      return true;
    } catch (err) {
      if (!handleAuthError(err)) Ink.toast(err.message, 'bad');
      return false;
    }
  }

  /* ───────────── Read-only view ───────────── */
  let readState = null;
  async function openRead(a) {
    show('read');
    readState = { a: a, comments: [], showDone: false, active: null };
    $('#read-title').textContent = a.title;
    $('#read-doc').innerHTML = '<span class="spin"></span>';
    $('#read-meta').textContent = '';
    $('#read-side').innerHTML = '';
    try {
      const r = await Ink.call('sView', { token: auth.token, aid: a.id });
      if (!readState || readState.a !== a) return;
      $('#read-doc').innerHTML = Ink.sanitize(r.html) || '<p class="muted"><i>Nothing written yet.</i></p>';
      const w = r.work;
      $('#read-meta').textContent = w ? (w.words + ' words' + (w.status === 'submitted' ? ' · Submitted ' + Ink.fmtDateTime(w.submittedAt) : ' · Draft, not submitted')) : '';
      readState.comments = r.comments || [];
      readState.feedback = r.feedback;
      drawReadSide();
    } catch (err) {
      if (handleAuthError(err)) return;
      $('#read-doc').textContent = err.message;
    }
  }

  function drawReadSide() {
    const S = readState;
    const side = $('#read-side');
    let h = '';
    if (S.feedback) {
      const f = S.feedback;
      h += '<section class="card fb-card"><h4>Feedback</h4>';
      if (f.rubric && f.rubric.criteria) {
        h += '<div class="fb-score"><b>' + Ink.Rubric.fmt(f.total) + '</b><span>/ ' + Ink.Rubric.fmt(f.max) + '</span></div>' + Ink.Rubric.list(f.rubric, f.scores);
      }
      if (f.comment) h += '<div class="fb-comment">' + esc(f.comment).replace(/\n/g, '<br>') + '</div>';
      h += '</section>';
    }
    if (S.comments.length) {
      h += '<section class="card fb-card"><div class="side-h"><h4>Comments in your writing</h4><label class="tiny-check"><input type="checkbox" id="rd-done"' + (S.showDone ? ' checked' : '') + '> Show done</label></div><div class="cmt-list" id="rd-cmts"></div></section>';
    }
    if (!h) h = '<div class="muted small" style="padding:8px 4px">Your teacher hasn\'t left feedback here yet.</div>';
    side.innerHTML = h;
    const doc = $('#read-doc');
    const m = TX.model(doc);
    const located = TX.hasHighlights ? paintComments(m, S.comments, S.active) : null;
    if (!TX.hasHighlights && !doc.dataset.marked) {
      const spans = [];
      S.comments.forEach(function (c) { const loc = TX.locate(m, c); if (loc && !c.resolved) spans.push({ start: loc.start, end: loc.end, id: c.id }); });
      TX.markFallback(m, spans);
      doc.dataset.marked = '1';
    }
    const list = $('#rd-cmts');
    if (list) {
      list.innerHTML = commentCards(S.comments, { showDone: S.showDone, activeId: S.active, located: located });
      wireCards(list, S.comments, function (c) { S.active = c.id; drawReadSide(); scrollToComment(doc, c); }, function () { drawReadSide(); });
      $('#rd-done').onchange = function () { S.showDone = this.checked; drawReadSide(); };
    }
  }

  function wireCards(list, comments, onFocus, onChanged) {
    list.querySelectorAll('.cmt').forEach(function (el) {
      const c = comments.find(function (x) { return x.id === el.dataset.cid; });
      el.addEventListener('mousedown', function (e) { if (!e.target.closest('label')) e.preventDefault(); });
      el.addEventListener('click', function (e) { if (e.target.closest('label')) return; onFocus(c); });
      const cb = el.querySelector('input');
      cb.addEventListener('change', async function () {
        cb.disabled = true;
        const ok = await toggleComment(c, cb.checked);
        if (!ok) cb.checked = !cb.checked;
        cb.disabled = false;
        onChanged();
      });
    });
  }

  function scrollToComment(root, c) {
    const m = TX.model(root);
    const loc = TX.locate(m, c);
    if (!loc) { Ink.toast('That part of your writing has changed since the comment was made.'); return; }
    const r = TX.rangeOf(m, loc.start, loc.end);
    const el = r && r.startContainer.parentElement;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  $('#read-back').addEventListener('click', function () { readState = null; TX.clear('ink-cmt'); TX.clear('ink-cmt-active'); loadHome(); });
  // The read-only copy is for reading, not copying out.
  ['copy', 'cut'].forEach(function (ev) { $('#read-doc').addEventListener(ev, function (e) { e.preventDefault(); Ink.toast('Copying is turned off for your writing.', 'warn', 2500); }); });

  /* ───────────── Start screen ───────────── */
  let pendingStart = null;
  function askStart(a) {
    pendingStart = a;
    $('#start-title').textContent = a.title;
    const bits = [];
    if (a.win.closesAt) bits.push('Open until ' + Ink.fmtTime(a.win.closesAt) + '.');
    if (a.goal && a.goal.show && Ink.goalText(0, a.goal)) bits.push('Goal: ' + Ink.goalText(0, a.goal) + '.');
    if (!FS_OK) bits.push('This browser can\'t go full screen, so stay on this page the whole time.');
    $('#start-sub').textContent = bits.join(' ');
    $('#start-go-text').textContent = a.work ? 'Continue writing' : 'Start writing';
    $('#mic-check').hidden = !(a.tools && a.tools.stt && Ink.Speech.sttAvailable);
    overlay('ov-start', true);
  }
  $('#start-cancel').addEventListener('click', function () { overlay('ov-start', false); pendingStart = null; });
  $('#start-go').addEventListener('click', function () {
    const a = pendingStart;
    if (!a) return;
    goFullscreen(); // must happen inside the click
    overlay('ov-start', false);
    enterWriting(a);
  });
  // Ask for the microphone before going full screen, so the permission prompt can't trigger a lock.
  $('#mic-test').addEventListener('click', function () {
    const btn = this;
    const R = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!R) return;
    const r = new R();
    btn.disabled = true;
    btn.innerHTML = '<span class="spin sm"></span><span>Waiting…</span>';
    let done = false;
    const finish = function (ok, msg) {
      if (done) return; done = true;
      try { r.abort(); } catch (e) { /* ignore */ }
      btn.disabled = false;
      btn.innerHTML = ok ? Ink.bi('check', 'Microphone ready') : '<span>Try again</span>';
      btn.classList.toggle('teal', ok);
      if (msg) Ink.toast(msg, ok ? 'good' : 'warn', 4000);
    };
    r.onstart = function () { finish(true); };
    r.onerror = function (e) { finish(false, e.error === 'not-allowed' ? 'The microphone was blocked. Ask your teacher to help you allow it.' : 'Couldn\'t start the microphone (' + e.error + ').'); };
    try { r.start(); } catch (e) { finish(false); }
    setTimeout(function () { finish(false); }, 15000);
  });

  function goFullscreen() {
    if (!FS_OK) return Promise.resolve(true);
    let p;
    try { p = document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch (e) { p = Promise.reject(e); }
    return Promise.resolve(p).then(function () {
      try { if (navigator.keyboard && navigator.keyboard.lock) navigator.keyboard.lock().catch(function () {}); } catch (e) { /* ignore */ }
      return true;
    }).catch(function () { return false; });
  }
  function leaveFullscreen() {
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch (e) { /* ignore */ }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
  }

  /* ───────────── Writing mode: editor + tools ───────────── */
  let editor = null, spell = null, lookupPanel = null, reader = null, dictation = null;
  const toolBtn = {};

  function getEditor() {
    if (editor) return editor;
    const host = $('#editor-host');
    const wrap = document.createElement('div');
    wrap.style.display = 'contents';
    host.appendChild(wrap);
    editor = Ink.makeEditor(wrap, { placeholder: 'Start writing here…', spacing: true, nativeSpell: false });
    const scroll = document.createElement('div');
    scroll.className = 'page-scroll';
    const page = document.createElement('div');
    page.className = 'page';
    scroll.appendChild(page);
    wrap.appendChild(scroll);
    page.appendChild(editor.el);
    editor.onInput(onEditorInput);
    wireEditorGuards(editor.el);

    // Tools (shown or hidden per assignment)
    toolBtn.spell = editor.addTool({ icon: 'spell', title: 'Spelling underlines on/off', onClick: function () { if (!spell) return; spell.setOn(!spell.isOn()); toolBtn.spell.classList.toggle('on', spell.isOn()); } });
    toolBtn.lookup = editor.addTool({ icon: 'book', title: 'Look up a word (dictionary & thesaurus)', onClick: lookupSelection });
    toolBtn.tts = editor.addTool({ icon: 'speaker', label: 'Read aloud', title: 'Read my writing aloud (from the cursor, or the selected text)', onClick: function () { if (reader.state === 'idle') reader.read(editor.el, { fromCaret: true }); else reader.stop(); } });
    toolBtn.stt = editor.addTool({ icon: 'mic', label: 'Dictate', title: 'Speech-to-text: talk and your words are typed', onClick: toggleDictation });

    spell = Ink.Spell.attach(editor.el, {
      userKey: auth && auth.student ? auth.student.id : 'anon',
      onReplace: function (range, text) { internalInsert(range, text, false); },
      onLookup: function (word, range) { openLookup(word, range); },
      onStatus: function (n) {
        const b = $('#spell-sum');
        if (n === 'unavailable') { b.hidden = true; return; }
        b.hidden = !W || !W.tools.spell || !spell.isOn() || !n;
        b.innerHTML = Ink.bi('spell', n + ' possible spelling mistake' + (n === 1 ? '' : 's') + ' — review');
      }
    });
    $('#spell-sum').addEventListener('click', function () { spell.next(); });

    lookupPanel = Ink.Lookup.panel($('#lookup-host'), {
      onUse: function (word, range) { return internalInsert(range, word, false); },
      onLookup: function () { if (W) W.d.look++; },
      proxy: function (word) { return Ink.call('sLookup', { token: auth.token, word: word }, { timeout: 20000 }); }
    });

    reader = Ink.Speech.reader({ onState: ttsState });
    dictation = Ink.Speech.dictation({
      lang: 'en-CA',
      onText: function (t) { dictateText(t); },
      onInterim: function (t) { $('#dictate-text').textContent = t ? '“' + t + '”' : 'Listening…'; },
      onState: function (s) {
        const on = s === 'listening' || s === 'starting';
        toolBtn.stt.classList.toggle('rec', on);
        $('#dictate-bubble').hidden = !on;
        if (s === 'listening' && W) W.graceUntil = 0;
      }
    });
    $('#dictate-stop').addEventListener('click', function () { dictation.stop(); });

    // Clicking commented text highlights its card.
    editor.el.addEventListener('click', function (e) {
      if (!W || !W.comments.length) return;
      const m = TX.model(editor.el);
      const i = TX.indexAtPoint(m, e.clientX, e.clientY);
      const c = W.comments.find(function (x) { if (x.resolved) return false; const l = TX.locate(m, x); return l && i >= l.start && i <= l.end; });
      if (c) { W.activeComment = c.id; drawComments(); const card = $('#cmt-list [data-cid="' + c.id + '"]'); if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    });
    $('#cmt-show-done').addEventListener('change', function () { if (W) { W.showDone = this.checked; drawComments(); } });

    // Read-aloud controls
    $('#tts-rate').addEventListener('change', function () { reader.setRate(Number(this.value)); });
    $('#tts-pause').addEventListener('click', function () { reader.state === 'paused' ? reader.resume() : reader.pause(); });
    $('#tts-stop').addEventListener('click', function () { reader.stop(); });
    $('#prompt-read').addEventListener('click', function () { if (reader.state !== 'idle') reader.stop(); else reader.read($('#w-prompt')); });
    return editor;
  }

  function ttsState(s) {
    const on = s !== 'idle';
    $('#tts-bar').hidden = !on;
    toolBtn.tts.classList.toggle('on', on);
    toolBtn.tts.querySelector('span').textContent = on ? 'Stop reading' : 'Read aloud';
    $('#tts-pause').innerHTML = Ink.icon(s === 'paused' ? 'play' : 'pause');
    $('#tts-pause').title = s === 'paused' ? 'Resume' : 'Pause';
    $('#tts-rate').value = String(reader.rate);
  }

  function setTools(t) {
    toolBtn.spell.hidden = !t.spell;
    toolBtn.lookup.hidden = !t.lookup;
    toolBtn.tts.hidden = !(t.tts && Ink.Speech.ttsAvailable);
    toolBtn.stt.hidden = !(t.stt && Ink.Speech.sttAvailable);
    $('#prompt-read').hidden = !(t.tts && Ink.Speech.ttsAvailable);
    $('#lookup-sec').hidden = !t.lookup;
    $('#rem-spell').hidden = !t.spell;
    $('#rem-lookup').hidden = !t.lookup;
    spell.setOn(!!t.spell);
    toolBtn.spell.classList.toggle('on', !!t.spell);
    if (!t.spell) $('#spell-sum').hidden = true;
  }

  // Text the app inserts itself (dictation, spelling fixes, thesaurus swaps) skips the paste guard.
  function internalInsert(range, text, dictated) {
    if (!W || W.locked || W.ended) return false;
    W.internal = true;
    try { editor.insertAt(range, text); } finally { W.internal = false; }
    if (dictated) W.d.dict += text.length;
    return true;
  }

  function lookupSelection() {
    const m = TX.model(editor.el);
    const sel = TX.selection(m);
    let w = null;
    if (sel && !sel.collapsed) {
      const t = m.text.slice(sel.start, sel.end).trim();
      if (/^[A-Za-zÀ-ɏ'’-]+$/.test(t)) w = { w: t, start: sel.start, end: sel.end };
    } else if (sel) w = TX.wordAt(m, sel.start) || (sel.start > 0 ? TX.wordAt(m, sel.start - 1) : null);
    openLookup(w ? w.w : '', w ? TX.rangeOf(m, w.start, w.end) : null);
  }

  function openLookup(word, range) {
    if (!W || !W.tools.lookup) return;
    $('#lookup-sec').hidden = false;
    $('#lookup-sec').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (word) lookupPanel.show(word, range); else lookupPanel.focus();
  }

  function toggleDictation() {
    if (!W) return;
    if (dictation.active) { dictation.stop(); return; }
    W.graceUntil = Date.now() + 10000; // a permission bubble may briefly take focus
    dictation.start();
    editor.focus();
  }

  function dictateText(raw) {
    if (!W || W.locked || W.ended) return;
    const m = TX.model(editor.el);
    let sel = TX.selection(m);
    if (!sel) { editor.focus(); sel = { start: m.text.length, end: m.text.length }; }
    const before = m.text.slice(0, sel.start);
    const fit = Ink.Speech.fitText(before, raw);
    internalInsert(null, fit.text, true);
  }

  /* ───────────── Session ───────────── */
  function newSession(a) {
    return {
      aid: a.id, assignment: { title: a.title, goal: a.goal, allowSelfPaste: true }, sessionId: Ink.uuid(),
      tools: { spell: true, lookup: true, tts: false, stt: false },
      rev: 0, savedRev: 0, saving: false, pending: false, saveTimer: 0, firstDirtyAt: 0, retryTimer: 0,
      armed: false, armTimer: 0, locked: false, lockSent: false, exiting: false, ended: false, graceUntil: 0, internal: false,
      closesAt: null, skew: 0, warned5: false, warned1: false, relaxed: false,
      d: { keys: 0, dels: 0, active: 0, open: 0, lockedS: 0, paste: 0, insert: 0, dict: 0, look: 0 }, lastKeyAt: 0, clip: null, words: 0, chars: 0,
      comments: [], cAt: 0, activeComment: null, showDone: false,
      timers: []
    };
  }

  async function enterWriting(a) {
    W = newSession(a);
    const ed = getEditor();
    ed.setHTML('');
    ed.setEditable(false);
    $('#w-title').textContent = a.title;
    $('#w-prompt').innerHTML = '';
    $('#cmt-sec').hidden = true;
    setSaveState('Opening…', 'saving');
    show('write');
    let r;
    try {
      r = await Ink.call('sStart', { token: auth.token, aid: a.id, sessionId: W.sessionId });
    } catch (err) {
      W = null;
      leaveFullscreen();
      if (handleAuthError(err)) return;
      loadHome();
      Ink.toast(err.message, 'bad', 5000);
      return;
    }
    W.skew = (r.now || Date.now()) - Date.now();
    if (r.submitted) { W.exiting = true; endWriting(false); openRead(a); return; }
    if (r.closed) {
      W.exiting = true; endWriting(false);
      Ink.toast(closedMessage(r.win).text, 'warn', 6000);
      loadHome();
      return;
    }
    W.assignment = r.assignment;
    W.tools = r.assignment.tools || W.tools;
    W.relaxed = !!W.tools.stt;
    W.rev = Number(r.rev) || 0;
    W.savedRev = W.rev;
    W.closesAt = r.win && r.win.closesAt ? r.win.closesAt : null;
    W.comments = r.comments || [];
    W.cAt = r.cAt || 0;
    const prompt = Ink.sanitize(r.assignment.prompt || '');
    $('#w-prompt').innerHTML = prompt;
    $('#prompt-wrap').hidden = !prompt.replace(/<[^>]+>/g, '').trim();
    setTools(W.tools);
    ed.setHTML(r.html || '');
    updateCounts();
    drawComments();
    spell.refresh();
    setSaveState(r.work && r.work.lastSaveAt ? 'Saved' : 'Ready', '');
    startTimers();
    if (r.locked) { showLock(r.lockReason, r.lockedAt, true); return; }
    arm();
  }

  // Start watching for "leaving" a moment after we're settled in full screen.
  function arm() {
    if (!W) return;
    clearTimeout(W.armTimer);
    W.armed = false;
    if (FS_OK && !document.fullscreenElement) {
      overlay('ov-fs', true);
      editor.setEditable(false);
      return;
    }
    overlay('ov-fs', false);
    editor.setEditable(true);
    editor.focus();
    placeCaretAtEnd(editor.el);
    W.armTimer = setTimeout(function () { if (W && !W.locked && !W.exiting) W.armed = true; }, 900);
  }

  $('#fs-go').addEventListener('click', function () {
    goFullscreen().then(function (ok) { if (ok || !FS_OK) arm(); else Ink.toast('Your browser blocked full screen. Try again.', 'warn'); });
  });

  function placeCaretAtEnd(el) {
    try {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    } catch (e) { /* ignore */ }
  }

  function startTimers() {
    W.timers.push(setInterval(tickSecond, 1000));
    W.timers.push(setInterval(ping, 10000));
    tickSecond();
  }

  function inGrace() { return W && Date.now() < W.graceUntil; }

  function tickSecond() {
    if (!W || W.ended) return;
    // time accounting
    if (W.locked) W.d.lockedS++;
    else if (W.armed) {
      W.d.open++;
      if (Date.now() - W.lastKeyAt < ACTIVE_WINDOW) W.d.active++;
    }
    // safety net in case an event was missed
    if (W.armed && !W.locked && !W.exiting) {
      if (FS_OK && !document.fullscreenElement) lockOut('Exited full screen');
      else if (!document.hasFocus() && !inGrace()) lockOut('Left the assignment window');
    }
    // countdown
    const t = $('#w-timer');
    if (W.closesAt) {
      const left = W.closesAt - (Date.now() + W.skew);
      t.classList.remove('off');
      $('#w-timer-text').textContent = left > 0 ? Ink.countdown(left) + ' left' : 'Time\'s up';
      t.classList.toggle('warn', left < 5 * 60000 && left >= 60000);
      t.classList.toggle('urgent', left < 60000);
      if (left < 5 * 60000 && left > 60000 && !W.warned5) { W.warned5 = true; Ink.toast('5 minutes left. Your work keeps saving automatically.', 'warn', 5000); }
      if (left < 60000 && left > 0 && !W.warned1) { W.warned1 = true; Ink.toast('1 minute left!', 'warn', 5000); }
      if (left <= 0 && !W.locked) timeUp({ label: 'Class time is over' });
    } else {
      t.classList.add('off');
    }
  }

  /* ── Counting & saving ── */
  function updateCounts() {
    const text = Ink.textOf(editor.el);
    W.words = Ink.countWords(text);
    W.chars = Ink.countChars(text);
    $('#st-words').textContent = W.words.toLocaleString();
    $('#st-chars').textContent = W.chars.toLocaleString();
    $('#st-chars-ns').textContent = Ink.countCharsNoSpaces(text).toLocaleString() + ' characters without spaces';
    const g = W.assignment.goal;
    const showGoal = g && g.show && (g.min || g.max);
    $('#goal-wrap').hidden = !showGoal;
    if (showGoal) {
      const bar = $('#goal-bar');
      bar.querySelector('i').style.width = Ink.goalPct(W.words, g) + '%';
      const met = g.min ? W.words >= g.min : true;
      const over = g.max && W.words > g.max;
      bar.classList.toggle('met', met && !over);
      bar.classList.toggle('over', !!over);
      let txt = 'Goal: ' + Ink.goalText(W.words, g);
      if (over) txt += ' — you\'re ' + (W.words - g.max) + ' over the limit';
      else if (g.min && !met) txt += ' — ' + (g.min - W.words) + ' to go';
      else if (met) txt += ' — goal met';
      $('#goal-text').textContent = txt;
    }
  }

  const repaintComments = Ink.debounce(function () { if (W) drawComments(true); }, 350);

  function onEditorInput() {
    if (!W || W.locked || W.ended) return;
    W.rev++;
    updateCounts();
    scheduleSave();
    if (W.comments.length) repaintComments();
  }

  function scheduleSave(soon) {
    if (!W) return;
    clearTimeout(W.saveTimer);
    if (!W.firstDirtyAt) W.firstDirtyAt = Date.now();
    const overdue = Date.now() - W.firstDirtyAt > 10000;
    W.saveTimer = setTimeout(save, soon || overdue ? 50 : 2000);
    if (!W.saving) setSaveState('Saving…', 'saving');
  }

  function takeDeltas() { const d = W.d; W.d = { keys: 0, dels: 0, active: 0, open: 0, lockedS: 0, paste: 0, insert: 0, dict: 0, look: 0 }; return d; }
  function restoreDeltas(d) { Object.keys(d).forEach(function (k) { W.d[k] += d[k]; }); }

  function payload(withDoc) {
    const p = { token: auth.token, aid: W.aid, sessionId: W.sessionId, focused: document.hasFocus() };
    if (withDoc) { p.rev = W.rev; p.html = editor.getHTML(); p.words = W.words; p.chars = W.chars; }
    return p;
  }

  async function save() {
    if (!W || W.ended) return;
    if (W.saving) { W.pending = true; return; }
    if (W.rev === W.savedRev && !hasDeltas()) { setSaveState('Saved', ''); return; }
    W.saving = true;
    W.pending = false;
    const s = W;
    const p = payload(true);
    p.d = takeDeltas();
    try {
      const r = await Ink.call('sSave', p);
      if (s !== W) return;
      s.firstDirtyAt = 0;
      if (r.saved || r.rev >= p.rev) s.savedRev = Math.max(s.savedRev, p.rev);
      handleServerState(r);
      if (!W) return;
      if (s.rev === s.savedRev) setSaveState('Saved ' + Ink.fmtTime(Date.now()), '');
    } catch (err) {
      if (s !== W) return;
      restoreDeltas(p.d);
      onCallError(err);
      clearTimeout(s.retryTimer);
      s.retryTimer = setTimeout(function () { if (W === s) save(); }, 4000);
    } finally {
      s.saving = false;
      if (W === s && !s.ended && (s.pending || s.rev !== s.savedRev) && !s.locked) scheduleSave(true);
    }
  }

  function hasDeltas() { const d = W.d; return d.paste || d.insert; }

  async function ping() {
    if (!W || W.ended || W.saving) return;
    if (W.locked) return; // the lock screen polls separately
    const s = W;
    const p = payload(false);
    p.d = takeDeltas();
    try {
      const r = await Ink.call('sPing', p);
      if (s !== W) return;
      handleServerState(r);
      if (s.rev === s.savedRev && !s.saving && $('#savestate').classList.contains('bad')) setSaveState('Saved', '');
    } catch (err) {
      if (s !== W) return;
      restoreDeltas(p.d);
      onCallError(err);
    }
  }

  function handleServerState(r) {
    if (!W) return;
    if (r.win) W.closesAt = r.win.closesAt || (r.win.open ? null : W.closesAt);
    if (r.now) W.skew = r.now - Date.now();
    if (r.superseded) return endWithMessage('info', 'Opened somewhere else', 'This assignment was opened in another tab or on another device, so this window stopped. Your work up to that point is saved.');
    if (r.submitted) return endWithMessage('ok', 'Already submitted', 'This assignment has been submitted.');
    if (r.cAt && r.cAt > W.cAt) fetchComments(r.cAt);
    if (r.locked && !W.locked) return showLock(r.lockReason, r.lockedAt, true);
    if (r.closed) return timeUp(r.win);
  }

  function onCallError(err) {
    if (err.code === 'AUTH') { reauth(); return; }
    setSaveState(navigator.onLine === false ? 'Offline — keep writing, we\'ll retry' : 'Not saved yet — retrying…', 'bad');
  }

  function setSaveState(text, cls) {
    const el = $('#savestate');
    el.className = 'savestate ' + (cls || '');
    $('#savestate-text').textContent = text;
  }

  let reauthOpen = false;
  async function reauth() {
    if (reauthOpen) return;
    reauthOpen = true;
    if (W) W.graceUntil = Date.now() + 120000;
    const code = await Ink.modal({
      title: 'Sign in again', dismissable: false,
      html: '<p class="muted">Your sign-in expired. Type your student code to keep saving — your writing is still here.</p><input class="input code-input" id="reauth-code" autocomplete="off" spellcheck="false">',
      buttons: [{ label: 'Continue', cls: 'primary', collect: function (b) { const v = b.querySelector('#reauth-code').value.trim(); return v || false; } }]
    });
    try {
      const r = await Ink.call('sLogin', { code: code });
      if (r.student.id !== auth.student.id) throw new Error('That code belongs to someone else.');
      auth.token = r.token;
      Ink.store.set(TOKEN_KEY, auth);
      reauthOpen = false;
      if (W) { W.graceUntil = 0; scheduleSave(true); }
    } catch (err) {
      reauthOpen = false;
      Ink.toast(err.message, 'bad');
      reauth();
    }
  }

  /* ── Teacher comments while writing ── */
  async function fetchComments(cAt) {
    const s = W;
    try {
      const r = await Ink.call('sComments', { token: auth.token, aid: W.aid });
      if (s !== W) return;
      const before = new Set(W.comments.map(function (c) { return c.id; }));
      const fresh = r.comments.filter(function (c) { return !before.has(c.id) && !c.resolved; });
      W.comments = r.comments;
      W.cAt = r.cAt || cAt;
      drawComments();
      if (fresh.length) {
        Ink.toast(fresh.length === 1 ? 'Your teacher left a comment on your writing.' : 'Your teacher left ' + fresh.length + ' comments on your writing.', 'good', 4500);
        const sec = $('#cmt-sec');
        sec.classList.remove('flash'); void sec.offsetWidth; sec.classList.add('flash');
      }
    } catch (err) { /* try again on the next ping */ }
  }

  function drawComments(paintOnly) {
    if (!W) return;
    const list = W.comments;
    const open = list.filter(function (c) { return !c.resolved; }).length;
    $('#cmt-sec').hidden = !list.length;
    const m = TX.model(editor.el);
    const located = paintComments(m, list, W.activeComment);
    if (paintOnly) return;
    $('#cmt-count').textContent = open ? String(open) : '';
    $('#cmt-count').hidden = !open;
    $('#cmt-show-done').checked = W.showDone;
    const host = $('#cmt-list');
    host.innerHTML = commentCards(list, { showDone: W.showDone, activeId: W.activeComment, located: located });
    wireCards(host, list, function (c) { W.activeComment = c.id; drawComments(); scrollToComment(editor.el, c); }, function () { drawComments(); });
  }

  /* ── Locking ── */
  function lockOut(reason, viaBeacon, soft) {
    if (!W || !W.armed || W.locked || W.exiting || W.ended) return;
    if (soft && inGrace()) return;
    W.armed = false;
    W.locked = true;
    editor.setEditable(false);
    stopSpeech();
    showLock(reason, Date.now(), false);
    const p = payload(true);
    p.reason = reason;
    p.d = takeDeltas();
    if (viaBeacon) { Ink.beacon('sLock', p); W.lockSent = true; return; }
    sendLock(p, 0);
  }

  function stopSpeech() {
    if (reader) reader.stop();
    if (dictation && dictation.active) dictation.stop();
  }

  function sendLock(p, attempt) {
    const s = W;
    Ink.call('sLock', p, { keepalive: true }).then(function (r) {
      if (s === W) { s.lockSent = true; s.savedRev = Math.max(s.savedRev, p.rev); if (r.superseded) handleServerState(r); }
    }).catch(function (err) {
      if (err.code === 'AUTH') return reauth();
      if (s === W && attempt < 20) setTimeout(function () { sendLock(p, attempt + 1); }, Math.min(15000, 2000 * (attempt + 1)));
    });
  }

  let lockPoll = 0;
  function showLock(reason, at, fromServer) {
    if (!W) return;
    W.locked = true;
    W.armed = false;
    if (fromServer) W.lockSent = true;
    editor.setEditable(false);
    stopSpeech();
    clearTimeout(W.saveTimer);
    $('#lock-reason').textContent = (reason || 'You left the assignment window') + (at ? ' · ' + Ink.fmtTime(at) : '');
    $('#lock-words').textContent = W.words ? ' (' + W.words + ' words)' : '';
    $('#lock-waiting').hidden = false;
    $('#lock-cleared').hidden = true;
    overlay('ov-fs', false);
    overlay('ov-lock', true);
    clearInterval(lockPoll);
    lockPoll = setInterval(pollLock, 3000);
  }

  async function pollLock() {
    if (!W || !W.locked) { clearInterval(lockPoll); return; }
    const s = W;
    const d = takeDeltas();
    try {
      const r = await Ink.call('sStatus', { token: auth.token, aid: W.aid, sessionId: W.sessionId, d: d });
      if (s !== W) return;
      if (r.superseded) { clearInterval(lockPoll); return handleServerState(r); }
      if (r.submitted) { clearInterval(lockPoll); return handleServerState(r); }
      if (r.cAt && r.cAt > W.cAt) fetchComments(r.cAt);
      if (!r.locked && s.lockSent) {
        clearInterval(lockPoll);
        $('#lock-waiting').hidden = true;
        $('#lock-cleared').hidden = false;
      }
      if (r.win && !r.win.open) { clearInterval(lockPoll); timeUp(r.win); }
    } catch (err) {
      if (s === W) restoreDeltas(d);
      if (err.code === 'AUTH') reauth();
    }
  }

  $('#lock-return').addEventListener('click', function () {
    goFullscreen().then(function () {
      if (!W) return;
      W.locked = false;
      overlay('ov-lock', false);
      arm();
      setSaveState('Saved', '');
    });
  });
  $('#lock-leave').addEventListener('click', function () {
    if (!W) return;
    W.exiting = true;
    const s = W;
    Ink.call('sStatus', { token: auth.token, aid: s.aid, sessionId: s.sessionId, d: takeDeltas() }).catch(function () {});
    endWriting(true);
  });

  /* ── Leaving detection ── */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') lockOut('Switched tabs or minimized the window', true);
  });
  window.addEventListener('blur', function () {
    setTimeout(function () { if (!document.hasFocus()) lockOut('Clicked outside the assignment or switched to another app', false, true); }, 120);
  });
  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement) lockOut('Exited full screen');
  });
  window.addEventListener('pagehide', function () { lockOut('Closed or reloaded the page', true); });
  window.addEventListener('beforeunload', function (e) {
    if (W && !W.exiting && !W.ended) { lockOut('Closed or reloaded the page', true); e.preventDefault(); e.returnValue = ''; }
  });

  // Shortcuts that would leave the page or open tools.
  document.addEventListener('keydown', function (e) {
    if (!W || W.ended || $('#view-write').hidden) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = (e.key || '').toLowerCase();
    if (mod && !e.shiftKey && k === 'u') { // underline here, never "view source"
      e.preventDefault();
      if (editor && editor.el.contains(e.target) && !W.locked) document.execCommand('underline', false, null);
      return;
    }
    if (e.key === 'F12' || e.key === 'F5' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].indexOf(k) >= 0) ||
      (mod && !e.shiftKey && ['p', 'f', 'g', 'h', 'j', 'o', 'r', 'd'].indexOf(k) >= 0) ||
      (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (mod && k === 's') { e.preventDefault(); scheduleSave(true); Ink.toast('Saving — your work also saves automatically.', '', 2000); return; }
    if (editor && editor.el.contains(e.target)) {
      if (e.key && e.key.length === 1 && !mod) { W.d.keys++; W.lastKeyAt = Date.now(); }
      else if (e.key === 'Backspace' || e.key === 'Delete') { W.d.keys++; W.d.dels++; W.lastKeyAt = Date.now(); }
      else if (e.key === 'Enter') { W.d.keys++; W.lastKeyAt = Date.now(); }
    }
  }, true);

  /* ── Paste / drop / big insert guards ── */
  function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function wireEditorGuards(el) {
    el.addEventListener('copy', rememberClip);
    el.addEventListener('cut', rememberClip);
    el.addEventListener('dragstart', function (e) { e.preventDefault(); });
    el.addEventListener('beforeinput', function (e) {
      if (!W || W.internal) return;
      const t = e.inputType || '';
      if (/^insertFrom(Paste|PasteAsQuotation|Drop|Yank)$/.test(t)) { e.preventDefault(); return; }
      if (t === 'insertText' || t === 'insertReplacementText') {
        let data = e.data || '';
        if (!data && e.dataTransfer) { try { data = e.dataTransfer.getData('text/plain') || ''; } catch (x) { /* ignore */ } }
        const limit = W.relaxed ? 400 : 40;
        if (data.length > limit) {
          e.preventDefault();
          W.d.insert++;
          Ink.toast('A large block of text was blocked. Please type your own words.', 'bad', 4500);
          scheduleSave(true);
        }
      }
    });
  }

  function rememberClip() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const div = document.createElement('div');
    div.appendChild(sel.getRangeAt(0).cloneContents());
    if (W) W.clip = { text: norm(sel.toString()), html: Ink.sanitize(div.innerHTML) };
  }

  document.addEventListener('paste', function (e) {
    if (!W || $('#view-write').hidden) return;
    if (e.target && e.target.closest && e.target.closest('.modal')) return; // re-auth box
    e.preventDefault();
    if (W.locked || !editor.el.contains(e.target)) return;
    let text = '';
    try { text = e.clipboardData.getData('text/plain'); } catch (x) { /* ignore */ }
    if (W.assignment.allowSelfPaste !== false && W.clip && text && norm(text) === W.clip.text) {
      W.internal = true;
      try { document.execCommand('insertHTML', false, W.clip.html || esc(text)); } finally { W.internal = false; }
      return;
    }
    if (!text.trim()) return;
    W.d.paste++;
    Ink.toast('Pasting from outside this assignment is turned off. Your teacher can see paste attempts.', 'bad', 4500);
    scheduleSave(true);
  }, true);
  document.addEventListener('drop', function (e) { if (W && !$('#view-write').hidden) e.preventDefault(); }, true);
  document.addEventListener('dragover', function (e) { if (W && !$('#view-write').hidden) e.preventDefault(); }, true);

  /* ── Exit / submit / time up ── */
  $('#exit-btn').addEventListener('click', async function () {
    if (!W || W.locked) return;
    W.exiting = true;
    stopSpeech();
    const btn = this;
    btn.disabled = true;
    try {
      const p = payload(true);
      p.d = takeDeltas();
      await Ink.call('sExit', p);
      endWriting(true);
    } catch (err) {
      W.exiting = false;
      Ink.toast('Couldn\'t save just now — stay here and try again in a moment. (' + err.message + ')', 'bad', 5000);
    } finally { btn.disabled = false; }
  });

  $('#submit-btn').addEventListener('click', async function () {
    if (!W || W.locked) return;
    const g = W.assignment.goal || {};
    let msg = 'You won\'t be able to make changes after submitting unless your teacher reopens it.';
    if (g.min && W.words < g.min) msg = 'You have ' + W.words + ' words, and the goal is at least ' + g.min + '. ' + msg;
    if (g.max && W.words > g.max) msg = 'You have ' + W.words + ' words, which is over the ' + g.max + '-word limit. ' + msg;
    const open = W.comments.filter(function (c) { return !c.resolved; }).length;
    if (open) msg = 'You have ' + open + ' teacher comment' + (open > 1 ? 's' : '') + ' not marked done. ' + msg;
    W.exiting = true; // the dialog shouldn't count as leaving
    stopSpeech();
    const yes = await Ink.confirm('Submit your writing?', msg, 'Submit');
    if (!W) return;
    if (!yes) { W.exiting = false; arm(); return; }
    setSaveState('Submitting…', 'saving');
    try {
      const p = payload(true);
      p.d = takeDeltas();
      const r = await Ink.call('sSubmit', p);
      if (r.locked) { W.exiting = false; showLock(r.lockReason, r.lockedAt, true); return; }
      endWithMessage('ok', 'Submitted!', 'Nice work. Your writing (' + W.words + ' words) was handed in at ' + Ink.fmtTime(Date.now()) + '.');
    } catch (err) {
      W.exiting = false;
      setSaveState('Not submitted', 'bad');
      Ink.toast('Couldn\'t submit: ' + err.message, 'bad', 5000);
    }
  });

  function closedMessage(win) {
    win = win || {};
    if (win.absent) return { title: 'Marked absent today', text: 'Your teacher marked you absent today, so this assignment is closed for you. Your work is saved.' };
    if (win.dayOff) return { title: 'No school today', text: (win.label || 'No school today') + '. Assignments are closed. Your work is saved.' };
    if (win.via === 'override' || /teacher/i.test(win.label || '')) return { title: 'Closed by your teacher', text: 'Your teacher closed this assignment. Your work is saved.' };
    if (win.opensAt) return { title: 'Class time is over', text: 'This assignment opens again ' + Ink.fmtDateTime(win.opensAt) + '. Your work is saved.' };
    return { title: 'Class time is over', text: 'This assignment is closed right now. Your work is saved.' };
  }

  async function timeUp(win) {
    if (!W || W.ended || W.timeUp) return;
    W.timeUp = true;
    W.exiting = true;
    W.armed = false;
    stopSpeech();
    editor.setEditable(false);
    clearInterval(lockPoll);
    overlay('ov-lock', false);
    setSaveState('Saving…', 'saving');
    for (let i = 0; i < 4 && W; i++) {
      try {
        const p = payload(true);
        p.d = takeDeltas();
        if (W.locked) break;
        await Ink.call('sExit', p);
        break;
      } catch (err) { await new Promise(function (r) { setTimeout(r, 1500); }); }
    }
    const m = closedMessage(win);
    endWithMessage('info', m.title, m.text.replace('Your work is saved.', 'Your work is saved (' + (W ? W.words : 0) + ' words). You can still look at it from your assignment list.'));
  }

  function endWithMessage(kind, title, text) {
    if (!W) return;
    W.exiting = true;
    endWriting(false);
    $('#msg-icon').className = 'icon ' + (kind === 'ok' ? 'ok-icon' : 'info-icon');
    $('#msg-icon').innerHTML = Ink.icon(kind === 'ok' ? 'check' : 'clock');
    $('#msg-title').textContent = title;
    $('#msg-text').textContent = text;
    overlay('ov-msg', true);
  }
  $('#msg-btn').addEventListener('click', function () { overlay('ov-msg', false); loadHome(); });

  function endWriting(goHome) {
    if (!W) return;
    W.ended = true;
    W.armed = false;
    stopSpeech();
    if (spell) spell.close();
    clearTimeout(W.saveTimer);
    clearTimeout(W.retryTimer);
    clearTimeout(W.armTimer);
    W.timers.forEach(clearInterval);
    clearInterval(lockPoll);
    overlay('ov-lock', false);
    overlay('ov-fs', false);
    ['ink-cmt', 'ink-cmt-active', 'ink-spell', 'ink-tts'].forEach(TX.clear);
    leaveFullscreen();
    W = null;
    if (goHome) loadHome();
  }

  /* ───────────── Boot ───────────── */
  if (!Ink.apiUrl()) {
    show('login');
    $('#login-err').textContent = 'This site isn\'t connected to its backend yet.';
  } else if (auth && auth.token) {
    loadHome();
  } else {
    show('login');
  }
})();
