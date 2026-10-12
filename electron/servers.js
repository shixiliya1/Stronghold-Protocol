// electron/servers.js — the server picker's pure helpers (no Electron import; unit-tested in test/desktop-servers.test.js):
// address normalisation, the connectivity probe (GET /healthz, else a WebSocket handshake) and the version check.

/** The picker's modes (main.js). */
export const MODES = ['cloud', 'offline', 'host', 'custom'];

/** `ws(s)://host[:port][/ws]`, `http(s)://host[:port][/…]` or a bare `host[:port]` → `ws(s)://host[:port]/ws`; else null. */
export function toWsUrl(input) {
  let v = String(input ?? '').trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `ws://${v}`;
  let u;
  try { u = new URL(v); } catch { return null; }
  if (u.protocol === 'http:') u.protocol = 'ws:';
  else if (u.protocol === 'https:') u.protocol = 'wss:';
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
  if (!u.hostname || u.username || u.password) return null;
  u.pathname = '/ws';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** The server's web root for a /ws URL: `wss://h/ws` → `https://h/`. */
export function httpBase(wsUrl) {
  const u = new URL(wsUrl);
  return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}/`;
}

/**
 * Compare what a server reports with this client.
 * @param {{ app?: string, protocol?: number }} remote
 * @param {{ app: string, protocol: number }} local
 * @returns {{ level: 'ok'|'warn'|'error', text: string }}
 */
export function compareVersions(remote, local) {
  if (remote.protocol != null && remote.protocol !== local.protocol) {
    return { level: 'error', text: `联机协议不同（服务器 ${remote.protocol}，本客户端 ${local.protocol}），无法正常联机` };
  }
  if (remote.app && remote.app !== local.app) {
    return { level: 'warn', text: `游戏版本不同（服务器 ${remote.app}，本客户端 ${local.app}），战斗结果可能不一致` };
  }
  if (!remote.app && remote.protocol == null) return { level: 'warn', text: '无法读取服务器版本' };
  return { level: 'ok', text: `版本一致（${local.app}）` };
}

/**
 * Is the server up, how fast, which version? GET <web root>/healthz first; when that does not answer (a server behind a
 * proxy that only passes /ws), a WebSocket handshake + hello → welcome (its `version` is the protocol).
 * @param {string} input any address toWsUrl accepts
 * @param {{ timeoutMs?: number, fetch?: typeof fetch, WebSocket?: any, now?: () => number, local: { app: string, protocol: number } }} o
 */
export async function probeServer(input, o) {
  const ws = toWsUrl(input);
  if (!ws) return { ok: false, error: '地址无效' };
  const timeoutMs = o.timeoutMs ?? 4000;
  const doFetch = o.fetch || globalThis.fetch;
  const WS = o.WebSocket || globalThis.WebSocket;
  const now = o.now || (() => performance.now());
  let t0 = now();
  try {
    const res = await doFetch(`${httpBase(ws)}healthz`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (res.ok) {
      const body = await res.json();
      const latencyMs = Math.round(now() - t0);
      if (body && body.ok) {
        const remote = { app: typeof body.app === 'string' ? body.app : undefined, protocol: typeof body.version === 'number' ? body.version : undefined };
        return { ok: true, url: ws, via: 'healthz', latencyMs, ...remote, check: compareVersions(remote, o.local) };
      }
    }
  } catch { /* fall back to the socket */ }
  if (!WS) return { ok: false, url: ws, error: '连接失败' };
  t0 = now();
  return new Promise((resolve) => {
    let sock;
    const finish = (r) => { clearTimeout(timer); try { sock && sock.close(); } catch { /* ignore */ } resolve(r); };
    const timer = setTimeout(() => finish({ ok: false, url: ws, error: `${timeoutMs / 1000} 秒内没有响应` }), timeoutMs);
    try { sock = new WS(ws); } catch (e) { finish({ ok: false, url: ws, error: String(e && e.message || e) }); return; }
    let latencyMs = null;
    sock.onopen = () => {
      latencyMs = Math.round(now() - t0);
      try { sock.send(JSON.stringify({ t: 'hello', name: 'probe' })); } catch { /* ignore */ }
    };
    sock.onmessage = (ev) => {
      let d = null;
      try { d = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { /* ignore */ }
      if (d && d.t === 'welcome') {
        const remote = { protocol: typeof d.version === 'number' ? d.version : undefined };
        finish({ ok: true, url: ws, via: 'ws', latencyMs, ...remote, check: compareVersions(remote, o.local) });
      }
    };
    sock.onerror = () => finish({ ok: false, url: ws, error: '连接失败' });
    sock.onclose = () => { if (latencyMs != null) finish({ ok: true, url: ws, via: 'ws', latencyMs, check: compareVersions({}, o.local) }); };
  });
}

/**
 * The picker's saved settings, cleaned: `{ mode, remember, serverId, servers: [{ id, name, url }], skipVersion }`
 * (the earlier single `custom` address becomes a saved server).
 */
export function normalizeSettings(s) {
  const o = s && typeof s === 'object' ? s : {};
  const servers = (Array.isArray(o.servers) ? o.servers : [])
    .filter((x) => x && typeof x.url === 'string' && toWsUrl(x.url))
    .slice(0, 50)
    .map((x, i) => ({ id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : `s${Date.now().toString(36)}${i}`, name: String(x.name || '').slice(0, 40), url: String(x.url).trim().slice(0, 300) }));
  if (typeof o.custom === 'string' && toWsUrl(o.custom) && !servers.some((x) => toWsUrl(x.url) === toWsUrl(o.custom))) {
    servers.push({ id: 'legacy', name: '', url: o.custom }); // the single address of the earlier picker
  }
  let serverId = typeof o.serverId === 'string' ? o.serverId : null;
  if (o.mode === 'custom' && !servers.some((x) => x.id === serverId)) serverId = servers[0] ? servers[0].id : null;
  const mode = MODES.includes(o.mode) && (o.mode !== 'custom' || serverId) ? o.mode : null;
  return { mode, remember: !!o.remember, serverId, servers, skipVersion: typeof o.skipVersion === 'string' ? o.skipVersion : '' };
}
