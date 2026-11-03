// End-to-end walk-through of the v2 features in headless Chromium against dev/server.js.
// Usage: node dev/e2e-v2.js [baseUrl] [shotsDir]
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert = require('assert');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:8080/';
const SHOTS = process.argv[3] || '/tmp/claude-0/shots2';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('•', ...a);

// Fake dictionary + thesaurus responses (the real APIs aren't reachable from this sandbox).
async function mockLookups(ctx) {
  await ctx.route('https://api.dictionaryapi.dev/**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify([{ word: 'happy', phonetic: '/ˈhæpi/', meanings: [{ partOfSpeech: 'adjective', definitions: [{ definition: 'Feeling or showing pleasure or contentment.', example: 'a happy smile', synonyms: ['cheerful'] }], synonyms: ['joyful'], antonyms: ['sad'] }] }]) }));
  await ctx.route('https://api.datamuse.com/**', r => {
    const u = r.request().url();
    const body = /rel_syn/.test(u) ? [{ word: 'glad' }, { word: 'content' }] : /rel_ant/.test(u) ? [{ word: 'unhappy' }] : [{ word: 'delighted' }];
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
}

// A fake SpeechRecognition that "hears" a sentence a moment after it starts.
const FAKE_STT = `
  window.__sttPhrase = 'the dog ran home period it was happy';
  class FakeRec { constructor(){ this.lang='en-CA'; } start(){ setTimeout(()=>{ this.onstart&&this.onstart();
      setTimeout(()=>{ const r=[{transcript: window.__sttPhrase, confidence:.9}]; r.isFinal=true; const ev={resultIndex:0, results:[r]}; this.onresult&&this.onresult(ev); }, 300); }, 50); }
    stop(){ setTimeout(()=>this.onend&&this.onend(), 10); } abort(){ this.stop(); } }
  window.SpeechRecognition = FakeRec; window.webkitSpeechRecognition = FakeRec;
`;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const tctx = await browser.newContext({ viewport: { width: 1500, height: 920 } });
  const sctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await mockLookups(sctx);
  await sctx.addInitScript(FAKE_STT);
  const teacher = await tctx.newPage();
  const student = await sctx.newPage();
  for (const [name, p] of [['teacher', teacher], ['student', student]]) {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::|ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
  }
  const SDOC = '#view-write .page .doc';

  /* ── Teacher in ── */
  await teacher.goto(BASE + 'teacher.html');
  await teacher.fill('#t-pw', 'english2026');
  await teacher.click('#t-login-btn');
  await teacher.waitForSelector('.scard');
  await sleep(600);
  const absentCard = await teacher.$eval('.scard.absent .nm', e => e.textContent);
  log('absent card:', absentCard.replace(/\s+/g, ' '));
  assert(/Mateo/.test(absentCard));
  await teacher.screenshot({ path: SHOTS + '/01-live.png', fullPage: true });

  /* ── Student: home → read-only view of the graded quickwrite ── */
  await student.goto(BASE);
  await student.fill('#code', 'TEST-0001');
  await student.click('#login-btn');
  await student.waitForSelector('.assign');
  await student.screenshot({ path: SHOTS + '/02-student-home.png', fullPage: true });
  await student.click('.assign:has-text("Quickwrite") [data-act=view]');
  await student.waitForSelector('.fb-score');
  const score = await student.textContent('.fb-score');
  log('student sees released score:', score.replace(/\s+/g, ' '));
  const nCards = await student.$$eval('#rd-cmts .cmt', e => e.length);
  assert.strictEqual(nCards, 2, 'two comments visible');
  const hl = await student.evaluate(() => CSS.highlights.has('ink-cmt'));
  assert(hl, 'comment highlights painted');
  await student.click('#rd-cmts .cmt:first-child .cmt-done input');
  await sleep(700);
  await student.screenshot({ path: SHOTS + '/03-student-feedback.png', fullPage: true });
  const copyBlocked = await student.evaluate(() => { const ev = new ClipboardEvent('copy', { cancelable: true, bubbles: true }); document.querySelector('#read-doc').dispatchEvent(ev); return ev.defaultPrevented; });
  log('copy from read-only view blocked:', copyBlocked);
  await student.click('#read-back');
  await student.waitForSelector('.assign');

  /* ── Student: writing with tools ── */
  await student.click('.assign.is-open [data-act=write]');
  await student.waitForSelector('#ov-start:not([hidden])');
  const micShown = await student.isVisible('#mic-check');
  log('microphone pre-check shown for speech-to-text student:', micShown);
  await student.click('#mic-test');
  await sleep(300);
  await student.click('#start-go');
  await student.waitForFunction(s => document.querySelector(s) && document.querySelector(s).isContentEditable, SDOC, { timeout: 8000 });
  await sleep(1200);
  const tools = await student.$$eval('.tb.tool', bs => bs.filter(b => !b.hidden).map(b => b.title.split(' (')[0]));
  log('toolbar tools:', tools.join(' | '));
  assert(tools.length === 4, 'spell, lookup, read aloud, dictate');
  await student.click(SDOC);
  await student.keyboard.type('Grandpa said I would recieve a gift. I was happy and teh day was bright. ', { delay: 4 });
  await sleep(1800);
  const spellCount = await student.evaluate(() => CSS.highlights.has('ink-spell') ? CSS.highlights.get('ink-spell').size : 0);
  log('misspellings underlined:', spellCount);
  assert(spellCount >= 2, 'recieve + teh underlined');
  // click the misspelled word → suggestions → pick "receive"
  const box = await student.evaluate(() => { const h = CSS.highlights.get('ink-spell'); const r = Array.from(h)[0]; const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: r.toString() }; });
  log('clicking misspelled word:', box.w);
  await student.mouse.click(box.x, box.y);
  await student.waitForSelector('.word-pop .wp-s', { timeout: 10000 });
  const sugg = await student.$$eval('.word-pop .wp-s', b => b.map(x => x.textContent));
  log('suggestions:', sugg.join(', '));
  await student.screenshot({ path: SHOTS + '/04-spell-pop.png' });
  const pick = sugg.find(s => s === 'receive' || s === 'the') || sugg[0];
  await student.click('.word-pop .wp-s:text-is("' + pick + '")');
  await sleep(400);
  let text = await student.textContent(SDOC);
  log('after fix:', text.trim());
  assert(text.includes(pick), 'replacement applied');

  // Right-click "happy" → Look up → definition + thesaurus swap
  const hp = await student.evaluate(s => { const d = document.querySelector(s); const t = d.innerText; const m = Ink.Text.model(d); const i = m.text.indexOf('happy'); const r = Ink.Text.rangeOf(m, i, i + 5); const b = r.getBoundingClientRect(); return { x: b.left + 8, y: b.top + b.height / 2 }; }, SDOC);
  await student.mouse.click(hp.x, hp.y, { button: 'right' });
  await student.waitForSelector('.word-pop .wp-btn');
  await student.click('.word-pop .wp-btn:has-text("Look up")');
  await student.waitForSelector('.lk-defs li');
  log('definition:', (await student.textContent('.lk-defs li')).trim());
  await student.click('.lk-tabs [data-tab=syn]');
  await student.click('.lk-chip:text-is("glad")');
  await sleep(300);
  text = await student.textContent(SDOC);
  assert(/I was glad/.test(text), 'thesaurus swap applied: ' + text);
  log('thesaurus swap: "happy" → "glad" ✓');
  await student.screenshot({ path: SHOTS + '/05-lookup.png' });

  // Dictation
  await student.click(SDOC);
  await student.keyboard.press('End');
  await student.click('.tb.tool[title^="Speech-to-text"]');
  await sleep(900);
  text = await student.textContent(SDOC);
  log('after dictation:', text.trim().slice(-60));
  assert(/The dog ran home\. It was happy/.test(text), 'dictated with punctuation + capitals');
  await student.click('#dictate-stop').catch(() => {});
  // Read aloud runs without errors
  await student.click('.tb.tool[title^="Read my writing"]');
  await sleep(400);
  await student.click('.tb.tool[title^="Read my writing"]');
  // Paste is still blocked even with tools on
  const before = await student.evaluate(s => document.querySelector(s).innerText.length, SDOC);
  await student.evaluate(s => { const dt = new DataTransfer(); dt.setData('text/plain', 'Copied from somewhere else entirely.'); document.querySelector(s).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); }, SDOC);
  await sleep(200);
  assert.strictEqual(await student.evaluate(s => document.querySelector(s).innerText.length, SDOC), before, 'outside paste blocked');
  await sleep(3500); // autosave
  log('save state:', await student.textContent('#savestate-text'));

  /* ── Teacher: live drawer → highlight → comment ── */
  await sleep(4000);
  await teacher.click('.scard:has-text("Test Student")');
  await teacher.waitForFunction(() => { const d = document.querySelector('#dr-docview .doc'); return d && /The dog ran home/.test(d.textContent); }, null, { timeout: 15000 });
  await sleep(1200);
  const sel = await teacher.evaluate(() => {
    const d = document.querySelector('#dr-docview .doc');
    const m = Ink.Text.model(d);
    const i = m.text.indexOf('The dog ran home');
    const r = Ink.Text.rangeOf(m, i, i + 'The dog ran home'.length);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    const b = r.getBoundingClientRect();
    return { x: b.right - 2, y: b.top + b.height / 2, ok: i >= 0 };
  });
  assert(sel.ok, 'found dictated text in teacher view');
  await teacher.dispatchEvent('#dr-docview .doc', 'mouseup');
  await teacher.waitForSelector('.cmt-fab');
  await teacher.click('.cmt-fab');
  await teacher.fill('.cmt-pop textarea', 'Nice short sentence — try adding a sensory detail here.');
  await teacher.screenshot({ path: SHOTS + '/06-teacher-commenting.png' });
  await teacher.click('.cmt-pop [data-ok]');
  await teacher.waitForSelector('#dr-cmts .cmt');
  await teacher.screenshot({ path: SHOTS + '/07-drawer.png' });
  const timeTxt = await teacher.textContent('#dr-time');
  log('drawer time panel:', timeTxt.replace(/\s+/g, ' ').slice(0, 140));
  assert(/Actively typing/.test(timeTxt) && /Open, not typing/.test(timeTxt));

  // Student receives it live
  await student.waitForSelector('#cmt-list .cmt', { timeout: 20000 });
  const stHl = await student.evaluate(() => CSS.highlights.has('ink-cmt') && CSS.highlights.get('ink-cmt').size);
  log('student got the comment live; highlighted ranges:', stHl);
  await student.screenshot({ path: SHOTS + '/08-student-live-comment.png' });
  await student.click('#cmt-list .cmt .cmt-done input');
  await sleep(1500);
  await sleep(3500);
  const doneTeacher = await teacher.$eval('#dr-cmts', e => e.textContent);
  log('teacher sees check-off:', /Done/.test(doneTeacher));

  /* ── Absent while writing ── */
  await teacher.click('#dr-actions button:has-text("Mark absent")');
  await student.waitForSelector('#ov-msg:not([hidden])', { timeout: 20000 });
  log('student message:', await student.textContent('#msg-title'));
  assert(/absent/i.test(await student.textContent('#msg-title')));
  await student.screenshot({ path: SHOTS + '/09-student-absent.png' });
  await student.click('#msg-btn');
  await student.waitForSelector('#absent-banner:not([hidden])');
  // still able to view work read-only while absent
  const viewBtn = await student.$('.assign:has-text("Personal Narrative") [data-act=view]');
  assert(viewBtn, 'view-only available while closed');
  await viewBtn.click();
  await student.waitForFunction(() => /The dog ran home/.test(document.querySelector('#read-doc').textContent));
  await student.screenshot({ path: SHOTS + '/09b-student-readonly.png', fullPage: true });
  await student.click('#read-back');
  await teacher.waitForSelector('#dr-actions button:has-text("Mark here")', { timeout: 10000 });
  await teacher.click('#dr-actions button:has-text("Mark here")');
  await sleep(800);
  await teacher.keyboard.press('Escape');

  /* ── Attendance modal ── */
  await teacher.click('#lv-attend');
  await teacher.waitForSelector('.att');
  await teacher.screenshot({ path: SHOTS + '/10-attendance.png' });
  await teacher.click('.modal .actions .btn:first-child');

  /* ── Grade tab ── */
  await teacher.click('[data-tab=grade]');
  await teacher.waitForSelector('.g-st');
  await teacher.click('.g-st:has-text("Fong")');
  await teacher.waitForSelector('.sc-crit');
  await sleep(500);
  await teacher.screenshot({ path: SHOTS + '/11-grade.png' });
  await teacher.click('.g-st:has-text("Nguyen")');
  await teacher.waitForSelector('.sc-crit');
  await sleep(400);
  const nCrit = await teacher.$$eval('.sc-crit', e => e.length);
  for (let i = 0; i < nCrit; i++) { await teacher.locator('.sc-crit').nth(i).locator('.sc-lv').nth(1).click(); await sleep(60); }
  await teacher.fill('#g-comment', 'Strong voice throughout. Watch your paragraph transitions.');
  await teacher.click('#g-graded + .switch');
  await sleep(1500);
  log('grade save:', await teacher.textContent('#g-save'), '· total', await teacher.textContent('#g-tot'));
  assert(/Saved/.test(await teacher.textContent('#g-save')));
  // comment from the grade view
  await teacher.evaluate(() => { const d = document.querySelector('#g-view .doc'); const m = Ink.Text.model(d); const i = m.text.indexOf('chess'); const r = Ink.Text.rangeOf(m, i, i + 10); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await teacher.dispatchEvent('#g-view .doc', 'mouseup');
  await teacher.waitForSelector('.cmt-fab');
  await teacher.click('.cmt-fab');
  await teacher.fill('.cmt-pop textarea', 'Good hook.');
  await teacher.click('.cmt-pop [data-ok]');
  await teacher.waitForSelector('.g-pane .cmt');
  await teacher.screenshot({ path: SHOTS + '/12-grade-comments.png' });

  /* ── Rubric editor from a template ── */
  await teacher.click('[data-tab=assignments]');
  await teacher.click('.side-list .item:has-text("Literary Response")');
  await teacher.waitForSelector('#af-rb-edit');
  await teacher.click('#af-rb-edit');
  await teacher.waitForSelector('.rb-modal');
  await teacher.selectOption('#rb-from', { label: 'Literary Analysis Essay' });
  await teacher.waitForSelector('.rb-edit');
  await teacher.screenshot({ path: SHOTS + '/13-rubric-editor.png' });
  await teacher.click('#rb-add-c');
  await teacher.fill('.rb-edit tr:last-child .c-name', 'Use of Quotations');
  await teacher.click('#rb-save');
  await sleep(1500);
  const rsum = await teacher.textContent('#af-rubric');
  log('rubric summary:', rsum.replace(/\s+/g, ' ').slice(0, 90));
  assert(/6 criteria/.test(rsum));

  /* ── Calendar ── */
  await teacher.click('[data-tab=settings]');
  await teacher.waitForSelector('.cal-d');
  await teacher.click('[data-hol]');
  // drag across three weekdays
  const days = await teacher.$$('.cal-d:not(.we):not(.off):not(.past)');
  const b1 = await days[3].boundingBox(), b2 = await days[5].boundingBox();
  await teacher.mouse.move(b1.x + 5, b1.y + 5); await teacher.mouse.down(); await teacher.mouse.move(b2.x + 5, b2.y + 5, { steps: 4 }); await teacher.mouse.up();
  await sleep(1500);
  log('calendar save:', await teacher.textContent('#cal-save'), '· listed', await teacher.$$eval('.cal-li', e => e.length), 'groups');
  await teacher.screenshot({ path: SHOTS + '/14-calendar.png', fullPage: true });

  /* ── Record ── */
  const sid = await teacher.evaluate(() => (JSON.parse(localStorage.getItem('inkwell_teacher')) && 1) && null);
  await teacher.click('[data-tab=classes]');
  await teacher.waitForSelector('table.roster');
  await teacher.evaluate(() => { const tr = Array.from(document.querySelectorAll('table.roster tbody tr')).find(r => r.querySelector('[data-f=first]').value === 'Test'); tr.querySelector('[data-rec]').click(); });
  await teacher.waitForSelector('.rec-item');
  log('record sections:', await teacher.$$eval('.rec-item h2', e => e.map(x => x.textContent).join(' | ')));
  await teacher.screenshot({ path: SHOTS + '/15-record.png', fullPage: true });

  /* ── Print all (PDF built in the page, checked for duplex padding) ── */
  await teacher.click('[data-tab=live]');
  await teacher.waitForSelector('.scard');
  const pdf = await teacher.evaluate(async () => {
    const r = await Ink.call('tExport', { token: JSON.parse(localStorage.getItem('inkwell_teacher')).token, aid: document.querySelector('#lv-assign').value, withComments: true });
    const items = r.items.filter(i => i.status !== 'none').sort((a, b) => (a.last + a.first).localeCompare(b.last + b.first));
    const res = await Ink.PDF.build(items, r.assignment, { doubleSpace: true, duplex: true, feedback: true });
    let bin = ''; const u = res.bytes; for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
    return { pages: res.pages, stats: res.stats, b64: btoa(bin) };
  });
  fs.writeFileSync(SHOTS + '/print-all.pdf', Buffer.from(pdf.b64, 'base64'));
  const odd = pdf.stats.filter(s => (s.pages + (s.padded ? 1 : 0)) % 2 === 1);
  log('PDF:', pdf.pages, 'pages;', pdf.stats.map(s => s.name.split(' ')[0] + ':' + s.pages + (s.padded ? '+1' : '')).join(' '));
  assert.strictEqual(odd.length, 0, 'every student ends on an even page');
  assert.strictEqual(pdf.pages % 2, 0);
  // the dialog opens (and a popup appears)
  const [popup] = await Promise.all([teacher.waitForEvent('popup'), (async () => { await teacher.click('#lv-print'); await teacher.waitForSelector('.modal #pdbl'); await teacher.click('.modal .actions .btn:last-child'); })()]);
  await teacher.waitForFunction(() => /PDF ready/.test(document.querySelector('#toasts').textContent), null, { timeout: 30000 });
  await sleep(500);
  log('Print all opened:', popup.url().slice(0, 30), '·', (await teacher.textContent('#toasts')).match(/PDF ready[^.]*\./)[0]);
  await popup.close();

  /* ── Icon centring audit ── */
  const audit = async (page, label) => {
    const r = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button, a.btn, .btn').forEach(b => {
        const rb = b.getBoundingClientRect();
        if (!rb.width || !rb.height || getComputedStyle(b).visibility === 'hidden') return;
        const svg = b.querySelector(':scope > svg, :scope > span[data-icon] > svg, :scope > span > svg');
        if (!svg) return;
        const rs = svg.getBoundingClientRect();
        if (!rs.width) return;
        const dy = (rs.top + rs.height / 2) - (rb.top + rb.height / 2);
        const onlyIcon = !b.textContent.trim();
        const dx = onlyIcon ? (rs.left + rs.width / 2) - (rb.left + rb.width / 2) : 0;
        if (Math.abs(dy) > 1 || Math.abs(dx) > 1) out.push((b.title || b.textContent.trim() || b.className).slice(0, 30) + ' dy=' + dy.toFixed(1) + ' dx=' + dx.toFixed(1));
      });
      return { bad: out, total: document.querySelectorAll('button svg').length };
    });
    log('icon audit ' + label + ':', r.bad.length ? r.bad : 'all centred', '(' + r.total + ' icons)');
    return r.bad;
  };
  let bad = [];
  bad = bad.concat(await audit(teacher, 'live'));
  await teacher.click('.scard:has-text("Sofia")'); await teacher.waitForSelector('#dr-actions button'); await sleep(800);
  bad = bad.concat(await audit(teacher, 'drawer'));
  await teacher.keyboard.press('Escape');
  for (const tab of ['grade', 'assignments', 'classes', 'settings']) { await teacher.click('[data-tab=' + tab + ']'); await sleep(1500); bad = bad.concat(await audit(teacher, tab)); }
  bad = bad.concat(await audit(student, 'student home'));

  // Mobile student home
  const m = await sctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(BASE);
  await m.waitForSelector('.assign');
  await m.screenshot({ path: SHOTS + '/16-mobile.png', fullPage: true });

  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length || bad.length) process.exit(2);
  console.log('E2E V2 PASSED');
})().catch(e => { console.error('E2E FAILED:', e); process.exit(1); });
