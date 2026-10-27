// End-to-end walk-through in headless Chromium against dev/server.js.
// Usage: node dev/e2e.js [baseUrl] [shotsDir]
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const assert = require('assert');

const BASE = process.argv[2] || 'http://localhost:8080/';
const SHOTS = process.argv[3] || '/tmp/claude-0/shots';
require('fs').mkdirSync(SHOTS, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const sctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const teacher = await tctx.newPage();
  const student = await sctx.newPage();
  for (const [name, p] of [['teacher', teacher], ['student', student]]) {
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text()) && !/ERR_/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
  }

  // ── Teacher signs in ──
  await teacher.goto(BASE + 'teacher.html');
  await teacher.fill('#t-pw', 'english2026');
  await teacher.click('#t-login-btn');
  await teacher.waitForSelector('.scard');
  await sleep(600);
  await teacher.screenshot({ path: SHOTS + '/01-teacher-live.png', fullPage: true });
  const cardCount = await teacher.$$eval('.scard', els => els.length);
  console.log('teacher live cards:', cardCount);

  // ── Student signs in ──
  await student.goto(BASE);
  await student.fill('#code', 'test-0001');
  await student.click('#login-btn');
  await student.waitForSelector('.assign');
  await student.screenshot({ path: SHOTS + '/02-student-home.png', fullPage: true });
  const titles = await student.$$eval('.assign h3', els => els.map(e => e.textContent));
  console.log('student sees:', titles);

  // ── Start writing ──
  await student.click('.assign.is-open [data-act=write]');
  await student.waitForSelector('#ov-start:not([hidden])');
  await student.screenshot({ path: SHOTS + '/03-student-start.png' });
  await student.click('#start-go');
  await student.waitForSelector('#view-write:not([hidden])');
  await student.waitForFunction(() => document.querySelector('#view-write .page .doc').isContentEditable, null, { timeout: 8000 });
  const fs = await student.evaluate(() => !!document.fullscreenElement);
  console.log('fullscreen active:', fs);
  await sleep(1200); // armed
  await student.click('#view-write .page .doc');
  await student.selectOption('[data-block]', 'h1');
  await student.keyboard.type('The Day I Learned to Listen');
  await student.keyboard.press('Enter');
  await student.keyboard.press('Tab');
  await student.keyboard.type('It was the last week of summer when my grandfather asked me to help him fix the old fence behind the barn. ', { delay: 5 });
  await student.keyboard.press('Control+i');
  await student.keyboard.type('I did not want to go.', { delay: 5 });
  await student.keyboard.press('Control+i');
  await student.keyboard.type(' But something in his voice told me this was not really about the fence.', { delay: 5 });
  await sleep(3500);
  const saveText = await student.textContent('#savestate-text');
  const words = await student.textContent('#st-words');
  console.log('save state:', saveText, '| words:', words);
  assert(/Saved/.test(saveText), 'autosaved');
  await student.screenshot({ path: SHOTS + '/04-student-writing.png' });

  // ── Paste from outside is blocked ──
  const before = await student.evaluate(() => document.querySelector('#view-write .page .doc').innerText.length);
  await student.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'This paragraph was copied from a website and should never appear.');
    document.querySelector('#view-write .page .doc').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(300);
  const after = await student.evaluate(() => document.querySelector('#view-write .page .doc').innerText.length);
  const toast = await student.textContent('#toasts').catch(() => '');
  console.log('paste blocked:', before === after, '| toast:', toast.trim().slice(0, 60));
  assert.strictEqual(before, after, 'outside paste blocked');

  // ── Self-paste (copy from own essay) is allowed ──
  await student.evaluate(() => {
    const doc = document.querySelector('#view-write .page .doc');
    const p = doc.querySelector('p');
    const r = document.createRange();
    r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 6); // "It was"
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    doc.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: false, clipboardData: new DataTransfer() }));
    r.selectNodeContents(doc); r.collapse(false); s.removeAllRanges(); s.addRange(r);
    const dt = new DataTransfer(); dt.setData('text/plain', 'It was');
    doc.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await sleep(200);
  const selfPasted = await student.evaluate(() => /It was\s*$/.test(document.querySelector('#view-write .page .doc').innerText.trim()));
  console.log('self paste allowed:', selfPasted);

  // ── Big insert (e.g. AI "help me write") is blocked ──
  const b2 = await student.evaluate(() => document.querySelector('#view-write .page .doc').innerText.length);
  await student.keyboard.insertText(' Here is an entire generated paragraph that suddenly appears all at once in the essay.');
  await sleep(200);
  const a2 = await student.evaluate(() => document.querySelector('#view-write .page .doc').innerText.length);
  console.log('big insert blocked:', a2 === b2);
  assert.strictEqual(a2, b2, 'big insert blocked');

  // ── Leaving full screen locks the student ──
  await sleep(2500);
  await student.evaluate(() => document.exitFullscreen ? document.exitFullscreen() : null).catch(() => {});
  if (!fs) await student.evaluate(() => window.dispatchEvent(new Event('blur')));
  await student.waitForSelector('#ov-lock:not([hidden])', { timeout: 5000 });
  console.log('lock reason:', await student.textContent('#lock-reason'));
  await student.screenshot({ path: SHOTS + '/05-student-locked.png' });

  // ── Teacher sees it and clears ──
  await teacher.waitForFunction(() => Array.from(document.querySelectorAll('.scard.locked .nm')).some(e => e.textContent.includes('Test Student')), null, { timeout: 15000 });
  await teacher.screenshot({ path: SHOTS + '/06-teacher-sees-lock.png', fullPage: true });
  const card = await teacher.$('.scard.locked:has-text("Test Student")');
  await (await card.$('[data-clear]')).click();
  await student.waitForSelector('#lock-cleared:not([hidden])', { timeout: 10000 });
  await student.screenshot({ path: SHOTS + '/07-student-cleared.png' });
  await student.click('#lock-return');
  await student.waitForFunction(() => document.querySelector('#view-write .page .doc').isContentEditable && document.getElementById('ov-lock').hidden, null, { timeout: 5000 });
  await sleep(1200);
  await student.click('#view-write .page .doc');
  await student.keyboard.press('End');
  await student.keyboard.type(' He handed me a hammer and waited.', { delay: 5 });
  await sleep(3000);
  console.log('after clear, save state:', await student.textContent('#savestate-text'));

  // ── Teacher opens the live view drawer ──
  await sleep(5500);
  await teacher.click('.scard:has-text("Test Student")');
  await teacher.waitForSelector('.drawer #dr-doc h1', { timeout: 10000 });
  await sleep(800);
  const liveText = await teacher.textContent('#dr-doc');
  console.log('teacher live view contains typed text:', liveText.includes('hammer'));
  await teacher.screenshot({ path: SHOTS + '/08-teacher-drawer.png' });
  await teacher.keyboard.press('Escape');

  // Drawer for a seeded student with history → playback
  await teacher.click('.scard:has-text("Sofia")');
  await teacher.waitForSelector('.drawer #dr-doc p');
  await teacher.click('.mode-switch [data-mode=playback]');
  await sleep(800);
  await teacher.screenshot({ path: SHOTS + '/09-teacher-playback.png' });
  await teacher.keyboard.press('Escape');

  // ── Student submits ──
  await student.click('#submit-btn');
  await student.waitForSelector('.modal');
  await student.click('.modal .actions .btn:last-child');
  await student.waitForSelector('#ov-msg:not([hidden])', { timeout: 8000 });
  console.log('submit message:', await student.textContent('#msg-title'));
  await student.screenshot({ path: SHOTS + '/10-student-submitted.png' });

  // ── Teacher tabs ──
  await teacher.click('[data-tab=assignments]');
  await teacher.waitForSelector('#af-title');
  await teacher.screenshot({ path: SHOTS + '/11-teacher-assignments.png', fullPage: true });
  await teacher.click('[data-tab=classes]');
  await teacher.waitForSelector('table.roster');
  await teacher.screenshot({ path: SHOTS + '/12-teacher-classes.png', fullPage: true });
  await teacher.click('[data-tab=settings]');
  await teacher.waitForSelector('#st-url');
  await teacher.screenshot({ path: SHOTS + '/13-teacher-settings.png', fullPage: true });

  // ── Simulation on the live page ──
  await teacher.click('[data-tab=live]');
  await teacher.waitForSelector('#lv-sim:not([hidden])');
  await teacher.click('#lv-sim');
  await sleep(9000);
  await teacher.screenshot({ path: SHOTS + '/14-teacher-sim.png', fullPage: true });
  await teacher.click('#lv-sim');

  // mobile-ish student home
  const m = await sctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(BASE);
  await m.waitForSelector('.assign');
  await m.screenshot({ path: SHOTS + '/15-student-mobile.png', fullPage: true });

  console.log('page errors:', errors.length ? errors : 'none');
  await browser.close();
  if (errors.length) process.exit(2);
  console.log('E2E PASSED');
})().catch(e => { console.error('E2E FAILED:', e); process.exit(1); });
