// Smoke test of the server-less web client (mobile/www): a plain static server (like GitHub Pages / the Capacitor
// WebView: no /ws, no /media, no /healthz logic), a phone-sized landscape touch viewport, the picker → 离线单人 →
// a solo 独立模拟 through the briefing and band draft into PREP, all with the in-page server. Screenshots to OUT.
//   node mobile/scripts/smoke.mjs --www mobile/www [--base /Stronghold-Protocol/] [--out /workspace/android-shots] [--cloud]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Client, sleep } from '../../test/e2e/client.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const WWW = path.resolve(arg('www', 'mobile/www'));
const BASE = arg('base', '/');
const OUT = path.resolve(arg('out', '/workspace/android-shots'));
const CLOUD = process.argv.includes('--cloud');
const tag = BASE === '/' ? 'android' : 'pages';
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.atlas': 'text/plain' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE)) { res.writeHead(404); res.end('nf'); return; }
  p = p.slice(BASE.length);
  let f = path.join(WWW, p);
  if (!f.startsWith(WWW)) { res.writeHead(403); res.end(); return; }
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); } catch { /* 404 below */ }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${srv.address().port}`;
process.env.CHROME_PATH ||= '/usr/bin/google-chrome';
const c = new Client(puppeteer, origin, tag, { w: 915, h: 412 });
let ok = false;
try {
  // Client.open, but into the picker and with a phone viewport
  c.browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, headless: true, args: ['--no-sandbox', '--mute-audio', '--autoplay-policy=no-user-gesture-required'], protocolTimeout: 90000 });
  c.page = (await c.browser.pages())[0];
  const page = c.page;
  await page.setViewport({ width: 915, height: 412, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  page.on('pageerror', (e) => c.problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') c.problems.push(`console: ${m.text()}`); });
  page.on('dialog', (d) => d.accept().catch(() => {}));
  page.on('response', (r) => { if (r.status() >= 400) c.problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(origin + BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button.card[data-mode="offline"]', { timeout: 30000 });
  await sleep(1500);
  await page.screenshot({ path: path.join(OUT, `${tag}-1-picker.png`) });
  await page.click(`button.card[data-mode="${CLOUD ? 'cloud' : 'offline'}"]`);
  await page.waitForFunction(() => !!globalThis.__SP__ && !!document.querySelector('.screen'), { timeout: 60000 });
  await c.enter('移动测试');
  await page.screenshot({ path: path.join(OUT, `${tag}-2-lobby.png`) });
  if (!CLOUD) {
    await c.click('.mode-card', '独立模拟');
    await c.click('.diff-card', '标准模拟', { optional: true });
    await c.click('.create-box button', '开始独立模拟');
    await c.waitFor((s) => !!s.room, 'solo room', 30000);
    if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
    await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
    await page.screenshot({ path: path.join(OUT, `${tag}-3-briefing.png`) });
    await c.click('.brief__foot .btn--primary', '准备就绪');
    await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
    await c.click('.dband', null, { nth: 2 });
    await c.click('.draft-detail__btns .btn--primary', '确认选择');
    await c.waitFor((s) => s.phase === 'PREP' || s.phase === 'SP_DRAFT', 'prep', 60000);
    await sleep(5000);
    await page.screenshot({ path: path.join(OUT, `${tag}-4-prep.png`) });
    await c.click('button, [role=button], div', '准备就绪', { optional: true, timeout: 5000 });
    const s = await c.waitFor((s) => s.phase === 'COMBAT', 'combat', 90000).catch(() => null);
    if (s) { await sleep(6000); await page.screenshot({ path: path.join(OUT, `${tag}-5-combat.png`) }); }
    console.log('state', JSON.stringify(await c.st()));
  }
  ok = true;
} catch (e) {
  console.error('FAILED', e.message);
  try { await c.page.screenshot({ path: path.join(OUT, `${tag}-fail.png`) }); } catch { /* ignore */ }
} finally {
  console.log('problems', JSON.stringify(c.problems.slice(0, 30), null, 1));
  await c.browser?.close().catch(() => {});
  srv.close();
}
process.exit(ok ? 0 : 1);
