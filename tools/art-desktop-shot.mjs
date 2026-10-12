// Desktop art-pack check (not a test file): starts a packaged Electron build (offline mode) with a remote-debugging
// port, drives a solo match to PREP and screenshots it; lists every failed /assets request (missing art).
//   node tools/art-desktop-shot.mjs <app-binary> <user-data-dir> <out.png>
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { Client, sleep } from '../test/e2e/client.mjs';

const [bin, ud, out] = process.argv.slice(2);
const port = 9333;
const app = spawn(bin, ['--no-sandbox', `--user-data-dir=${ud}`, `--remote-debugging-port=${port}`], { env: { ...process.env, SP_MODE: 'offline', SP_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
const logs = [];
app.stdout.on('data', (d) => logs.push(String(d)));
app.stderr.on('data', (d) => logs.push(String(d)));
let browser;
try {
  for (let i = 0; i < 60 && !browser; i++) { try { browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}`, defaultViewport: null }); } catch { await sleep(500); } }
  let page;
  for (let i = 0; i < 60; i++) { page = (await browser.pages()).find((p) => p.url().startsWith('app://game/')); if (page) break; await sleep(500); }
  const bad = [];
  let artOk = 0;
  page.on('response', (r) => { if (/\/assets\//.test(r.url())) { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); else artOk++; } });
  page.on('requestfailed', (r) => { if (/\/assets\//.test(r.url())) bad.push(`failed ${r.url()}`); });
  await page.waitForFunction(() => !!globalThis.__SP__ && !!globalThis.document.querySelector('.screen'), { timeout: 30000 });
  const c = new Client(puppeteer, 'app://game', 'D');
  c.browser = browser; c.page = page;
  await c.enter('阿米娅');
  await c.click('.mode-card', '独立模拟');
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room', 30000);
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 2 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((s) => s.phase === 'PREP', 'prep', 60000);
  await sleep(6000);
  await page.screenshot({ path: out });
  console.log(JSON.stringify({ phase: (await c.st()).phase, artResponses: artOk, artFailures: bad.length, sample: bad.slice(0, 10) }));
} catch (e) {
  console.error('FAILED', e.message, logs.slice(-20).join(''));
} finally {
  try { browser?.disconnect(); } catch { /* ignore */ }
  app.kill();
  process.exit(0);
}
