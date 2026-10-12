// shared/resources.js — the resource manifest a server publishes (GET /resources.json, server/resources.js) and the
// client-side rules (public/js/resources.js):
//
//   { v: 1, protocol, app, hash, overlays: [{ id, name, version, files: { 'assets/<path>': { h: sha256, s: bytes } } }] }
//
// * protocol / app: the server's wire protocol (shared/constants.js PROTOCOL_VERSION) and release; a client whose
//   protocol differs is told it cannot play there (compat()).
// * overlays: mod packs (mods/<id>/mod.json + mods/<id>/files/assets/…) laid over the client's own art, in order (a
//   later pack wins). Files are content-addressed: GET /cas/<sha256> serves any of them, and clients keep one cache
//   keyed by sha256 shared by every server — a file another server (or an earlier visit) already brought is not
//   downloaded again, and every download is verified against its hash.
// * hash: sha256 of canonicalManifest() — the welcome carries it (resources: { hash, url, protocol }) so a client
//   refetches the manifest only when it changed.

import { N_ } from './i18n.js';

export const RES_VERSION = 1;
export const HASH_RE = /^[0-9a-f]{64}$/;
/** Overlay paths: under assets/, plain segments only. */
export function isOverlayPath(rel) {
  return typeof rel === 'string' && rel.length <= 300 && /^assets\/[A-Za-z0-9_\-./]+$/.test(rel)
    && !rel.split('/').some((s) => s === '' || s === '.' || s === '..');
}

/** The string hashed into `hash` (stable: overlays in order, files sorted). */
export function canonicalManifest(m) {
  return JSON.stringify({
    v: RES_VERSION, protocol: m.protocol,
    overlays: (m.overlays || []).map((o) => ({ id: o.id, version: o.version || '', files: Object.keys(o.files || {}).sort().map((k) => [k, o.files[k].h, o.files[k].s]) })),
  });
}

/** Is this a well-formed manifest? @returns {string|null} the problem, or null */
export function checkManifest(m) {
  if (!m || typeof m !== 'object' || m.v !== RES_VERSION) return 'unknown manifest version';
  if (!Number.isInteger(m.protocol)) return 'no protocol';
  if (!Array.isArray(m.overlays)) return 'no overlays';
  for (const o of m.overlays) {
    if (!o || typeof o.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(o.id)) return 'bad overlay id';
    for (const [rel, f] of Object.entries(o.files || {})) {
      if (!isOverlayPath(rel)) return `bad path ${rel}`;
      if (!f || !HASH_RE.test(f.h) || !Number.isInteger(f.s) || f.s < 0) return `bad entry ${rel}`;
    }
  }
  return null;
}

/** rel → { h, s, pack } with later overlays winning. */
export function overlayMap(m) {
  const out = {};
  for (const o of (m && m.overlays) || []) for (const [rel, f] of Object.entries(o.files || {})) out[rel] = { h: f.h, s: f.s, pack: o.id };
  return out;
}

/** The distinct hashes of `map` not in `have` (a Set): what to download. */
export function missingHashes(map, have) {
  const need = new Map();
  for (const f of Object.values(map)) if (!have.has(f.h) && !need.has(f.h)) need.set(f.h, f.s);
  return [...need].map(([h, s]) => ({ h, s }));
}

/**
 * Can this client play with this server? The text is the client's to show: `t(text, params)` (shared/i18n.js).
 * @returns {{ ok: boolean, text: string, params?: object }}
 */
export function compat(m, local) {
  if (!m) return { ok: true, text: '' };
  if (m.protocol !== local.protocol) {
    return {
      ok: false,
      text: m.protocol > local.protocol ? N_('服务器的联机协议是 {server}，本客户端是 {client}：版本不兼容，请更新客户端（服务器版本 {app}）')
        : N_('服务器的联机协议是 {server}，本客户端是 {client}：版本不兼容，请更新服务器（服务器版本 {app}）'),
      params: { server: m.protocol, client: local.protocol, app: m.app || '?' },
    };
  }
  return { ok: true, text: '' };
}
