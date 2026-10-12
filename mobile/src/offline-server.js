// Offline single-player for the server-less clients (Android / PWA): the real game server (server/net.js Network +
// server/lobby.js Lobby + the match / sim code, bundled with esbuild and Node shims) runs inside the page, and the
// page's WebSocket to OFFLINE_WS_URL is a pair of in-memory sockets. No network, no Node.
import { createSessionStack } from '../../server/http/websocket.js';
import { DATA_FILES } from '../../server/data.js';
import { setSimData } from '../../server/sim/simdata.js';

let stackPromise = null;

/** Fetch data/*.json into the virtual fs, then build the session stack (once). */
export function startOfflineServer(baseUrl) {
  if (stackPromise) return stackPromise;
  stackPromise = (async () => {
    let names = DATA_FILES.map((n) => n + '.json');
    try {
      const r = await fetch(new URL('data/index.json', baseUrl));
      if (r.ok) names = await r.json();
    } catch { /* default list */ }
    const vfs = {};
    await Promise.all(names.map(async (n) => {
      try { const r = await fetch(new URL('data/' + n, baseUrl)); if (r.ok) vfs[n] = await r.text(); } catch { /* skip */ }
    }));
    globalThis.__SP_VFS = vfs;
    const log = { info() {}, debug() {}, warn: (...a) => console.warn('[offline]', ...a), error: (...a) => console.error('[offline]', ...a) };
    const { getData } = await import('../../server/data.js');
    const data = getData({ log });
    try { setSimData(data); } catch { /* the match passes its own data */ }
    return createSessionStack({ trustProxy: false }, { data, log });
  })();
  return stackPromise;
}


// boot.js waits on this (client/offline-socket.js holds the in-memory socket pair)
if (typeof window !== 'undefined' && window.__spOfflineResolve) window.__spOfflineResolve({ startOfflineServer });
