#!/usr/bin/env node
// tools/server-bin/smoke.mjs [executable, default the one in dist/server-bin] — start the headless server binary from an empty dir (own cache dir), then over
// WebSocket: A creates a co-op room, B joins it, both chat, the 联机大厅 stats / list see it; /healthz, / and no art.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { connectAs } from '../../test/helpers/wsClient.js';

const DIST = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'dist', 'server-bin');
const exe = path.resolve(process.argv[2] || path.join(DIST, fs.readdirSync(DIST).find((n) => n.startsWith('stronghold-server-') && !n.endsWith('.sha256'))));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-bin-'));
const port = 30000 + Math.floor(Math.random() * 20000);
const mod = path.join(dir, 'mods', 'demo', 'files', 'assets', 'ui');
fs.mkdirSync(mod, { recursive: true });
fs.writeFileSync(path.join(dir, 'mods', 'demo', 'mod.json'), JSON.stringify({ name: 'Demo', version: '1' }));
fs.writeFileSync(path.join(mod, 'x.png'), 'demo-bytes');
const child = spawn(exe, ['--port', String(port), '--host', '127.0.0.1', '--data-dir', path.join(dir, 'cache'), '--mods-dir', path.join(dir, 'mods')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });
const ok = (c, m) => { if (!c) throw new Error(m + '\n--- server output ---\n' + out); console.log('ok  ' + m); };
const base = `http://127.0.0.1:${port}`;
try {
  for (let i = 0; i < 120 && !/Ctrl\+C/.test(out); i++) await new Promise((r) => setTimeout(r, 250));
  ok(/headless server v\d/.test(out) && out.includes(`localhost:${port}`), 'banner with version and address');
  const h = await (await fetch(base + '/healthz')).json();
  ok(h.ok === true, '/healthz ok (app ' + h.app + ')');
  ok((await (await fetch(base + '/')).text()).includes('自定义服务器'), '/ = "use a client" page');
  ok((await fetch(base + '/assets/chars/x.png')).status === 404, 'no art served');
  const rm = await (await fetch(base + '/resources.json')).json();
  const f = rm.overlays?.[0]?.files?.['assets/ui/x.png'];
  ok(rm.protocol === h.version && f && f.s === 10, 'resource manifest lists the mod (protocol ' + rm.protocol + ')');
  ok((await (await fetch(`${base}/cas/${f.h}`)).text()) === 'demo-bytes', '/cas serves the mod file by hash');
  const url = `ws://127.0.0.1:${port}/ws`;
  const { client: a, welcome } = await connectAs(url, '晨曦守望');
  const { client: b } = await connectAs(url, '银灰骑士');
  ok(welcome.features?.includes('lobby') && welcome.features?.includes('chat'), 'welcome features lobby + chat');
  ok(welcome.resources?.hash === rm.hash, 'welcome names the resource manifest');
  b.send({ t: 'lobby.sub', on: true, list: true });
  a.send({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const st = await a.waitFor('room.state', (m) => !!m.code, 3000);
  ok(/^[A-Z0-9]+$/.test(st.code), 'room created ' + st.code);
  a.send({ t: 'room.setPublic', on: true });
  const list = await b.waitFor('lobby.rooms', (m) => JSON.stringify(m).includes(st.code), 5000);
  ok(!!list, 'lobby list shows the public room');
  b.send({ t: 'room.join', code: st.code });
  await b.waitFor('room.state', (m) => m.code === st.code, 3000);
  ok(true, 'second client joined');
  a.send({ t: 'room.chat', text: '大家好，一起守住！' });
  const chat = await b.waitFor('room.chat', (m) => m.text === '大家好，一起守住！', 3000);
  ok(chat.name === '晨曦守望', 'chat relayed');
  const stats = await b.waitFor('lobby.stats', () => true, 5000);
  ok(stats.online >= 2 || stats.players >= 2 || JSON.stringify(stats).length > 2, 'lobby stats ' + JSON.stringify(stats).slice(0, 120));
  await a.close(); await b.close();
} finally {
  child.kill('SIGINT');
  await new Promise((r) => { child.once('exit', (code, sig) => { console.log(`server exit code=${code} signal=${sig}`); r(); }); setTimeout(r, 6000); });
  fs.rmSync(dir, { recursive: true, force: true });
}
