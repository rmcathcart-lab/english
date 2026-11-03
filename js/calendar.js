/* Inkwell — school-year calendar for picking days off (click a day, or drag across a range). */
(function () {
  const esc = Ink.esc;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  const iso = function (y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); };
  const parse = function (s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const isoOf = function (dt) { return iso(dt.getFullYear(), dt.getMonth(), dt.getDate()); };

  function nthWeekday(y, m, dow, n) { // dow 0=Sun; n=1..5
    const d = new Date(y, m, 1);
    const shift = (dow - d.getDay() + 7) % 7;
    return new Date(y, m, 1 + shift + (n - 1) * 7);
  }
  function easter(y) { // Anonymous Gregorian algorithm
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
      day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, mo - 1, day);
  }
  /** Statutory and common school holidays in Alberta for the school year starting in September of `y`. */
  function albertaHolidays(y) {
    const y2 = y + 1;
    const out = {};
    const add = function (dt, name) { out[isoOf(dt)] = name; };
    add(nthWeekday(y, 8, 1, 1), 'Labour Day');
    add(new Date(y, 8, 30), 'Truth and Reconciliation Day');
    add(nthWeekday(y, 9, 1, 2), 'Thanksgiving');
    add(new Date(y, 10, 11), 'Remembrance Day');
    add(new Date(y, 11, 25), 'Christmas Day');
    add(new Date(y, 11, 26), 'Boxing Day');
    add(new Date(y2, 0, 1), 'New Year\'s Day');
    add(nthWeekday(y2, 1, 1, 3), 'Family Day');
    const ez = easter(y2);
    add(new Date(ez.getFullYear(), ez.getMonth(), ez.getDate() - 2), 'Good Friday');
    add(new Date(ez.getFullYear(), ez.getMonth(), ez.getDate() + 1), 'Easter Monday');
    const may25 = new Date(y2, 4, 25);
    add(new Date(y2, 4, 25 - (((may25.getDay() + 6) % 7) || 7)), 'Victoria Day');
    return out;
  }

  /**
   * Ink.Calendar.mount(host, { daysOff: {date:label}, today: 'YYYY-MM-DD', onChange(daysOff) })
   */
  function mount(host, opts) {
    const days = Object.assign({}, opts.daysOff || {});
    const today = opts.today || isoOf(new Date());
    const t = parse(today);
    let year = t.getMonth() >= 6 ? t.getFullYear() : t.getFullYear() - 1; // school year starts in the fall
    let drag = null;

    host.innerHTML =
      '<div class="cal-bar"><div class="row" style="gap:6px"><button class="btn sm icon-only" data-prev aria-label="Previous school year" title="Previous school year">' + Ink.icon('chevL') + '</button>' +
      '<b class="cal-year"></b><button class="btn sm icon-only" data-next aria-label="Next school year" title="Next school year">' + Ink.icon('chevR') + '</button></div>' +
      '<div class="row" style="gap:8px"><button class="btn sm" data-hol>' + Ink.bi('calendar', 'Add Alberta holidays') + '</button><button class="btn sm danger" data-clear>' + Ink.bi('trash', 'Clear this year') + '</button></div></div>' +
      '<p class="muted small cal-help">Click a day to mark it off. Drag across days to mark a whole break. On a day off, every assignment stays closed for everyone (unless you open one yourself from the Live page). Weekends are already closed for "during class time" assignments.</p>' +
      '<div class="cal-grid"></div><div class="cal-list"></div>';
    const grid = host.querySelector('.cal-grid');
    const list = host.querySelector('.cal-list');

    function changed() { draw(); if (opts.onChange) opts.onChange(Object.assign({}, days)); }

    function inYear(d) { return d >= iso(year, 7, 1) && d <= iso(year + 1, 6, 31); }

    function draw() {
      host.querySelector('.cal-year').textContent = year + '–' + String(year + 1).slice(2) + ' school year';
      let h = '';
      for (let k = 0; k < 11; k++) { // Aug → Jun
        const m = (7 + k) % 12, y = k < 5 ? year : year + 1;
        const first = new Date(y, m, 1);
        const n = new Date(y, m + 1, 0).getDate();
        const lead = (first.getDay() + 6) % 7; // Monday-first
        h += '<div class="cal-m"><div class="cal-mh">' + MONTHS[m] + ' <span>' + y + '</span></div><div class="cal-dow"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="cal-days">';
        for (let i = 0; i < lead; i++) h += '<span></span>';
        for (let d = 1; d <= n; d++) {
          const ds = iso(y, m, d);
          const dow = (lead + d - 1) % 7;
          const cls = ['cal-d'];
          if (dow >= 5) cls.push('we');
          if (days[ds]) cls.push('off');
          if (ds === today) cls.push('today');
          if (ds < today) cls.push('past');
          h += '<button type="button" class="' + cls.join(' ') + '" data-d="' + ds + '" title="' + esc(Ink.fmtDate(ds, { weekday: 'long', month: 'long', day: 'numeric' }) + (days[ds] ? ' — ' + days[ds] : '')) + '">' + d + '</button>';
        }
        h += '</div></div>';
      }
      grid.innerHTML = h;
      drawList();
    }

    // Group consecutive days with the same label into ranges for the list.
    function drawList() {
      const ds = Object.keys(days).filter(inYear).sort();
      if (!ds.length) { list.innerHTML = '<div class="muted small">No days off marked for this school year yet.</div>'; return; }
      const groups = [];
      ds.forEach(function (d) {
        const g = groups[groups.length - 1];
        if (g && days[d] === g.label) {
          // allow weekends between weekdays to continue a range
          let x = parse(g.end); x.setDate(x.getDate() + 1);
          let ok = false;
          for (let i = 0; i < 4; i++) { if (isoOf(x) === d) { ok = true; break; } if (x.getDay() !== 0 && x.getDay() !== 6) break; x.setDate(x.getDate() + 1); }
          if (ok) { g.end = d; g.days.push(d); return; }
        }
        groups.push({ start: d, end: d, label: days[d], days: [d] });
      });
      list.innerHTML = '<div class="cal-lh">Days off this year <span class="muted">(' + ds.length + ')</span></div>' + groups.map(function (g, i) {
        const when = g.start === g.end ? Ink.fmtDate(g.start, { weekday: 'short', month: 'short', day: 'numeric' }) : Ink.fmtDate(g.start, { month: 'short', day: 'numeric' }) + ' – ' + Ink.fmtDate(g.end, { month: 'short', day: 'numeric' });
        return '<div class="cal-li' + (g.end < today ? ' past' : '') + '"><span class="cal-when">' + esc(when) + '</span><input class="input sm" data-g="' + i + '" value="' + esc(g.label) + '" maxlength="40" aria-label="Name for this day off"><button class="icon-btn" data-rm="' + i + '" title="Remove" aria-label="Remove">' + Ink.icon('x') + '</button></div>';
      }).join('');
      list.querySelectorAll('[data-g]').forEach(function (inp) {
        inp.onchange = function () { const g = groups[Number(inp.dataset.g)]; g.days.forEach(function (d) { days[d] = inp.value.trim() || 'Day off'; }); changed(); };
      });
      list.querySelectorAll('[data-rm]').forEach(function (b) {
        b.onclick = function () { groups[Number(b.dataset.rm)].days.forEach(function (d) { delete days[d]; }); changed(); };
      });
    }

    function setDay(d, on) { if (on) days[d] = days[d] || 'Day off'; else delete days[d]; }
    grid.addEventListener('mousedown', function (e) {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      e.preventDefault();
      drag = { on: !days[b.dataset.d], start: b.dataset.d, touched: {} };
      drag.touched[b.dataset.d] = 1;
      setDay(b.dataset.d, drag.on);
      b.classList.toggle('off', drag.on);
    });
    grid.addEventListener('mouseover', function (e) {
      if (!drag) return;
      const b = e.target.closest('[data-d]');
      if (!b) return;
      // fill every day between the start and here
      const a = drag.start < b.dataset.d ? drag.start : b.dataset.d, z = drag.start < b.dataset.d ? b.dataset.d : drag.start;
      grid.querySelectorAll('[data-d]').forEach(function (x) {
        const d = x.dataset.d;
        if (d >= a && d <= z && !drag.touched[d]) { drag.touched[d] = 1; setDay(d, drag.on); x.classList.toggle('off', drag.on); }
      });
    });
    document.addEventListener('mouseup', function () { if (drag) { drag = null; changed(); } });
    // keyboard: Enter/Space toggles a focused day
    grid.addEventListener('keydown', function (e) {
      const b = e.target.closest('[data-d]');
      if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDay(b.dataset.d, !days[b.dataset.d]); changed(); grid.querySelector('[data-d="' + b.dataset.d + '"]').focus(); }
    });
    host.querySelector('[data-prev]').onclick = function () { year--; draw(); };
    host.querySelector('[data-next]').onclick = function () { year++; draw(); };
    host.querySelector('[data-hol]').onclick = function () {
      const h = albertaHolidays(year);
      let n = 0;
      Object.keys(h).forEach(function (d) { if (!days[d]) { days[d] = h[d]; n++; } });
      changed();
      Ink.toast(n ? 'Added ' + n + ' holidays. Add PD days and breaks from your division\'s calendar too.' : 'Those holidays are already marked.', 'good', 5000);
    };
    host.querySelector('[data-clear]').onclick = async function () {
      const ds = Object.keys(days).filter(inYear);
      if (!ds.length) return;
      if (!(await Ink.confirm('Clear ' + ds.length + ' days off?', 'This clears every day off in the ' + year + '–' + (year + 1) + ' school year.', 'Clear', true))) return;
      ds.forEach(function (d) { delete days[d]; });
      changed();
    };
    draw();
    return { get: function () { return Object.assign({}, days); } };
  }

  window.Ink.Calendar = { mount: mount, albertaHolidays: albertaHolidays };
})();
