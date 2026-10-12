// Screenshot of the 3D board in a solo match at PREP (not a test file): checks the battlefield scene art loads.
//   node tools/scene-shot.mjs --base https://host [--out DIR] [--difficulty NORMAL]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Client, sleep } from '../test/e2e/client.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', '/workspace/scene-shots'));
const tag = arg('tag', 'azure');
fs.mkdirSync(OUT, { recursive: true });
const c = new Client(puppeteer, arg('base'), 'S', { w: 1440, h: 900 });
const scene = [];
try {
  await c.open();
  c.page.on('response', (r) => { if (/\/assets\/local\/scene\//.test(r.url())) scene.push(`${r.status()} ${r.url().replace(/^.*\/scene\//, '')}`); });
  await c.enter('阿米娅');
  await c.click('.mode-card', '独立模拟');
  const diff = arg('difficulty', '');
  if (diff) await c.click('.diff-card', diff);
  await c.click('.create-box button', '开始独立模拟');
  await c.waitFor((s) => !!s.room, 'solo room', 30000);
  if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await c.waitFor((s) => s.phase === 'INFO_CHECK', 'briefing', 30000);
  await c.click('.brief__foot .btn--primary', '准备就绪');
  await c.waitFor((s) => s.phase === 'BAND_DRAFT', 'band draft', 30000);
  await c.click('.dband', null, { nth: 2 });
  await c.click('.draft-detail__btns .btn--primary', '确认选择');
  await c.waitFor((s) => s.phase === 'PREP', 'prep', 60000);
  await sleep(10000);
  const field = (await c.st()).field;
  const file = path.join(OUT, `${tag}-prep-${diff || 'FUNNY'}.png`);
  await c.page.screenshot({ path: file });
  console.log(JSON.stringify({ file, field, sceneRequests: scene.length, sceneFailures: scene.filter((s) => !s.startsWith('2') && !s.startsWith('3')), sample: scene.slice(0, 4), problems: c.problems.filter((x) => !/media|favicon/.test(x)).slice(0, 6) }));
} catch (e) {
  console.error('FAILED', e.message);
  await c.page?.screenshot({ path: path.join(OUT, `${tag}-fail.png`) }).catch(() => {});
} finally { await c.close().catch(() => {}); process.exit(0); }
