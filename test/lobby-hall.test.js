// test/lobby-hall.test.js — 联机大厅 (shared/hall.js, server/lobby.js hall*): capability flag, lobby.stats / lobby.rooms
// to subscribers only, room.setPublic, 最快匹配 (join the best open room of the size preference, else create one),
// room sizes, and that a client which never subscribes gets no lobby.* frame.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR, MAX_SEATS } from '../shared/constants.js';
import { validateC2S, S2C } from '../shared/protocol.js';
import { serverHasHall, pickRoom, HALL_SIZES } from '../shared/hall.js';

describe('shared/hall.js', () => {
  test('sizes, flag, pickRoom', () => {
    assert.deepEqual(HALL_SIZES, [0, ...Array.from({ length: MAX_SEATS - 1 }, (_, i) => i + 2)]);
    assert.equal(serverHasHall({ features: ['chat', 'lobby'] }), true);
    assert.equal(serverHasHall({ features: ['chat'] }), false);
    const rooms = [{ code: 'A', humans: 1, size: 4, createdAt: 1 }, { code: 'B', humans: 2, size: 4, createdAt: 2 }, { code: 'C', humans: 1, size: 2, createdAt: 0 }, { code: 'D', humans: 2, size: 2, createdAt: 0 }];
    assert.equal(pickRoom(rooms, 0).code, 'B');
    assert.equal(pickRoom(rooms, 2).code, 'C');
    assert.equal(pickRoom(rooms, 3), null);
  });
  test('protocol', () => {
    assert.ok(S2C.includes('lobby.stats') && S2C.includes('lobby.rooms'));
    assert.equal(validateC2S({ t: 'lobby.sub', on: true }), null);
    assert.equal(validateC2S({ t: 'lobby.quick', size: 2, difficulty: 'FUNNY' }), null);
    assert.notEqual(validateC2S({ t: 'lobby.quick', size: 7, difficulty: 'FUNNY' }), null);
    assert.equal(validateC2S({ t: 'room.setPublic', on: false }), null);
  });
});

describe('联机大厅 (server)', () => {
  let srv;
  const open = new Set();
  const player = async (name) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    open.add(c);
    const w = await c.hello(name);
    c.id = w.playerId; c.welcome = w;
    return c;
  };
  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
  const roomOf = (c) => c.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === c.id));
  before(async () => { srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, MatchClass: StubMatch }); });
  afterEach(async () => { await Promise.all([...open].map((c) => c.terminate().catch(() => {}))); open.clear(); });
  after(async () => { await srv?.close(); });

  test('stats + list to subscribers; quick match joins by preference or creates; old clients get nothing', async () => {
    const a = await player('甲');
    const old = await player('旧');
    assert.ok(serverHasHall(a.welcome));
    await ok(a, { t: 'lobby.sub', on: true, list: true });
    const s0 = await a.waitFor('lobby.stats');
    assert.equal(s0.online, 2);
    assert.equal(s0.joinable, 0);
    assert.deepEqual((await a.waitFor('lobby.rooms')).rooms, []);

    // a private room is counted, not listed; made public it is listed
    const h = await player('房主');
    await ok(h, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await roomOf(h);
    assert.equal(st.public, false);
    await ok(h, { t: 'room.setPublic', on: true });
    const listed = await a.waitFor('lobby.rooms', (m) => m.rooms.length === 1, 5000);
    assert.deepEqual(listed.rooms[0], { code: st.code, host: '房主', humans: 1, size: MAX_SEATS, difficulty: 'NORMAL' });
    const s1 = await a.waitFor('lobby.stats', (m) => m.joinable === 1, 5000);
    assert.equal(s1.rooms, 1);
    assert.equal(s1.online, 3);

    // quick match with size 2: no 2-player room → a new public 2-player room
    const b = await player('乙');
    await ok(b, { t: 'lobby.quick', size: 2, difficulty: 'HARD' });
    const sb = await roomOf(b);
    assert.notEqual(sb.code, st.code);
    assert.equal(sb.public, true);
    assert.equal(sb.size, 2);
    // quick match "any": the fullest-then-oldest open room
    const c = await player('丙');
    await ok(c, { t: 'lobby.quick', size: 0, difficulty: 'FUNNY' });
    assert.equal((await roomOf(c)).code, st.code);
    // size 2 → joins 乙's room, which is then full for a 3rd human
    const d = await player('丁');
    await ok(d, { t: 'lobby.quick', size: 2, difficulty: 'FUNNY' });
    assert.equal((await roomOf(d)).code, sb.code);
    const e = await player('戊');
    const r = await e.request({ t: 'room.join', code: sb.code });
    assert.equal(r.code, ERR.ROOM_FULL);
    // unsubscribed / never-subscribed clients
    await new Promise((res) => setTimeout(res, 2300));
    assert.ok(!old.log.some((m) => String(m.t).startsWith('lobby.')), 'no lobby.* to a client that never subscribed');
    await ok(a, { t: 'lobby.sub', on: false });
  });

  test('setPublic: host of a co-op room only', async () => {
    const a = await player('甲');
    await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    await roomOf(a);
    assert.equal((await a.request({ t: 'room.setPublic', on: true })).t, 'error');
    const b = await player('乙');
    assert.equal((await b.request({ t: 'room.setPublic', on: true })).code, ERR.NOT_IN_ROOM);
  });
});
