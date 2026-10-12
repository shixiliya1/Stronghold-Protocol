// electron/server-host.mjs — the bundled game server inside the desktop app (an Electron utilityProcess: the app's own
// Node, no system Node needed). Started by main.js for 离线单人 (127.0.0.1) and 本机开服 (LAN); stops on {type:'stop'}.
//
//   env SP_GAME_ROOT  the game files (resources/game when packaged, the repository in development)
//   env SP_HOST       bind address ('127.0.0.1' or '::'), env SP_PORT the preferred port (0 = any free port)

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const port = process.parentPort;
const send = (msg) => { try { port.postMessage(msg); } catch { /* parent gone */ } };

let server = null;
async function stop(code = 0) {
  try { if (server) await server.close(); } catch { /* ignore */ }
  process.exit(code);
}
port.on('message', (e) => { if (e && e.data && e.data.type === 'stop') stop(0); });

try {
  const root = process.env.SP_GAME_ROOT;
  const { startServer } = await import(pathToFileURL(path.join(root, 'server', 'index.js')).href);
  const host = process.env.SP_HOST || '127.0.0.1';
  const want = Number(process.env.SP_PORT) || 0;
  try {
    server = await startServer({ host, port: want });
  } catch (e) {
    if (!want || !e || e.code !== 'EADDRINUSE') throw e;
    server = await startServer({ host, port: 0 }); // the preferred port is taken: any free one
  }
  send({ type: 'ready', port: server.port, host: server.host });
} catch (e) {
  send({ type: 'error', message: (e && (e.code || e.message)) || String(e) });
  setTimeout(() => process.exit(1), 100);
}
