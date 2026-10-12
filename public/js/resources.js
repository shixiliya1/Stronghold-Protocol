// public/js/resources.js — the client side of the resource manifest (shared/resources.js). On every welcome that
// names one, fetch the server's /resources.json (only when its hash changed), check it (format, sha256, protocol:
// an incompatible server gets a clear prompt), download the overlay files this client does not have yet from
// /cas/<sha256> — verified against the hash — into the content-addressed cache shared by every server, then make
// that server's overlay the active one:
//   desktop app  window.spDesktop.cas* → userData/cas (electron/cas.js; app:// serves the overlay)
//   Android      ArtPack plugin cas*   → filesDir/cas (ArtWebViewClient serves the overlay)
//   web (PWA)    Cache Storage 'sp-cas-v1' + the service worker (mobile/src/sw.js serves the overlay)
// Which server uses which packs is recorded for the 存储管理 page (localStorage sp.res.usage / desktop res-usage.json).
import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { t } from '../../shared/i18n.js';
import { checkManifest, canonicalManifest, overlayMap, missingHashes, compat, HASH_RE } from '../../shared/resources.js';

const CAS_CACHE = 'sp-cas-v1';
const CAS_KEY = (h) => `https://cas.invalid/${h}`;
const USAGE_KEY = 'sp.res.usage';
const MANIFEST_KEY = 'sp.res.manifest.';

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };

/** The cache backend of this platform, or null (a plain browser tab on a server: overlays not applied). */
export function pickStore(g = globalThis) {
  const d = g.spDesktop;
  if (d && d.casList) {
    return { kind: 'desktop', list: () => d.casList(), put: (h, u8) => d.casPut(h, u8), activate: (map) => d.casActivate(map), usage: (u) => d.resUsage(u) };
  }
  const p = g.SP_ARTPACK;
  if (p && p.casList) {
    return { kind: 'android', list: async () => (await p.casList()).hashes || [], put: (h, u8) => p.casPut({ hash: h, data: b64(u8) }), activate: (map) => p.casActivate({ map }), usage: null };
  }
  if (g.caches && g.navigator && g.navigator.serviceWorker && g.navigator.serviceWorker.controller) {
    return {
      kind: 'web',
      list: async () => (await (await g.caches.open(CAS_CACHE)).keys()).map((r) => r.url.split('/').pop()).filter((h) => HASH_RE.test(h)),
      put: async (h, u8) => (await g.caches.open(CAS_CACHE)).put(CAS_KEY(h), new Response(u8, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(u8.length) } })),
      activate: async (map) => { g.navigator.serviceWorker.controller.postMessage({ t: 'sp-overlay', map }); },
      usage: null,
    };
  }
  return null;
}

export function httpBaseOf(wsUrl, loc = globalThis.location) {
  try {
    const u = new URL(wsUrl, loc && loc.href);
    u.protocol = u.protocol === 'wss:' ? 'https:' : u.protocol === 'ws:' ? 'http:' : u.protocol;
    u.pathname = u.pathname.replace(/\/ws\/?$/, '/');
    u.search = ''; u.hash = '';
    return u.href.replace(/\/$/, '');
  } catch { return null; }
}

function recordUsage(store, base, m) {
  let all = {};
  try { all = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}') || {}; } catch { all = {}; }
  all[base] = { hash: m.hash, app: m.app, protocol: m.protocol, at: Date.now(),
    packs: m.overlays.map((o) => ({ id: o.id, name: o.name, version: o.version, files: Object.keys(o.files).length, bytes: Object.values(o.files).reduce((n, f) => n + f.s, 0) })) };
  const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at).slice(0, 30);
  all = Object.fromEntries(keys.map((k) => [k, all[k]]));
  try { localStorage.setItem(USAGE_KEY, JSON.stringify(all)); } catch { /* ignore */ }
  if (store && store.usage) store.usage(all);
}

/**
 * Bring this server's resources in line. @param {{ resources?: { hash, url, protocol } }} welcome
 * @param {string} wsUrl @param {{ notify?: (text: string, level: string) => void, fetchImpl?: typeof fetch, store?: object|null }} [o]
 * @returns {Promise<{ status: string, fetched?: number, bytes?: number, packs?: number }>}
 */
export async function syncResources(welcome, wsUrl, o = {}) {
  const notify = o.notify || (() => {});
  const fetchImpl = o.fetchImpl || globalThis.fetch;
  const r = welcome && welcome.resources;
  if (!r || !HASH_RE.test(String(r.hash || ''))) return { status: 'none' };
  if (r.protocol != null && r.protocol !== PROTOCOL_VERSION) {
    const c = compat({ protocol: r.protocol, app: '' }, { protocol: PROTOCOL_VERSION });
    notify(t(c.text, c.params), 'error');
    return { status: 'incompatible' };
  }
  const base = httpBaseOf(wsUrl);
  if (!base) return { status: 'none' };
  let m = null;
  try { m = JSON.parse(localStorage.getItem(MANIFEST_KEY + r.hash) || 'null'); } catch { m = null; }
  if (!m) {
    const res = await fetchImpl(base + (r.url || '/resources.json'), { cache: 'no-cache' });
    if (!res.ok) return { status: 'unavailable' };
    m = await res.json();
  }
  const bad = checkManifest(m);
  if (bad) { notify(t('服务器资源清单无效（{bad}），已忽略', { bad }), 'warn'); return { status: 'invalid' }; }
  if ((await sha256Hex(canonicalManifest(m))) !== m.hash || m.hash !== r.hash) { notify(t('服务器资源清单校验失败，已忽略'), 'warn'); return { status: 'invalid' }; }
  const c = compat(m, { protocol: PROTOCOL_VERSION, app: APP_VERSION });
  if (!c.ok) { notify(t(c.text, c.params), 'error'); return { status: 'incompatible' }; }
  try { localStorage.setItem(MANIFEST_KEY + m.hash, JSON.stringify(m)); } catch { /* ignore */ }
  const store = o.store !== undefined ? o.store : pickStore();
  recordUsage(store, base, m);
  const map = overlayMap(m);
  if (!store) return { status: Object.keys(map).length ? 'unsupported' : 'ok', packs: m.overlays.length };
  const have = new Set(await store.list());
  const need = missingHashes(map, have);
  let bytes = 0;
  let fetched = 0;
  for (const f of need) {
    const res = await fetchImpl(`${base}/cas/${f.h}`);
    if (!res.ok) { notify(t('模组资源下载失败（HTTP {status}）', { status: res.status }), 'warn'); continue; }
    const u8 = new Uint8Array(await res.arrayBuffer());
    if ((await sha256Hex(u8)) !== f.h) { notify(t('模组资源校验失败，已丢弃'), 'warn'); continue; }
    await store.put(f.h, u8);
    fetched++; bytes += u8.length;
  }
  const active = {};
  const haveNow = new Set(await store.list());
  for (const [rel, f] of Object.entries(map)) if (haveNow.has(f.h)) active[rel] = f.h;
  await store.activate(active);
  if (fetched) notify(t('已下载服务器模组资源 {n} 个文件（{mb} MB），重新进入后生效', { n: fetched, mb: (bytes / 1048576).toFixed(1) }), 'info');
  return { status: 'ok', fetched, bytes, packs: m.overlays.length, active: Object.keys(active).length };
}
