// server/http/static.js artDir: the desktop / Android art directory overlays /assets/… and /data/local-assets.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createStaticHandler } from '../server/http/static.js';

test('static artDir overlays /assets and the local-art manifest, falls back to public', async () => {
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-static-art-'));
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(t, p)), { recursive: true }); fs.writeFileSync(path.join(t, p), s); };
  w('public/index.html', '<p>hi');
  w('public/assets/only-public.txt', 'public');
  w('art/assets/x.txt', 'from-art');
  w('art/data/local-assets.json', '{"art":1}');
  w('data/index.json', '{}');
  const h = createStaticHandler({ publicDir: path.join(t, 'public'), dataDir: path.join(t, 'data'), sharedDir: path.join(t, 'public'), artDir: path.join(t, 'art') });
  const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); h(req, res, u.pathname, u.searchParams); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const get = async (u) => { const r = await fetch(base + u); return [r.status, await r.text()]; };
    assert.deepEqual(await get('/assets/x.txt'), [200, 'from-art']);
    assert.deepEqual(await get('/assets/only-public.txt'), [200, 'public']);
    assert.deepEqual(await get('/data/local-assets.json'), [200, '{"art":1}']);
    assert.equal((await get('/assets/../../art/assets/x.txt'))[0] !== 500, true);
    assert.equal((await get('/index.html'))[0], 200);
  } finally { srv.close(); }
});
