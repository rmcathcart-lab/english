/* Inkwell — teacher dashboard. */
(function () {
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.from((r || document).querySelectorAll(s)); };
  const esc = Ink.esc;
  const TX = Ink.Text;
  const R = Ink.Rubric;
  const TOKEN_KEY = 'inkwell_teacher';
  const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const T = {
    token: (Ink.store.get(TOKEN_KEY) || {}).token || '',
    boot: null,
    tab: 'live',
    live: { aid: Ink.store.get('inkwell_live_aid') || '', data: null, timer: 0, busy: false, sort: 'name', cls: '', sim: false, simTimer: 0, locked: {}, sound: Ink.store.get('inkwell_sound') !== false },
    drawer: null,
    grade: { aid: Ink.store.get('inkwell_grade_aid') || '', sid: '', board: null, data: null, filter: 'all', panel: 'rubric' },
    selA: null,
    selC: null
  };

  function paintIcons(root) { (root || document).querySelectorAll('[data-icon]').forEach(function (el) { el.innerHTML = Ink.icon(el.dataset.icon); }); }
  paintIcons();

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
      route();
    } catch (err) {
      if (err.code !== 'AUTH') $('#t-main').innerHTML = '<div class="empty"><div class="display">Couldn\'t load</div>' + esc(err.message) + '<br><br><button class="btn" onclick="location.reload()">Try again</button></div>';
    }
  }

  async function reboot() { T.boot = await call('tBoot'); }

  /* ───────────── Routing ───────────── */
  // #live · #grade · #grade/<aid>/<sid> · #assignments · #classes · #record/<sid> · #settings
  function route() {
    if (!T.boot) return;
    const h = location.hash.replace(/^#/, '').split('/');
    const tab = ['live', 'grade', 'assignments', 'classes', 'settings', 'record'].indexOf(h[0]) >= 0 ? h[0] : 'live';
    if (tab === 'grade' && h[1]) { T.grade.aid = h[1]; T.grade.sid = h[2] || ''; }
    render(tab, h);
  }
  window.addEventListener('hashchange', route);
  function go(tab, extra) {
    const want = '#' + tab + (extra ? '/' + extra : '');
    if (location.hash !== want) location.hash = want; else route();
  }

  $('#tabs').addEventListener('click', function (e) {
    const b = e.target.closest('[data-tab]');
    if (b) go(b.dataset.tab);
  });

  function render(tab, parts) {
    T.tab = tab;
    $$('#tabs .tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab || (tab === 'record' && b.dataset.tab === 'classes')); });
    if (tab !== 'live') stopLive();
    closeDrawer();
    closeMenu();
    const main = $('#t-main');
    main.innerHTML = '';
    main.className = 't-main' + (tab === 'grade' ? ' wide' : '');
    if (T.boot && T.boot.settings.defaultPassword && tab !== 'settings') {
      const b = document.createElement('div');
      b.className = 'banner';
      b.innerHTML = '<span>You\'re still using the starter teacher password. Change it before sharing the site with students.</span><button class="btn sm">Change password</button>';
      b.querySelector('button').onclick = function () { go('settings'); };
      main.appendChild(b);
    }
    const host = document.createElement('div');
    main.appendChild(host);
    if (tab === 'record') renderRecord(host, parts[1]);
    else ({ live: renderLive, grade: renderGrade, assignments: renderAssignments, classes: renderClasses, settings: renderSettings })[tab](host);
  }

  /* ───────────── Shared helpers ───────────── */
  function className(id) { const c = (T.boot.classes || []).find(function (x) { return x.id === id; }); return c ? c.name : ''; }
  function studentsIn(cids) { return T.boot.students.filter(function (s) { return cids.indexOf(s.classId) >= 0; }); }
  function student(id) { return T.boot.students.find(function (s) { return s.id === id; }); }
  function assignment(id) { return T.boot.assignments.find(function (a) { return a.id === id; }); }
  function isAbsent(sid) { return (T.boot.absentToday || []).indexOf(sid) >= 0; }

  function winText(w) {
    if (!w) return 'Not assigned';
    if (w.open) return 'Open' + (w.closesAt ? ' until ' + Ink.fmtTime(w.closesAt) : '') + (w.via === 'override' ? ' (opened by you)' : '');
    if (w.dayOff) return w.label;
    if (w.opensAt) return 'Opens ' + Ink.fmtDateTime(w.opensAt);
    return w.label || 'Closed';
  }

  const STATE_ORDER = { locked: 0, idle: 1, offline: 2, writing: 3, none: 4, absent: 5, submitted: 6 };
  const STATE_LABEL = { locked: 'Locked', idle: 'Idle', offline: 'Not here', writing: 'Writing', none: 'Not started', submitted: 'Submitted', absent: 'Absent' };

  const EV_ICON = { start: 'play', resume: 'refresh', locked: 'lock', unlocked: 'unlock', submit: 'check', exit: 'door', paste: 'copy', insert: 'alert', burst: 'bolt', unusual: 'question', returned: 'refresh', view: 'eye', absent: 'userX' };
  const EV_TEXT = {
    start: 'started writing', resume: 'opened the assignment', locked: 'was locked out', unlocked: 'was cleared', submit: 'submitted',
    exit: 'saved and exited', paste: 'tried to paste', insert: 'had a big insert blocked', burst: 'added a lot of text quickly',
    unusual: 'had text appear without typing', returned: 'was given the assignment back', view: 'opened the read-only copy', absent: 'was marked absent'
  };
  function evHtml(e, who) {
    return '<div class="ev"><span class="ic ' + esc(e.type) + '">' + Ink.icon(EV_ICON[e.type] || 'dot') + '</span><div>' +
      (who ? '<b>' + esc(who) + '</b> ' : '') + esc(who ? (EV_TEXT[e.type] || e.type) : (e.detail || EV_TEXT[e.type] || e.type)) +
      (who && e.detail && e.type !== 'start' && e.type !== 'resume' && e.type !== 'view' ? '<div class="muted small">' + esc(e.detail) + '</div>' : '') +
      '<time>' + esc(Ink.fmtTimeSec(e.ts)) + '</time></div></div>';
  }

  let openMenuEl = null;
  function openMenu(anchor, items) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'menu';
    items.forEach(function (it) {
      if (it.sep) { const s = document.createElement('div'); s.className = 'menu-sep'; m.appendChild(s); return; }
      const b = document.createElement('button');
      b.innerHTML = Ink.bi(it.icon, esc(it.label));
      b.onclick = function () { closeMenu(); it.fn(); };
      m.appendChild(b);
    });
    anchor.parentNode.appendChild(m);
    openMenuEl = m;
  }
  function closeMenu() { if (openMenuEl) { openMenuEl.remove(); openMenuEl = null; } }
  document.addEventListener('click', function (e) { if (openMenuEl && !openMenuEl.contains(e.target) && !e.target.closest('.dropdown > .btn')) closeMenu(); });

  function accomBadges(ac) {
    if (!ac) return '';
    const b = [];
    if (ac.extended) b.push('<span class="badge-acc" title="Extended access: assignments stay open outside class time">EXT</span>');
    if (ac.tts) b.push('<span class="badge-acc" title="Read aloud">TTS</span>');
    if (ac.stt) b.push('<span class="badge-acc" title="Speech-to-text">STT</span>');
    return b.join('');
  }

  function timeLine(r) {
    if (!r.openSec && !r.activeSec) return '';
    return 'Open ' + Ink.dur(r.openSec) + ' · typing ' + Ink.dur(r.activeSec);
  }

  /* ───────────── Document view with highlight-to-comment ───────────── */
  /**
   * docView(host, { comments: true, onAdd(anchor, text), onDelete(c), onReopen(c), onEdit(c, text), onSelectComment(c) })
   * → { set(html), setComments(list, activeId), el }
   */
  function docView(host, opts) {
    opts = opts || {};
    host.innerHTML = '<div class="page"><div class="doc t-doc"></div></div>';
    const doc = host.querySelector('.doc');
    let comments = [], active = null, html = '';
    let fab = null, pop = null;

    function paint() {
      const m = TX.model(doc);
      const open = [], done = [], act = [];
      const located = {};
      comments.forEach(function (c) {
        const loc = TX.locate(m, c);
        located[c.id] = !!loc;
        if (!loc) return;
        const r = TX.rangeOf(m, loc.start, loc.end);
        if (!r) return;
        (c.id === active ? act : c.resolved ? done : open).push(r);
      });
      if (TX.hasHighlights) {
        TX.paint('t-cmt', open); TX.paint('t-cmt-done', done); TX.paint('t-cmt-active', act);
      } else {
        doc.innerHTML = Ink.sanitize(html) || '<p class="muted"><i>Nothing written yet.</i></p>';
        const mm = TX.model(doc);
        const spans = [];
        comments.forEach(function (c) { const loc = TX.locate(mm, c); if (loc) spans.push({ start: loc.start, end: loc.end, id: c.id, cls: 'cmt-mark' + (c.resolved ? ' done' : '') + (c.id === active ? ' on' : '') }); });
        TX.markFallback(mm, spans);
      }
      return located;
    }

    function hideFab() { if (fab) { fab.remove(); fab = null; } }
    function hidePop() { if (pop) { pop.remove(); pop = null; } }

    if (opts.comments) {
      doc.addEventListener('mouseup', function () {
        setTimeout(function () {
          if (pop) return;
          const sel = window.getSelection();
          if (!sel.rangeCount || sel.isCollapsed || !doc.contains(sel.anchorNode) || !doc.contains(sel.focusNode)) { hideFab(); return; }
          const m = TX.model(doc);
          const s = TX.selection(m);
          if (!s || s.collapsed || !m.text.slice(s.start, s.end).trim()) { hideFab(); return; }
          const rect = sel.getRangeAt(0).getBoundingClientRect();
          hideFab();
          fab = document.createElement('button');
          fab.type = 'button';
          fab.className = 'btn sm primary cmt-fab';
          fab.innerHTML = Ink.bi('comment', 'Comment');
          fab.style.left = Math.min(window.innerWidth - 130, rect.right - 20) + 'px';
          fab.style.top = (rect.bottom + 8) + 'px';
          fab.onmousedown = function (e) { e.preventDefault(); };
          fab.onclick = function () { const anchor = TX.anchorFor(m, s.start, s.end); hideFab(); if (anchor) openPop(anchor, rect); };
          document.body.appendChild(fab);
        }, 10);
      });
      document.addEventListener('mousedown', function (e) {
        if (fab && !fab.contains(e.target)) hideFab();
      }, true);
    }

    function openPop(anchor, rect) {
      hidePop();
      pop = document.createElement('div');
      pop.className = 'cmt-pop card';
      pop.innerHTML = '<div class="cmt-q">“' + esc(anchor.quote.length > 120 ? anchor.quote.slice(0, 118) + '…' : anchor.quote) + '”</div>' +
        '<textarea class="input" rows="3" maxlength="2000" placeholder="Comment for the student…"></textarea>' +
        '<div class="row" style="justify-content:space-between;margin-top:8px"><span class="muted small">The student sees this right away.</span><div class="row" style="gap:6px"><button class="btn sm" data-x>Cancel</button><button class="btn sm primary" data-ok>' + Ink.bi('send', 'Add comment') + '</button></div></div>';
      document.body.appendChild(pop);
      const w = Math.min(380, window.innerWidth - 24);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, rect.left)) + 'px';
      const top = rect.bottom + 10;
      pop.style.top = (top + 190 > window.innerHeight ? Math.max(12, rect.top - 200) : top) + 'px';
      // Show where the comment will go while typing
      const m = TX.model(doc);
      const loc = TX.locate(m, anchor);
      if (loc) TX.paint('t-cmt-pending', [TX.rangeOf(m, loc.start, loc.end)]);
      const ta = pop.querySelector('textarea');
      ta.focus();
      const close = function () { hidePop(); TX.clear('t-cmt-pending'); };
      pop.querySelector('[data-x]').onclick = close;
      const submit = async function () {
        const text = ta.value.trim();
        if (!text) { ta.focus(); return; }
        const b = pop.querySelector('[data-ok]');
        b.disabled = true; b.innerHTML = '<span class="spin sm"></span>';
        try { await opts.onAdd(anchor, text); close(); window.getSelection().removeAllRanges(); }
        catch (err) { Ink.toast(err.message, 'bad'); b.disabled = false; b.innerHTML = Ink.bi('send', 'Add comment'); }
      };
      pop.querySelector('[data-ok]').onclick = submit;
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    }

    doc.addEventListener('click', function (e) {
      if (!comments.length || !opts.onSelectComment) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const m = TX.model(doc);
      const i = TX.indexAtPoint(m, e.clientX, e.clientY);
      const c = comments.find(function (x) { const l = TX.locate(m, x); return l && i >= l.start && i <= l.end; });
      if (c) opts.onSelectComment(c);
    });

    return {
      el: doc,
      set: function (h) {
        if (h === html && doc.innerHTML) { paint(); return; }
        html = h || '';
        // don't wipe a teacher's in-progress selection during a live refresh
        const sel = window.getSelection();
        if ((pop || fab) || (sel && !sel.isCollapsed && doc.contains(sel.anchorNode))) return;
        doc.innerHTML = Ink.sanitize(html) || '<p class="muted"><i>Nothing written yet.</i></p>';
        paint();
      },
      setComments: function (list, act) { comments = list || []; active = act || null; return paint(); },
      scrollTo: function (c) {
        const m = TX.model(doc);
        const loc = TX.locate(m, c);
        if (!loc) return false;
        const r = TX.rangeOf(m, loc.start, loc.end);
        const el = r && r.startContainer.parentElement;
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
      },
      destroy: function () { hideFab(); hidePop(); ['t-cmt', 't-cmt-done', 't-cmt-active', 't-cmt-pending'].forEach(TX.clear); }
    };
  }

  function commentListHtml(list, located, active) {
    if (!list.length) return '<div class="muted small">Select text in the writing, then click <b>Comment</b>.</div>';
    return list.map(function (c) {
      const gone = located && located[c.id] === false;
      return '<div class="cmt t' + (c.resolved ? ' done' : '') + (active === c.id ? ' on' : '') + '" data-cid="' + esc(c.id) + '">' +
        '<div class="cmt-q">' + (gone ? '<span class="pill plain warnp">Text changed</span> ' : '') + '“' + esc(c.quote.length > 90 ? c.quote.slice(0, 88) + '…' : c.quote) + '”</div>' +
        '<div class="cmt-t">' + esc(c.text) + '</div>' +
        '<div class="cmt-meta"><span>' + (c.resolved ? Ink.icon('check') + 'Done ' + esc(Ink.fmtDateTime(c.resolvedAt)) : 'Added ' + esc(Ink.fmtDateTime(c.created))) + '</span>' +
        '<span class="cmt-acts">' + (c.resolved ? '<button class="icon-btn" data-reopen title="Reopen" aria-label="Reopen">' + Ink.icon('refresh') + '</button>' : '') +
        '<button class="icon-btn" data-edit title="Edit" aria-label="Edit">' + Ink.icon('edit') + '</button><button class="icon-btn" data-del title="Delete" aria-label="Delete">' + Ink.icon('trash') + '</button></span></div></div>';
    }).join('');
  }

  function wireCommentList(host, list, h) {
    host.querySelectorAll('.cmt').forEach(function (el) {
      const c = list.find(function (x) { return x.id === el.dataset.cid; });
      el.addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (!b) { h.onFocus(c); return; }
        if (b.hasAttribute('data-del')) h.onDelete(c);
        else if (b.hasAttribute('data-reopen')) h.onReopen(c);
        else if (b.hasAttribute('data-edit')) h.onEdit(c);
      });
    });
  }

  async function commentAction(kind, c, refresh) {
    try {
      if (kind === 'delete') {
        if (!(await Ink.confirm('Delete this comment?', 'It disappears from the student\'s screen too.', 'Delete', true))) return;
        await call('tDeleteComment', { id: c.id });
      } else if (kind === 'reopen') await call('tEditComment', { id: c.id, reopen: true });
      else if (kind === 'edit') {
        const t = await Ink.modal({
          title: 'Edit comment', html: '<div class="cmt-q" style="margin-bottom:8px">“' + esc(c.quote) + '”</div><textarea class="input" id="ec" rows="4" maxlength="2000"></textarea>',
          onOpen: function (b) { b.querySelector('#ec').value = c.text; },
          buttons: [{ label: 'Cancel', value: null }, { label: 'Save', cls: 'primary', collect: function (b) { return b.querySelector('#ec').value.trim() || false; } }]
        });
        if (!t) return;
        await call('tEditComment', { id: c.id, text: t });
      }
      refresh();
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

  /* ════════════════════════ LIVE ════════════════════════ */
  function renderLive(host) {
    const list = T.boot.assignments;
    if (!list.length) {
      host.innerHTML = '<div class="empty card" style="padding:60px"><div class="display">No assignments yet</div><p>Create one and assign it to a class to watch students write live.</p><button class="btn primary" id="lv-new">' + Ink.bi('plus', 'Create an assignment') + '</button></div>';
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
      '    <div class="dropdown"><button class="btn" id="lv-open-btn">' + Ink.bi('clock', 'Open / close') + '</button></div>' +
      '    <button class="btn" id="lv-attend">' + Ink.bi('users', 'Attendance') + '</button>' +
      '    <button class="btn danger" id="lv-clear-all" hidden>' + Ink.bi('unlock', 'Clear all locked') + '</button>' +
      '    <button class="btn" id="lv-sim" hidden title="Make the demo students type, get locked, and submit so you can see the dashboard move">' + Ink.bi('play', 'Simulate class') + '</button>' +
      '    <button class="btn icon-only" id="lv-sound" title="Chime when a student gets locked out" aria-label="Chime when a student gets locked out"></button>' +
      '    <button class="btn" id="lv-print">' + Ink.bi('print', 'Print all') + '</button>' +
      '    <div class="dropdown"><button class="btn" id="lv-export-btn">' + Ink.bi('download', 'Export') + '</button></div>' +
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
    sel.onchange = function () { T.live.aid = sel.value; Ink.store.set('inkwell_live_aid', sel.value); T.live.data = null; T.live.locked = {}; T.live.hadData = false; stopSim(); $('#lv-cards').innerHTML = '<div class="empty"><span class="spin"></span></div>'; pollLive(); };
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
    $('#lv-attend').onclick = function () { attendance(assignment(T.live.aid)); };
    $('#lv-print').onclick = function () { printAllDialog(T.live.aid, T.live.cls); };
    $('#lv-export-btn').onclick = function (e) {
      e.stopPropagation();
      openMenu(this, [
        { icon: 'file', label: 'Download all as Word (.doc)', fn: function () { exportAll('doc'); } },
        { icon: 'download', label: 'Download word counts & scores (.csv)', fn: function () { exportAll('csv'); } }
      ]);
    };
    startLive();
  }

  function soundBtn() { const b = $('#lv-sound'); if (b) b.innerHTML = Ink.icon(T.live.sound ? 'bell' : 'bellOff'); }

  function openCloseItems() {
    const a = T.live.data && T.live.data.assignment;
    const items = [
      { icon: 'clock', label: 'Open now for 30 minutes', fn: function () { override('open', { minutes: 30 }); } },
      { icon: 'clock', label: 'Open now for 60 minutes', fn: function () { override('open', { minutes: 60 }); } },
      { icon: 'calendar', label: 'Open for the rest of today', fn: function () { override('open', { until: 'today' }); } },
      { icon: 'unlock', label: 'Open until I close it', fn: function () { override('open', {}); } },
      { icon: 'lock', label: 'Close now', fn: function () { override('closed', {}); } }
    ];
    if (a && a.override && a.override.mode) items.push({ sep: true }, { icon: 'refresh', label: 'Go back to the normal schedule', fn: function () { override('', {}); } });
    return items;
  }

  async function override(mode, extra) {
    try {
      await call('tOverride', Object.assign({ aid: T.live.aid, mode: mode }, extra));
      Ink.toast(mode === 'open' ? 'Opened. Students marked absent stay closed.' : mode === 'closed' ? 'Closed. Students writing now will be saved and sent back to their list.' : 'Back on the normal schedule.', 'good', 4000);
      await reboot();
      pollLive();
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

  /* Attendance: mark who's away today (their assignments stay closed all day). */
  async function attendance(a) {
    if (!a) return;
    const cids = a.classIds || [];
    const list = studentsIn(cids).filter(function (s) { return s.active !== false; }).sort(function (x, y) { return (x.first + x.last).localeCompare(y.first + y.last); });
    const absent = new Set(T.boot.absentToday || []);
    const res = await Ink.modal({
      title: 'Attendance · ' + Ink.fmtDate(T.boot.today, { weekday: 'long', month: 'long', day: 'numeric' }),
      html: '<p class="muted small" style="margin-top:0">Tap anyone who\'s away. Absent students can\'t open <b>any</b> assignment today, even ones you open for the rest of the class. It resets tomorrow.</p>' +
        (cids.length > 1 ? cids.map(function (cid) { return '<div class="att-h">' + esc(className(cid)) + '</div><div class="att-grid">' + list.filter(function (s) { return s.classId === cid; }).map(chip).join('') + '</div>'; }).join('') : '<div class="att-grid">' + list.map(chip).join('') + '</div>'),
      onOpen: function (b) {
        b.closest('.modal').classList.add('wide');
        b.querySelectorAll('.att').forEach(function (el) { el.onclick = function () { el.classList.toggle('away'); el.querySelector('em').textContent = el.classList.contains('away') ? 'Absent' : 'Here'; }; });
      },
      buttons: [{ label: 'Cancel', value: null }, { label: 'Save attendance', cls: 'primary', collect: function (b) { return $$('.att', b).map(function (el) { return { sid: el.dataset.sid, away: el.classList.contains('away') }; }); } }]
    });
    function chip(s) { const away = absent.has(s.id); return '<button type="button" class="att' + (away ? ' away' : '') + '" data-sid="' + s.id + '"><b>' + esc(s.first + ' ' + s.last) + '</b><em>' + (away ? 'Absent' : 'Here') + '</em></button>'; }
    if (!res) return;
    const nowAway = res.filter(function (x) { return x.away && !absent.has(x.sid); }).map(function (x) { return x.sid; });
    const nowHere = res.filter(function (x) { return !x.away && absent.has(x.sid); }).map(function (x) { return x.sid; });
    try {
      if (nowAway.length) T.boot.absentToday = (await call('tSetAbsent', { sids: nowAway, absent: true })).absentToday;
      if (nowHere.length) T.boot.absentToday = (await call('tSetAbsent', { sids: nowHere, absent: false })).absentToday;
      Ink.toast('Attendance saved.', 'good');
      pollLive();
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

  async function setAbsent(sid, absent) {
    try {
      T.boot.absentToday = (await call('tSetAbsent', { sids: [sid], absent: absent })).absentToday;
      const s = student(sid);
      Ink.toast(s.first + (absent ? ' is marked absent today.' : ' is marked here.'), 'good');
      if (T.tab === 'live') pollLive();
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

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
      drawLive();
    } catch (err) {
      const u = $('#lv-updated');
      if (u) u.textContent = 'Connection problem — retrying…';
    } finally { T.live.busy = false; }
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && T.tab === 'live') pollLive(); });

  function drawLive() {
    const d = T.live.data;
    if (!d || !$('#lv-cards')) return;
    const a = d.assignment;
    const now = d.now;
    $('#lv-windows').innerHTML = (a.classIds || []).map(function (cid) {
      const w = d.windows[cid];
      return '<span class="pill ' + (w && w.open ? 'open' : (w && w.opensAt ? 'soon' : 'closed')) + '">' + esc(className(cid).replace(/\s*\(Demo\)$/, '')) + ': ' + esc(winText(w)) + '</span>';
    }).join('') + (a.override && a.override.mode ? ' <span class="muted small">Manual override is on.</span>' : '');
    const clsSel = $('#lv-cls');
    if ((a.classIds || []).length > 1) {
      clsSel.hidden = false;
      const want = '<option value="">All classes</option>' + a.classIds.map(function (c) { return '<option value="' + c + '">' + esc(className(c)) + '</option>'; }).join('');
      if (clsSel.dataset.sig !== want) { clsSel.innerHTML = want; clsSel.dataset.sig = want; clsSel.value = T.live.cls; }
    } else { clsSel.hidden = true; T.live.cls = ''; }

    let rows = d.rows.slice();
    if (T.live.cls) rows = rows.filter(function (r) { return r.classId === T.live.cls; });

    const c = { writing: 0, locked: 0, submitted: 0, none: 0, absent: 0 };
    let sum = 0, n = 0;
    rows.forEach(function (r) {
      if (r.state === 'writing' || r.state === 'idle') c.writing++;
      if (r.state === 'locked') c.locked++;
      if (r.state === 'submitted') c.submitted++;
      if (r.state === 'none') c.none++;
      if (r.absent) c.absent++;
      if (r.state !== 'none' && r.state !== 'absent' || r.words) { sum += r.words || 0; n++; }
    });
    $('#lv-tiles').innerHTML =
      tile(c.writing, 'Writing now', 'green') + tile(c.locked, 'Locked out', c.locked ? 'red' : '') + tile(c.submitted, 'Submitted', 'blue') +
      tile(c.none, 'Not started', '') + tile(c.absent, 'Absent today', '') + tile(n ? Math.round(sum / n) : 0, 'Average words', '');
    const lc = $('#lock-count');
    lc.hidden = !c.locked; lc.textContent = c.locked;
    $('#lv-clear-all').hidden = !c.locked;
    $('#lv-sim').hidden = !d.demo;

    const nowLocked = {};
    let fresh = false;
    rows.forEach(function (r) { if (r.state === 'locked') { nowLocked[r.sid] = r.lockedAt; if (T.live.locked[r.sid] !== r.lockedAt) fresh = true; } });
    if (fresh && T.live.hadData && T.live.sound) chime();
    T.live.locked = nowLocked;
    T.live.hadData = true;

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
    const st = (a.settings || {});
    const g = { min: st.minWords, max: st.maxWords };
    const cards = $('#lv-cards');
    cards.innerHTML = rows.length ? '' : '<div class="empty">No students in this assignment\'s classes yet.</div>';
    rows.forEach(function (r) {
      const el = document.createElement('div');
      el.className = 'card scard ' + r.state + (T.drawer && T.drawer.sid === r.sid ? ' sel' : '');
      let sub = '';
      if (r.state !== 'none' && r.state !== 'absent') {
        const bits = [];
        if (r.state === 'submitted') bits.push('Handed in ' + Ink.fmtTime(r.submittedAt));
        else bits.push(r.lastSaveAt ? 'Typed ' + Ink.ago(r.lastSaveAt, now) : 'Opened, no typing yet');
        if (r.lockCount) bits.push('<span class="flag">' + r.lockCount + '× locked</span>');
        if (r.pasteBlocked) bits.push('<span class="flag">' + r.pasteBlocked + ' paste' + (r.pasteBlocked > 1 ? 's' : '') + '</span>');
        if (r.insertBlocked) bits.push('<span class="flag">' + r.insertBlocked + ' big insert</span>');
        sub = '<div class="sub">' + bits.join('<span>·</span>') + '</div>' + (timeLine(r) ? '<div class="sub t">' + Ink.icon('clock') + esc(timeLine(r)) + '</div>' : '');
      }
      const pct = Ink.goalPct(r.words || 0, g);
      el.innerHTML =
        '<div class="nm"><span class="nm-t"><span class="nm-n">' + esc(r.first + ' ' + r.last) + '</span>' + accomBadges(r.accom) + '</span><span class="pill ' + r.state + '">' + STATE_LABEL[r.state] + '</span></div>' +
        (r.state === 'none' ? '<div class="sub" style="margin-top:12px">Hasn\'t opened it yet</div>' :
          r.state === 'absent' && !r.words ? '<div class="sub" style="margin-top:12px">' + Ink.icon('userX') + 'Marked absent today</div>' :
          '<div class="wc">' + (r.words || 0) + '<small>words</small>' + (r.openComments ? '<span class="cm-badge" title="Comments not yet marked done">' + Ink.icon('comment') + r.openComments + '</span>' : '') + '</div>' +
          ((g.min || g.max) ? '<div class="goal-bar' + (g.min && r.words >= g.min ? ' met' : '') + '"><i style="width:' + pct + '%"></i></div>' : '') + sub) +
        (r.state === 'locked' ? '<div class="why">' + esc(r.lockReason || 'Left the window') + ' · ' + esc(Ink.fmtTime(r.lockedAt)) + '</div><button class="btn sm teal clear-btn" data-clear>' + Ink.bi('unlock', 'Clear') + '</button>' : '');
      el.addEventListener('click', function (e) {
        if (e.target.closest('[data-clear]')) { e.stopPropagation(); clearStudent(r.sid, e.target.closest('button')); return; }
        openDrawer(r.sid);
      });
      cards.appendChild(el);
    });

    const sname = {};
    d.rows.forEach(function (r) { sname[r.sid] = r.first + ' ' + r.last; });
    $('#lv-feed').innerHTML = d.events.length ? d.events.map(function (e) { return evHtml(e, sname[e.sid]); }).join('') : '<div class="muted small">Nothing yet.</div>';
    $('#lv-updated').textContent = 'Updated ' + Ink.fmtTimeSec(Date.now());
    if (T.drawer) refreshDrawerHeader();
  }

  function tile(v, label, cls) { return '<div class="card tile ' + (cls || '') + '"><b>' + v + '</b><span>' + label + '</span></div>'; }

  async function clearStudent(sid, btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin sm"></span>'; }
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
        const o = audioCtx.createOscillator(), gn = audioCtx.createGain();
        o.frequency.value = f; o.type = 'sine';
        gn.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.16);
        gn.gain.exponentialRampToValueAtTime(0.18, audioCtx.currentTime + i * 0.16 + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.16 + 0.3);
        o.connect(gn); gn.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * 0.16); o.stop(audioCtx.currentTime + i * 0.16 + 0.32);
      });
    } catch (e) { /* ignore */ }
  }

  function startSim() {
    T.live.sim = true;
    const b = $('#lv-sim');
    if (b) { b.innerHTML = Ink.bi('pause', 'Stop simulation'); b.classList.add('teal'); }
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
    if (b) { b.innerHTML = Ink.bi('play', 'Simulate class'); b.classList.remove('teal'); }
  }

  /* ───────────── Student drawer (Live) ───────────── */
  function openDrawer(sid) {
    closeDrawer();
    T.drawer = { sid: sid, aid: T.live.aid, mode: 'live', data: null, revCache: {}, timer: 0, fullAt: 0, idx: -1, playing: 0, active: null };
    const back = document.createElement('div');
    back.className = 'drawer-back';
    back.onclick = closeDrawer;
    const dr = document.createElement('aside');
    dr.className = 'drawer';
    dr.innerHTML =
      '<div class="drawer-head"><div><h2 id="dr-name"></h2><div class="muted small" id="dr-sub"></div></div>' +
      '<div class="row" style="gap:6px" id="dr-actions"></div></div>' +
      '<div class="drawer-body">' +
      '  <div class="drawer-doc">' +
      '    <div class="row" style="justify-content:space-between;margin-bottom:12px"><div class="mode-switch"><button data-mode="live" class="on"><span class="live-dot"></span>Live</button><button data-mode="playback">Playback</button></div><span class="muted small" id="dr-updated"></span></div>' +
      '    <div class="playback" id="dr-pb" hidden><div class="row" style="gap:10px;flex-wrap:nowrap"><button class="btn sm icon-only" id="dr-play" title="Play" aria-label="Play">' + Ink.icon('play') + '</button><input type="range" id="dr-range" min="0" max="0" value="0" aria-label="Snapshot"></div><div class="pb-meta"><span id="dr-pb-when"></span><span id="dr-pb-words"></span></div></div>' +
      '    <div class="hint-line" id="dr-hint">' + Ink.icon('comment') + 'Select text to leave a comment the student sees right away.</div>' +
      '    <div id="dr-docview"></div>' +
      '  </div>' +
      '  <div class="drawer-side">' +
      '    <div><h4>Time</h4><div id="dr-time"></div></div>' +
      '    <div><h4>Comments <span class="count-badge" id="dr-ccount"></span></h4><div class="cmt-list" id="dr-cmts"></div></div>' +
      '    <div><h4>Stats</h4><dl class="kv" id="dr-kv"></dl></div>' +
      '    <div><h4>Words over time</h4><div id="dr-spark" class="muted small">—</div></div>' +
      '    <div><h4>Timeline</h4><div class="timeline" id="dr-tl"></div></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(back);
    document.body.appendChild(dr);
    T.drawer.el = dr; T.drawer.back = back;
    const D = T.drawer;
    D.view = docView($('#dr-docview', dr), {
      comments: true,
      onAdd: async function (anchor, text) {
        const r = await call('tAddComment', { aid: D.aid, sid: D.sid, comment: Object.assign({}, anchor, { text: text }) });
        if (D.data) D.data.comments = r.comments;
        drawDrawerComments();
        Ink.toast('Comment added. ' + (rowFor(D.sid) && rowFor(D.sid).online ? 'The student can see it now.' : 'The student will see it next time they open this.'), 'good');
      },
      onSelectComment: function (c) { D.active = c.id; drawDrawerComments(); }
    });
    $$('.mode-switch button', dr).forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
    $('#dr-range', dr).oninput = function () { showRevision(Number(this.value)); };
    $('#dr-play', dr).onclick = togglePlay;
    document.addEventListener('keydown', drawerKey);
    refreshDrawerHeader();
    loadDrawer(true);
    T.drawer.timer = setInterval(function () { if (T.drawer && T.drawer.mode === 'live') loadDrawer(Date.now() - T.drawer.fullAt > 20000); }, 3000);
    drawLive();
  }
  function drawerKey(e) { if (e.key === 'Escape' && !$('.modal-back') && !$('.cmt-pop')) closeDrawer(); }
  function closeDrawer() {
    if (!T.drawer) return;
    clearInterval(T.drawer.timer);
    clearInterval(T.drawer.playing);
    if (T.drawer.view) T.drawer.view.destroy();
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
    $('#dr-name', D.el).innerHTML = esc(r.first + ' ' + r.last) + ' <span class="pill ' + r.state + '">' + STATE_LABEL[r.state] + '</span>';
    $('#dr-sub', D.el).innerHTML = esc(className(r.classId)) + (r.state === 'locked' ? ' · ' + esc(r.lockReason || '') : '') + (accomBadges(r.accom) ? ' · ' + accomBadges(r.accom) : '');
    const acts = $('#dr-actions', D.el);
    const sig = r.state + '|' + D.sid + '|' + r.absent;
    if (acts.dataset.sig === sig) return;
    acts.dataset.sig = sig;
    acts.innerHTML = '';
    const add = function (label, icon, cls, fn, title) {
      const b = document.createElement('button');
      b.className = 'btn sm ' + (cls || '') + (label ? '' : ' icon-only');
      b.innerHTML = Ink.bi(icon, label);
      if (title) { b.title = title; b.setAttribute('aria-label', title); }
      b.onclick = fn;
      acts.appendChild(b);
      return b;
    };
    if (r.state === 'locked') add('Clear lock', 'unlock', 'teal', function () { clearStudent(D.sid, this); });
    else if (r.state === 'writing' || r.state === 'idle' || r.state === 'offline') add('Pause', 'lock', 'danger', async function () {
      if (!(await Ink.confirm('Pause ' + r.first + '?', 'Their screen locks within about 10 seconds, and they\'ll need you to clear them.', 'Pause', true))) return;
      try { await call('tLock', { aid: D.aid, sid: D.sid }); Ink.toast('Paused.', 'good'); pollLive(); } catch (err) { Ink.toast(err.message, 'bad'); }
    });
    if (r.state === 'submitted') add('Reopen', 'refresh', '', async function () {
      if (!(await Ink.confirm('Give it back to ' + r.first + '?', 'They\'ll be able to edit and submit again while the assignment is open.', 'Reopen'))) return;
      try { await call('tReturn', { aid: D.aid, sid: D.sid }); Ink.toast('Reopened.', 'good'); pollLive(); } catch (err) { Ink.toast(err.message, 'bad'); }
    });
    if (r.state !== 'submitted') add(r.absent ? 'Mark here' : 'Mark absent', r.absent ? 'userCheck' : 'userX', '', function () { setAbsent(D.sid, !r.absent); });
    add('Grade', 'grade', '', function () { const sid = D.sid, aid = D.aid; closeDrawer(); go('grade', aid + '/' + sid); });
    add('', 'record', 'ghost', function () { const sid = D.sid; closeDrawer(); go('record', sid); }, 'Student record');
    add('', 'download', 'ghost', function () { downloadOne(); }, 'Download as Word');
    add('', 'x', 'ghost', closeDrawer, 'Close');
  }

  async function loadDrawer(full) {
    const D = T.drawer;
    if (!D || D.loading) return;
    D.loading = true;
    try {
      const r = await call('tWork', { aid: D.aid, sid: D.sid, light: !full });
      if (T.drawer !== D) return;
      if (full) { D.data = r; D.fullAt = Date.now(); }
      else if (D.data) { D.data.work = r.work; D.data.html = r.html; D.data.comments = r.comments; D.data.grade = r.grade; }
      else D.data = r;
      if (D.mode === 'live') { D.view.set(r.html); }
      $('#dr-updated', D.el).textContent = 'Updated ' + Ink.fmtTimeSec(Date.now());
      drawDrawerSide();
    } catch (err) {
      if (T.drawer === D) $('#dr-updated', D.el).textContent = 'Connection problem — retrying…';
    } finally { D.loading = false; }
  }

  function drawDrawerComments() {
    const D = T.drawer;
    if (!D || !D.data) return;
    const list = D.data.comments || [];
    const located = D.mode === 'live' ? D.view.setComments(list, D.active) : null;
    const open = list.filter(function (c) { return !c.resolved; }).length;
    $('#dr-ccount', D.el).textContent = open || '';
    $('#dr-ccount', D.el).hidden = !open;
    const host = $('#dr-cmts', D.el);
    host.innerHTML = commentListHtml(list, located, D.active);
    const refresh = function () { loadDrawer(false); };
    wireCommentList(host, list, {
      onFocus: function (c) { D.active = c.id; drawDrawerComments(); if (D.mode === 'live' && !D.view.scrollTo(c)) Ink.toast('The student has changed that part of their writing.'); },
      onDelete: function (c) { commentAction('delete', c, refresh); },
      onReopen: function (c) { commentAction('reopen', c, refresh); },
      onEdit: function (c) { commentAction('edit', c, refresh); }
    });
  }

  function timeBreakdown(w) {
    const open = w.openSec || 0, act = Math.min(w.activeSec || 0, open || w.activeSec || 0), lockd = w.lockedSec || 0;
    const idle = Math.max(0, open - act);
    const tot = open + lockd;
    if (!tot && !act) return '<div class="muted small">No time recorded yet.</div>';
    const pc = function (x) { return tot ? (x / tot * 100).toFixed(1) : 0; };
    return '<div class="tb-total"><b>' + Ink.dur(tot) + '</b><span>in the assignment</span></div>' +
      '<div class="tbar"><i class="t-a" style="width:' + pc(act) + '%"></i><i class="t-i" style="width:' + pc(idle) + '%"></i><i class="t-l" style="width:' + pc(lockd) + '%"></i></div>' +
      '<dl class="kv tkv"><dt><span class="sw t-a"></span>Actively typing</dt><dd>' + Ink.dur(act) + (tot ? ' <small>' + Math.round(act / tot * 100) + '%</small>' : '') + '</dd>' +
      '<dt><span class="sw t-i"></span>Open, not typing</dt><dd>' + Ink.dur(idle) + '</dd>' +
      '<dt><span class="sw t-l"></span>Locked out</dt><dd' + (lockd ? ' class="flag"' : '') + '>' + Ink.dur(lockd) + '</dd>' +
      '<dt>Sessions</dt><dd>' + (w.sessions || 1) + '</dd>' +
      '<dt>Read-only views</dt><dd>' + (w.viewCount ? w.viewCount + ' · last ' + esc(Ink.fmtDateTime(w.lastViewAt)) : 'none') + '</dd></dl>' +
      '<div class="muted tiny">“Actively typing” counts each second the student pressed a key within the previous 15 seconds.</div>';
  }

  function drawDrawerSide() {
    const D = T.drawer;
    const w = D.data && D.data.work;
    drawDrawerComments();
    if (!w) {
      $('#dr-kv', D.el).innerHTML = '<dt>Status</dt><dd>' + (D.data && D.data.absent ? 'Absent today' : 'Not started') + '</dd>';
      $('#dr-time', D.el).innerHTML = '<div class="muted small">No time recorded yet.</div>';
      $('#dr-hint', D.el).hidden = true;
      return;
    }
    $('#dr-hint', D.el).hidden = D.mode !== 'live';
    $('#dr-time', D.el).innerHTML = timeBreakdown(w);
    const kpc = w.chars ? w.keystrokes / Math.max(1, w.chars - (w.dictated || 0)) : 0;
    const wpm = w.activeSec > 30 ? Math.round(w.words / (w.activeSec / 60)) : 0;
    const kv = [
      ['Words', w.words], ['Characters', w.chars],
      ['Started', Ink.fmtDateTime(w.startedAt)],
      ['Last typed', w.lastSaveAt ? Ink.ago(w.lastSaveAt) : '—'],
      ['Writing speed', wpm ? wpm + ' words/min typing' : '—'],
      ['Keystrokes', (w.keystrokes || 0).toLocaleString()],
      ['Keystrokes per character', kpc ? kpc.toFixed(2) : '—', kpc && w.chars - (w.dictated || 0) > 150 && kpc < 0.85],
      ['Backspaces/deletes', (w.deletions || 0).toLocaleString()],
      ['Dictated characters', (w.dictated || 0).toLocaleString()],
      ['Dictionary lookups', w.lookups || 0],
      ['Times locked', w.lockCount, w.lockCount > 0],
      ['Paste attempts blocked', w.pasteBlocked, w.pasteBlocked > 0],
      ['Big inserts blocked', w.insertBlocked, w.insertBlocked > 0]
    ];
    if (w.submittedAt && w.status === 'submitted') kv.push(['Submitted', Ink.fmtDateTime(w.submittedAt)]);
    const g = D.data.grade;
    const a = assignment(D.aid);
    if (g && a && a.rubric) kv.push(['Score', R.fmt(g.total) + ' / ' + R.fmt(g.max) + (g.graded ? '' : ' (in progress)')]);
    $('#dr-kv', D.el).innerHTML = kv.map(function (k) { return '<dt>' + esc(k[0]) + '</dt><dd' + (k[2] ? ' class="flag"' : '') + '>' + esc(String(k[1])) + '</dd>'; }).join('') +
      '<dt class="kv-note">Typing makes about 1.1–1.6 keystrokes per character. Much lower means text appeared without being typed here (dictation is left out of this number).</dt>';
    const revs = (D.data.revisions || []);
    const pts = revs.map(function (r) { return [r.ts, r.words]; });
    if (w.lastSaveAt) pts.push([w.lastSaveAt, w.words]);
    if (pts.length >= 2) {
      const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
      const mx = Math.max.apply(null, pts.map(function (p) { return p[1]; })) || 1;
      const path = pts.map(function (p, i) { return (i ? 'L' : 'M') + (((p[0] - t0) / Math.max(1, t1 - t0)) * 236 + 2).toFixed(1) + ' ' + (52 - (p[1] / mx) * 48).toFixed(1); }).join(' ');
      $('#dr-spark', D.el).innerHTML = '<svg class="spark" viewBox="0 0 240 56" preserveAspectRatio="none"><path d="' + path + '" fill="none" stroke="#1c6b66" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="row muted small" style="justify-content:space-between"><span>' + esc(Ink.fmtTime(t0)) + '</span><span>' + esc(Ink.fmtTime(t1)) + '</span></div>';
    } else $('#dr-spark', D.el).textContent = 'Not enough history yet.';
    if (D.data.events) $('#dr-tl', D.el).innerHTML = D.data.events.slice().reverse().map(function (e) { return evHtml(e, null); }).join('') || '<div class="muted small">No activity yet.</div>';
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
    $('#dr-hint', D.el).hidden = mode !== 'live';
    clearInterval(D.playing); D.playing = 0;
    $('#dr-play', D.el).innerHTML = Ink.icon('play');
    if (mode === 'live') { D.view.set(''); D.view.set(D.data ? D.data.html : ''); loadDrawer(true); return; }
    D.view.setComments([], null);
    const revs = (D.data && D.data.revisions) || [];
    if (!revs.length) Ink.toast('No saved history yet — snapshots are kept about every 90 seconds while a student writes.');
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
      D.view.el.style.opacity = '.5';
      try {
        const r = await call('tRevision', { aid: D.aid, sid: D.sid, row: revs[i].row });
        D.revCache[revs[i].row] = r.html;
        html = r.html;
      } catch (err) { Ink.toast(err.message, 'bad'); return; }
      finally { if (T.drawer === D) D.view.el.style.opacity = ''; }
      if (T.drawer !== D || D.idx !== i) return;
    }
    D.view.el.innerHTML = Ink.sanitize(html) || '<p class="muted"><i>Empty.</i></p>';
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

  /* ───────────── Export & print ───────────── */
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
  async function exportAll(kind) {
    Ink.toast('Preparing…', '', 1500);
    try {
      const r = await call('tExport', { aid: T.live.aid });
      const title = r.assignment.title;
      let items = r.items.slice().sort(function (x, y) { return (x.last + x.first).localeCompare(y.last + y.first); });
      if (T.live.cls) items = items.filter(function (it) { return className(T.live.cls) === it.className; });
      if (kind === 'csv') {
        const rb = r.assignment.rubric;
        const head = ['Last name', 'First name', 'Class', 'Status', 'Words', 'Submitted'];
        if (rb && rb.criteria) { rb.criteria.forEach(function (c) { head.push(c.name); }); head.push('Total', 'Out of'); }
        head.push('Graded');
        const lines = [head].concat(items.map(function (it) {
          const row = [it.last, it.first, it.className, it.status === 'none' ? 'not started' : it.status, it.words, it.submittedAt ? new Date(it.submittedAt).toLocaleString() : ''];
          const g = it.grade || {};
          if (rb && rb.criteria) {
            rb.criteria.forEach(function (c) { const i = g.scores ? g.scores[c.id] : undefined; row.push(i === undefined || i === null ? '' : R.critPoints(rb, c, i)); });
            row.push(g.scores ? R.total(rb, g.scores) : '', R.max(rb));
          }
          row.push(g.graded ? 'yes' : '');
          return row;
        }));
        download(title + ' - word counts and scores.csv', 'text/csv', lines.map(function (l) { return l.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n'));
        return;
      }
      const started = items.filter(function (it) { return it.status !== 'none'; });
      if (!started.length) { Ink.toast('Nobody has written anything yet.'); return; }
      const body = started.map(function (it, i) { return (i ? '<br clear=all style="page-break-before:always">' : '') + itemHeader(it, title) + Ink.sanitize(it.html); }).join('');
      download(title + '.doc', 'application/msword', docShell(title, body));
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }
  function downloadOne() {
    const D = T.drawer;
    const r = rowFor(D.sid);
    const w = D.data && D.data.work;
    const it = { first: r.first, last: r.last, className: className(r.classId), words: w ? w.words : 0, status: w ? w.status : 'none', submittedAt: w ? w.submittedAt : 0, html: D.data ? D.data.html : '' };
    const t = T.live.data.assignment.title;
    download(it.last + ', ' + it.first + ' - ' + t + '.doc', 'application/msword', docShell(t, itemHeader(it, t) + Ink.sanitize(it.html)));
  }

  /** "Print all" — options, then a duplex-ready PDF. onlySid prints one student. */
  async function printAllDialog(aid, clsFilter, onlySid) {
    const a = assignment(aid);
    if (!a) return;
    const multi = !onlySid && (a.classIds || []).length > 1;
    const saved = Ink.store.get('inkwell_print') || { who: 'submitted', dbl: true, duplex: true, fb: false };
    const opts = await Ink.modal({
      title: onlySid ? 'Print ' + (student(onlySid) || {}).first + '\'s writing' : 'Print all · ' + a.title,
      html: (onlySid ? '' : '<div class="field"><label>Whose writing</label><div class="seg"><label><input type="radio" name="pw" value="submitted"> Submitted only</label><label><input type="radio" name="pw" value="started"> Everyone who has started</label></div></div>') +
        (multi ? '<div class="field"><label for="pcls">Class</label><select class="input" id="pcls"><option value="">All classes</option>' + a.classIds.map(function (c) { return '<option value="' + c + '">' + esc(className(c)) + '</option>'; }).join('') + '</select></div>' : '') +
        '<label class="check"><input type="checkbox" id="pdbl"> <span>Double-spaced</span></label>' +
        (onlySid ? '' : '<label class="check"><input type="checkbox" id="pdup"> <span><b>Add a blank page after any student who ends on an odd page</b><br><span class="hint">For double-sided printing — each student\'s work stays on their own sheets of paper.</span></span></label>') +
        '<label class="check"><input type="checkbox" id="pfb"' + (a.rubric ? '' : '') + '> <span>Include a feedback page (rubric scores, your comments, and comments in the writing)</span></label>' +
        '<p class="muted small" style="margin-bottom:0">Every page has the student\'s name at the top. The PDF opens in a new tab — print it from there' + (onlySid ? '' : ' with <b>double-sided</b> turned on') + '.</p>',
      onOpen: function (b) {
        const w = b.querySelector('input[name=pw][value="' + saved.who + '"]'); if (w) w.checked = true;
        b.querySelector('#pdbl').checked = saved.dbl;
        if (b.querySelector('#pdup')) b.querySelector('#pdup').checked = saved.duplex;
        b.querySelector('#pfb').checked = saved.fb;
        if (b.querySelector('#pcls')) b.querySelector('#pcls').value = clsFilter || '';
      },
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Create PDF', cls: 'primary', collect: function (b) {
          const o = {
            who: onlySid ? 'started' : (b.querySelector('input[name=pw]:checked') || {}).value || 'submitted',
            dbl: b.querySelector('#pdbl').checked, duplex: b.querySelector('#pdup') ? b.querySelector('#pdup').checked : false,
            fb: b.querySelector('#pfb').checked, cls: b.querySelector('#pcls') ? b.querySelector('#pcls').value : (clsFilter || '')
          };
          o.win = window.open('', '_blank');
          if (o.win) o.win.document.write('<!doctype html><title>Preparing PDF…</title><body style="font-family:system-ui;padding:40px;color:#555">Preparing the PDF…</body>');
          return o;
        }
      }]
    });
    if (!opts) return;
    if (!onlySid) Ink.store.set('inkwell_print', { who: opts.who, dbl: opts.dbl, duplex: opts.duplex, fb: opts.fb });
    try {
      const r = await call('tExport', { aid: aid, withComments: opts.fb });
      let items = r.items.slice().sort(function (x, y) { return (x.last + ' ' + x.first).localeCompare(y.last + ' ' + y.first); });
      if (onlySid) items = items.filter(function (it) { return it.sid === onlySid; });
      if (opts.cls) items = items.filter(function (it) { return it.className === className(opts.cls); });
      items = items.filter(function (it) { return opts.who === 'started' ? it.status !== 'none' : it.status === 'submitted'; });
      if (!items.length) { if (opts.win) opts.win.close(); Ink.toast(opts.who === 'submitted' ? 'Nobody has submitted yet. Try "Everyone who has started".' : 'Nobody has written anything yet.', 'warn', 5000); return; }
      const res = await Ink.PDF.open(items, r.assignment, { doubleSpace: opts.dbl, duplex: opts.duplex, feedback: opts.fb }, opts.win);
      const padded = res.stats.filter(function (s) { return s.padded; }).length;
      Ink.toast('PDF ready: ' + items.length + ' student' + (items.length === 1 ? '' : 's') + ', ' + res.pages + ' pages' + (padded ? ' (' + padded + ' blank page' + (padded === 1 ? '' : 's') + ' added for double-sided printing)' : '') + '.', 'good', 6000);
    } catch (err) { if (opts.win) opts.win.close(); Ink.toast('Couldn\'t make the PDF: ' + err.message, 'bad', 6000); }
  }

  /* ════════════════════════ GRADE ════════════════════════ */
  function renderGrade(host) {
    const G = T.grade;
    const list = T.boot.assignments;
    if (!list.length) { host.innerHTML = '<div class="empty card" style="padding:60px"><div class="display">No assignments yet</div></div>'; return; }
    if (!assignment(G.aid)) G.aid = (assignment(T.live.aid) || list[0]).id;
    Ink.store.set('inkwell_grade_aid', G.aid);
    const a = assignment(G.aid);
    host.innerHTML =
      '<div class="grade">' +
      '  <aside class="card g-list">' +
      '    <select class="input g-pick" id="g-assign" aria-label="Assignment"></select>' +
      '    <div class="row g-filters"><select class="input" id="g-filter" aria-label="Show"><option value="all">Everyone</option><option value="submitted">Submitted</option><option value="ungraded">Not graded yet</option><option value="graded">Graded</option></select>' +
      '    <button class="btn sm icon-only" id="g-print" title="Print all" aria-label="Print all">' + Ink.icon('print') + '</button></div>' +
      '    <label class="switch-row"><input type="checkbox" id="g-release"><span class="switch"></span><span>Students can see grades &amp; feedback</span></label>' +
      '    <div class="g-summary muted small" id="g-summary"></div>' +
      '    <div class="g-students" id="g-students"><div class="empty"><span class="spin"></span></div></div>' +
      '  </aside>' +
      '  <section class="g-doc" id="g-doc"><div class="empty card" style="padding:60px">Choose a student.</div></section>' +
      '  <aside class="card g-side" id="g-side"></aside>' +
      '</div>';
    const sel = $('#g-assign');
    list.forEach(function (x) { const o = document.createElement('option'); o.value = x.id; o.textContent = x.title; sel.appendChild(o); });
    sel.value = G.aid;
    sel.onchange = function () { G.aid = sel.value; G.sid = ''; go('grade', G.aid); };
    $('#g-filter').value = G.filter;
    $('#g-filter').onchange = function () { G.filter = this.value; drawGradeList(); };
    $('#g-print').onclick = function () { printAllDialog(G.aid, ''); };
    $('#g-release').checked = !!(a.settings && a.settings.releaseFeedback);
    $('#g-release').onchange = async function () {
      const on = this.checked;
      try {
        await call('tSaveAssignment', { assignment: { id: a.id, title: a.title, classIds: a.classIds, prompt: a.prompt, settings: Object.assign({}, a.settings, { releaseFeedback: on }) } });
        a.settings.releaseFeedback = on;
        Ink.toast(on ? 'Students can now see their scores and your overall comment (for work you\'ve marked graded).' : 'Feedback hidden from students.', 'good', 5000);
      } catch (err) { this.checked = !on; Ink.toast(err.message, 'bad'); }
    };
    loadBoard();
  }

  async function loadBoard() {
    const G = T.grade;
    try {
      G.board = await call('tGradeBoard', { aid: G.aid });
      drawGradeList();
      const rows = filteredRows();
      if (!G.sid || !G.board.rows.find(function (r) { return r.sid === G.sid; })) {
        const first = rows.find(function (r) { return r.started; }) || rows[0];
        if (first) selectStudent(first.sid, true);
      } else selectStudent(G.sid, true);
    } catch (err) { $('#g-students').innerHTML = '<div class="muted small">' + esc(err.message) + '</div>'; }
  }

  function filteredRows() {
    const G = T.grade;
    const rows = (G.board ? G.board.rows : []).slice().sort(function (x, y) { return (x.last + ' ' + x.first).localeCompare(y.last + ' ' + y.first); });
    return rows.filter(function (r) {
      if (G.filter === 'submitted') return r.status === 'submitted';
      if (G.filter === 'ungraded') return r.started && !r.graded;
      if (G.filter === 'graded') return r.graded;
      return true;
    });
  }

  function drawGradeList() {
    const G = T.grade;
    const a = assignment(G.aid);
    const rows = filteredRows();
    const all = G.board ? G.board.rows : [];
    const graded = all.filter(function (r) { return r.graded; }).length;
    const subm = all.filter(function (r) { return r.status === 'submitted'; }).length;
    const scores = all.filter(function (r) { return r.graded && r.max; });
    const avg = scores.length ? scores.reduce(function (s, r) { return s + r.total / r.max; }, 0) / scores.length : 0;
    $('#g-summary').innerHTML = subm + ' submitted · ' + graded + ' graded' + (scores.length && a.rubric ? ' · class average ' + Math.round(avg * 100) + '%' : '');
    $('#g-students').innerHTML = rows.length ? rows.map(function (r) {
      const score = a.rubric && r.total !== null && r.total !== undefined ? R.fmt(r.total) + '<small>/' + R.fmt(r.max) + '</small>' : '';
      return '<button class="g-st' + (r.sid === G.sid ? ' on' : '') + (r.started ? '' : ' none') + '" data-sid="' + r.sid + '">' +
        '<span class="g-nm">' + esc(r.last + ', ' + r.first) + '</span>' +
        '<span class="g-meta">' + (r.status === 'submitted' ? '<span class="pill submitted xs">Submitted</span>' : r.started ? '<span class="pill idle xs">Draft</span>' : '<span class="pill none xs">Not started</span>') +
        (r.started ? '<span class="muted">' + r.words + ' w</span>' : '') + '</span>' +
        '<span class="g-score">' + (r.graded ? '<span class="g-done" title="Graded">' + Ink.icon('check') + '</span>' : '') + score + '</span></button>';
    }).join('') : '<div class="muted small" style="padding:10px">Nobody matches this filter.</div>';
    $$('#g-students .g-st').forEach(function (b) { b.onclick = function () { selectStudent(b.dataset.sid); }; });
  }

  async function selectStudent(sid, keepHash) {
    const G = T.grade;
    flushGrade();
    G.sid = sid;
    if (!keepHash) history.replaceState(null, '', '#grade/' + G.aid + '/' + sid);
    drawGradeList();
    const docHost = $('#g-doc');
    docHost.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    $('#g-side').innerHTML = '';
    try {
      const d = await call('tWork', { aid: G.aid, sid: sid, light: true });
      if (G.sid !== sid || T.tab !== 'grade') return;
      G.data = d;
      G.scores = (d.grade && d.grade.scores) || {};
      G.comment = (d.grade && d.grade.comment) || '';
      G.graded = !!(d.grade && d.grade.graded);
      G.active = null;
      drawGradeDoc();
      drawGradeSide();
    } catch (err) { docHost.innerHTML = '<div class="empty">' + esc(err.message) + '</div>'; }
  }

  function gradeNav(dir) {
    const G = T.grade;
    const rows = filteredRows();
    const i = rows.findIndex(function (r) { return r.sid === G.sid; });
    const n = rows[i + dir];
    if (n) selectStudent(n.sid);
  }

  function drawGradeDoc() {
    const G = T.grade;
    const d = G.data;
    const s = d.student || {};
    const w = d.work;
    const host = $('#g-doc');
    const rows = filteredRows();
    const i = rows.findIndex(function (r) { return r.sid === G.sid; });
    host.innerHTML = '<div class="g-head card"><div class="row" style="gap:10px;min-width:0"><button class="btn sm icon-only" id="g-prev" title="Previous student" aria-label="Previous student"' + (i <= 0 ? ' disabled' : '') + '>' + Ink.icon('chevL') + '</button>' +
      '<div style="min-width:0"><h2>' + esc(s.first + ' ' + s.last) + '</h2><div class="muted small">' + (w ? (w.status === 'submitted' ? 'Submitted ' + esc(Ink.fmtDateTime(w.submittedAt)) : 'Draft — not submitted') + ' · ' + w.words + ' words' + (w.openSec ? ' · open ' + Ink.dur(w.openSec) + ', typing ' + Ink.dur(w.activeSec) : '') : (d.absent ? 'Absent today · not started' : 'Not started')) + '</div></div>' +
      '<button class="btn sm icon-only" id="g-next" title="Next student" aria-label="Next student"' + (i >= rows.length - 1 ? ' disabled' : '') + '>' + Ink.icon('chevR') + '</button></div>' +
      '<div class="row" style="gap:6px"><button class="btn sm" id="g-rec">' + Ink.bi('record', 'Record') + '</button><button class="btn sm" id="g-print1">' + Ink.bi('print', 'Print') + '</button></div></div>' +
      (w ? '<div class="hint-line">' + Ink.icon('comment') + 'Select text in the writing to add a comment. Students see comments right away, even before you release grades.</div>' : '') +
      '<div id="g-view"></div>';
    $('#g-prev').onclick = function () { gradeNav(-1); };
    $('#g-next').onclick = function () { gradeNav(1); };
    $('#g-rec').onclick = function () { go('record', G.sid); };
    $('#g-print1').onclick = function () { printAllDialog(G.aid, '', G.sid); };
    if (G.view) G.view.destroy();
    G.view = docView($('#g-view'), {
      comments: !!w,
      onAdd: async function (anchor, text) {
        const r = await call('tAddComment', { aid: G.aid, sid: G.sid, comment: Object.assign({}, anchor, { text: text }) });
        G.data.comments = r.comments;
        G.panel = 'comments';
        drawGradeSide();
      },
      onSelectComment: function (c) { G.active = c.id; G.panel = 'comments'; drawGradeSide(); }
    });
    G.view.set(d.html);
  }

  function drawGradeSide() {
    const G = T.grade;
    const a = assignment(G.aid);
    const d = G.data;
    const side = $('#g-side');
    const comments = d.comments || [];
    const located = G.view ? G.view.setComments(comments, G.active) : null;
    const open = comments.filter(function (c) { return !c.resolved; }).length;
    side.innerHTML = '<div class="g-tabs"><button data-p="rubric" class="' + (G.panel === 'rubric' ? 'on' : '') + '">' + Ink.bi('rubric', 'Rubric & feedback') + '</button><button data-p="comments" class="' + (G.panel === 'comments' ? 'on' : '') + '">' + Ink.bi('comment', 'Comments') + (comments.length ? '<span class="count-badge' + (open ? '' : ' muted') + '">' + comments.length + '</span>' : '') + '</button></div><div class="g-pane" id="g-pane"></div>';
    $$('.g-tabs button', side).forEach(function (b) { b.onclick = function () { G.panel = b.dataset.p; drawGradeSide(); }; });
    const pane = $('#g-pane', side);
    if (G.panel === 'comments') {
      pane.innerHTML = '<div class="cmt-list">' + commentListHtml(comments, located, G.active) + '</div>';
      const refresh = async function () { const r = await call('tWork', { aid: G.aid, sid: G.sid, light: true }); G.data.comments = r.comments; drawGradeSide(); };
      wireCommentList(pane, comments, {
        onFocus: function (c) { G.active = c.id; drawGradeSide(); if (!G.view.scrollTo(c)) Ink.toast('The student has changed that part of their writing.'); },
        onDelete: function (c) { commentAction('delete', c, refresh); },
        onReopen: function (c) { commentAction('reopen', c, refresh); },
        onEdit: function (c) { commentAction('edit', c, refresh); }
      });
      return;
    }
    let h = '';
    if (a.rubric && a.rubric.criteria && a.rubric.criteria.length) {
      h += '<div class="g-total"><div><b id="g-tot">' + R.fmt(R.total(a.rubric, G.scores)) + '</b><span>/ ' + R.fmt(R.max(a.rubric)) + '</span></div><div class="muted small" id="g-pct"></div>' +
        '<button class="btn xs" id="g-edit-rb">' + Ink.bi('edit', 'Edit rubric') + '</button></div><div id="g-scorer"></div>';
    } else {
      h += '<div class="g-norubric"><b>No rubric for this assignment.</b><p class="muted small">Add one to score each criterion. You can still write an overall comment below.</p><button class="btn teal sm" id="g-new-rb">' + Ink.bi('rubric', 'Add a rubric') + '</button></div>';
    }
    h += '<div class="field" style="margin-top:16px"><label for="g-comment">Overall comment</label><textarea class="input" id="g-comment" rows="6" maxlength="20000" placeholder="Feedback for the student…"></textarea></div>' +
      '<label class="switch-row"><input type="checkbox" id="g-graded"><span class="switch"></span><span><b>Graded</b> — done with this one' + (a.settings && a.settings.releaseFeedback ? ' (the student can see it)' : '') + '</span></label>' +
      '<div class="row" style="justify-content:space-between;margin-top:10px"><span class="muted small" id="g-save"></span><button class="btn primary sm" id="g-next2"' + '>' + Ink.bi('chevR', 'Save & next') + '</button></div>';
    pane.innerHTML = h;
    if ($('#g-scorer')) {
      R.scorer($('#g-scorer'), a.rubric, G.scores, function (s) { G.scores = s; updateTotal(); queueGradeSave(); });
      updateTotal();
      $('#g-edit-rb').onclick = function () { editRubricFor(a, function () { drawGradeSide(); }); };
    }
    if ($('#g-new-rb')) $('#g-new-rb').onclick = function () { editRubricFor(a, function () { drawGradeSide(); }); };
    const ta = $('#g-comment');
    ta.value = G.comment;
    ta.oninput = function () { G.comment = ta.value; queueGradeSave(); };
    $('#g-graded').checked = G.graded;
    $('#g-graded').onchange = function () { G.graded = this.checked; queueGradeSave(true); };
    $('#g-next2').onclick = async function () { await flushGrade(); gradeNav(1); };
    function updateTotal() {
      $('#g-tot').textContent = R.fmt(R.total(a.rubric, G.scores));
      const n = R.scoredCount(a.rubric, G.scores);
      $('#g-pct').textContent = n + ' of ' + a.rubric.criteria.length + ' scored · ' + R.pct(a.rubric, G.scores) + '%';
    }
  }

  let gradeTimer = 0, gradeDirty = false;
  function queueGradeSave(now) {
    gradeDirty = true;
    const el = $('#g-save'); if (el) el.textContent = 'Saving…';
    clearTimeout(gradeTimer);
    gradeTimer = setTimeout(flushGrade, now ? 50 : 900);
  }
  async function flushGrade() {
    clearTimeout(gradeTimer);
    if (!gradeDirty) return;
    gradeDirty = false;
    const G = T.grade;
    const payload = { aid: G.aid, sid: G.sid, scores: G.scores, comment: G.comment, graded: G.graded };
    try {
      const r = await call('tSaveGrade', payload);
      const row = G.board && G.board.rows.find(function (x) { return x.sid === payload.sid; });
      if (row) { row.graded = r.grade.graded; row.total = r.grade.total; row.max = r.grade.max; }
      if (G.sid === payload.sid && $('#g-save')) $('#g-save').textContent = 'Saved ' + Ink.fmtTime(Date.now());
      drawGradeList();
    } catch (err) { gradeDirty = true; Ink.toast('Couldn\'t save the grade: ' + err.message, 'bad'); }
  }
  window.addEventListener('beforeunload', function (e) { if (gradeDirty) { flushGrade(); e.preventDefault(); e.returnValue = ''; } });

  async function editRubricFor(a, after) {
    const sources = (T.boot.rubricSources || []).filter(function (s) { return s.aid !== a.id; });
    const r = await R.edit(a.rubric, { sources: sources, title: a.title });
    if (r === null) return;
    try {
      const res = await call('tSaveAssignment', { assignment: { id: a.id, title: a.title, classIds: a.classIds, prompt: a.prompt, settings: a.settings, rubric: r || '' } });
      a.rubric = res.assignment.rubric;
      await reboot();
      Ink.toast(r ? 'Rubric saved.' : 'Rubric removed.', 'good');
      if (after) after(a);
    } catch (err) { Ink.toast(err.message, 'bad'); }
  }

  /* ════════════════════════ STUDENT RECORD ════════════════════════ */
  async function renderRecord(host, sid) {
    host.innerHTML = '<div class="empty"><span class="spin"></span></div>';
    let d;
    try { d = await call('tRecord', { sid: sid }); } catch (err) { host.innerHTML = '<div class="empty card">' + esc(err.message) + '</div>'; return; }
    if (T.tab !== 'record') return;
    const s = d.student;
    const ac = s.accom || {};
    const accom = [ac.extended ? 'Extended access' : '', ac.tts ? 'Read aloud' : '', (ac.stt || ac.relaxed) ? 'Speech-to-text' : ''].filter(String);
    const items = d.items;
    const rubricItems = items.filter(function (it) { return it.assignment.rubric && it.grade && it.grade.graded; });
    const avg = rubricItems.length ? Math.round(rubricItems.reduce(function (t, it) { return t + (it.grade.max ? it.grade.total / it.grade.max : 0); }, 0) / rubricItems.length * 100) : null;
    const flag = function (it) {
      const w = it.work; if (!w) return '';
      const f = [];
      if (w.lockCount) f.push(w.lockCount + '× locked');
      if (w.pasteBlocked) f.push(w.pasteBlocked + ' paste' + (w.pasteBlocked > 1 ? 's' : ''));
      if (w.insertBlocked) f.push(w.insertBlocked + ' big insert');
      return f.join(' · ');
    };
    let h = '<div class="rec">' +
      '<div class="rec-head card"><div><div class="muted small no-print"><a href="#classes">Classes &amp; students</a> / Record</div><h1 class="display">' + esc(s.first + ' ' + s.last) + '</h1>' +
      '<div class="muted">' + esc(d.className) + ' · code <code>' + esc(s.code) + '</code>' + (accom.length ? ' · ' + esc(accom.join(', ')) : '') + '</div></div>' +
      '<div class="row no-print" style="gap:8px"><button class="btn" id="rec-expand">' + Ink.bi('eye', 'Show all writing') + '</button><button class="btn" id="rec-print">' + Ink.bi('print', 'Print record') + '</button></div></div>' +
      '<div class="tiles rec-tiles">' + tile(items.filter(function (it) { return it.work && it.work.status === 'submitted'; }).length + '<small>/' + items.length + '</small>', 'Submitted', 'blue') +
      tile(avg === null ? '—' : avg + '%', 'Average score', '') + tile(items.reduce(function (t, it) { return t + (it.work ? it.work.words : 0); }, 0).toLocaleString(), 'Words written', '') +
      tile(Ink.dur(items.reduce(function (t, it) { return t + (it.work ? it.work.activeSec : 0); }, 0)), 'Time typing', '') +
      tile(d.absences.length, 'Days absent', '') + tile(items.reduce(function (t, it) { return t + (it.work ? (it.work.lockCount || 0) : 0); }, 0), 'Times locked', '') + '</div>' +
      '<div class="card rec-table"><table class="roster"><thead><tr><th>Assignment</th><th>Status</th><th>Words</th><th>Score</th><th>Time open / typing</th><th>Flags</th></tr></thead><tbody>' +
      items.map(function (it, i) {
        const w = it.work, g = it.grade, rb = it.assignment.rubric;
        return '<tr><td><a href="#rec-' + i + '" class="rec-jump">' + esc(it.assignment.title) + '</a>' + (it.assignment.archived ? ' <span class="muted small">(archived)</span>' : '') + '</td>' +
          '<td>' + (w ? (w.status === 'submitted' ? '<span class="pill submitted">Submitted</span>' : '<span class="pill idle">Draft</span>') : '<span class="pill none">Not started</span>') + '</td>' +
          '<td>' + (w ? w.words : '—') + '</td><td>' + (g && rb ? R.fmt(g.total) + ' / ' + R.fmt(g.max) + (g.graded ? '' : ' <span class="muted small">(in progress)</span>') : g && g.graded ? 'Graded' : '—') + '</td>' +
          '<td>' + (w ? Ink.dur(w.openSec) + ' / ' + Ink.dur(w.activeSec) : '—') + '</td><td class="flagc">' + esc(flag(it)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    items.forEach(function (it, i) {
      const w = it.work, g = it.grade, rb = it.assignment.rubric;
      h += '<section class="card rec-item" id="rec-' + i + '"><div class="rec-ih"><div><h2>' + esc(it.assignment.title) + '</h2><div class="muted small">' +
        (w ? (w.status === 'submitted' ? 'Submitted ' + esc(Ink.fmtDateTime(w.submittedAt)) : 'Draft — not submitted') + ' · ' + w.words + ' words · started ' + esc(Ink.fmtDateTime(w.startedAt)) +
          ' · open ' + Ink.dur(w.openSec) + ', typing ' + Ink.dur(w.activeSec) + (w.lockedSec ? ', locked ' + Ink.dur(w.lockedSec) : '') + (w.viewCount ? ' · viewed read-only ' + w.viewCount + '×' : '') : 'Not started') + '</div>' +
        (flag(it) ? '<div class="flagc small">' + esc(flag(it)) + '</div>' : '') + '</div>' +
        '<div class="row no-print" style="gap:6px">' + (w ? '<button class="btn sm" data-grade="' + it.assignment.id + '">' + Ink.bi('grade', 'Open in Grade') + '</button>' : '') + '</div></div>';
      if (rb && rb.criteria) h += g ? R.grid(rb, g.scores, { compact: true }) : '<div class="muted small">Not scored yet.</div>';
      if (g && g.comment) h += '<div class="fb-comment"><b>Overall comment</b><br>' + esc(g.comment).replace(/\n/g, '<br>') + '</div>';
      if (it.comments && it.comments.length) {
        h += '<div class="rec-cmts"><b>Comments in the writing</b>' + it.comments.map(function (c) {
          return '<div class="rec-c"><span class="cmt-q">“' + esc(c.quote) + '”</span> — ' + esc(c.text) + (c.resolved ? ' <span class="pill submitted xs">Done</span>' : '') + '</div>';
        }).join('') + '</div>';
      }
      if (w) h += '<details class="rec-writing"><summary>' + Ink.bi('chevD', 'Writing') + '</summary><div class="page"><div class="doc">' + (Ink.sanitize(it.html) || '<p class="muted"><i>Empty.</i></p>') + '</div></div></details>';
      h += '</section>';
    });
    if (d.absences.length) h += '<section class="card rec-item"><h2>Absences</h2><div class="muted">' + d.absences.map(function (x) { return esc(Ink.fmtDate(x, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })); }).join(' · ') + '</div></section>';
    h += '</div>';
    host.innerHTML = h;
    $('#rec-print').onclick = function () { $$('.rec-writing').forEach(function (x) { x.open = true; }); setTimeout(function () { window.print(); }, 50); };
    $('#rec-expand').onclick = function () { const all = $$('.rec-writing'); const open = !all.every(function (x) { return x.open; }); all.forEach(function (x) { x.open = open; }); this.innerHTML = Ink.bi('eye', open ? 'Hide all writing' : 'Show all writing'); };
    $$('[data-grade]').forEach(function (b) { b.onclick = function () { go('grade', b.dataset.grade + '/' + sid); }; });
    $$('.rec-jump').forEach(function (a) { a.onclick = function (e) { e.preventDefault(); const el = document.getElementById(a.getAttribute('href').slice(1)); if (el) el.scrollIntoView({ behavior: 'smooth' }); }; });
  }

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
    el.innerHTML = '<button class="btn primary new" id="as-new">' + Ink.bi('plus', 'New assignment') + '</button>';
    T.boot.assignments.forEach(function (a) {
      const it = document.createElement('div');
      it.className = 'item' + (T.selA === a.id ? ' on' : '');
      const anyOpen = Object.values(a.windows || {}).some(function (w) { return w.open; });
      it.innerHTML = '<b>' + esc(a.title) + '</b><span>' + (anyOpen ? '<span class="pill open xs">Open now</span> ' : '') + (a.rubric ? '<span class="pill plain xs">Rubric</span> ' : '') + esc((a.classIds || []).map(className).join(', ') || 'No class yet') + '</span>';
      it.onclick = function () { editAssignment(a); };
      el.appendChild(it);
    });
    $('#as-new').onclick = function () { editAssignment(null); };
  }

  function editAssignment(a) {
    T.selA = a ? a.id : 'new';
    drawAssignList();
    const st = (a && a.settings) || { openMode: 'class', showGoal: true, allowSelfPaste: true, lockOnReentry: true, graceMin: 0, spellcheck: true, lookup: true };
    let rubric = a ? a.rubric || '' : '';
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
      '<p class="hint" style="margin-top:-4px">Days off from your school calendar (Settings) and students marked absent are always closed.</p>' +
      '<h3>Length</h3>' +
      '<div class="row"><div class="field"><label for="af-min">Minimum words</label><input type="number" min="0" class="input" id="af-min" placeholder="none"></div>' +
      '<div class="field"><label for="af-max">Maximum words</label><input type="number" min="0" class="input" id="af-max" placeholder="none"></div></div>' +
      '<label class="check"><input type="checkbox" id="af-show"> <span>Show the word goal and a progress bar to students</span></label>' +
      '<h3>Rubric &amp; feedback</h3>' +
      '<div class="rb-sum" id="af-rubric"></div>' +
      '<label class="check"><input type="checkbox" id="af-release"> <span><b>Let students see their grades and feedback</b> — rubric scores and your overall comment, once you mark their work graded. (Comments in the writing always show.)</span></label>' +
      '<h3>Writing tools</h3>' +
      '<label class="check"><input type="checkbox" id="af-spell"> <span><b>Spell check</b> — red underlines with suggestions. No grammar checking. Turn off for spelling tests.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-lookup"> <span><b>Dictionary &amp; thesaurus</b> — students can look up definitions and synonyms.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-tts"> <span><b>Read aloud for everyone</b> <span class="hint">(otherwise only students with the accommodation)</span></span></label>' +
      '<label class="check"><input type="checkbox" id="af-stt"> <span><b>Speech-to-text for everyone</b> <span class="hint">(otherwise only students with the accommodation)</span></span></label>' +
      '<h3>Integrity</h3>' +
      '<label class="check"><input type="checkbox" checked disabled> <span><b>Lock students out when they leave the window</b> (switch tabs/apps, exit full screen, close the page). Always on.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-reentry"> <span><b>Also lock when a student comes back after leaving unexpectedly</b> — e.g. their tab closed or laptop shut off mid-writing. Students who use <i>Save &amp; exit</i> are never locked.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-selfpaste"> <span><b>Let students cut/copy and paste their own writing</b> within the same essay (to move sentences around). Pasting anything from outside is always blocked.</span></label>' +
      '<label class="check"><input type="checkbox" id="af-hidden"> <span>Hide from students\' lists for now</span></label>' +
      '<div class="row" style="margin-top:22px;justify-content:space-between">' +
      '  <div class="row" style="gap:8px">' + (a ? '<button class="btn danger" id="af-del">' + Ink.bi('trash', 'Archive') + '</button><button class="btn" id="af-dup">' + Ink.bi('copy', 'Duplicate') + '</button>' : '') + '</div>' +
      '  <div class="row" style="gap:8px">' + (a ? '<button class="btn" id="af-grade">' + Ink.bi('grade', 'Grade') + '</button><button class="btn" id="af-live">' + Ink.bi('eye', 'Watch live') + '</button>' : '') + '<button class="btn primary" id="af-save">' + Ink.bi('check', 'Save assignment') + '</button></div>' +
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
    $('#af-spell').checked = st.spellcheck !== false;
    $('#af-lookup').checked = st.lookup !== false;
    $('#af-tts').checked = !!st.ttsAll;
    $('#af-stt').checked = !!st.sttAll;
    $('#af-release').checked = !!st.releaseFeedback;

    function drawRubricSum() {
      const box = $('#af-rubric');
      if (rubric && rubric.criteria) {
        box.innerHTML = '<div class="rb-sum-in"><div><b>' + esc(rubric.title || 'Rubric') + '</b><div class="muted small">' + rubric.criteria.length + ' criteria · ' + rubric.levels.map(function (l) { return esc(l.label); }).join(' / ') + ' · out of ' + R.fmt(R.max(rubric)) + '</div></div>' +
          '<div class="row" style="gap:6px"><button class="btn sm" id="af-rb-view">' + Ink.bi('eye', 'Preview') + '</button><button class="btn sm teal" id="af-rb-edit">' + Ink.bi('edit', 'Edit rubric') + '</button></div></div><div id="af-rb-prev" hidden></div>';
        $('#af-rb-view').onclick = function () { const pv = $('#af-rb-prev'); pv.hidden = !pv.hidden; pv.innerHTML = R.grid(rubric, {}, { compact: true }); };
      } else {
        box.innerHTML = '<div class="rb-sum-in"><div class="muted small">No rubric yet. Start from a pre-built rubric, copy one from another assignment, or build your own.</div><button class="btn sm teal" id="af-rb-edit">' + Ink.bi('rubric', 'Add a rubric') + '</button></div>';
      }
      $('#af-rb-edit').onclick = async function () {
        const sources = (T.boot.rubricSources || []).filter(function (s) { return !a || s.aid !== a.id; });
        const r = await R.edit(rubric, { sources: sources, title: $('#af-title').value.trim() });
        if (r === null) return;
        rubric = r;
        drawRubricSum();
        if (a) {
          try { await call('tSaveAssignment', { assignment: Object.assign(collect(), { rubric: rubric }) }); await reboot(); drawAssignList(); Ink.toast(r ? 'Rubric saved.' : 'Rubric removed.', 'good'); }
          catch (err) { Ink.toast(err.message, 'bad'); }
        } else Ink.toast('Rubric ready — it saves with the assignment.', 'good');
      };
    }
    drawRubricSum();

    const collect = function () {
      const mode = ($('#af-mode input:checked') || {}).value || 'class';
      return {
        id: a ? a.id : '',
        title: $('#af-title').value.trim(),
        classIds: $$('#af-classes input:checked').map(function (i) { return i.value; }),
        prompt: ed.getHTML(),
        rubric: rubric || '',
        settings: {
          openMode: mode, startDate: $('#af-start').value, endDate: $('#af-end').value, graceMin: Number($('#af-grace').value) || 0,
          minWords: Number($('#af-min').value) || 0, maxWords: Number($('#af-max').value) || 0, showGoal: $('#af-show').checked,
          lockOnReentry: $('#af-reentry').checked, allowSelfPaste: $('#af-selfpaste').checked, hidden: $('#af-hidden').checked,
          spellcheck: $('#af-spell').checked, lookup: $('#af-lookup').checked, ttsAll: $('#af-tts').checked, sttAll: $('#af-stt').checked,
          releaseFeedback: $('#af-release').checked
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
        if (!(await Ink.confirm('Archive this assignment?', 'Students will no longer see it. Their writing, grades and comments are kept, and still show in each student\'s record.', 'Archive', true))) return;
        try { await call('tDeleteAssignment', { id: a.id }); await reboot(); T.selA = null; render('assignments', []); Ink.toast('Archived.'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $('#af-dup').onclick = async function () {
        const data = collect();
        data.id = ''; data.title = 'Copy of ' + data.title;
        try { const r = await call('tSaveAssignment', { assignment: data }); await reboot(); T.selA = r.assignment.id; render('assignments', []); Ink.toast('Duplicated.', 'good'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $('#af-live').onclick = function () { T.live.aid = a.id; Ink.store.set('inkwell_live_aid', a.id); go('live'); };
      $('#af-grade').onclick = function () { go('grade', a.id); };
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
    el.innerHTML = '<button class="btn primary new" id="cl-new">' + Ink.bi('plus', 'New class') + '</button>';
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
      '<div class="field"><label>Class times</label><div class="hint" style="margin-bottom:8px">Assignments set to "During class time" open only during these periods. Add a row for each set of days that share the same times. Days off are set in Settings.</div><div id="cf-sched"></div><button class="btn sm" id="cf-add-row">' + Ink.bi('plus', 'Add class time') + '</button></div>' +
      '<div class="row" style="gap:8px;justify-content:flex-end;margin-top:6px">' + (c ? '<button class="btn danger" id="cf-del">' + Ink.bi('trash', 'Delete class') + '</button>' : '') + '<button class="btn primary" id="cf-save">' + Ink.bi('check', c ? 'Save class' : 'Create class') + '</button></div>' +
      (c ? '<h3>Students</h3><div id="cf-roster"></div>' : '');
    $('#cf-name').value = c ? c.name : '';
    const groups = {};
    ((c && c.schedule) || []).forEach(function (pp) { const k = pp.s + '-' + pp.e; (groups[k] = groups[k] || { s: pp.s, e: pp.e, d: [] }).d.push(pp.d); });
    const sched = $('#cf-sched');
    const addRow = function (g) {
      const row = document.createElement('div');
      row.className = 'sched-row';
      row.innerHTML = '<div class="days">' + [1, 2, 3, 4, 5].map(function (d) { const on = g && g.d.indexOf(d) >= 0; return '<label class="' + (on ? 'on' : '') + '"><input type="checkbox" value="' + d + '"' + (on ? ' checked' : '') + '>' + DAYS[d] + '</label>'; }).join('') + '</div>' +
        '<input type="time" class="input" value="' + (g ? g.s : '09:00') + '" aria-label="Start time"><input type="time" class="input" value="' + (g ? g.e : '10:28') + '" aria-label="End time"><button class="icon-btn" title="Remove" aria-label="Remove">' + Ink.icon('x') + '</button>';
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
        try { await call('tDeleteClass', { id: c.id }); await reboot(); T.selC = null; render('classes', []); Ink.toast('Deleted.'); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      drawRoster(c);
    }
  }

  function drawRoster(c) {
    const host = $('#cf-roster');
    const list = studentsIn([c.id]).sort(function (a, b) { return (a.last + a.first).localeCompare(b.last + b.first); });
    host.innerHTML =
      '<div class="row" style="justify-content:space-between;margin-bottom:12px"><span class="muted small">' + list.length + ' students · Each student signs in with their own code.</span>' +
      '<div class="row" style="gap:8px"><button class="btn sm" id="ro-cards">' + Ink.bi('print', 'Print sign-in cards') + '</button><button class="btn sm teal" id="ro-add">' + Ink.bi('plus', 'Add students') + '</button></div></div>' +
      (list.length ? '<div class="table-scroll"><table class="roster"><thead><tr><th>First</th><th>Last</th><th>Code</th><th title="Accommodations">Accommodations</th><th></th></tr></thead><tbody></tbody></table></div>' : '<div class="empty" style="padding:30px">No students yet. Click <b>Add students</b> and paste your class list.</div>');
    const tb = host.querySelector('tbody');
    list.forEach(function (s) {
      const ac = s.accom || {};
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input class="input" data-f="first" aria-label="First name"></td><td><input class="input" data-f="last" aria-label="Last name"></td><td class="code-cell"><code>' + esc(s.code) + '</code><button class="icon-btn" data-regen title="New code" aria-label="New code">' + Ink.icon('refresh') + '</button></td>' +
        '<td class="acc-cell"><label class="chip-check" title="Assignments stay open outside class time (still closed on days off and when absent)"><input type="checkbox" data-acc="extended"' + (ac.extended ? ' checked' : '') + '><span>Extended access</span></label>' +
        '<label class="chip-check" title="Can have the prompt and their writing read aloud"><input type="checkbox" data-acc="tts"' + (ac.tts ? ' checked' : '') + '><span>Read aloud</span></label>' +
        '<label class="chip-check" title="Can dictate with the microphone"><input type="checkbox" data-acc="stt"' + (ac.stt || ac.relaxed ? ' checked' : '') + '><span>Speech-to-text</span></label></td>' +
        '<td class="row-acts"><button class="icon-btn" data-rec title="Student record" aria-label="Student record">' + Ink.icon('record') + '</button><button class="icon-btn" data-del title="Remove student" aria-label="Remove student">' + Ink.icon('trash') + '</button></td>';
      tr.querySelector('[data-f=first]').value = s.first;
      tr.querySelector('[data-f=last]').value = s.last;
      const saveS = async function () {
        const upd = { id: s.id, first: tr.querySelector('[data-f=first]').value.trim() || s.first, last: tr.querySelector('[data-f=last]').value.trim(), accom: { extended: tr.querySelector('[data-acc=extended]').checked, tts: tr.querySelector('[data-acc=tts]').checked, stt: tr.querySelector('[data-acc=stt]').checked } };
        try { const r = await call('tSaveStudent', { student: upd }); Object.assign(s, r.student); Ink.toast('Saved ' + s.first + '.', 'good', 1500); } catch (err) { Ink.toast(err.message, 'bad'); }
      };
      $$('input', tr).forEach(function (i) { i.addEventListener('change', saveS); });
      tr.querySelector('[data-rec]').onclick = function () { go('record', s.id); };
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
      '<div class="settings">' +
      '<div class="card panel"><h2>Student link</h2><p class="muted" style="margin-top:-8px">Share this with students (post it in Google Classroom or on the board). They sign in with their code.</p>' +
      '<div class="row"><input class="input" id="st-url" readonly style="flex:1;min-width:240px"><button class="btn" id="st-copy">' + Ink.bi('copy', 'Copy') + '</button><a class="btn" href="' + esc(url) + '" target="_blank">' + Ink.bi('eye', 'Open') + '</a></div></div>' +
      '<div class="card panel"><h2>School calendar</h2><div id="cal-host"></div><div class="muted small" id="cal-save" style="margin-top:8px"></div></div>' +
      '<div class="card panel"><h2>Teacher password</h2>' + (T.boot.settings.defaultPassword ? '<div class="banner">You\'re using the starter password. Pick your own.</div>' : '') +
      '<div class="row"><div class="field"><label for="pw-cur">Current password</label><input type="password" class="input" id="pw-cur" autocomplete="current-password"></div>' +
      '<div class="field"><label for="pw-new">New password</label><input type="password" class="input" id="pw-new" autocomplete="new-password"></div></div>' +
      '<button class="btn primary" id="pw-save">' + Ink.bi('check', 'Change password') + '</button></div>' +
      '<div class="card panel"><h2>Demo data</h2><p class="muted" style="margin-top:-8px">Two practice classes with made-up students, three assignments, writing in progress, rubrics, grades, comments, and one student marked absent. On the Live page, <b>Simulate class</b> makes the demo students type, get locked out and submit. <b>Test Student</b> signs in with code <code>TEST-0001</code> (with read-aloud and speech-to-text turned on) so you can try the student side yourself.</p>' +
      '<div class="row" style="gap:8px"><button class="btn" id="demo-seed">' + Ink.bi('refresh', hasDemo ? 'Reset demo data' : 'Load demo data') + '</button>' + (hasDemo ? '<button class="btn danger" id="demo-clear">' + Ink.bi('trash', 'Remove demo data') + '</button>' : '') + '</div></div>' +
      '<div class="card panel"><h2>How Inkwell keeps writing honest</h2><ul style="line-height:1.6;margin:0;padding-left:20px">' +
      '<li>Writing happens in full screen. Leaving it — switching tabs or apps, clicking outside, exiting full screen, closing or reloading — <b>locks the student out</b> until you clear them.</li>' +
      '<li>Pasting from outside the assignment is blocked, and so are big chunks of text appearing at once (autofill, AI "help me write" tools). Attempts show on the Live page.</li>' +
      '<li>Writing saves every few seconds, with a snapshot about every 90 seconds so you can <b>play back</b> how a piece was written.</li>' +
      '<li>Each student shows time open vs. time actively typing, keystroke stats, dictionary lookups and dictated text. Text that appears without matching keystrokes, or a big jump in words, is flagged in the timeline.</li>' +
      '<li>Spell check is built in (Canadian English). There\'s no grammar checking, and writing assistants like Grammarly are asked to stay off.</li>' +
      '<li class="muted">No tool can stop a student from copying from a phone or a second device — walking the room still matters. Playback and the typing stats make that much easier to spot.</li>' +
      '</ul></div>' +
      '<div class="muted small">Inkwell v' + esc(T.boot.settings.version) + ' · Times shown in ' + esc(T.boot.settings.tz) + ' · All data lives in your own Google Sheet.</div>' +
      '</div>';
    $('#st-url').value = url;
    $('#st-copy').onclick = function () { navigator.clipboard.writeText(url).then(function () { Ink.toast('Copied.', 'good'); }); };
    const saveDays = Ink.debounce(async function (days) {
      $('#cal-save').textContent = 'Saving…';
      try { const r = await call('tSetDaysOff', { daysOff: days }); T.boot.daysOff = r.daysOff; $('#cal-save').textContent = 'Saved ' + Ink.fmtTime(Date.now()) + '.'; }
      catch (err) { $('#cal-save').textContent = ''; Ink.toast(err.message, 'bad'); }
    }, 700);
    Ink.Calendar.mount($('#cal-host'), { daysOff: T.boot.daysOff || {}, today: T.boot.today, onChange: saveDays });
    $('#pw-save').onclick = async function () {
      try {
        const r = await call('tPassword', { current: $('#pw-cur').value, next: $('#pw-new').value });
        T.token = r.token; Ink.store.set(TOKEN_KEY, { token: r.token });
        await reboot();
        Ink.toast('Password changed.', 'good');
        render('settings', []);
      } catch (err) { Ink.toast(err.message, 'bad'); }
    };
    $('#demo-seed').onclick = async function () {
      if (hasDemo && !(await Ink.confirm('Reset the demo data?', 'The demo classes, students and their writing are replaced with a fresh copy. Your real classes are not touched.', 'Reset'))) return;
      this.disabled = true; this.innerHTML = '<span class="spin sm"></span><span>Working…</span>';
      try { T.boot = await call('tDemoSeed', {}, { timeout: 90000 }); Ink.toast('Demo data is ready.', 'good'); render('settings', []); } catch (err) { Ink.toast(err.message, 'bad'); this.disabled = false; }
    };
    if (hasDemo) $('#demo-clear').onclick = async function () {
      if (!(await Ink.confirm('Remove the demo data?', 'The demo classes and students are deleted and the demo assignments archived. Your real classes are not touched.', 'Remove', true))) return;
      try { T.boot = await call('tDemoClear', {}, { timeout: 90000 }); Ink.toast('Demo data removed.'); render('settings', []); } catch (err) { Ink.toast(err.message, 'bad'); }
    };
  }

  /* ───────────── Boot ───────────── */
  if (!Ink.apiUrl()) showLogin('This site isn\'t connected to its backend yet.');
  else if (T.token) start();
  else showLogin();
})();
