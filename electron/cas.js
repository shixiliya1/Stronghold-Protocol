// electron/cas.js — the desktop app's content-addressed resource cache (shared/resources.js): userData/cas/<sha256>,
// one copy per file whatever server brought it, every file verified on the way in; overlay.json = the active
// server's mod overlay (rel → sha256), applied by protocol.js to app://game/assets/… requests.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const HASH_RE = /^[0-9a-f]{64}$/;
const isRel = (rel) => typeof rel === 'string' && /^assets\/[A-Za-z0-9_\-./]+$/.test(rel) && !rel.split('/').some((s) => s === '' || s === '.' || s === '..');

export function createCas(dir) {
  const mapFile = path.join(dir, 'overlay.json');
  let map = {};
  try { map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) || {}; } catch { map = {}; }
  const file = (h) => path.join(dir, h);
  return {
    dir,
    list() { try { return fs.readdirSync(dir).filter((n) => HASH_RE.test(n)); } catch { return []; } },
    /** Store bytes under their sha256 (rejects a mismatch). */
    put(h, bytes) {
      const b = Buffer.from(bytes);
      if (!HASH_RE.test(h) || createHash('sha256').update(b).digest('hex') !== h) throw new Error('sha256 mismatch');
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${file(h)}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, b);
      fs.renameSync(tmp, file(h));
      return b.length;
    },
    /** The overlay of the server just joined: { rel: sha256 } (files must already be stored). */
    activate(next) {
      const m = {};
      for (const [rel, h] of Object.entries(next || {})) if (isRel(rel) && HASH_RE.test(h) && fs.existsSync(file(h))) m[rel] = h;
      map = m;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(mapFile, JSON.stringify(m));
      return Object.keys(m).length;
    },
    /** The overlay file for an app:// path (/assets/…), or null. */
    fileFor(pathname) {
      const rel = String(pathname || '').replace(/^\/+/, '');
      const h = map[rel];
      return h ? file(h) : null;
    },
    size() {
      let bytes = 0, files = 0;
      for (const h of this.list()) { try { bytes += fs.statSync(file(h)).size; files++; } catch { /* gone */ } }
      return { bytes, files };
    },
    /** Verify every stored file; bad ones are deleted. */
    verify() {
      const bad = [];
      for (const h of this.list()) {
        try { if (createHash('sha256').update(fs.readFileSync(file(h))).digest('hex') !== h) { bad.push(h); fs.rmSync(file(h), { force: true }); } } catch { /* gone */ }
      }
      return bad;
    },
    clear() { const s = this.size(); fs.rmSync(dir, { recursive: true, force: true }); map = {}; return s.bytes; },
  };
}
