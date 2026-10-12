// 存储管理 + 跳过美术: electron/art.js storage helpers on a temp art dir, the shared panel's diff / size format
// (electron/ui/storage-ui.js), and the wiring on every platform (desktop IPC, Android plugin methods, web caches).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { artStorage, clearPartials, removeLeftovers, verifyArt, STATE_FILE } from '../electron/art.js';

const rd = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
  const files = { 'assets/a.png': Buffer.alloc(1000, 1), 'assets/b/c.mp3': Buffer.alloc(3000, 2) };
  const entries = Object.entries(files).map(([p, b]) => ({ p, s: b.length, h: sha(b), o: 0 }));
  const manifest = { tag: 'art-test', hash: 'h1', bytes: 4000, files: entries.length, entries };
  for (const [p, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), b); }
  fs.writeFileSync(path.join(dir, STATE_FILE), JSON.stringify({ hash: 'h1', tag: 'art-test' }));
  fs.writeFileSync(path.join(dir, 'assets/old.png'), Buffer.alloc(500));           // an older pack's file
  fs.writeFileSync(path.join(dir, 'assets/d.png.part'), Buffer.alloc(200));        // a download partial
  const migrate = path.join(dir, '..', path.basename(dir) + '-migrate');
  fs.mkdirSync(migrate, { recursive: true });
  fs.writeFileSync(path.join(migrate, 'x.png'), Buffer.alloc(50));
  return { dir, manifest, migrate };
}

test('artStorage: installed, partial and leftover bytes', async () => {
  const { dir, manifest, migrate } = fixture();
  const s = await artStorage(manifest, dir, { extraDirs: [migrate] });
  assert.deepEqual([s.artBytes, s.artFiles, s.partBytes, s.leftoverBytes, s.missing, s.ready], [4000, 2, 200, 550, 0, true]);
  assert.equal(await clearPartials(dir), 200);
  await removeLeftovers(manifest, dir, { extraDirs: [migrate] });
  const t = await artStorage(manifest, dir, { extraDirs: [migrate] });
  assert.deepEqual([t.artBytes, t.partBytes, t.leftoverBytes, t.ready], [4000, 0, 0, true]);
  assert.ok(fs.existsSync(path.join(dir, STATE_FILE)), 'the installed state survives');
});

test('verifyArt: a corrupted file (same size) is found, deleted and the state dropped (→ re-download)', async () => {
  const { dir, manifest } = fixture();
  assert.deepEqual((await verifyArt(manifest, dir)).bad, []);
  fs.writeFileSync(path.join(dir, 'assets/a.png'), Buffer.alloc(1000, 9));
  const r = await verifyArt(manifest, dir);
  assert.deepEqual(r.bad, ['assets/a.png']);
  assert.ok(!fs.existsSync(path.join(dir, 'assets/a.png')));
  assert.ok(!fs.existsSync(path.join(dir, STATE_FILE)));
  const s = await artStorage(manifest, dir);
  assert.equal(s.missing, 1);
  assert.equal(s.ready, false);
});

test('storage panel: before → after diff and sizes', () => {
  const ctx = vm.createContext({});
  vm.runInContext(rd('electron/ui/storage-ui.js'), ctx);
  const { diff, fmt } = ctx.SPStorage;
  const a = { rows: [{ id: 'art', label: '美术', bytes: 3 << 20 }, { id: 'cache', label: '缓存', bytes: 5 << 20 }, { id: 'p', label: '位置', text: 'x' }] };
  const b = { rows: [{ id: 'art', label: '美术', bytes: 3 << 20 }, { id: 'cache', label: '缓存', bytes: 0 }, { id: 'p', label: '位置', text: 'x' }] };
  assert.deepEqual(JSON.parse(JSON.stringify(diff(a, b))), [{ id: 'cache', label: '缓存', before: 5 << 20, after: 0 }]);
  assert.equal(fmt(5 << 20), '5.0 MB');
  assert.equal(fmt(3 * 1073741824), '3.00 GB');
});

test('wiring: picker button, desktop IPC, Android plugin, web caches, skip buttons', () => {
  assert.match(rd('electron/ui/chooser.html'), /id="storage"[^>]*>存储管理/);
  assert.match(rd('electron/ui/chooser.html'), /storage-ui\.js[\s\S]*chooser\.js/);
  assert.match(rd('electron/ui/chooser.js'), /SPStorage\.open\(api\)/);
  for (const k of ['art-skip', 'storage-info', 'storage-action']) {
    assert.match(rd('electron/main.js'), new RegExp(`desktop:${k}`));
    assert.match(rd('electron/preload.cjs'), new RegExp(`desktop:${k}`));
  }
  for (const a of ['clear-cache', 'remove-leftover', 'verify', 'redownload', 'delete-art']) assert.match(rd('electron/main.js'), new RegExp(`'${a}'`));
  assert.match(rd('electron/ui/art.html'), /id="skip"[^>]*>跳过，先进入游戏/);
  const plugin = rd('mobile/android/app/src/main/java/io/github/shixiliya1/stronghold/ArtPackPlugin.java');
  for (const m of ['storage', 'clearCache', 'removeLeftover', 'deleteArt', 'verify']) assert.match(plugin, new RegExp(`@PluginMethod\\s+public void ${m}\\(`));
  const st = rd('mobile/src/client/storage.js');
  for (const m of ['storage', 'clearCache', 'removeLeftover', 'deleteArt', 'verify']) assert.match(st, new RegExp(`plugin\\.${m}\\(`));
  assert.match(st, /navigator\.storage|st\.estimate/);
  assert.match(st, /persist\(\)/);
  assert.match(rd('mobile/src/client/art-ui.js'), /跳过，先进入游戏/);
  const b = rd('mobile/scripts/build-www.mjs');
  assert.match(b, /storage-ui\.js/);
  assert.match(b, /web-api\.js"><\/script>\\n<script src="storage\.js"><\/script>\\n<script src="chooser\.js"/);
});
