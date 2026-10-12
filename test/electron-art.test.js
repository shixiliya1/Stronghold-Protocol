// The desktop art pack: .github/scripts/art-pack.py builds it, electron/art.js installs it (Range spans, reuse of
// matching / legacy files, sha256 verification, mirror fallback, resume). Runs against a local HTTP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureArt, artReady, planSpans, packUrls } from '../electron/art.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PY = ['python3', 'python'].find((p) => spawnSync(p, ['--version']).status === 0);

function makePack() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-src-'));
  const files = {};
  for (let i = 0; i < 40; i++) files[`public/assets/u/${String(i).padStart(2, '0')}.png`] = Buffer.alloc(1000 + i * 3001, i);
  files['public/assets/empty.txt'] = Buffer.alloc(0);
  files['public/assets/big.bin'] = Buffer.alloc(600 * 1024, 7);
  files['data/local-assets.json'] = Buffer.from('{"ok":true}');
  for (const [p, b] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(src, p)), { recursive: true }); fs.writeFileSync(path.join(src, p), b); }
  const out = path.join(src, 'out');
  const r = spawnSync(PY, [path.join(ROOT, '.github/scripts/art-pack.py'), '--root', src, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'art-manifest.json'), 'utf8'));
  return { src, out, manifest, zip: fs.readFileSync(path.join(out, manifest.zip)) };
}

function serve(zip, { failFirst = 0, ignoreRange = false } = {}) {
  let n = 0;
  const log = [];
  const srv = http.createServer((req, res) => {
    log.push(req.headers.range || 'full');
    if (n++ < failFirst) { res.writeHead(503); res.end(); return; }
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    if (!m || ignoreRange) { res.writeHead(200, { 'Content-Length': zip.length }); res.end(zip); return; }
    const a = Number(m[1]); const b = Number(m[2]);
    res.writeHead(206, { 'Content-Range': `bytes ${a}-${b}/${zip.length}` });
    res.end(zip.subarray(a, b + 1));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, log, url: `http://127.0.0.1:${srv.address().port}/z.zip` })));
}

const check = (manifest, dir, src) => {
  for (const e of manifest.entries) {
    const from = e.p.startsWith('assets/') ? path.join(src, 'public', e.p) : path.join(src, e.p);
    assert.deepEqual(fs.readFileSync(path.join(dir, e.p)), fs.readFileSync(from), e.p);
  }
};

test('art-pack: stored, deterministic, offsets point at the file data', { skip: !PY }, () => {
  const a = makePack();
  const r = spawnSync(PY, [path.join(ROOT, '.github/scripts/art-pack.py'), '--root', a.src, '--out', path.join(a.src, 'out2')], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const b = JSON.parse(fs.readFileSync(path.join(a.src, 'out2', 'art-manifest.json'), 'utf8'));
  assert.equal(b.hash, a.manifest.hash);
  assert.equal(b.zipSha256, a.manifest.zipSha256);
  for (const e of a.manifest.entries) assert.equal(a.zip.subarray(e.o, e.o + e.s).length, e.s);
  assert.ok(a.manifest.entries.some((e) => e.p === 'data/local-assets.json'));
  assert.ok(a.manifest.zip.startsWith('Stronghold-Protocol-Art-'));
});

test('planSpans merges neighbours, splits large', () => {
  const s = planSpans([{ o: 0, s: 10 }, { o: 50, s: 10 }, { o: 10_000_000, s: 5 }], { gap: 100, max: 1000 });
  assert.equal(s.length, 2);
  assert.equal(s[0].entries.length, 2);
  assert.deepEqual(packUrls({ base: 'https://x/releases/download/', tag: 't', zip: 'z.zip' }, { mirrors: ['', 'https://m/'] }), ['https://x/releases/download/t/z.zip', 'https://m/https://x/releases/download/t/z.zip']);
});

test('ensureArt: first install, then ready; mirror fallback; legacy reuse; repair', { skip: !PY }, async () => {
  const { src, manifest, zip } = makePack();
  const bad = await serve(zip, { failFirst: 1000 });
  const good = await serve(zip);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
    const seen = [];
    const r = await ensureArt({ manifest, artDir: dir, urls: [bad.url, good.url], retries: 2, retryDelay: 1, onProgress: (p) => seen.push(p.phase) });
    assert.equal(r.status, 'installed');
    assert.equal(r.fetched, manifest.entries.length);
    check(manifest, dir, src);
    assert.ok(seen.includes('download') && seen.at(-1) === 'done');
    assert.ok(await artReady(manifest, dir));
    const again = await ensureArt({ manifest, artDir: dir, urls: [good.url] });
    assert.equal(again.status, 'ready');

    // a damaged file and a stray one: only the damaged file is fetched again, the stray one is removed
    fs.writeFileSync(path.join(dir, 'assets/u/03.png'), 'broken');
    fs.writeFileSync(path.join(dir, 'assets/u/stale.png'), 'old');
    good.log.length = 0;
    const fix = await ensureArt({ manifest, artDir: dir, urls: [good.url] });
    assert.equal(fix.fetched, 1);
    assert.equal(good.log.length, 1);
    assert.ok(!fs.existsSync(path.join(dir, 'assets/u/stale.png')));
    check(manifest, dir, src);

    // legacy art (desktop.3's bundled public/): everything matching is migrated, nothing downloaded
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
    const legacy = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-legacy-'));
    fs.cpSync(path.join(src, 'public', 'assets'), path.join(legacy, 'assets'), { recursive: true });
    fs.cpSync(path.join(src, 'data'), path.join(legacy, 'data'), { recursive: true });
    fs.writeFileSync(path.join(legacy, 'assets/u/05.png'), 'changed in the new pack');
    good.log.length = 0;
    const mig = await ensureArt({ manifest, artDir: dir2, legacyDirs: [legacy], moveLegacy: true, urls: [good.url] });
    assert.equal(mig.fetched, 1);
    assert.equal(good.log.length, 1);
    check(manifest, dir2, src);
  } finally { bad.srv.close(); good.srv.close(); }
});

test('ensureArt: a server ignoring Range still works; a corrupt pack is refused', { skip: !PY }, async () => {
  const { src, manifest, zip } = makePack();
  const plain = await serve(zip, { ignoreRange: true });
  const evil = Buffer.from(zip); evil[manifest.entries[2].o] ^= 0xff;
  const corrupt = await serve(evil);
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
    await ensureArt({ manifest, artDir: dir, urls: [plain.url] });
    check(manifest, dir, src);
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-art-'));
    await assert.rejects(ensureArt({ manifest, artDir: dir2, urls: [corrupt.url], retries: 1, retryDelay: 1 }), /sha256 mismatch/);
    assert.ok(!(await artReady(manifest, dir2)));
    assert.ok(!fs.existsSync(path.join(dir2, manifest.entries[2].p)));
  } finally { plain.srv.close(); corrupt.srv.close(); }
});
