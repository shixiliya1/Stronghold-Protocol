// Screenshots of the room chat (not a test file): two players in a co-op room chat; a solo match with the chat open.
//   node test/e2e/chat-shot.mjs [--base http://127.0.0.1:3000] [--out /workspace/chat-shots]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { Client, sleep, startRealServer } from './client.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', '/workspace/chat-shots'));
fs.mkdirSync(OUT, { recursive: true });
process.env.CHROME_PATH ||= '/usr/bin/google-chrome';
const srv = arg('base') ? { base: arg('base'), stop: async () => {} } : await startRealServer();
const a = new Client(puppeteer, srv.base, 'A', { w: 1280, h: 720 });
const b = new Client(puppeteer, srv.base, 'B', { w: 1280, h: 720 });
const say = async (c, text) => {
  if (!(await c.page.$('.chat__input'))) await c.click('.chat__btn');
  await c.page.waitForSelector('.chat__input');
  await c.page.click('.chat__input');
  await c.page.keyboard.type(text);
  await c.page.keyboard.press('Enter');
  await sleep(500);
};
try {
  await a.open();
  await a.enter('能天使');
  await a.click('.mode-card', '同盟模拟');
  await a.click('.create-box button', '创建同盟');
  const room = (await a.waitFor((s) => !!s.room?.code, 'room created')).room;
  await b.open(`?room=${room.code}`);
  await b.enter('德克萨斯');
  await b.waitFor((s) => s.room?.code === room.code, 'guest joined');
  await say(a, '大家好！今晚一起打绝境吗？');
  await say(b, '好啊 <b>不会被当成HTML</b> 😀');
  await say(a, 'what the fuck 傻逼');
  await sleep(800);
  console.log('B sees', JSON.stringify(await b.page.$$eval('.chat__line', (els) => els.map((e) => e.textContent))));
  await a.page.screenshot({ path: path.join(OUT, 'chat-room-open.png') });
  await b.page.screenshot({ path: path.join(OUT, 'chat-room-b.png') });
  // in the match
  await b.page.keyboard.press('Escape');
  await b.click('.room-bar__right button', '准备就绪');
  await sleep(500);
  await a.click('.room-bar__right button', '开始模拟', { timeout: 20000 });
  await a.waitFor((s) => !!s.phase, 'match', 30000);
  await sleep(4000);
  await say(b, '开打了，我守左路');
  await sleep(300);
  await a.page.screenshot({ path: path.join(OUT, 'chat-match-bubble.png') });
  await say(a, '收到 👍');
  await sleep(500);
  await a.page.screenshot({ path: path.join(OUT, 'chat-match-open.png') });
  // battle screen (solo PREP): the chat sits next to 交流
  const c = new Client(puppeteer, srv.base, 'C', { w: 1280, h: 720 });
  await c.open();
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
  await sleep(4000);
  await say(c, '这局先升人口');
  await c.page.keyboard.press('Escape');
  await sleep(400);
  await c.page.screenshot({ path: path.join(OUT, 'chat-battle-bubble.png') });
  await say(c, '能看到聊天记录和输入框');
  await c.page.screenshot({ path: path.join(OUT, 'chat-battle-open.png') });
  await c.close();
  console.log('problems', JSON.stringify([...a.problems, ...b.problems].filter((x) => !/media|favicon/.test(x)).slice(0, 10)));
} catch (e) {
  console.error('FAILED', e.message);
  await a.page?.screenshot({ path: path.join(OUT, 'fail-a.png') }).catch(() => {});
  await b.page?.screenshot({ path: path.join(OUT, 'fail-b.png') }).catch(() => {});
} finally {
  await a.close(); await b.close(); await srv.stop?.();
  process.exit(0);
}
