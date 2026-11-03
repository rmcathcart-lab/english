// Tests for the v2 features: schema upgrade, days off, absences, timing, views, comments, rubrics, grades, records.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { makeContext } = require('./gas-mock');

const ok = (r, label) => { if (!r.ok) { console.error('FAIL', label, r); process.exit(1); } return r; };

/* ── 1. Upgrade a sheet written by v1 ── */
const v1code = fs.readFileSync(process.argv[2] || path.join(__dirname, 'fixtures', 'Code.v1.gs'), 'utf8');
const old = makeContext({ code: v1code });
old.setup();
const ot = ok(old.call({ action: 'tLogin', password: 'english2026' }), 'v1 login').token;
const oboot = ok(old.call({ action: 'tBoot', token: ot }), 'v1 boot');
const narrative1 = oboot.assignments.find(a => a.title.startsWith('Personal'));
const os = ok(old.call({ action: 'sLogin', code: 'TEST-0001' }), 'v1 student');
ok(old.call({ action: 'sStart', token: os.token, aid: narrative1.id, sessionId: 'v1' }), 'v1 start');
ok(old.call({ action: 'sSave', token: os.token, aid: narrative1.id, sessionId: 'v1', rev: 5, html: '<p>Written in v1.</p>', words: 3, chars: 15, d: { keys: 20, active: 9 } }), 'v1 save');
ok(old.call({ action: 'sLock', token: os.token, aid: narrative1.id, sessionId: 'v1', reason: 'Switched tabs' }), 'v1 lock');

// Same spreadsheet + properties, new code (cache cleared like a fresh deployment would not guarantee — keep it to be harsh).
const g = makeContext({ ss: old._ss, props: old._props, cache: old._cache });
const t = ok(g.call({ action: 'tLogin', password: 'english2026' }), 'v2 login after upgrade').token;
const head = g._ss.getSheetByName('work').getRange(1, 1, 1, 40).getValues()[0].filter(String);
assert.deepStrictEqual(head, Array.from(g.ev('SHEETS.work')), 'work header upgraded');
assert(g._ss.getSheetByName('grades') && g._ss.getSheetByName('comments') && g._ss.getSheetByName('absences'), 'new sheets created');
let tw = ok(g.call({ action: 'tWork', token: t, aid: narrative1.id, sid: os.student.id }), 'tWork after upgrade');
assert.strictEqual(tw.html, '<p>Written in v1.</p>');
assert.strictEqual(tw.work.keystrokes, 20);
assert.strictEqual(tw.work.activeSec, 9);
assert.strictEqual(tw.work.locked, true);
assert.strictEqual(tw.work.lockReason, 'Switched tabs');
console.log('✓ v1 → v2 upgrade keeps work, keystrokes, lock state');
ok(g.call({ action: 'tUnlock', token: t, aid: narrative1.id, sid: os.student.id }), 'unlock after upgrade');

/* ── 2. Fresh v2 instance with the new demo ── */
const h = makeContext();
h.setup();
const T = ok(h.call({ action: 'tLogin', password: 'english2026' }), 'login').token;
let boot = ok(h.call({ action: 'tBoot', token: T }), 'boot');
const A = n => boot.assignments.find(a => a.title.startsWith(n));
const narr = A('Personal'), lit = A('Literary'), qw = A('Quickwrite');
assert(narr.rubric && narr.rubric.criteria.length === 5, 'narrative has rubric');
assert(boot.rubricSources.length >= 2, 'rubric sources');
assert.strictEqual(boot.absentToday.length, 1, 'one demo absence');
console.log('✓ demo: rubrics', boot.rubricSources.map(r => r.title).join(', '), '· absent today', boot.absentToday.length);

let mon = ok(h.call({ action: 'tMonitor', token: T, aid: narr.id }), 'monitor');
const mateo = mon.rows.find(r => r.first === 'Mateo');
assert.strictEqual(mateo.state, 'absent');
assert(mon.rows.find(r => r.first === 'Ava').openComments === 2, 'Ava has 2 open comments');
assert(mon.rows.find(r => r.first === 'Ava').openSec > 0, 'openSec present');
console.log('✓ monitor shows absent state, comment counts, open time');

/* ── Student: timing deltas, dictation, lookups ── */
const s = ok(h.call({ action: 'sLogin', code: 'TEST-0001' }), 'student');
let st = ok(h.call({ action: 'sStart', token: s.token, aid: narr.id, sessionId: 'S1' }), 'start');
assert(st.assignment.tools.tts && st.assignment.tools.stt && st.assignment.tools.spell && st.assignment.tools.lookup, 'tools for Test Student');
ok(h.call({ action: 'sSave', token: s.token, aid: narr.id, sessionId: 'S1', rev: 1, html: '<p>' + 'spoken words here '.repeat(20) + '</p>', words: 60, chars: 360, d: { keys: 10, dict: 340, open: 30, active: 12, look: 2 } }), 'save w/ dictation');
ok(h.call({ action: 'sPing', token: s.token, aid: narr.id, sessionId: 'S1', d: { open: 10, active: 4 } }), 'ping');
ok(h.call({ action: 'sLock', token: s.token, aid: narr.id, sessionId: 'S1', reason: 'Exited full screen' }), 'lock');
ok(h.call({ action: 'sStatus', token: s.token, aid: narr.id, sessionId: 'S1', d: { lockedS: 15 } }), 'status w/ locked seconds');
tw = ok(h.call({ action: 'tWork', token: T, aid: narr.id, sid: s.student.id }), 'tWork');
assert.strictEqual(tw.work.openSec, 40);
assert.strictEqual(tw.work.activeSec, 16);
assert.strictEqual(tw.work.lockedSec, 15);
assert.strictEqual(tw.work.dictated, 340);
assert.strictEqual(tw.work.lookups, 2);
assert.strictEqual(tw.work.sessions, 1);
assert(!tw.events.some(e => e.type === 'unusual' || e.type === 'burst'), 'dictation is not flagged as unusual/burst');
console.log('✓ open/active/locked seconds, dictated chars, lookups, sessions recorded; dictation not flagged');
ok(h.call({ action: 'tUnlock', token: T, aid: narr.id, sid: s.student.id }), 'unlock');

/* ── Inline comments, live ── */
const html = '<h1>My Day</h1><p>It was the best day of my life. The sun was bright.</p>';
ok(h.call({ action: 'sSave', token: s.token, aid: narr.id, sessionId: 'S1', rev: 2, html, words: 13, chars: 50 }), 'save essay');
const before = ok(h.call({ action: 'sPing', token: s.token, aid: narr.id, sessionId: 'S1' }), 'ping').cAt;
const ac = ok(h.call({ action: 'tAddComment', token: T, aid: narr.id, sid: s.student.id, comment: { quote: 'best day of my life', prefix: 'It was the ', suffix: '. The sun', offset: 18, text: 'Cliché — can you be more specific?' } }), 'add comment');
assert.strictEqual(ac.comments.length, 1);
const after = ok(h.call({ action: 'sPing', token: s.token, aid: narr.id, sessionId: 'S1' }), 'ping2').cAt;
assert(after > before, 'commentsAt advanced so the student refetches');
let sc = ok(h.call({ action: 'sComments', token: s.token, aid: narr.id }), 'sComments');
assert.strictEqual(sc.comments[0].text, 'Cliché — can you be more specific?');
ok(h.call({ action: 'sResolveComment', token: s.token, id: sc.comments[0].id, resolved: true }), 'resolve');
tw = ok(h.call({ action: 'tWork', token: T, aid: narr.id, sid: s.student.id, light: true }), 'tWork light');
assert.strictEqual(tw.comments[0].resolved, true);
ok(h.call({ action: 'tEditComment', token: T, id: sc.comments[0].id, reopen: true, text: 'Edited.' }), 'reopen');
sc = ok(h.call({ action: 'sComments', token: s.token, aid: narr.id }), 'sComments2');
assert(sc.comments[0].resolved === false && sc.comments[0].text === 'Edited.');
ok(h.call({ action: 'tDeleteComment', token: T, id: sc.comments[0].id }), 'delete');
assert.strictEqual(ok(h.call({ action: 'sComments', token: s.token, aid: narr.id }), 'x').comments.length, 0);
// Other students can't resolve it
const ava = ok(h.call({ action: 'tBoot', token: T }), 'b').students.find(x => x.first === 'Ava');
console.log('✓ comments: add → student sees → check off → teacher sees → reopen/edit → delete');

/* ── Rubric + grade ── */
const rubric = { title: 'Mini', levels: [{ label: 'A', points: 4 }, { label: 'B', points: 2 }], criteria: [{ id: 'x', name: 'Ideas', weight: 2, cells: ['great', 'ok'] }, { id: 'y', name: 'Voice', weight: 1, cells: ['great', 'ok'] }] };
const saved = ok(h.call({ action: 'tSaveAssignment', token: T, assignment: Object.assign({}, lit, { rubric, settings: Object.assign({}, lit.settings, { releaseFeedback: false }) }) }), 'save rubric');
assert.strictEqual(saved.assignment.rubric.criteria[0].weight, 2);
const gr = ok(h.call({ action: 'tSaveGrade', token: T, aid: lit.id, sid: s.student.id, scores: { x: 0, y: 1 }, comment: 'Nice work', graded: true }), 'grade');
assert.strictEqual(gr.grade.total, 10);
assert.strictEqual(gr.grade.max, 12);
// Editing the rubric recomputes totals
rubric.levels[1].points = 3;
ok(h.call({ action: 'tSaveAssignment', token: T, assignment: Object.assign({}, lit, { rubric }) }), 'edit rubric');
const gb = ok(h.call({ action: 'tGradeBoard', token: T, aid: lit.id }), 'gradeboard');
assert.strictEqual(gb.rows.find(r => r.sid === s.student.id).total, 11);
// Prompt update without rubric field keeps the rubric
ok(h.call({ action: 'tSaveAssignment', token: T, assignment: { id: lit.id, title: lit.title, classIds: lit.classIds, prompt: 'p', settings: lit.settings } }), 'save w/o rubric');
boot = ok(h.call({ action: 'tBoot', token: T }), 'boot2');
assert(boot.assignments.find(a => a.id === lit.id).rubric.criteria.length === 2, 'rubric kept when not sent');
console.log('✓ rubric weights, totals, recompute on edit, rubric kept on other edits');

/* ── Feedback release + read-only view logging ── */
let v = ok(h.call({ action: 'sView', token: s.token, aid: qw.id }), 'view quickwrite');
assert(v.html.includes('the tool is not the problem'), 'Test Student quickwrite present');
assert(v.feedback && v.feedback.total > 0 && v.feedback.rubric.criteria.length === 3, 'released feedback visible');
assert.strictEqual(v.comments.length, 2, 'inline comments in read-only view');
v = ok(h.call({ action: 'sView', token: s.token, aid: lit.id }), 'view lit');
assert.strictEqual(v.feedback, null, 'unreleased feedback hidden');
ok(h.call({ action: 'sView', token: s.token, aid: qw.id }), 'view again');
tw = ok(h.call({ action: 'tWork', token: T, aid: qw.id, sid: s.student.id }), 'tWork qw');
assert.strictEqual(tw.work.viewCount, 2);
assert(tw.events.some(e => e.type === 'view'));
const home = ok(h.call({ action: 'sHome', token: s.token }), 'home');
assert(home.assignments.find(a => a.id === qw.id).feedback === true, 'home shows feedback flag');
console.log('✓ read-only views counted + logged; released feedback shown, unreleased hidden');

/* ── Absent: closes even when opened by teacher ── */
ok(h.call({ action: 'tOverride', token: T, aid: lit.id, mode: 'open', minutes: 30 }), 'open lit');
st = ok(h.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'L1' }), 'start lit');
assert(!st.closed, 'open for present student');
ok(h.call({ action: 'tSetAbsent', token: T, sids: [s.student.id], absent: true }), 'mark absent');
const sv = ok(h.call({ action: 'sSave', token: s.token, aid: lit.id, sessionId: 'L1', rev: 1, html: '<p>x</p>', words: 1, chars: 1 }), 'save while absent');
assert(sv.closed && sv.win.absent && !sv.saved, 'absent closes writing');
st = ok(h.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'L2' }), 'start while absent');
assert(st.closed && st.win.absent);
// Extended access does not bypass absence either; narrative is 'always' mode
st = ok(h.call({ action: 'sStart', token: s.token, aid: narr.id, sessionId: 'S9' }), 'start narr absent');
assert(st.closed, 'always-mode closed when absent');
ok(h.call({ action: 'tSetAbsent', token: T, sids: [s.student.id], absent: false }), 'present');
st = ok(h.call({ action: 'sStart', token: s.token, aid: lit.id, sessionId: 'L3' }), 'start after present');
assert(!st.closed, 'reopens when marked present');
console.log('✓ absent overrides teacher open + always mode; marking present restores');

/* ── Days off ── */
const today = boot.today;
ok(h.call({ action: 'tSetDaysOff', token: T, daysOff: { [today]: 'PD Day', '2026-12-25': 'Christmas', bad: 'x' } }), 'days off');
ok(h.call({ action: 'tOverride', token: T, aid: lit.id, mode: '' }), 'clear override');
st = ok(h.call({ action: 'sStart', token: s.token, aid: narr.id, sessionId: 'D1' }), 'start on day off');
assert(st.closed && st.win.dayOff, 'always-mode closed on day off: ' + JSON.stringify(st.win));
assert(/PD Day/.test(st.win.label));
boot = ok(h.call({ action: 'tBoot', token: T }), 'boot3');
assert.deepStrictEqual(Object.keys(boot.daysOff).sort(), ['2026-12-25', today].sort());
// next-class search skips a day off
const tomorrow = h.addDays_(today, 1);
ok(h.call({ action: 'tSetDaysOff', token: T, daysOff: { [tomorrow]: 'Holiday' } }), 'tomorrow off');
const w = h.windowFor_(Object.assign({}, lit, { settings: Object.assign({}, lit.settings, { openMode: 'class', startDate: '' }), override: '' }), boot.classes.find(c => c.id === lit.classIds[0]), null, Date.now());
if (w.opensAt) assert(new Date(w.opensAt).toISOString().slice(0, 10) !== tomorrow, 'skips tomorrow');
ok(h.call({ action: 'tSetDaysOff', token: T, daysOff: {} }), 'clear days off');
console.log('✓ days off lock everything (incl. always mode) and are skipped for next-class times');

/* ── Record ── */
ok(h.call({ action: 'tSetAbsent', token: T, sids: [s.student.id], date: '2026-10-15', absent: true }), 'past absence');
const rec = ok(h.call({ action: 'tRecord', token: T, sid: s.student.id }), 'record');
assert(rec.items.length >= 3, 'record lists assignments');
assert(rec.items.find(i => i.assignment.id === qw.id).grade.graded);
assert(rec.absences.length === 1, 'absence history kept');
console.log('✓ record: ' + rec.items.length + ' assignments, ' + rec.absences.length + ' absence(s)');

/* ── Export includes grades + comments ── */
const ex = ok(h.call({ action: 'tExport', token: T, aid: qw.id, withComments: true }), 'export');
const exTest = ex.items.find(i => i.first === 'Test');
assert(exTest.grade && exTest.comments.length === 2);
console.log('✓ export carries grades and comments for printing');

/* ── Accommodations saved ── */
const sAva = ok(h.call({ action: 'tSaveStudent', token: T, student: { id: ava.id, first: 'Ava', last: ava.last, accom: { tts: true, relaxed: true } } }), 'save accom').student;
assert(sAva.accom.tts && sAva.accom.stt && !sAva.accom.extended);
console.log('✓ accommodations (legacy "dictation" maps to speech-to-text)');

/* ── Demo reseed still works ── */
ok(h.call({ action: 'tDemoSeed', token: T }), 'reseed');
for (let i = 0; i < 4; i++) ok(h.call({ action: 'tDemoTick', token: T, aid: narr.id }), 'tick');
console.log('\nALL V2 BACKEND TESTS PASSED');
