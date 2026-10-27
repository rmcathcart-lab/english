/* Inkwell — student side: sign in, assignment list, locked-down writing mode. */
(function () {
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const TOKEN_KEY = 'inkwell_student';
  const FS_OK = !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false);

  let auth = Ink.store.get(TOKEN_KEY); // { token, student }
  let home = null;
  let homeTimer = null;
  let W = null; // the active writing session

  document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = Ink.icon(el.dataset.icon); });

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
      if (!quiet) $('#assign-list').innerHTML = '<div class="empty"><div class="display">Couldn\'t load assignments</div>' + Ink.esc(err.message) + '<br><br><button class="btn" onclick="location.reload()">Try again</button></div>';
    }
    clearInterval(homeTimer);
    homeTimer = setInterval(function () { if (!W && !$('#view-home').hidden) loadHome(true); }, 45000);
  }

  function winLabel(a) {
    const w = a.win;
    if (a.work && a.work.status === 'submitted') return '<span class="pill submitted">Submitted ' + Ink.esc(Ink.fmtDateTime(a.work.submittedAt)) + '</span>';
    if (a.work && a.work.locked && w.open) return '<span class="pill locked">Locked — ask your teacher</span>';
    if (w.open) return '<span class="pill open">Open now' + (w.closesAt ? ' · until ' + Ink.esc(Ink.fmtTime(w.closesAt)) : '') + '</span>';
    if (w.opensAt) return '<span class="pill soon">Opens ' + Ink.esc(Ink.fmtDateTime(w.opensAt)) + '</span>';
    return '<span class="pill closed">' + Ink.esc(w.label || 'Closed') + '</span>';
  }

  function renderHome() {
    const list = $('#assign-list');
    const items = (home && home.assignments) || [];
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
      if (a.goal && a.goal.show && goal) meta += '<span>Goal: ' + Ink.esc(goal) + '</span>';
      if (a.work && a.work.words) meta += '<span>' + a.work.words + ' words written</span>';
      if (a.work && a.work.lastSaveAt && !done) meta += '<span>Last saved ' + Ink.esc(Ink.fmtDateTime(a.work.lastSaveAt)) + '</span>';
      let action = '';
      if (done) action = '<button class="btn" data-act="view">View</button>';
      else if (a.win.open) action = '<button class="btn primary" data-act="write"><span>' + Ink.icon('pen') + '</span>' + (a.work ? 'Continue writing' : 'Start writing') + '</button>';
      else if (a.work && a.work.words) action = '<button class="btn" data-act="view">View draft</button>';
      card.innerHTML = '<div><h3>' + Ink.esc(a.title) + '</h3><div class="meta">' + meta + '</div></div><div>' + action + '</div>';
      const b = card.querySelector('[data-act]');
      if (b) b.addEventListener('click', function () { b.dataset.act === 'view' ? openRead(a) : askStart(a); });
      list.appendChild(card);
    });
  }

  /* ───────────── Read-only view ───────────── */
  async function openRead(a) {
    show('read');
    $('#read-title').textContent = a.title;
    $('#read-doc').innerHTML = '<span class="spin"></span>';
    $('#read-meta').textContent = '';
    try {
      const r = await Ink.call('sView', { token: auth.token, aid: a.id });
      $('#read-doc').innerHTML = Ink.sanitize(r.html) || '<p class="muted"><i>Nothing written yet.</i></p>';
      const w = r.work;
      $('#read-meta').textContent = w ? (w.words + ' words' + (w.status === 'submitted' ? ' · Submitted ' + Ink.fmtDateTime(w.submittedAt) : ' · Draft, not submitted')) : '';
    } catch (err) {
      if (handleAuthError(err)) return;
      $('#read-doc').textContent = err.message;
    }
  }
  $('#read-back').addEventListener('click', function () { loadHome(); });

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

  /* ───────────── Writing mode ───────────── */
  let editor = null;
  function getEditor() {
    if (editor) return editor;
    const host = $('#editor-host');
    const wrap = document.createElement('div');
    wrap.style.display = 'contents';
    host.appendChild(wrap);
    // toolbar goes on top, then the page
    editor = Ink.makeEditor(wrap, { placeholder: 'Start writing here…', spacing: true });
    const scroll = document.createElement('div');
    scroll.className = 'page-scroll';
    const page = document.createElement('div');
    page.className = 'page';
    scroll.appendChild(page);
    wrap.appendChild(scroll);
    page.appendChild(editor.el);
    editor.onInput(onEditorInput);
    wireEditorGuards(editor.el);
    return editor;
  }

  function newSession(a) {
    return {
      aid: a.id, assignment: { title: a.title, goal: a.goal, allowSelfPaste: true }, sessionId: Ink.uuid(),
      rev: 0, savedRev: 0, saving: false, pending: false, saveTimer: 0, firstDirtyAt: 0, retryTimer: 0,
      armed: false, armTimer: 0, locked: false, lockSent: false, exiting: false, ended: false,
      closesAt: null, skew: 0, warned5: false, warned1: false, relaxed: false,
      d: { keys: 0, dels: 0, active: 0, paste: 0, insert: 0 }, lastKeyAt: 0, clip: null, words: 0, chars: 0,
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
    setSaveState('Opening…', 'saving');
    show('write');
    let r;
    try {
      r = await Ink.call('sStart', { token: auth.token, aid: a.id, sessionId: W.sessionId });
    } catch (err) {
      const s = W; W = null;
      leaveFullscreen();
      if (handleAuthError(err)) return;
      loadHome();
      Ink.toast(err.message, 'bad', 5000);
      return s;
    }
    W.skew = (r.now || Date.now()) - Date.now();
    if (r.submitted) { W.exiting = true; endWriting(false); openRead(a); return; }
    if (r.closed) {
      W.exiting = true; endWriting(false);
      Ink.toast(r.win && r.win.opensAt ? 'This assignment opens ' + Ink.fmtDateTime(r.win.opensAt) + '.' : 'This assignment is closed right now.', 'warn', 5000);
      loadHome();
      return;
    }
    W.assignment = r.assignment;
    W.relaxed = !!r.relaxed;
    W.rev = Number(r.rev) || 0;
    W.savedRev = W.rev;
    W.closesAt = r.win && r.win.closesAt ? r.win.closesAt : null;
    const prompt = Ink.sanitize(r.assignment.prompt || '');
    $('#w-prompt').innerHTML = prompt;
    $('#prompt-wrap').hidden = !prompt.replace(/<[^>]+>/g, '').trim();
    ed.setHTML(r.html || '');
    updateCounts();
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
      // The browser didn't give us full screen (or the student left it) — ask again with a click.
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

  function tickSecond() {
    if (!W || W.ended) return;
    // active writing time
    if (W.armed && !W.locked && document.hasFocus() && Date.now() - W.lastKeyAt < 30000) W.d.active++;
    // safety net in case an event was missed
    if (W.armed && !W.locked && !W.exiting) {
      if (FS_OK && !document.fullscreenElement) lockOut('Exited full screen');
      else if (!document.hasFocus()) lockOut('Left the assignment window');
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
      if (left <= 0 && !W.locked) timeUp();
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
      else if (met) txt += ' — goal met ✓';
      $('#goal-text').textContent = txt;
    }
  }

  function onEditorInput() {
    if (!W || W.locked || W.ended) return;
    W.rev++;
    updateCounts();
    scheduleSave();
  }

  function scheduleSave(soon) {
    if (!W) return;
    clearTimeout(W.saveTimer);
    if (!W.firstDirtyAt) W.firstDirtyAt = Date.now();
    const overdue = Date.now() - W.firstDirtyAt > 10000;
    W.saveTimer = setTimeout(save, soon || overdue ? 50 : 2000);
    if (!W.saving) setSaveState('Saving…', 'saving');
  }

  function takeDeltas() { const d = W.d; W.d = { keys: 0, dels: 0, active: 0, paste: 0, insert: 0 }; return d; }
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
    if (r.locked && !W.locked) return showLock(r.lockReason, r.lockedAt, true);
    if (r.closed) return timeUp();
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
      if (W) scheduleSave(true);
    } catch (err) {
      reauthOpen = false;
      Ink.toast(err.message, 'bad');
      reauth();
    }
  }

  /* ── Locking ── */
  function lockOut(reason, viaBeacon) {
    if (!W || !W.armed || W.locked || W.exiting || W.ended) return;
    W.armed = false;
    W.locked = true;
    editor.setEditable(false);
    showLock(reason, Date.now(), false);
    const p = payload(true);
    p.reason = reason;
    p.d = takeDeltas();
    if (viaBeacon) { Ink.beacon('sLock', p); W.lockSent = true; return; }
    sendLock(p, 0);
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
    try {
      const r = await Ink.call('sStatus', { token: auth.token, aid: W.aid, sessionId: W.sessionId });
      if (s !== W) return;
      if (r.superseded) { clearInterval(lockPoll); return handleServerState(r); }
      if (r.submitted) { clearInterval(lockPoll); return handleServerState(r); }
      if (!r.locked && s.lockSent) {
        clearInterval(lockPoll);
        $('#lock-waiting').hidden = true;
        $('#lock-cleared').hidden = false;
        try { new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=').play().catch(function () {}); } catch (e) { /* ignore */ }
      }
      if (r.win && !r.win.open) { clearInterval(lockPoll); timeUp(); }
    } catch (err) {
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
    endWriting(true);
  });

  /* ── Leaving detection ── */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') lockOut('Switched tabs or minimized the window', true);
  });
  window.addEventListener('blur', function () {
    setTimeout(function () { if (!document.hasFocus()) lockOut('Clicked outside the assignment or switched to another app'); }, 120);
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
    if (e.key === 'F12' || e.key === 'F5' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].indexOf(k) >= 0) ||
      (mod && !e.shiftKey && ['p', 'f', 'g', 'h', 'u', 'j', 'o', 'r', 'd'].indexOf(k) >= 0) ||
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
      if (!W) return;
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
    W && (W.clip = { text: norm(sel.toString()), html: Ink.sanitize(div.innerHTML) });
  }

  document.addEventListener('paste', function (e) {
    if (!W || $('#view-write').hidden) return;
    if (e.target && e.target.closest && e.target.closest('.modal')) return; // re-auth box
    e.preventDefault();
    if (W.locked || !editor.el.contains(e.target)) return;
    let text = '';
    try { text = e.clipboardData.getData('text/plain'); } catch (x) { /* ignore */ }
    if (W.assignment.allowSelfPaste !== false && W.clip && text && norm(text) === W.clip.text) {
      document.execCommand('insertHTML', false, W.clip.html || Ink.esc(text));
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
    W.exiting = true; // the dialog shouldn't count as leaving
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

  async function timeUp() {
    if (!W || W.ended || W.timeUp) return;
    W.timeUp = true;
    W.exiting = true;
    W.armed = false;
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
    endWithMessage('info', 'Class time is over', 'Your work has been saved (' + (W ? W.words : 0) + ' words). You can keep going the next time this assignment opens.');
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
    clearTimeout(W.saveTimer);
    clearTimeout(W.retryTimer);
    clearTimeout(W.armTimer);
    W.timers.forEach(clearInterval);
    clearInterval(lockPoll);
    overlay('ov-lock', false);
    overlay('ov-fs', false);
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
