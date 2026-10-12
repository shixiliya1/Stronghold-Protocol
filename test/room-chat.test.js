// test/room-chat.test.js — room text chat (shared/chat.js, server/lobby.js chat): cleaning, the profanity filter, the
// capability flag in `welcome`, relay to the room only (seats + spectators), the per-player rate limit, refusals.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';
import { validateC2S, S2C } from '../shared/protocol.js';
import { cleanChat, filterProfanity, serverHasChat, chatAllowed, CHAT_MAX_LEN, CHAT_RATE } from '../shared/chat.js';

describe('shared/chat.js', () => {
  test('control / format characters go, whitespace collapses, length is capped in code points', () => {
    assert.equal(cleanChat('  hi\u0000\u0007 \u202Ethere\u200B\n\nyou\t '), 'hi there you');
    assert.equal(cleanChat('\u0001\u2028  '), '');
    assert.equal(cleanChat(42), '');
    const long = '😀'.repeat(150);
    assert.equal([...cleanChat(long)].length, CHAT_MAX_LEN);
    assert.equal(cleanChat('a'.repeat(1000)).length, CHAT_MAX_LEN);
  });
  test('markup stays plain text (the client renders text nodes)', () => {
    assert.equal(cleanChat('<img src=x onerror=alert(1)>'), '<img src=x onerror=alert(1)>');
  });
  test('profanity filter masks listed words only', () => {
    assert.equal(filterProfanity('你个傻逼'), '你个＊＊');
    assert.equal(filterProfanity('what the FUCK man'), 'what the ＊＊＊＊ man');
    assert.equal(filterProfanity('Dickens and shitake? no: scunthorpe'), 'Dickens and shitake? no: scunthorpe');
    assert.equal(cleanChat('fuck'), '＊＊＊＊');
  });
  test('rate limiter: 3 per 5 s sliding window', () => {
    const times = [];
    assert.ok(chatAllowed(times, 0) && chatAllowed(times, 100) && chatAllowed(times, 200));
    assert.equal(chatAllowed(times, 300), false);
    assert.ok(chatAllowed(times, CHAT_RATE.windowMs + 1));
  });
  test('capability flag', () => {
    assert.equal(serverHasChat({ t: 'welcome', features: ['chat'] }), true);
    assert.equal(serverHasChat({ t: 'welcome' }), false);
    assert.equal(serverHasChat(null), false);
  });
  test('protocol: room.chat is a C2S and S2C type', () => {
    assert.ok(S2C.includes('room.chat'));
    assert.equal(validateC2S({ t: 'room.chat', text: 'hi' }), null);
    assert.notEqual(validateC2S({ t: 'room.chat', text: 5 }), null);
  });
});

function pool(getUrl) {
  const open = new Set();
  return {
    async player(name) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
      const w = await c.hello(name);
      c.id = w.playerId;
      c.welcome = w;
      return c;
    },
    async closeAll() { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); },
  };
}
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };

describe('room.chat (server)', () => {
  let srv;
  let p;
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch });
    p = pool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { await p.closeAll(); });
  after(async () => { await srv?.close(); });

  test('welcome advertises chat; relayed cleaned to the room only', async () => {
    const a = await p.player('甲');
    const b = await p.player('乙');
    const outsider = await p.player('丙');
    assert.ok(serverHasChat(a.welcome), 'welcome.features has chat');
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await a.waitFor('room.state', (s) => s.hostId === a.id);
    await ok(b, { t: 'room.join', code: st.code });
    await b.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === b.id));
    await ok(a, { t: 'room.chat', text: ' 你好\u0000 <b>傻逼</b> ' });
    const got = await b.waitFor('room.chat', (m) => m.playerId === a.id);
    assert.equal(got.text, '你好 <b>＊＊</b>');
    assert.equal(got.name, '甲');
    const echo = await a.waitFor('room.chat', (m) => m.playerId === a.id);
    assert.equal(echo.text, got.text);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!outsider.log.some((m) => m.t === 'room.chat'), 'not relayed outside the room');
    await err(outsider, { t: 'room.chat', text: 'hi' }, ERR.NOT_IN_ROOM);
    await err(a, { t: 'room.chat', text: ' \u200B ' }, ERR.BAD_MSG);
    await err(a, { t: 'room.chat', text: 'x'.repeat(401) }, ERR.BAD_MSG);
  });

  test('rate limit: the 4th message within 5 s is refused', async () => {
    const a = await p.player('丁');
    await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    await a.waitFor('room.state', (s) => s.hostId === a.id);
    for (let i = 0; i < CHAT_RATE.count; i++) await ok(a, { t: 'room.chat', text: `m${i}` });
    await err(a, { t: 'room.chat', text: 'too fast' }, ERR.RATE);
  });
});
