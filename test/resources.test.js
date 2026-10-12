// Resource manifest (shared/resources.js, server/resources.js, public/js/resources.js, electron/cas.js): the server
// generates a per-file sha256 manifest of its mod overlay packs and names it in the welcome; clients fetch only the
// files their shared content-addressed cache lacks, verify them, and refuse an incompatible protocol.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { startServer } from '../server/index.js';
import { connectAs } from './helpers/wsClient.js';
import { checkManifest, canonicalManifest, overlayMap, missingHashes, compat, isOverlayPath } from '../shared/resources.js';
import { PROTOCOL_VERSION } from '../shared/constants.js';
import { createCas } from '../electron/cas.js';

const mem = new Map();
globalThis.localStorage ??= { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { syncResources, httpBaseOf } = await import('../public/js/resources.js');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PNG_A = Buffer.from('mod-a-image-bytes');
const PNG_B = Buffer.from('mod-b-shared-bytes');

function modsFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mods-'));
  const put = (id, rel, b) => { const f = path.join(dir, id, 'files', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); };
  fs.mkdirSync(path.join(dir, 'skin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'skin', 'mod.json'), JSON.stringify({ id: 'skin', name: '新皮肤', version: '1.0' }));
  put('skin', 'assets/chars/a.png', PNG_A);
  put('skin', 'assets/chars/b.png', PNG_B);
  put('skin', 'notassets/x.txt', Buffer.from('ignored'));
  return dir;
}

let srv;
let srv2;
before(async () => {
  srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, modsDir: modsFixture() });
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-mods2-'));
  fs.mkdirSync(path.join(d2, 'other', 'files', 'assets', 'ui'), { recursive: true });
  fs.writeFileSync(path.join(d2, 'other', 'mod.json'), JSON.stringify({ name: '别的服' }));
  fs.writeFileSync(path.join(d2, 'other', 'files', 'assets', 'ui', 'same.png'), PNG_B); // same bytes as skin's b.png
  srv2 = await startServer({ port: 0, host: '127.0.0.1', quiet: true, modsDir: d2 });
});
after(async () => { await srv?.close(); await srv2?.close(); });

test('shared rules: paths, manifest check, overlay order, missing hashes, protocol compat', () => {
  assert.ok(isOverlayPath('assets/a/b.png'));
  for (const bad of ['assets/../x', '/assets/a', 'data/x.json', 'assets//a', 'assets/a b.png']) assert.ok(!isOverlayPath(bad), bad);
  const h = 'a'.repeat(64), g = 'b'.repeat(64);
  const m = { v: 1, protocol: 1, overlays: [{ id: 'one', files: { 'assets/x.png': { h, s: 1 } } }, { id: 'two', files: { 'assets/x.png': { h: g, s: 2 }, 'assets/y.png': { h, s: 1 } } }] };
  assert.equal(checkManifest(m), null);
  assert.equal(checkManifest({ ...m, overlays: [{ id: 'x', files: { '../x': { h, s: 1 } } }] }), 'bad path ../x');
  assert.deepEqual(overlayMap(m)['assets/x.png'], { h: g, s: 2, pack: 'two' });
  assert.deepEqual(missingHashes(overlayMap(m), new Set([h])), [{ h: g, s: 2 }]);
  assert.equal(compat(m, { protocol: 1 }).ok, true);
  assert.equal(compat({ ...m, protocol: 2 }, { protocol: 1 }).ok, false);
  assert.equal(httpBaseOf('wss://h.example/ws'), 'https://h.example');
});

test('server: /resources.json (auto-generated, per-file sha256), welcome names it, /cas/<sha256> serves it', async () => {
  const m = await (await fetch(srv.url + '/resources.json')).json();
  assert.equal(m.protocol, PROTOCOL_VERSION);
  assert.equal(checkManifest(m), null);
  assert.equal(m.hash, sha(canonicalManifest(m)));
  assert.deepEqual(Object.keys(m.overlays[0].files).sort(), ['assets/chars/a.png', 'assets/chars/b.png']);
  assert.equal(m.overlays[0].files['assets/chars/a.png'].h, sha(PNG_A));
  const res = await fetch(`${srv.url}/cas/${sha(PNG_A)}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), PNG_A);
  assert.equal((await fetch(`${srv.url}/cas/${'0'.repeat(64)}`)).status, 404);
  assert.equal((await fetch(`${srv.url}/cas/../package.json`)).status, 404);
  const { client, welcome } = await connectAs(srv.url.replace('http', 'ws') + '/ws', 'res');
  assert.deepEqual(welcome.resources, { hash: m.hash, url: '/resources.json', protocol: PROTOCOL_VERSION });
  await client.close();
});

function memStore() {
  const files = new Map();
  return { files, active: null, list: async () => [...files.keys()], put: async (h, u8) => { files.set(h, Buffer.from(u8)); }, activate: async (map) => { memStore.last = map; }, usage: null };
}

test('client: downloads only what the shared cache lacks (across servers), verifies, activates the overlay', async () => {
  const store = memStore();
  const ws1 = srv.url.replace('http', 'ws') + '/ws';
  const ws2 = srv2.url.replace('http', 'ws') + '/ws';
  const w1 = { resources: { hash: (await (await fetch(srv.url + '/resources.json')).json()).hash, url: '/resources.json', protocol: PROTOCOL_VERSION } };
  const r1 = await syncResources(w1, ws1, { store });
  assert.equal(r1.status, 'ok');
  assert.equal(r1.fetched, 2);
  assert.deepEqual(memStore.last, { 'assets/chars/a.png': sha(PNG_A), 'assets/chars/b.png': sha(PNG_B) });
  const again = await syncResources(w1, ws1, { store });
  assert.equal(again.fetched, 0, 'nothing new the second time');
  const w2 = { resources: { hash: (await (await fetch(srv2.url + '/resources.json')).json()).hash, protocol: PROTOCOL_VERSION } };
  const r2 = await syncResources(w2, ws2, { store });
  assert.equal(r2.fetched, 0, 'the other server\'s identical file comes from the shared cache');
  assert.deepEqual(memStore.last, { 'assets/ui/same.png': sha(PNG_B) });
  const usage = JSON.parse(localStorage.getItem('sp.res.usage'));
  assert.equal(usage[srv.url].packs[0].name, '新皮肤');
  assert.equal(usage[srv2.url].packs[0].id, 'other');
});

test('client: a tampered file is rejected; an incompatible protocol is reported, not synced', async () => {
  const store = memStore();
  const ws1 = srv.url.replace('http', 'ws') + '/ws';
  const m = await (await fetch(srv.url + '/resources.json')).json();
  const notes = [];
  const tamper = async (u, o) => { const r = await fetch(u, o); if (!u.includes('/cas/')) return r; return new Response(Buffer.from('evil')); };
  const r = await syncResources({ resources: { hash: m.hash, protocol: PROTOCOL_VERSION } }, ws1, { store, fetchImpl: tamper, notify: (t) => notes.push(t) });
  assert.equal(r.fetched, 0);
  assert.equal(store.files.size, 0);
  assert.ok(notes.some((t) => t.includes('校验失败')));
  const r2 = await syncResources({ resources: { hash: m.hash, protocol: PROTOCOL_VERSION + 1 } }, ws1, { store, notify: (t) => notes.push(t) });
  assert.equal(r2.status, 'incompatible');
  assert.ok(notes.at(-1).includes('不兼容'));
});

test('desktop cache (electron/cas.js): sha256-checked put, overlay lookup, verify, clear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-cas-'));
  const cas = createCas(dir);
  assert.throws(() => cas.put(sha(PNG_A), PNG_B), /mismatch/);
  cas.put(sha(PNG_A), PNG_A);
  assert.equal(cas.activate({ 'assets/x.png': sha(PNG_A), 'assets/missing.png': sha(PNG_B), '../evil': sha(PNG_A) }), 1);
  assert.equal(cas.fileFor('/assets/x.png'), path.join(dir, sha(PNG_A)));
  assert.equal(createCas(dir).fileFor('/assets/x.png'), path.join(dir, sha(PNG_A)), 'the overlay survives a restart');
  fs.writeFileSync(path.join(dir, sha(PNG_A)), 'rot');
  assert.deepEqual(cas.verify(), [sha(PNG_A)]);
  cas.put(sha(PNG_B), PNG_B);
  assert.equal(cas.clear(), PNG_B.length);
  assert.deepEqual(cas.list(), []);
});
