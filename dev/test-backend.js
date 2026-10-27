// Exercises the main student/teacher flows against the mocked Apps Script runtime.
const assert = require('assert');
const { makeContext } = require('./gas-mock');

const g = makeContext();
console.log(g.setup());

const ok = (r, label) => { if (!r.ok) { console.error(label, r); process.exit(1); } return r; };

// Teacher
const t = ok(g.call({ action: 'tLogin', password: 'english2026' }), 'tLogin');
assert(g.call({ action: 'tLogin', password: 'nope' }).ok === false);
const boot = ok(g.call({ action: 'tBoot', token: t.token }), 'tBoot');
console.log('classes', boot.classes.map(c => c.name), 'students', boot.students.length, 'assignments', boot.assignments.map(a => a.title + ' → ' + JSON.stringify(Object.values(a.windows)[0].label)));
const narrative = boot.assignments.find(a => a.title.startsWith('Personal'));
const lit = boot.assignments.find(a => a.title.startsWith('Literary'));

// Monitor
const mon = ok(g.call({ action: 'tMonitor', token: t.token, aid: narrative.id }), 'tMonitor');
console.log('monitor rows', mon.rows.length, mon.rows.map(r => r.first + ':' + r.state + ':' + (r.words || 0)).join(' '));
console.log('events', mon.events.length);

// Student login with the test code
const s = ok(g.call({ action: 'sLogin', code: 'test-0001' }), 'sLogin');
const home = ok(g.call({ action: 'sHome', token: s.token }), 'sHome');
console.log('home', home.assignments.map(a => `${a.title} [${a.win.label}]`));

// Start writing
const sess = 'sess-1';
const st = ok(g.call({ action: 'sStart', token: s.token, aid: narrative.id, sessionId: sess }), 'sStart');
assert(!st.locked, 'should not be locked on first start');
let rev = st.rev;
const html1 = '<h1>My Title</h1><p class="fi">One two three four five.</p>';
let sv = ok(g.call({ action: 'sSave', token: s.token, aid: narrative.id, sessionId: sess, rev: ++rev, html: html1, words: 7, chars: 30, d: { keys: 40, active: 10 } }), 'sSave');
assert(sv.saved && !sv.locked);
// formula-looking content survives
const html2 = '=SUM(1,2) <p>+44 and 1/2</p>' + 'x'.repeat(60000);
sv = ok(g.call({ action: 'sSave', token: s.token, aid: narrative.id, sessionId: sess, rev: ++rev, html: html2, words: 5, chars: 60010, d: { keys: 3 } }), 'sSave2');
let tw = ok(g.call({ action: 'tWork', token: t.token, aid: narrative.id, sid: st.student ? home.student.id : '' }), 'tWork');
assert.strictEqual(tw.html, html2, 'html round trip');
console.log('round trip ok; revisions', tw.revisions.length, 'events', tw.events.map(e => e.type).join(','));

// Ping
let pg = ok(g.call({ action: 'sPing', token: s.token, aid: narrative.id, sessionId: sess, focused: true, d: { active: 5 } }), 'sPing');
assert(!pg.locked);

// Lock (student left)
const lk = ok(g.call({ action: 'sLock', token: s.token, aid: narrative.id, sessionId: sess, reason: 'Switched tabs', rev: ++rev, html: html1, words: 7, chars: 30 }), 'sLock');
assert(lk.locked, 'locked after sLock');
sv = ok(g.call({ action: 'sSave', token: s.token, aid: narrative.id, sessionId: sess, rev: ++rev, html: 'cheat', words: 1, chars: 5 }), 'save while locked');
assert(sv.locked && !sv.saved, 'save refused while locked');
let ss = ok(g.call({ action: 'sStatus', token: s.token, aid: narrative.id, sessionId: sess }), 'sStatus');
assert(ss.locked);
let mon2 = ok(g.call({ action: 'tMonitor', token: t.token, aid: narrative.id }), 'tMonitor2');
const me = mon2.rows.find(r => r.first === 'Test');
assert.strictEqual(me.state, 'locked');
ok(g.call({ action: 'tUnlock', token: t.token, aid: narrative.id, sid: me.sid }), 'tUnlock');
ss = ok(g.call({ action: 'sStatus', token: s.token, aid: narrative.id, sessionId: sess }), 'sStatus2');
assert(!ss.locked, 'cleared');

// Re-entry without clean exit → locked
const st2 = ok(g.call({ action: 'sStart', token: s.token, aid: narrative.id, sessionId: 'sess-2' }), 'sStart2');
assert(st2.locked, 'second tab with fresh heartbeat locks: ' + st2.lockReason);
console.log('re-entry lock reason:', st2.lockReason);
// old session is superseded
sv = ok(g.call({ action: 'sSave', token: s.token, aid: narrative.id, sessionId: sess, rev: ++rev, html: 'x', words: 1, chars: 1 }), 'superseded');
assert(sv.superseded, 'old session superseded');
ok(g.call({ action: 'tUnlock', token: t.token, aid: narrative.id, all: true }), 'unlock all');

// Clean exit then re-enter → not locked
ok(g.call({ action: 'sExit', token: s.token, aid: narrative.id, sessionId: 'sess-2', rev: ++rev, html: html1, words: 7, chars: 30 }), 'sExit');
const st3 = ok(g.call({ action: 'sStart', token: s.token, aid: narrative.id, sessionId: 'sess-3' }), 'sStart3');
assert(!st3.locked, 'clean exit → no lock');
assert.strictEqual(st3.html, html1);

// Paste-attempt + burst signals
ok(g.call({ action: 'sSave', token: s.token, aid: narrative.id, sessionId: 'sess-3', rev: ++rev, html: html1 + '<p>' + 'word '.repeat(90) + '</p>', words: 97, chars: 500, d: { keys: 5, paste: 2 } }), 'burst save');
tw = ok(g.call({ action: 'tWork', token: t.token, aid: narrative.id, sid: me.sid }), 'tWork2');
console.log('events:', tw.events.map(e => e.type + ':' + e.detail).join(' | '));
assert(tw.events.some(e => e.type === 'burst') && tw.events.some(e => e.type === 'paste') && tw.events.some(e => e.type === 'unusual'));

// Submit
const sub = ok(g.call({ action: 'sSubmit', token: s.token, aid: narrative.id, sessionId: 'sess-3', rev: ++rev, html: html1, words: 7, chars: 30 }), 'sSubmit');
assert(sub.submitted);
const st4 = ok(g.call({ action: 'sStart', token: s.token, aid: narrative.id, sessionId: 'sess-4' }), 'sStart4');
assert(st4.submitted, 'submitted view');
ok(g.call({ action: 'tReturn', token: t.token, aid: narrative.id, sid: me.sid }), 'tReturn');
const st5 = ok(g.call({ action: 'sStart', token: s.token, aid: narrative.id, sessionId: 'sess-5' }), 'sStart5');
assert(!st5.submitted && !st5.locked, 'returned → editable, not locked');

// Class-time window for the literary response
const st6 = ok(g.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'x' }), 'sStart lit');
console.log('literary response window:', JSON.stringify(st6.win), 'closed?', !!st6.closed);
// Override open
ok(g.call({ action: 'tOverride', token: t.token, aid: lit.id, mode: 'open', minutes: 30 }), 'override');
const st7 = ok(g.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'y' }), 'sStart lit 2');
assert(!st7.closed, 'override opens');
ok(g.call({ action: 'tOverride', token: t.token, aid: lit.id, mode: 'closed' }), 'override close');
const sv7 = ok(g.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'z' }), 'sStart lit 3');
assert(sv7.closed, 'override closes');

// Class + roster management
const nc = ok(g.call({ action: 'tSaveClass', token: t.token, cls: { name: 'English 30-1', schedule: [{ d: 1, s: '09:00', e: '10:28' }] } }), 'saveClass');
const add = ok(g.call({ action: 'tAddStudents', token: t.token, classId: nc.cls.id, lines: 'Jane Doe\nSmith, John Paul\n\n' }), 'addStudents');
assert.strictEqual(add.added.length, 2);
assert.strictEqual(add.added[1].first, 'John Paul');
const rg = ok(g.call({ action: 'tRegenCode', token: t.token, id: add.added[0].id }), 'regen');
assert.notStrictEqual(rg.student.code, add.added[0].code);
ok(g.call({ action: 'tSaveStudent', token: t.token, student: { id: add.added[0].id, first: 'Janet', accom: { extended: true } } }), 'saveStudent');
const na = ok(g.call({ action: 'tSaveAssignment', token: t.token, assignment: { title: 'Test', classIds: [nc.cls.id], prompt: '<p>hi</p>', settings: { openMode: 'manual' } } }), 'saveAssignment');
const janet = ok(g.call({ action: 'sLogin', code: rg.student.code }), 'janet login');
const jh = ok(g.call({ action: 'sHome', token: janet.token }), 'janet home');
console.log('janet (extended) sees:', jh.assignments.map(a => a.title + ' ' + a.win.label));
ok(g.call({ action: 'tDeleteStudent', token: t.token, id: add.added[1].id }), 'delStudent');
ok(g.call({ action: 'tDeleteClass', token: t.token, id: nc.cls.id }), 'delClass');

// Export
const ex = ok(g.call({ action: 'tExport', token: t.token, aid: boot.assignments.find(a => a.title.startsWith('Quick')).id }), 'export');
console.log('export items', ex.items.length, 'submitted', ex.items.filter(i => i.status === 'submitted').length);

// Demo ticks
for (let i = 0; i < 5; i++) ok(g.call({ action: 'tDemoTick', token: t.token, aid: narrative.id }), 'tick');
const mon3 = ok(g.call({ action: 'tMonitor', token: t.token, aid: narrative.id }), 'tMonitor3');
console.log('after ticks:', mon3.rows.map(r => r.first + ':' + r.state + ':' + (r.words || 0)).join(' '));

// Password change invalidates old token
const pw = ok(g.call({ action: 'tPassword', token: t.token, current: 'english2026', next: 'newpass1' }), 'tPassword');
assert(g.call({ action: 'tBoot', token: t.token }).code === 'AUTH');
ok(g.call({ action: 'tBoot', token: pw.token }), 'new token works');

// Reseed demo
ok(g.call({ action: 'tDemoSeed', token: pw.token }), 'reseed');
console.log('\nALL BACKEND TESTS PASSED');
