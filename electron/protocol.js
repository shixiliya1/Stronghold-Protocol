// electron/protocol.js — the game's files for the desktop window, served in-process (no HTTP listener).
//
// The browser client asks for the same paths it asks the Node server for (/, /data/, /shared/, /sim/, /data.js,
// /media/…, /packs/…). Rather than re-implementing that routing, every app:// request goes through the server's own
// static handler (server/http/static.js) with a minimal node:http-shaped request / response pair, and the answer
// becomes a fetch Response. Only /ws stays remote: the page connects to the game server named with ?server=
// (public/js/net.js). /healthz answers a local stub without a build tag, so the build guard never reloads the window.

import { PassThrough, Readable } from 'node:stream';

/** Statuses a Response must not carry a body for. */
const NULL_BODY = new Set([101, 204, 205, 304]);

/**
 * Turn the server's (req, res) static handler into a fetch-style handler.
 * @param {(req: any, res: any, rawPath: string, query: string) => Promise<void>} serveStatic
 * @param {{ healthz?: () => object, log?: (msg: string) => void, overlay?: (pathname: string) => string|null }} [opts]
 * @returns {(request: Request) => Promise<Response>}
 */
export function createProtocolHandler(serveStatic, opts = {}) {
  const healthz = opts.healthz || (() => ({ ok: true }));
  const log = opts.log || (() => {});
  return async function handle(request) {
    const url = new URL(request.url);
    const method = request.method === 'HEAD' ? 'HEAD' : request.method;
    if (method !== 'GET' && method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    if (url.pathname === '/healthz') {
      return new Response(JSON.stringify(healthz()), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    // a server's mod overlay (cas.js): the file of that hash instead of the installed art
    const over = opts.overlay && url.pathname.startsWith('/assets/') ? opts.overlay(decodeURIComponent(url.pathname)) : null;
    if (over) {
      try {
        const buf = await (await import('node:fs/promises')).readFile(over);
        const ext = url.pathname.split('.').pop().toLowerCase();
        const type = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', mp3: 'audio/mpeg', ogg: 'audio/ogg', json: 'application/json', atlas: 'text/plain', skel: 'application/octet-stream' }[ext] || 'application/octet-stream';
        return new Response(method === 'HEAD' ? null : buf, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(buf.length), 'Cache-Control': 'no-cache' } });
      } catch { /* fall through to the installed art */ }
    }
    const headers = {};
    for (const [k, v] of request.headers) headers[k.toLowerCase()] = v;
    // no gzip: the bytes go straight to the renderer, and a custom scheme does not decode Content-Encoding
    delete headers['accept-encoding'];
    const req = { method, headers, url: url.pathname + url.search };
    return new Promise((resolve) => {
      const body = new PassThrough();
      const out = {};
      let status = 200;
      let done = false;
      const respond = () => {
        if (done) return;
        done = true;
        const hasBody = method !== 'HEAD' && !NULL_BODY.has(status);
        if (!hasBody) body.resume();
        resolve(new Response(hasBody ? Readable.toWeb(body) : null, { status, headers: out }));
      };
      const res = Object.assign(body, {
        headersSent: false,
        setHeader(k, v) { out[String(k).toLowerCase()] = String(v); },
        getHeader(k) { return out[String(k).toLowerCase()]; },
        writeHead(s, h) {
          status = s;
          if (h) for (const [k, v] of Object.entries(h)) if (v !== undefined) out[k.toLowerCase()] = String(v);
          this.headersSent = true;
          respond();
          return this;
        },
      });
      const origEnd = body.end.bind(body);
      res.end = (...a) => { if (!done) { status = status || 200; respond(); } return origEnd(...a); };
      serveStatic(req, res, url.pathname, url.search.replace(/^\?/, '')).catch((e) => {
        log(`[app] ${url.pathname} failed: ${e && e.message}`);
        if (!done) { status = 500; respond(); }
        body.destroy();
      });
    });
  };
}
