// server/resources.js — this server's resource manifest (shared/resources.js): the mod overlay packs of `modsDir`
// (mods/<id>/mod.json { id, name, version } + mods/<id>/files/assets/**), each file hashed (sha256), served at
// GET /resources.json and by content at GET /cas/<sha256>. Generated automatically: the folder is re-scanned when a
// request comes at least 5 s after the last scan and the files' sizes / mtimes changed (rehashing only changed files).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PROTOCOL_VERSION, APP_VERSION } from '../shared/constants.js';
import { RES_VERSION, canonicalManifest, isOverlayPath, HASH_RE } from '../shared/resources.js';

const RESCAN_MS = 5000;
const MAX_FILE = 64 << 20;

function walk(dir, rel, out) {
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (d.name.startsWith('.')) continue;
    const full = path.join(dir, d.name);
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) walk(full, r, out);
    else if (d.isFile()) out.push([r, full]);
  }
  return out;
}

/** @param {{ modsDir: string|null, log?: object }} o */
export function createResources({ modsDir, log = console }) {
  const hashCache = new Map(); // abs → { size, mtime, h }
  let manifest = null;
  let byHash = new Map();
  let signature = '';
  let scannedAt = 0;

  function hashOf(abs, st) {
    const c = hashCache.get(abs);
    if (c && c.size === st.size && c.mtime === st.mtimeMs) return c.h;
    const h = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
    hashCache.set(abs, { size: st.size, mtime: st.mtimeMs, h });
    return h;
  }

  function scan() {
    const overlays = [];
    const files = new Map();
    for (const id of ids()) {
      const dir = path.join(modsDir, id);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8')); } catch { continue; }
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(id) || (meta.id && meta.id !== id)) { log.warn?.(`[resources] skipped mod ${id}: bad id`); continue; }
      const o = { id, name: String(meta.name || id).slice(0, 80), version: String(meta.version || '').slice(0, 40), files: {} };
      for (const [rel, abs] of walk(path.join(dir, 'files'), '', [])) {
        if (!isOverlayPath(rel)) continue;
        const st = fs.statSync(abs);
        if (st.size > MAX_FILE) continue;
        const h = hashOf(abs, st);
        o.files[rel] = { h, s: st.size };
        files.set(h, abs);
      }
      overlays.push(o);
    }
    const m = { v: RES_VERSION, protocol: PROTOCOL_VERSION, app: APP_VERSION, overlays };
    m.hash = createHash('sha256').update(canonicalManifest(m)).digest('hex');
    manifest = m;
    byHash = files;
    if (overlays.length) log.info?.(`[resources] ${overlays.length} mod pack(s): ${overlays.map((o) => `${o.id} (${Object.keys(o.files).length} files)`).join(', ')}`);
  }

  const ids = () => { if (!modsDir) return []; try { return fs.readdirSync(modsDir).sort(); } catch { return []; } };
  function currentSig() {
    const sig = [];
    for (const id of ids()) for (const [, abs] of walk(path.join(modsDir, id), '', [])) { try { const st = fs.statSync(abs); sig.push(`${abs}\0${st.size}\0${st.mtimeMs}`); } catch { /* gone */ } }
    return sig.join('\n');
  }

  function fresh() {
    const now = Date.now();
    if (manifest && now - scannedAt < RESCAN_MS) return manifest;
    scannedAt = now;
    const sig = currentSig();
    if (!manifest || sig !== signature) { scan(); signature = sig; }
    return manifest;
  }

  return {
    manifest: fresh,
    /** welcome extra */
    info: () => ({ hash: fresh().hash, url: '/resources.json', protocol: PROTOCOL_VERSION }),
    /** @returns {string|null} the file of this sha256 */
    file: (h) => (HASH_RE.test(h) ? (fresh(), byHash.get(h) || null) : null),
  };
}
