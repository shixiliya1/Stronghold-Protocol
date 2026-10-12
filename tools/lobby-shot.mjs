// Screenshots of the 联机大厅 (not a test file): the lobby panel with stats + room list, 最快匹配 joining a room, the
// room's 公开到联机大厅 switch. Also an end-to-end check against any server (--base https://host).
//   node tools/lobby-shot.mjs [--base http://127.0.0.1:3000] [--out /workspace/lobby-shots]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Client, sleep, startRealServer } from '../test/e2e/client.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', '/workspace/lobby-shots'));
fs.mkdirSync(OUT, { recursive: true });
process.env.CHROME_PATH ||= '/usr/bin/google-chrome';
const srv = arg('base') ? { base: arg('base'), stop: async () => {} } : await startRealServer();
const tag = arg('tag', 'local');
const mk = (n) => new Client(puppeteer, srv.base, n, { w: 1440, h: 900 });
const [a, b, c] = [mk('A'), mk('B'), mk('C')];
const hall = (cl) => cl.page.evaluate(() => globalThis.__SP__.store.get().hall);
const result = {};
try {
  for (const [cl, n] of [[a, '能天使'], [b, '德克萨斯'], [c, '阿米娅']]) { await cl.open(); await cl.enter(n); }
  await a.page.waitForSelector('.hall-panel', { timeout: 15000 });
  // B: 最快匹配 with 2人 → a new public 2-player room; C: a normal room made public
  await b.page.select('.hall-pref select', '2');
  await b.click('.hall-quick');
  const rb = (await b.waitFor((s) => !!s.room?.code, 'B room')).room;
  await c.click('.mode-card', '同盟模拟');
  await c.click('.create-box button', '创建同盟');
  await c.waitFor((s) => !!s.room?.code, 'C room');
  await c.click('.ailast__opt', '公开到联机大厅');
  await sleep(2600);
  await c.page.screenshot({ path: path.join(OUT, `${tag}-3-room-public-switch.png`) });
  await a.click('.hall-list-btn');
  await sleep(2600);
  await a.page.evaluate(() => globalThis.document.querySelector('.hall-panel')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await a.page.screenshot({ path: path.join(OUT, `${tag}-1-lobby-hall-list.png`) });
  result.before = await hall(a);
  // A: 最快匹配 2人 → joins B's room
  await a.page.select('.hall-pref select', '2');
  await a.click('.hall-quick');
  const ra = (await a.waitFor((s) => !!s.room?.code, 'A room')).room;
  result.joinedB = ra.code === rb.code;
  await sleep(1500);
  await a.page.screenshot({ path: path.join(OUT, `${tag}-2-quick-match-joined.png`) });
  result.problems = [...a.problems, ...b.problems, ...c.problems].filter((x) => !/media|favicon/.test(x)).slice(0, 10);
  console.log(JSON.stringify(result));
} catch (e) {
  console.error('FAILED', e.message);
  for (const cl of [a, b, c]) await cl.page?.screenshot({ path: path.join(OUT, `${tag}-fail-${cl.label}.png`) }).catch(() => {});
} finally {
  for (const cl of [a, b, c]) await cl.close().catch(() => {});
  await srv.stop?.();
  process.exit(0);
}
