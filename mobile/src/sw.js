// Service worker of the GitHub Pages build (mobile/scripts/build-www.mjs --target pages).
//  * Base path: the game asks for root-relative URLs (/js/…, /sim/…, /data/…); every same-origin request outside BASE is
//    answered with BASE + path, re-wrapped so the page still sees the URL it asked for (one module instance per file).
//  * Caching: the app shell (code, data, css) is network-first with the cache as the offline fallback; art and audio
//    (/assets/, /fonts/) are cache-first, cached on demand. Storage is best-effort: a quota error (iOS caps a site at a
//    few hundred MB and may evict it) drops the art cache instead of failing the request.
const BASE = '__BASE__';
const VERSION = '__VERSION__';
const SHELL = `sp-shell-${VERSION}`;
const ART = 'sp-art-v1';
const PRECACHE = ['', 'index.html', 'client/', 'client/index.html', 'client/config.js', 'client/boot.js', 'client/web-api.js',
  'client/chooser.js', 'client/storage-ui.js', 'client/storage.js', 'client/chooser.css', 'client/mobile.css', 'client/servers.js', 'client/update-check.js', 'manifest.json', 'data.js', 'healthz'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE.map((p) => BASE + p))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('sp-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isArt = (p) => /^(assets|fonts|icons)\//.test(p) || /\.(png|webp|jpe?g|mp3|m4a|ogg|atlas|skel|glb|gltf|woff2?|ttf)$/i.test(p);

// mod overlay of the server the page joined (public/js/resources.js): rel → sha256 out of the shared content-addressed
// cache 'sp-cas-v1' (keys https://cas.invalid/<sha256>); kept in that cache too, so a restarted worker still has it.
const CAS = 'sp-cas-v1';
const MAP_KEY = 'https://cas.invalid/overlay-map';
let overlay = null;
async function overlayMap() {
  if (overlay) return overlay;
  try { const r = await caches.match(MAP_KEY, { cacheName: CAS }); overlay = r ? await r.json() : {}; } catch { overlay = {}; }
  return overlay;
}
self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.t !== 'sp-overlay' || !d.map || typeof d.map !== 'object') return;
  overlay = d.map;
  e.waitUntil(caches.open(CAS).then((c) => c.put(MAP_KEY, new Response(JSON.stringify(overlay), { headers: { 'Content-Type': 'application/json' } }))).catch(() => {}));
});

async function put(cacheName, req, res) {
  try { const c = await caches.open(cacheName); await c.put(req, res); } catch (err) {
    if (cacheName === ART) { try { await caches.delete(ART); } catch { /* ignore */ } }
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  let rel;
  if (u.pathname.startsWith(BASE)) rel = u.pathname.slice(BASE.length);
  else if (u.pathname + '/' === BASE) rel = '';
  else rel = u.pathname.replace(/^\//, '');
  if (rel.startsWith('media/')) { e.respondWith(new Response('', { status: 404 })); return; } // audio.js falls back to /assets/audio
  const mapped = BASE + rel + u.search;
  const remap = !u.pathname.startsWith(BASE);
  e.respondWith((async () => {
    const key = new Request(new URL(BASE + rel, self.location.origin).href);
    const wrap = async (res) => (remap && res ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers }) : res);
    if (rel.startsWith('assets/')) {
      const h = (await overlayMap())[rel];
      const o = h ? await caches.match(`https://cas.invalid/${h}`, { cacheName: CAS }) : null;
      if (o) {
        const ext = rel.split('.').pop().toLowerCase();
        const type = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json' }[ext] || 'application/octet-stream';
        return new Response(await o.blob(), { status: 200, headers: { 'Content-Type': type } });
      }
    }
    if (isArt(rel)) {
      const hit = await caches.match(key, { ignoreSearch: true });
      if (hit) return wrap(hit);
      const res = await fetch(mapped, { headers: req.headers.get('range') ? { range: req.headers.get('range') } : {} });
      if (res.ok && res.status === 200) e.waitUntil(put(ART, key, res.clone()));
      return wrap(res);
    }
    try {
      const res = await fetch(mapped, { cache: 'no-cache' });
      if (res.ok) e.waitUntil(put(SHELL, key, res.clone()));
      return wrap(res);
    } catch (err) {
      const hit = await caches.match(key, { ignoreSearch: true }) || (req.mode === 'navigate' ? await caches.match(BASE + 'index.html') : null);
      if (hit) return wrap(hit);
      throw err;
    }
  })());
});
