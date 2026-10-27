/* Inkwell — teacher dashboard. */
(function () {
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  const esc = Ink.esc;
  const TOKEN_KEY = 'inkwell_teacher';
  const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const T = {
    token: (Ink.store.get(TOKEN_KEY) || {}).token || '',
    boot: null,
    tab: 'live',
    live: { aid: Ink.store.get('inkwell_live_aid') || '', data: null, timer: 0, busy: false, sort: 'name', cls: '', sim: false, simTimer: 0, locked: {}, sound: Ink.store.get('inkwell_sound') !== false },
    drawer: null,
    selA: null,
    selC: null
  };

  document.querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = Ink.icon(el.dataset.icon); });

  /* ───────────── Auth ───────────── */
  $('#t-login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const btn = $('#t-login-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
    $('#t-login-err').textContent = '';
    try {
      const r = await Ink.call('tLogin', { password: $('#t-pw').value });
      T.token = r.token;
      Ink.store.set(TOKEN_KEY, { token: r.token });
      $('#t-pw').value = '';
      start();
    } catch (err) {
      $('#t-login-err').textContent = err.message;
    } finally { btn.disabled = false; btn.textContent = 'Sign in'; }
  });
  $('#t-logout').addEventListener('click', function () {
    Ink.store.del(TOKEN_KEY); T.token = ''; stopLive(); showLogin();
  });
  function showLogin(msg) {
    $('#t-app').hidden = true; $('#t-login').hidden = false;
    $('#t-login-err').textContent = msg || '';
    setTimeout(function () { $('#t-pw').focus(); }, 50);
  }

  async function call(action, data, opts) {
    try {
      return await Ink.call(action, Object.assign({ token: T.token }, data || {}), opts);
    } catch (err) {
      if (err.code === 'AUTH') { Ink.store.del(TOKEN_KEY); T.token = ''; stopLive(); closeDrawer(); showLogin(err.message); }
      throw err;
    }
  }

  async function start() {
    $('#t-login').hidden = true; $('#t-app').hidden = false;
    $('#t-main').innerHTML = '<div class="empty"><span class="spin"></span></div>';
    try {
      T.boot = await call('tBoot');
      go(T.tab);
    } catch (err) {
      if (err.code !== 'AUTH') $('#t-main').innerHTML = '<div class="empty"><div class="display">Couldn\'t load</div>' + esc(err.message) + '<br><br><button class="btn" onclick="location.reload()">Try again</button></div>';
    }
  }

  async function reboot() { T.boot = await call('tBoot'); }

  /* ───────────── Tabs ───────────── */
  $('#tabs').addEventListener('click', function (e) {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });
  function go(tab) {
    T.tab = tab;
    $$('#tabs .tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    if (tab !== 'live') stopLive();
    closeDrawer();
    const main = $('#t-main');
    main.innerHTML = '';
    if (T.boot && T.boot.settings.defaultPassword && tab !== 'settings') {
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = '<span>You\'re still using the starter teacher password. Change it before sharing the site with students.</span><button class="btn sm">Change password</button>';
      b.querySelector('button').onclick = function () { go('settings'); };
      main.appendChild(b);
    }
    const host = document.createElement('div');
    main.appendChild(host);
    ({ live: renderLive, assignments: renderAssignments, classes: renderClasses, settings: renderSettings })[tab](host);
  }

  function className(id) { const c = (T.boot.classes || []).find(function (x) { return x.id === id; }); return c ? c.name : ''; }
  function studentsIn(cids) { return T.boot.students.filter(function (s) { return cids.indexOf(s.classId) >= 0; }); }

  function winText(w) {
    if (!w) return 'Not assigned';
    if (w.open) return 'Open' + (w.closesAt ? ' until ' + Ink.fmtTime(w.closesAt) : '') + (w.via === 'override' ? ' (opened by you)' : '');
    if (w.opensAt) return 'Opens ' + Ink.fmtDateTime(w.opensAt);
    return w.label || 'Closed';
  }

  /* ════════════════════════ LIVE ════════════════════════ */
  function renderLive(host) {
    const list = T.boot.assignments;
    if (!list.length) {
      host.innerHTML = '<div class="empty card" style="padding:60px"><div class="display">No assignments yet</div><p>Create one and assign it to a class to watch students write live.</p><button class="btn primary" id="lv-new">Create an assignment</button></div>';
      $('#lv-new').onclick = function () { T.selA = 'new'; go('assignments'); };
      return;
    }
    if (!list.find(function (a) { return a.id === T.live.aid; })) {
      const open = list.find(function (a) { return Object.values(a.windows || {}).some(function (w) { return w.open; }); });
      T.live.aid = (open || list[0]).id;
    }
    host.innerHTML =
      '<div class="live-head">' +
      '  <div class="left"><select class="assign-picker" id="lv-assign" aria-label="Assignment"></select><div class="windows" id="lv-windows"></div></div>' +
      '  <div class="live-tools">' +
      '    <div class="dropdown"><button class="btn" id="lv-open-btn">' + Ink.icon('clock') + 'Open / close</button></div>' +
      '    <button class="btn danger" id="lv-clear-all" hidden>' + Ink.icon('unlock') + 'Clear all locked</button>' +
      '    <button class="btn" id="lv-sim" hidden title="Make the demo students type, get locked, and submit so you can see the dashboard move">' + Ink.icon('play') + 'Simulate class</button>' +
      '    <button class="btn ghost" id="lv-sound" title="Chime when a student gets locked out"></button>' +
      '    <div class="dropdown"><button class="btn" id="lv-export-btn">' + Ink.icon('download') + 'Export</button></div>' +
      '  </div>' +
      '</div>' +
      '<div class="tiles" id="lv-tiles"></div>' +
      '<div class="live-grid">' +
      '  <div><div class="cards-bar"><div class="row" style="gap:8px"><select class="input" id="lv-sort" style="width:auto;padding:7px 10px"><option value="name">Sort: first name</option><option value="last">Sort: last name</option><option value="status">Sort: needs attention</option><option value="words">Sort: most words</option><option value="wordsAsc">Sort: fewest words</option><option value="active">Sort: last active</option></select><select class="input" id="lv-cls" style="width:auto;padding:7px 10px" hidden></select></div><span class="muted small" id="lv-updated"></span></div>' +
      '  <div class="scards" id="lv-cards"><div class="empty"><span class="spin"></span></div></div></div>' +
      '  <div class="card feed"><h4>Activity</h4><div id="lv-feed"><div class="muted small">Nothing yet.</div></div></div>' +
      '</div>';
    const sel = $('#lv-assign');
    list.forEach(function (a) {
      const o = document.createElement('option');
      o.value = a.id; o.textContent = a.title;
      sel.appendChild(o);
    });
    sel.value = T.live.aid;
    sel.onchange = function () { T.live.aid = sel.value; Ink.store.set('inkwell_live_aid', sel.value); T.live.data = null; T.live.locked = {}; stopSim(); $('#lv-cards').innerHTML = '<div class="empty"><span class="spin"></span></div>'; pollLive(); };
    $('#lv-sort').value = T.live.sort;
    $('#lv-sort').onchange = function () { T.live.sort = this.value; drawLive(); };
    $('#lv-cls').onchange = function () { T.live.cls = this.value; drawLive(); };
    $('#lv-clear-all').onclick = async function () {
      const n = (T.live.data.rows || []).filter(function (r) { return r.state === 'locked'; }).length;
      if (!(await Ink.confirm('Clear all locked students?', n + ' student' + (n === 1 ? '' : 's') + ' will be able to return to their writing.', 'Clear all'))) return;
      try { await call('tUnlock', { aid: T.live.aid, all: true }); Ink.toast('Cleared.', 'good'); pollLive(); } catch (err) { Ink.toast(err.message, 'bad'); }
    };
    $('#lv-sim').onclick = function () { T.live.sim ? stopSim() : startSim(); };
    $('#lv-sound').onclick = function () { T.live.sound = !T.live.sound; Ink.store.set('inkwell_sound', T.live.sound); soundBtn(); if (T.live.sound) chime(); };
    soundBtn();
    $('#lv-open-btn').onclick = function (e) { e.stopPropagation(); openMenu(this, openCloseItems()); };
    $('#lv-export-btn').onclick = function (e) {
      e.stopPropagation();
      openMenu(this, [
        { label: 'Print all writing', fn: function () { exportAll('print'); } },
        { label: 'Download all as Word (.doc)', fn: function () { exportAll('doc'); } },
        { label: 'Download word counts (.csv)', fn: function () { exportAll('csv'); } }
      ]);
    };
    startLive();
  }

  function soundBtn() { const b = $('#lv-sound'); if (b) b.innerHTML = Ink.icon(T.live.sound ? 'bell' : 'bellOff'); }

  function openCloseItems() {
    const a = T.live.data && T.live.data.assignment;
    const items = [
      { label: 'Open now for 30 minutes', fn: function () { override('open', { minutes: 30 }); } },
      { label: 'Open now for 60 minutes', fn: function () { override('open', { minutes: 60 }); } },
      { label: 'Open for the rest of today', fn: function () { override('open', { until: 'today' }); } },
      { label: 'Open until I close it', fn: function () { override('open', {}); } },
      { label: 'Close now', fn: function () { override('closed', {}); } }
    ];
    if (a && a.override && a.override.mode) items.push({ label: 'Go back to the normal schedule', fn: function () { override('', {}); } });
    return items;
  }

  async function override(mode, extra) {
    try {
      await call('tOverride', Object.assign({ aid: T.live.aid, mode: mode }, extra));
      Ink.toast(mode === 'open' ? 'Opened.' : mode === 'closed' ? 'Closed. Students writing now will be saved and sent back to their list.' : 'Back on the normal schedule.', 'good', 4000);
      await reboot();
      pollLive();
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

  let openMenuEl = null;
  function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    items.forEach(function (it) {
      const b = document.createElement('button');
      b.textContent = it.label;
      b.onclick = function () { closeMenu(); it.fn(); };
      m.appendChild(b);
    });
    anchor.parentNode.appendChild(m);
    openMenuEl = m;
  }
  function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
  document.addEventListener('click', function (e) { if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu(); });

  function startLive() {
    stopLive();
    pollLive();
    T.live.timer = setInterval(pollLive, 5000);
  }
  function stopLive() {
    clearInterval(T.live.timer);
    T.live.timer = 0;
    stopSim();
  }

  async function pollLive() {
    if (T.live.busy || T.tab !== 'live' || document.hidden) return;
    T.live.busy = true;
    const aid = T.live.aid;
    try {
      const d = await call('tMonitor', { aid: aid });
      if (aid !== T.live.aid || T.tab !== 'live') return;
      T.live.data = d;
      T.live.serverSkew = d.now - Date.now();
      drawLive();
    } catch (err) {
      const u = $('#lv-updated');
      if (u) u.textContent = 'Connection problem — retrying…';
    } finally { T.live.busy = false; }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && T.tab === 'live') pollLive(); });

  const STATE_ORDER = { locked: 0, idle: 1, offline: 2, writing: 3, none: 4, submitted: 5 };
  const STATE_LABEL = { locked: 'Locked', idle: 'Idle', offline: 'Not here', writing: 'Writing', none: 'Not started', submitted: 'Submitted' };

  function drawLive() {
    const d = T.live.data;
    if (!d || !$('#lv-cards')) return;
    const a = d.assignment;
    const now = d.now;
    // class windows
    $('#lv-windows').innerHTML = (a.classIds || []).map(function (cid) {
      const w = d.windows[cid];
      return '<span class="pill ' + (w && w.open ? 'open' : (w && w.opensAt ? 'soon' : 'closed')) + '">' + esc(className(cid).replace(/\s*\(Demo\)$/, '')) + ': ' + esc(winText(w)) + '</span>';
    }).join('') + (a.override && a.override.mode ? ' <span class="muted small">Manual override is on.</span>' : '');
    // class filter
    const clsSel = $('#lv-cls');
    if ((a.classIds || []).length > 1) {
      clsSel.hidden = false;
      const want = '<option value="">All classes</option>' + a.classIds.map(function (c) { return '<option value="' + c + '">' + esc(className(c)) + '</option>'; }).join('');
      if (clsSel.dataset.sig !== want) { clsSel.innerHTML = want; clsSel.dataset.sig = want; clsSel.value = T.live.cls; }
    } else { clsSel.hidden = true; T.live.cls = ''; }

    let rows = d.rows.slice();
    if (T.live.cls) rows = rows.filter(function (r) { return r.classId === T.live.cls; });

    // tiles
    const c = { writing: 0, locked: 0, submitted: 0, none: 0 };
    let sum = 0, n = 0, paste = 0;
    rows.forEach(function (r) {
      if (r.state === 'writing' || r.state === 'idle') c.writing++;
      if (r.state === 'locked') c.locked++;
      if (r.state === 'submitted') c.submitted++;
      if (r.state === 'none') c.none++;
      if (r.state !== 'none') { sum += r.words || 0; n++; }
      paste += (r.pasteBlocked || 0) + (r.insertBlocked || 0);
    });
    $('#lv-tiles').innerHTML =
      tile(c.writing, 'Writing now', 'green') + tile(c.locked, 'Locked out', c.locked ? 'red' : '') + tile(c.submitted, 'Submitted', 'blue') +
      tile(c.none, 'Not started', '') + tile(n ? Math.round(sum / n) : 0, 'Average words', '') + tile(paste, 'Pastes blocked', paste ? 'red' : '');
    const lc = $('#lock-count');
    lc.hidden = !c.locked; lc.textContent = c.locked;
    $('#lv-clear-all').hidden = !c.locked;
    $('#lv-sim').hidden = !d.demo;

    // chime for newly locked
    const nowLocked = {};
    let fresh = false;
    rows.forEach(function (r) { if (r.state === 'locked') { nowLocked[r.sid] = r.lockedAt; if (T.live.locked[r.sid] !== r.lockedAt) fresh = true; } });
    if (fresh && T.live.hadData && T.live.sound) chime();
    T.live.locked = nowLocked;
    T.live.hadData = true;

    // sort
    const nm = function (r) { return (r.first + ' ' + r.last).toLowerCase(); };
    const ln = function (r) { return (r.last + ' ' + r.first).toLowerCase(); };
    const s = T.live.sort;
    rows.sort(function (x, y) {
      if (s === 'last') return ln(x) < ln(y) ? -1 : 1;
      if (s === 'status') return (STATE_ORDER[x.state] - STATE_ORDER[y.state]) || (nm(x) < nm(y) ? -1 : 1);
      if (s === 'words') return (y.words || 0) - (x.words || 0);
      if (s === 'wordsAsc') return (x.words || 0) - (y.words || 0);
      if (s === 'active') return (y.lastSaveAt || 0) - (x.lastSaveAt || 0);
      return nm(x) < nm(y) ? -1 : 1;
    });
    const goal = (a.settings || {});
    const g = { min: goal.minWords, max: goal.maxWords };
    const cards = $('#lv-cards');
    cards.innerHTML = rows.length ? '' : '<div class="empty">No students in this assignment\'s classes yet.</div>';
    rows.forEach(function (r) {
      const el = document.createElement('div');
      el.className = 'card scard ' + r.state + (T.drawer && T.drawer.sid === r.sid ? ' sel' : '');
      const acc = r.accom && (r.accom.extended || r.accom.relaxed) ? '<span class="badge-acc" title="' + esc([r.accom.extended ? 'Extended access' : '', r.accom.relaxed ? 'Relaxed input limit (dictation)' : ''].filter(String).join(', ')) + '">ACC</span>' : '';
      let sub = '';
      if (r.state !== 'none') {
        const bits = [];
        if (r.state === 'submitted') bits.push('Handed in ' + Ink.fmtTime(r.submittedAt));
        else bits.push(r.lastSaveAt ? 'Typed ' + Ink.ago(r.lastSaveAt, now) : 'Opened, no typing yet');
        if (r.lockCount) bits.push('<span class="flag">' + r.lockCount + '× locked</span>');
        if (r.pasteBlocked) bits.push('<span class="flag">' + r.pasteBlocked + ' paste' + (r.pasteBlocked > 1 ? 's' : '') + '</span>');
        if (r.insertBlocked) bits.push('<span class="flag">' + r.insertBlocked + ' big insert</span>');
        sub = '<div class="sub">' + bits.join('<span>·</span>') + '</div>';
      }
      const pct = Ink.goalPct(r.words || 0, g);
      el.innerHTML =
        '<div class="nm"><span>' + esc(r.first + ' ' + r.last) + ' ' + acc + '</span><span class="pill ' + r.state + '">' + STATE_LABEL[r.state] + '</span></div>' +
        (r.state === 'none' ? '<div class="sub" style="margin-top:12px">Hasn\'t opened it yet</div>' :
          '<div class="wc">' + (r.words || 0) + '<small>words</small></div>' +
          ((g.min || g.max) ? '<div class="goal-bar' + (g.min && r.words >= g.min ? ' met' : '') + '"><i style="width:' + pct + '%"></i></div>' : '') + sub) +
        (r.state === 'locked' ? '<div class="why">' + esc(r.lockReason || 'Left the window') + ' · ' + esc(Ink.fmtTime(r.lockedAt)) + '</div><button class="btn sm teal clear-btn" data-clear>' + Ink.icon('unlock') + 'Clear</button>' : '');
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-clear]')) { e.stopPropagation(); clearStudent(r.sid, e.target.closest('button')); return; }
        if (r.state === 'none') { Ink.toast(r.first + ' hasn\'t opened this assignment yet.'); return; }
        openDrawer(r.sid);
      });
      cards.appendChild(el);
    });

    // feed
    const sname = {};
    d.rows.forEach(function (r) { sname[r.sid] = r.first + ' ' + r.last; });
    $('#lv-feed').innerHTML = d.events.length ? d.events.map(function (e) { return evHtml(e, sname[e.sid]); }).join('') : '<div class="muted small">Nothing yet.</div>';
    $('#lv-updated').textContent = 'Updated ' + Ink.fmtTimeSec(Date.now());
    if (T.drawer) refreshDrawerHeader();
  }

  function tile(v, label, cls) { return '<div class="card tile ' + (cls || '') + '"><b>' + v + '</b><span>' + label + '</span></div>'; }

  const EV_ICON = { start: '▶', resume: '↻', locked: '🔒', unlocked: '✓', submit: '✓', exit: '⏏', paste: '⎘', insert: '!', burst: '⚡', unusual: '?', returned: '↺' };
  const EV_TEXT = {
    start: 'started writing', resume: 'opened the assignment', locked: 'was locked out', unlocked: 'was cleared', submit: 'submitted',
    exit: 'saved and exited', paste: 'tried to paste', insert: 'had a big insert blocked', burst: 'added a lot of text quickly', unusual: 'had text appear without typing', returned: 'was given the assignment back'
  };
  function evHtml(e, who) {
    return '<div class="ev"><span class="ic ' + esc(e.type) + '">' + (EV_ICON[e.type] || '•') + '</span><div>' +
      (who ? '<b>' + esc(who) + '</b> ' : '') + esc(who ? (EV_TEXT[e.type] || e.type) : (e.detail || EV_TEXT[e.type] || e.type)) +
      (who && e.detail && e.type !== 'start' && e.type !== 'resume' ? '<div class="muted small">' + esc(e.detail) + '</div>' : '') +
      '<time>' + esc(Ink.fmtTimeSec(e.ts)) + '</time></div></div>';
  }

  async function clearStudent(sid, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    try {
      await call('tUnlock', { aid: T.live.aid, sid: sid });
      Ink.toast('Cleared — they can return to their writing now.', 'good');
      await pollLive();
      if (T.drawer && T.drawer.sid === sid) loadDrawer(true);
    } catch (err) { Ink.toast(err.message, 'bad'); if (btn) btn.disabled = false; }
  }

  let audioCtx = null;
  function chime() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [660, 520].forEach(function (f, i) {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.16);
        g.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + i * 0.16 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.16 + 0.3);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.16); o.stop(audioCtx.currentTime + i * 0.16 + 0.32);
      });
    } catch (e) { /* ignore */ }
  }

  function startSim() {
    T.live.sim = true;
    const b = $('#lv-sim');
    if (b) { b.innerHTML = Ink.icon('pause') + 'Stop simulation'; b.classList.add('teal'); }
    Ink.toast('Simulating: demo students will type, get locked out, and submit. Try clearing someone!', '', 5000);
    const tick = async function () {
      if (!T.live.sim) return;
      try { await call('tDemoTick', { aid: T.live.aid }); pollLive(); } catch (e) { /* ignore */ }
      if (T.live.sim) T.live.simTimer = setTimeout(tick, 4000);
    };
    tick();
  }
  function stopSim() {
    T.live.sim = false;
    clearTimeout(T.live.simTimer);
    const b = $('#lv-sim');
    if (b) { b.innerHTML = Ink.icon('play') + 'Simulate class'; b.classList.remove('teal'); }
  }

  /* ───────────── Student drawer ───────────── */
  function openDrawer(sid) {
    closeDrawer();
    T.drawer = { sid: sid, aid: T.live.aid, mode: 'live', data: null, revCache: {}, timer: 0, fullAt: 0, idx: -1, playing: 0 };
    const back = document.createElement('div');
    back.className = 'drawer-back';
    back.onclick = closeDrawer;
    const dr = document.createElement('aside');
    dr.className = 'drawer';
    dr.innerHTML =
      '<div class="drawer-head"><div><h2 id="dr-name"></h2><div class="muted small" id="dr-sub"></div></div>' +
      '<div class="row" style="gap:8px" id="dr-actions"></div></div>' +
      '<div class="drawer-body">' +
      '  <div class="drawer-doc">' +
      '    <div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="mode-switch"><button data-mode="live" class="on"><span class="live-dot"></span>Live</button><button data-mode="playback">Playback</button></div><span class="muted small" id="dr-updated"></span></div>' +
      '    <div class="playback" id="dr-pb" hidden><div class="row" style="gap:10px;flex-wrap:nowrap"><button class="icon-btn" id="dr-play" title="Play">' + Ink.icon('play') + '</button><input type="range" id="dr-range" min="0" max="0" value="0"></div><div class="pb-meta"><span id="dr-pb-when"></span><span id="dr-pb-words"></span></div></div>' +
      '    <div class="page"><div class="doc" id="dr-doc"><span class="spin"></span></div></div>' +
      '  </div>' +
      '  <div class="drawer-side">' +
      '    <div><h4>Stats</h4><dl class="kv" id="dr-kv"></dl></div>' +
      '    <div><h4>Words over time</h4><div id="dr-spark" class="muted small">—</div></div>' +
      '    <div><h4>Timeline</h4><div class="timeline" id="dr-tl"></div></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(back);
    document.body.appendChild(dr);
    T.drawer.el = dr; T.drawer.back = back;
    $$('.mode-switch button', dr).forEach(function (b) {
      b.onclick = function () { setMode(b.dataset.mode); };
    });
    $('#dr-range', dr).oninput = function () { showRevision(Number(this.value)); };
    $('#dr-play', dr).onclick = togglePlay;
    document.addEventListener('keydown', drawerKey);
    refreshDrawerHeader();
    loadDrawer(true);
    T.drawer.timer = setInterval(function () { if (T.drawer && T.drawer.mode === 'live') loadDrawer(Date.now() - T.drawer.fullAt > 20000); }, 3000);
    drawLive();
  }
  function drawerKey(e) { if (e.key === 'Escape' && !$('.modal-back')) closeDrawer(); }
  function closeDrawer() {
    if (!T.drawer) return;
    clearInterval(T.drawer.timer);
    clearInterval(T.drawer.playing);
    T.drawer.el.remove(); T.drawer.back.remove();
    document.removeEventListener('keydown', drawerKey);
    T.drawer = null;
    drawLive();
  }

  function rowFor(sid) { return T.live.data && T.live.data.rows.find(function (r) { return r.sid === sid; }); }

  function refreshDrawerHeader() {
    const D = T.drawer;
    if (!D) return;
    const r = rowFor(D.sid);
    if (!r) return;
    $('#dr-name', D.el).innerHTML = esc(r.first + ' ' + r.last) + ' <span class="pill ' + r.state + '" style="vertical-align:middle">' + STATE_LABEL[r.state] + '</span>';
    $('#dr-sub', D.el).textContent = className(r.classId) + (r.state === 'locked' ? ' · ' + (r.lockReason || '') : '');
    const acts = $('#dr-actions', D.el);
    const sig = r.state + '|' + D.sid;
    if (acts.dataset.sig === sig) return;
    acts.dataset.sig = sig;
    acts.innerHTML = '';
    const add = function (label, icon, cls, fn) {
      const b = document.createElement('button');
      b.className = 'btn sm ' + (cls || '');
      b.innerHTML = (icon ? Ink.icon(icon) : '') + label;
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    if (r.state === 'locked') add('Clear lock', 'unlock', 'teal', function () { clearStudent(D.sid, this); });
    else if (r.state === 'writing' || r.state === 'idle' || r.state === 'offline') add('Pause student', 'lock', 'danger', async function () {
      if (!(await Ink.confirm('Pause ' + r.first + '?', 'Their screen locks within about 10 seconds, and they\'ll need you to clear them.', 'Pause', true))) return;
      try { await call('tLock', { aid: D.aid, sid: D.sid }); Ink.toast('Paused.', 'good'); pollLive(); } catch (err) { Ink.toast(err.message, 'bad'); }
    });
    if (r.state === 'submitted') add('Reopen for editing', 'refresh', '', async function () {
      if (!(await Ink.confirm('Give it back to ' + r.first + '?', 'They\'ll be able to edit and submit again while the assignment is open.', 'Reopen'))) return;
      try { await call('tReturn', { aid: D.aid, sid: D.sid }); Ink.toast('Reopened.', 'good'); pollLive(); } catch (err) { Ink.toast(err.message, 'bad'); }
    });
    add('', 'print', 'ghost', function () { printOne(); }).title = 'Print';
    add('', 'download', 'ghost', function () { downloadOne(); }).title = 'Download as Word';
    add('', 'x', 'ghost', closeDrawer).title = 'Close';
  }

  async function loadDrawer(full) {
    const D = T.drawer;
    if (!D || D.loading) return;
    D.loading = true;
    try {
      const r = await call('tWork', { aid: D.aid, sid: D.sid, light: !full });
      if (T.drawer !== D) return;
      if (full) { D.data = r; D.fullAt = Date.now(); }
      else if (D.data) { D.data.work = r.work; D.data.html = r.html; }
      else D.data = r;
      if (D.mode === 'live') $('#dr-doc', D.el).innerHTML = Ink.sanitize(r.html) || '<p class="muted"><i>Nothing written yet.</i></p>';
      $('#dr-updated', D.el).textContent = 'Updated ' + Ink.fmtTimeSec(Date.now());
      drawDrawerSide();
    } catch (err) {
      if (T.drawer === D) $('#dr-updated', D.el).textContent = 'Connection problem — retrying…';
    } finally { D.loading = false; }
  }

  function drawDrawerSide() {
    const D = T.drawer;
    const w = D.data && D.data.work;
    if (!w) { $('#dr-kv', D.el).innerHTML = '<dt>Status</dt><dd>Not started</dd>'; return; }
    const kpc = w.chars ? w.keystrokes / w.chars : 0;
    const wpm = w.activeSec > 30 ? Math.round(w.words / (w.activeSec / 60)) : 0;
    const kv = [
      ['Words', w.words], ['Characters', w.chars],
      ['Started', Ink.fmtDateTime(w.startedAt)],
      ['Last typed', w.lastSaveAt ? Ink.ago(w.lastSaveAt) : '—'],
      ['Active writing time', Ink.dur(w.activeSec)],
      ['Writing speed', wpm ? wpm + ' words/min' : '—'],
      ['Keystrokes', w.keystrokes.toLocaleString()],
      ['Keystrokes per character', kpc ? kpc.toFixed(2) : '—', kpc && w.chars > 150 && kpc < 0.85],
      ['Backspaces/deletes', w.deletions.toLocaleString()],
      ['Times locked', w.lockCount, w.lockCount > 0],
      ['Paste attempts blocked', w.pasteBlocked, w.pasteBlocked > 0],
      ['Big inserts blocked', w.insertBlocked, w.insertBlocked > 0]
    ];
    if (w.submittedAt && w.status === 'submitted') kv.push(['Submitted', Ink.fmtDateTime(w.submittedAt)]);
    $('#dr-kv', D.el).innerHTML = kv.map(function (k) { return '<dt>' + esc(k[0]) + '</dt><dd' + (k[2] ? ' class="flag"' : '') + '>' + esc(String(k[1])) + '</dd>'; }).join('') +
      '<dt style="grid-column:1/-1;font-size:12px;margin-top:4px">Typing produces about 1.1–1.6 keystrokes per character. Much lower means text appeared without being typed here.</dt>';
    const revs = (D.data.revisions || []);
    // sparkline
    const pts = revs.map(function (r) { return [r.ts, r.words]; });
    if (w.lastSaveAt) pts.push([w.lastSaveAt, w.words]);
    if (pts.length >= 2) {
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
      const mx = Math.max.apply(null, pts.map(function (p) { return p[1]; })) || 1;
      const path = pts.map(function (p, i) { return (i ? 'L' : 'M') + (((p[0] - t0) / Math.max(1, t1 - t0)) * 236 + 2).toFixed(1) + ' ' + (52 - (p[1] / mx) * 48).toFixed(1); }).join(' ');
      $('#dr-spark', D.el).innerHTML = '<svg class="spark" viewBox="0 0 240 56" preserveAspectRatio="none"><path d="' + path + '" fill="none" stroke="#1c6b66" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="row muted small" style="justify-content:space-between"><span>' + esc(Ink.fmtTime(t0)) + '</span><span>' + esc(Ink.fmtTime(t1)) + '</span></div>';
    } else $('#dr-spark', D.el).textContent = 'Not enough history yet.';
    // timeline
    if (D.data.events) $('#dr-tl', D.el).innerHTML = D.data.events.slice().reverse().map(function (e) { return evHtml(e, null); }).join('') || '<div class="muted small">No activity yet.</div>';
    // playback range
    const range = $('#dr-range', D.el);
    range.max = revs.length;
    if (D.mode === 'live') range.value = revs.length;
  }

  function setMode(mode) {
    const D = T.drawer;
    if (!D) return;
    D.mode = mode;
    $$('.mode-switch button', D.el).forEach(function (b) { b.classList.toggle('on', b.dataset.mode === mode); });
    $('#dr-pb', D.el).hidden = mode !== 'playback';
    clearInterval(D.playing); D.playing = 0;
    $('#dr-play', D.el).innerHTML = Ink.icon('play');
    if (mode === 'live') { loadDrawer(true); return; }
    const revs = (D.data && D.data.revisions) || [];
    if (!revs.length) { Ink.toast('No saved history yet — snapshots are kept about every 90 seconds while a student writes.'); }
    $('#dr-range', D.el).max = revs.length;
    $('#dr-range', D.el).value = 0;
    showRevision(0);
  }

  async function showRevision(i) {
    const D = T.drawer;
    if (!D || !D.data) return;
    const revs = D.data.revisions || [];
    D.idx = i;
    const isCurrent = i >= revs.length;
    const when = isCurrent ? (D.data.work && D.data.work.lastSaveAt) : revs[i].ts;
    const words = isCurrent ? (D.data.work && D.data.work.words) : revs[i].words;
    $('#dr-pb-when', D.el).textContent = (isCurrent ? 'Latest · ' : 'Snapshot ' + (i + 1) + ' of ' + revs.length + ' · ') + Ink.fmtTimeSec(when);
    $('#dr-pb-words', D.el).textContent = (words || 0) + ' words';
    let html;
    if (isCurrent) html = D.data.html;
    else if (D.revCache[revs[i].row] != null) html = D.revCache[revs[i].row];
    else {
      $('#dr-doc', D.el).style.opacity = '.5';
      try {
        const r = await call('tRevision', { aid: D.aid, sid: D.sid, row: revs[i].row });
        D.revCache[revs[i].row] = r.html;
        html = r.html;
      } catch (err) { Ink.toast(err.message, 'bad'); return; }
      finally { if (T.drawer === D) $('#dr-doc', D.el).style.opacity = ''; }
      if (T.drawer !== D || D.idx !== i) return;
    }
    $('#dr-doc', D.el).innerHTML = Ink.sanitize(html) || '<p class="muted"><i>Empty.</i></p>';
  }

  function togglePlay() {
    const D = T.drawer;
    if (!D) return;
    if (D.playing) { clearInterval(D.playing); D.playing = 0; $('#dr-play', D.el).innerHTML = Ink.icon('play'); return; }
    const range = $('#dr-range', D.el);
    if (Number(range.value) >= Number(range.max)) range.value = 0;
    $('#dr-play', D.el).innerHTML = Ink.icon('pause');
    showRevision(Number(range.value));
    D.playing = setInterval(function () {
      const v = Number(range.value) + 1;
      if (v > Number(range.max)) { togglePlay(); return; }
      range.value = v;
      showRevision(v);
    }, 1100);
  }

  /* ───────────── Export ───────────── */
  function docShell(title, body) {
    return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>' + esc(title) + '</title>' +
      '<style>body{font-family:"Times New Roman",serif;font-size:12pt;line-height:2}h1{font-size:14pt;text-align:center;font-weight:bold}h2{font-size:13pt}.fi{text-indent:.5in}p{margin:0}.hdr{font-family:Arial,sans-serif;font-size:10pt;color:#555;line-height:1.4;margin-bottom:12pt;border-bottom:1px solid #999;padding-bottom:6pt}blockquote{margin-left:.5in}</style></head><body>' + body + '</body></html>';
  }
  function itemHeader(it, title) {
    return '<div class="hdr"><b>' + esc(it.first + ' ' + it.last) + '</b> · ' + esc(it.className) + '<br>' + esc(title) + ' · ' + it.words + ' words · ' +
      (it.status === 'submitted' ? 'Submitted ' + esc(new Date(it.submittedAt).toLocaleString()) : it.status === 'none' ? 'Not started' : 'Not submitted (draft)') + '</div>';
  }
  function download(name, mime, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name.replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function printHtml(title, body) {
    const w = window.open('', '_blank');
    if (!w) { Ink.toast('Your browser blocked the print window. Allow pop-ups for this site.', 'warn'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><link href="https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,600;1,400&display=swap" rel="stylesheet"><style>body{font-family:Newsreader,Georgia,serif;font-size:13pt;line-height:1.9;max-width:7in;margin:.6in auto;color:#111}h1{font-size:17pt;text-align:center}h2{font-size:14pt}.fi{text-indent:2.5em}p{margin:0 0 .3em}.hdr{font-family:system-ui,sans-serif;font-size:10pt;color:#555;line-height:1.4;border-bottom:1px solid #bbb;padding-bottom:6px;margin-bottom:18px}.item{page-break-after:always}.item:last-child{page-break-after:auto}blockquote{margin-left:2.5em}@media print{body{margin:0 auto}}</style></head><body>' + body + '<script>window.onload=function(){setTimeout(function(){window.print()},400)}<\/script></body></html>');
    w.document.close();
  }
  async function exportAll(kind) {
    Ink.toast('Preparing…', '', 1500);
    try {
      const r = await call('tExport', { aid: T.live.aid });
      const title = r.assignment.title;
      let items = r.items.slice().sort(function (x, y) { return (x.last + x.first).localeCompare(y.last + y.first); });
      if (T.live.cls) items = items.filter(function (it) { return className(T.live.cls) === it.className; });
      if (kind === 'csv') {
        const lines = [['Last name', 'First name', 'Class', 'Status', 'Words', 'Submitted']].concat(items.map(function (it) {
          return [it.last, it.first, it.className, it.status === 'none' ? 'not started' : it.status, it.words, it.submittedAt ? new Date(it.submittedAt).toLocaleString() : ''];
        }));
        download(title + ' - word counts.csv', 'text/csv', lines.map(function (l) { return l.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'));
        return;
      }
      const started = items.filter(function (it) { return it.status !== 'none'; });
      if (!started.length) { Ink.toast('Nobody has written anything yet.'); return; }
      if (kind === 'doc') {
        const body = started.map(function (it, i) { return (i ? '<br clear=all style="page-break-before:always">' : '') + itemHeader(it, title) + Ink.sanitize(it.html); }).join('');
        download(title + '.doc', 'application/msword', docShell(title, body));
      } else {
        printHtml(title, started.map(function (it) { return '<div class="item">' + itemHeader(it, title) + Ink.sanitize(it.html) + '</div>'; }).join(''));
      }
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }
  function currentItem() {
    const D = T.drawer;
    const r = rowFor(D.sid);
    const w = D.data && D.data.work;
    return { first: r.first, last: r.last, className: className(r.classId), words: w ? w.words : 0, status: w ? w.status : 'none', submittedAt: w ? w.submittedAt : 0, html: D.data ? D.data.html : '' };
  }
  function printOne() { const it = currentItem(); const t = T.live.data.assignment.title; printHtml(it.first + ' ' + it.last + ' — ' + t, '<div class="item">' + itemHeader(it, t) + Ink.sanitize(it.html) + '</div>'); }
  function downloadOne() { const it = currentItem(); const t = T.live.data.assignment.title; download(it.last + ', ' + it.first + ' - ' + t + '.doc', 'application/msword', docShell(t, itemHeader(it, t) + Ink.sanitize(it.html))); }

  /* ════════════════════════ ASSIGNMENTS ════════════════════════ */
  function renderAssignments(host) {
    host.innerHTML = '<div class="split"><div class="card side-list" id="as-list"></div><div class="card panel" id="as-panel"></div></div>';
    drawAssignList();
    const list = T.boot.assignments;
    if (T.selA === 'new' || !list.length) editAssignment(null);
    else editAssignment(list.find(function (a) { return a.id === T.selA; }) || list[0]);
  }

  function drawAssignList() {
    const el = $('#as-list');
    if (!el) return;
    el.innerHTML = '<button class="btn primary new" id="as-new">' + Ink.icon('plus') + 'New assignment</button>';
    T.boot.assignments.forEach(function (a) {
      const it = document.createElement('div');
      it.className = 'item' + (T.selA === a.id ? ' on' : '');
      const anyOpen = Object.values(a.windows || {}).some(function (w) { return w.open; });
      it.innerHTML = '<b>' + esc(a.title) + '</b><span>' + (anyOpen ? '<span class="pill open" style="padding:1px 8px">Open now</span> ' : '') + esc((a.classIds || []).map(className).join(', ') || 'No class yet') + '</span>';
      it.onclick = function () { editAssignment(a); };
      el.appendChild(it);
    });
    $('#as-new').onclick = function () { editAssignment(null); };
  }

  function editAssignment(a) {
    T.selA = a ? a.id : 'new';
    drawAssignList();
    const st = (a && a.settings) || { openMode: 'class', showGoal: true, allowSelfPaste: true, lockOnReentry: true, graceMin: 0 };
    const p = $('#as-panel');
    p.innerHTML =
      '<h2>' + (a ? 'Edit assignment' : 'New assignment') + '</h2>' +
      '<div class="field"><label for="af-title">Title</label><input class="input" id="af-title" maxlength="200" placeholder="e.g. Personal Narrative: A Moment That Changed Me"></div>' +
      '<div class="field"><label>Classes</label><div id="af-classes" class="row" style="gap:8px"></div></div>' +
      '<div class="field"><label>Prompt <span class="hint">(optional — students see this beside their writing)</span></label><div class="mini-editor" id="af-prompt"></div></div>' +
      '<h3>When can students write?</h3>' +
      '<div class="radio-cards" id="af-mode">' +
      radioCard('class', 'During class time', 'Opens automatically during each class\'s scheduled periods.') +
      radioCard('always', 'Any time', 'Open around the clock between the dates below (good for homework).') +
      radioCard('manual', 'Only when I open it', 'Closed until you open it from the Live page.') +
      '</div>' +
      '<div class="row"><div class="field"><label for="af-start">First day <span class="hint">(optional)</span></label><input type="date" class="input" id="af-start"></div>' +
      '<div class="field"><label for="af-end">Last day <span class="hint">(optional)</span></label><input type="date" class="input" id="af-end"></div>' +
      '<div class="field" id="af-grace-f"><label for="af-grace">Extra minutes before/after class</label><input type="number" min="0" max="60" class="input" id="af-grace"></div></div>' +
      '<h3>Length</h3>' +
      '<div class="row"><div class="field"><label for="af-min">Minimum words</label><input type="number" min="0" class="input" id="af-min" placeholder="none"></div>' +
      '<div class="field"><label for="af-max">Maximum words</label><input type="number" min="0" class="input" id="af-max" placeholder="none"></div></div>' +
      '<label class="check"><input type="checkbox" id="af-show"> <span>Show the word goal and a progress bar to students</span></label>' +
      '<h3>Integrity</h3>' +
      '<label class="check"><input type="checkbox" checked disabled> <span><b>Lock students out when they leave the window</b> (switch tabs/apps, exit full screen, close the page). Always on.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-reentry"> <span><b>Also lock when a student comes back after leaving unexpectedly</b> — e.g. their tab closed or laptop shut off mid-writing. Students who use <i>Save &amp; exit</i> are never locked.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-selfpaste"> <span><b>Let students cut/copy and paste their own writing</b> within the same essay (to move sentences around). Pasting anything from outside is always blocked.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-hidden"> <span>Hide from students\' lists for now</span></label>' +
      '<div class="row" style="margin-top:22px;justify-content:space-between">' +
      '  <div class="row" style="gap:8px">' + (a ? '<button class="btn danger" id="af-del">' + Ink.icon('trash') + 'Archive</button><button class="btn" id="af-dup">Duplicate</button>' : '') + '</div>' +
      '  <div class="row" style="gap:8px">' + (a ? '<button class="btn" id="af-live">' + Ink.icon('eye') + 'Watch live</button>' : '') + '<button class="btn primary" id="af-save">Save assignment</button></div>' +
      '</div>';
    $('#af-title').value = a ? a.title : '';
    const cbox = $('#af-classes');
    if (!T.boot.classes.length) cbox.innerHTML = '<span class="muted small">Create a class first (Classes &amp; students tab).</span>';
    T.boot.classes.forEach(function (c) {
      const lab = document.createElement('label');
      lab.className = 'check';
      lab.style.marginBottom = '0';
      lab.style.marginRight = '14px';
      const on = a ? (a.classIds || []).indexOf(c.id) >= 0 : T.boot.classes.length === 1;
      lab.innerHTML = '<input type="checkbox" value="' + c.id + '"' + (on ? ' checked' : '') + '> <span>' + esc(c.name) + '</span>';
      cbox.appendChild(lab);
    });
    const ed = Ink.makeEditor($('#af-prompt'), { placeholder: 'Write the prompt or instructions students will see…' });
    ed.setHTML(a ? a.prompt : '');
    const setMode = function (m) {
      $$('#af-mode .radio-card').forEach(function (rc) { rc.classList.toggle('on', rc.dataset.v === m); rc.querySelector('input').checked = rc.dataset.v === m; });
      $('#af-grace-f').style.display = m === 'class' ? '' : 'none';
    };
    $$('#af-mode .radio-card').forEach(function (rc) { rc.onclick = function () { setMode(rc.dataset.v); }; });
    setMode(st.openMode || 'class');
    $('#af-start').value = st.startDate || '';
    $('#af-end').value = st.endDate || '';
    $('#af-grace').value = st.graceMin || 0;
    $('#af-min').value = st.minWords || '';
    $('#af-max').value = st.maxWords || '';
    $('#af-show').checked = st.showGoal !== false;
    $('#af-reentry').checked = st.lockOnReentry !== false;
    $('#af-selfpaste').checked = st.allowSelfPaste !== false;
    $('#af-hidden').checked = !!st.hidden;

    const collect = function () {
      const mode = ($('#af-mode input:checked') || {}).value || 'class';
      return {
        id: a ? a.id : '',
        title: $('#af-title').value.trim(),
        classIds: $$('#af-classes input:checked').map(function (i) { return i.value; }),
        prompt: ed.getHTML(),
        settings: {
          openMode: mode, startDate: $('#af-start').value, endDate: $('#af-end').value, graceMin: Number($('#af-grace').value) || 0,
          minWords: Number($('#af-min').value) || 0, maxWords: Number($('#af-max').value) || 0, showGoal: $('#af-show').checked,
          lockOnReentry: $('#af-reentry').checked, allowSelfPaste: $('#af-selfpaste').checked, hidden: $('#af-hidden').checked
        }
      };
    };
    $('#af-save').onclick = async function () {
      const data = collect();
      if (!data.title) { Ink.toast('Give the assignment a title.', 'warn'); $('#af-title').focus(); return; }
      if (!data.classIds.length) { Ink.toast('Choose at least one class.', 'warn'); return; }
      if (data.settings.minWords && data.settings.maxWords && data.settings.minWords > data.settings.maxWords) { Ink.toast('The minimum is bigger than the maximum.', 'warn'); return; }
      this.disabled = true;
      try {
        const r = await call('tSaveAssignment', { assignment: data });
        await reboot();
        T.selA = r.assignment.id;
        Ink.toast('Saved.', 'good');
        editAssignment(T.boot.assignments.find(function (x) { return x.id === r.assignment.id; }));
      } catch (err) { Ink.toast(err.message, 'bad'); this.disabled = false; }
    };
    if (a) {
      $('#af-del').onclick = async function () {
        if (!(await Ink.confirm('Archive this assignment?', 'Students will no longer see it. Their writing is kept in your Google Sheet.', 'Archive', true))) return;
        try { await call('tDeleteAssignment', { id: a.id }); await reboot(); T.selA = null; go('assignments'); Ink.toast('Archived.'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $('#af-dup').onclick = async function () {
        const data = collect();
        data.id = ''; data.title = 'Copy of ' + data.title;
        try { const r = await call('tSaveAssignment', { assignment: data }); await reboot(); T.selA = r.assignment.id; go('assignments'); Ink.toast('Duplicated.', 'good'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $('#af-live').onclick = function () { T.live.aid = a.id; Ink.store.set('inkwell_live_aid', a.id); go('live'); };
    }
  }
  function radioCard(v, title, text) { return '<label class="radio-card" data-v="' + v + '"><input type="radio" name="af-mode" value="' + v + '"><b>' + title + '</b><span>' + text + '</span></label>'; }

  /* ════════════════════════ CLASSES ════════════════════════ */
  function renderClasses(host) {
    host.innerHTML = '<div class="split"><div class="card side-list" id="cl-list"></div><div class="card panel" id="cl-panel"></div></div>';
    drawClassList();
    const list = T.boot.classes;
    if (T.selC === 'new' || !list.length) editClass(null);
    else editClass(list.find(function (c) { return c.id === T.selC; }) || list[0]);
  }
  function drawClassList() {
    const el = $('#cl-list');
    if (!el) return;
    el.innerHTML = '<button class="btn primary new" id="cl-new">' + Ink.icon('plus') + 'New class</button>';
    T.boot.classes.forEach(function (c) {
      const it = document.createElement('div');
      it.className = 'item' + (T.selC === c.id ? ' on' : '');
      it.innerHTML = '<b>' + esc(c.name) + '</b><span>' + studentsIn([c.id]).length + ' students</span>';
      it.onclick = function () { editClass(c); };
      el.appendChild(it);
    });
    $('#cl-new').onclick = function () { editClass(null); };
  }

  function editClass(c) {
    T.selC = c ? c.id : 'new';
    drawClassList();
    const p = $('#cl-panel');
    p.innerHTML =
      '<h2>' + (c ? esc(c.name) : 'New class') + '</h2>' +
      '<div class="field"><label for="cf-name">Class name</label><input class="input" id="cf-name" placeholder="e.g. English 10-1 · Block A"></div>' +
      '<div class="field"><label>Class times</label><div class="hint" style="margin-bottom:8px">Assignments set to "During class time" open only during these periods. Add a row for each set of days that share the same times.</div><div id="cf-sched"></div><button class="btn sm" id="cf-add-row">' + Ink.icon('plus') + 'Add class time</button></div>' +
      '<div class="row" style="gap:8px;justify-content:flex-end;margin-top:6px">' + (c ? '<button class="btn danger" id="cf-del">' + Ink.icon('trash') + 'Delete class</button>' : '') + '<button class="btn primary" id="cf-save">' + (c ? 'Save class' : 'Create class') + '</button></div>' +
      (c ? '<h3>Students</h3><div id="cf-roster"></div>' : '');
    $('#cf-name').value = c ? c.name : '';
    // schedule rows: group periods with the same times
    const groups = {};
    ((c && c.schedule) || []).forEach(function (pp) { const k = pp.s + '-' + pp.e; (groups[k] = groups[k] || { s: pp.s, e: pp.e, d: [] }).d.push(pp.d); });
    const sched = $('#cf-sched');
    const addRow = function (g) {
      const row = document.createElement('div');
      row.className = 'sched-row';
      row.innerHTML = '<div class="days">' + [1, 2, 3, 4, 5].map(function (d) { const on = g && g.d.indexOf(d) >= 0; return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" value="' + d + '"' + (on ? ' checked' : '') + '>' + DAYS[d] + '</label>'; }).join('') + '</div>' +
        '<input type="time" class="input" value="' + (g ? g.s : '09:00') + '" aria-label="Start time"><input type="time" class="input" value="' + (g ? g.e : '10:28') + '" aria-label="End time"><button class="icon-btn" title="Remove">' + Ink.icon('x') + '</button>';
      $$('.days label', row).forEach(function (l) { l.onclick = function (e) { e.preventDefault(); const i = l.querySelector('input'); i.checked = !i.checked; l.classList.toggle('on', i.checked); }; });
      row.querySelector('.icon-btn').onclick = function () { row.remove(); };
      sched.appendChild(row);
    };
    Object.values(groups).forEach(addRow);
    if (!Object.keys(groups).length) addRow({ s: '09:00', e: '10:28', d: [1, 2, 3, 4, 5] });
    $('#cf-add-row').onclick = function () { addRow(null); };
    $('#cf-save').onclick = async function () {
      const name = $('#cf-name').value.trim();
      if (!name) { Ink.toast('Name the class.', 'warn'); return; }
      const schedule = [];
      $$('.sched-row', sched).forEach(function (row) {
        const t = $$('input[type=time]', row);
        $$('.days input:checked', row).forEach(function (i) { schedule.push({ d: Number(i.value), s: t[0].value, e: t[1].value }); });
      });
      this.disabled = true;
      try {
        const r = await call('tSaveClass', { cls: { id: c ? c.id : '', name: name, schedule: schedule } });
        await reboot();
        T.selC = r.cls.id;
        Ink.toast('Saved.', 'good');
        editClass(T.boot.classes.find(function (x) { return x.id === r.cls.id; }));
      } catch (err) { Ink.toast(err.message, 'bad'); this.disabled = false; }
    };
    if (c) {
      $('#cf-del').onclick = async function () {
        if (!(await Ink.confirm('Delete ' + c.name + '?', 'This removes the class and its student list. Writing already saved stays in your Google Sheet.', 'Delete', true))) return;
        try { await call('tDeleteClass', { id: c.id }); await reboot(); T.selC = null; go('classes'); Ink.toast('Deleted.'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      drawRoster(c);
    }
  }

  function drawRoster(c) {
    const host = $('#cf-roster');
    const list = studentsIn([c.id]).sort(function (a, b) { return (a.last + a.first).localeCompare(b.last + b.first); });
    host.innerHTML =
      '<div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="muted small">' + list.length + ' students · Each student signs in with their own code.</span>' +
      '<div class="row" style="gap:8px"><button class="btn sm" id="ro-cards">' + Ink.icon('print') + 'Print sign-in cards</button><button class="btn sm teal" id="ro-add">' + Ink.icon('plus') + 'Add students</button></div></div>' +
      (list.length ? '<table class="roster"><thead><tr><th>First</th><th>Last</th><th>Code</th><th title="Accommodations">Accommodations</th><th></th></tr></thead><tbody></tbody></table>' : '<div class="empty" style="padding:30px">No students yet. Click <b>Add students</b> and paste your class list.</div>');
    const tb = host.querySelector('tbody');
    list.forEach(function (s) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input class="input" data-f="first"></td><td><input class="input" data-f="last"></td><td><code>' + esc(s.code) + '</code> <button class="icon-btn" data-regen title="New code">' + Ink.icon('refresh') + '</button></td>' +
        '<td><label class="check" style="margin:0 0 2px;font-size:13px"><input type="checkbox" data-acc="extended"' + (s.accom && s.accom.extended ? ' checked' : '') + '> Extended access</label>' +
        '<label class="check" style="margin:0;font-size:13px"><input type="checkbox" data-acc="relaxed"' + (s.accom && s.accom.relaxed ? ' checked' : '') + '> Dictation allowed</label></td>' +
        '<td><button class="icon-btn" data-del title="Remove student">' + Ink.icon('trash') + '</button></td>';
      tr.querySelector('[data-f=first]').value = s.first;
      tr.querySelector('[data-f=last]').value = s.last;
      const saveS = async function () {
        const upd = { id: s.id, first: tr.querySelector('[data-f=first]').value.trim() || s.first, last: tr.querySelector('[data-f=last]').value.trim(), accom: { extended: tr.querySelector('[data-acc=extended]').checked, relaxed: tr.querySelector('[data-acc=relaxed]').checked } };
        try { const r = await call('tSaveStudent', { student: upd }); Object.assign(s, r.student); Ink.toast('Saved ' + s.first + '.', 'good', 1500); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $$('input', tr).forEach(function (i) { i.addEventListener('change', saveS); });
      tr.querySelector('[data-regen]').onclick = async function () {
        if (!(await Ink.confirm('Give ' + s.first + ' a new code?', 'Their old code will stop working.', 'New code'))) return;
        try { const r = await call('tRegenCode', { id: s.id }); Object.assign(s, r.student); drawRoster(c); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      tr.querySelector('[data-del]').onclick = async function () {
        if (!(await Ink.confirm('Remove ' + s.first + ' ' + s.last + '?', 'They won\'t be able to sign in. Writing already saved stays in your Google Sheet.', 'Remove', true))) return;
        try { await call('tDeleteStudent', { id: s.id }); await reboot(); drawRoster(c); drawClassList(); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      tb.appendChild(tr);
    });
    host.querySelector('#ro-add').onclick = async function () {
      const lines = await Ink.modal({
        title: 'Add students to ' + c.name,
        html: '<p class="muted small" style="margin-top:0">One student per line, as <b>First Last</b> or <b>Last, First</b>. You can paste straight from a spreadsheet or your class list.</p><textarea class="input" id="add-lines" rows="10" placeholder="Jordan Smith&#10;Lee, Priya"></textarea>',
        buttons: [{ label: 'Cancel', value: null }, { label: 'Add students', cls: 'primary', collect: function (b) { return b.querySelector('#add-lines').value; } }]
      });
      if (!lines || !lines.trim()) return;
      try { const r = await call('tAddStudents', { classId: c.id, lines: lines }); await reboot(); Ink.toast('Added ' + r.added.length + ' students.', 'good'); drawRoster(c); drawClassList(); } catch (err) { Ink.toast(err.message, 'bad'); }
    };
    host.querySelector('#ro-cards').onclick = function () { printCards(c, list); };
  }

  function studentUrl() { return location.origin + location.pathname.replace(/teacher\.html.*$/, ''); }

  function printCards(c, list) {
    if (!list.length) { Ink.toast('Add students first.'); return; }
    const url = studentUrl();
    const w = window.open('', '_blank');
    if (!w) { Ink.toast('Allow pop-ups to print the cards.', 'warn'); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Sign-in cards — ' + esc(c.name) + '</title><style>body{font-family:system-ui,sans-serif;margin:.4in}.grid{display:grid;grid-template-columns:1fr 1fr;gap:.18in}.c{border:1.5px dashed #999;border-radius:10px;padding:.18in .22in;break-inside:avoid}.n{font-size:17px;font-weight:700}.k{font-size:11px;color:#666;margin-top:2px}.code{font-family:ui-monospace,Menlo,monospace;font-size:24px;font-weight:800;letter-spacing:.06em;margin:.08in 0;color:#8a2c37}.u{font-size:11px;color:#333;word-break:break-all}</style></head><body><div class="grid">' +
      list.map(function (s) { return '<div class="c"><div class="n">' + esc(s.first + ' ' + s.last) + '</div><div class="k">' + esc(c.name) + '</div><div class="code">' + esc(s.code) + '</div><div class="u">Go to <b>' + esc(url) + '</b> and type your code.</div></div>'; }).join('') +
      '</div><script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body></html>');
    w.document.close();
  }

  /* ════════════════════════ SETTINGS ════════════════════════ */
  function renderSettings(host) {
    const url = studentUrl();
    const hasDemo = T.boot.classes.some(function (c) { return c.demo; });
    host.innerHTML =
      '<div style="max-width:760px;display:grid;gap:18px">' +
      '<div class="card panel"><h2>Student link</h2><p class="muted" style="margin-top:-8px">Share this with students (post it in Google Classroom or on the board). They sign in with their code.</p>' +
      '<div class="row"><input class="input" id="st-url" readonly style="flex:1;min-width:240px"><button class="btn" id="st-copy">' + Ink.icon('copy') + 'Copy</button><a class="btn" href="' + esc(url) + '" target="_blank">Open</a></div></div>' +
      '<div class="card panel"><h2>Teacher password</h2>' + (T.boot.settings.defaultPassword ? '<div class="banner">You\'re using the starter password. Pick your own.</div>' : '') +
      '<div class="row"><div class="field"><label for="pw-cur">Current password</label><input type="password" class="input" id="pw-cur" autocomplete="current-password"></div>' +
      '<div class="field"><label for="pw-new">New password</label><input type="password" class="input" id="pw-new" autocomplete="new-password"></div></div>' +
      '<button class="btn primary" id="pw-save">Change password</button></div>' +
      '<div class="card panel"><h2>Demo data</h2><p class="muted" style="margin-top:-8px">Two practice classes with made-up students, three assignments, and writing in progress. On the Live page, <b>Simulate class</b> makes the demo students type, get locked out and submit. The demo student <b>Test Student</b> signs in with code <code>TEST-0001</code> so you can try the student side yourself.</p>' +
      '<div class="row" style="gap:8px"><button class="btn" id="demo-seed">' + Ink.icon('refresh') + (hasDemo ? 'Reset demo data' : 'Load demo data') + '</button>' + (hasDemo ? '<button class="btn danger" id="demo-clear">' + Ink.icon('trash') + 'Remove demo data</button>' : '') + '</div></div>' +
      '<div class="card panel"><h2>How Inkwell keeps writing honest</h2><ul style="line-height:1.6;margin:0;padding-left:20px">' +
      '<li>Writing happens in full screen. Leaving it — switching tabs or apps, clicking outside, exiting full screen, closing or reloading — <b>locks the student out</b> until you clear them.</li>' +
      '<li>Pasting from outside the assignment is blocked, and so are big chunks of text appearing at once (autofill, AI "help me write" tools). Attempts show on the Live page.</li>' +
      '<li>Writing saves every few seconds, with a snapshot about every 90 seconds so you can <b>play back</b> how a piece was written.</li>' +
      '<li>Each student card shows keystroke and timing stats. Text that appears without matching keystrokes, or a big jump in words, is flagged in the timeline.</li>' +
      '<li>Spell check uses the browser\'s built-in checker. There\'s no grammar checking, and writing assistants like Grammarly are asked to stay off.</li>' +
      '<li class="muted">No tool can stop a student from copying from a phone or a second device — walking the room still matters. Playback and the typing stats make that much easier to spot.</li>' +
      '</ul></div>' +
      '<div class="muted small">Inkwell v' + esc(T.boot.settings.version) + ' · Times shown in ' + esc(T.boot.settings.tz) + ' · All data lives in your own Google Sheet.</div>' +
      '</div>';
    $('#st-url').value = url;
    $('#st-copy').onclick = function () { navigator.clipboard.writeText(url).then(function () { Ink.toast('Copied.', 'good'); }); };
    $('#pw-save').onclick = async function () {
      try {
        const r = await call('tPassword', { current: $('#pw-cur').value, next: $('#pw-new').value });
        T.token = r.token; Ink.store.set(TOKEN_KEY, { token: r.token });
        await reboot();
        Ink.toast('Password changed.', 'good');
        go('settings');
      } catch (err) { Ink.toast(err.message, 'bad'); }
    };
    $('#demo-seed').onclick = async function () {
      if (hasDemo && !(await Ink.confirm('Reset the demo data?', 'The demo classes, students and their writing are replaced with a fresh copy. Your real classes are not touched.', 'Reset'))) return;
      this.disabled = true; this.innerHTML = '<span class="spin"></span> Working…';
      try { T.boot = await call('tDemoSeed', {}, { timeout: 90000 }); Ink.toast('Demo data is ready.', 'good'); go('settings'); } catch (err) { Ink.toast(err.message, 'bad'); this.disabled = false; }
    };
    if (hasDemo) $('#demo-clear').onclick = async function () {
      if (!(await Ink.confirm('Remove the demo data?', 'The demo classes and students are deleted and the demo assignments archived. Your real classes are not touched.', 'Remove', true))) return;
      try { T.boot = await call('tDemoClear', {}, { timeout: 90000 }); Ink.toast('Demo data removed.'); go('settings'); } catch (err) { Ink.toast(err.message, 'bad'); }
    };
  }

  /* ───────────── Boot ───────────── */
  if (!Ink.apiUrl()) showLogin('This site isn\'t connected to its backend yet.');
  else if (T.token) start();
  else showLogin();
})();
