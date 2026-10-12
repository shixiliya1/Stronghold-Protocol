// tools/server-bin/entry.mjs — the headless server executable (Node SEA; build.mjs). No art, no web client: the game
// server (WebSocket /ws, GET /healthz) and a page telling visitors to use a client. The game data the server reads
// (data/, packs/, docs/research/*.json) and the code itself ride in the executable as one asset (build.mjs); main.cjs
// unpacks it once per content hash into a cache dir and imports this file from there, so ROOT is that dir.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '../../shared/constants.js';

const HELP = `stronghold-server ${APP_VERSION} — 卫戍协议：盟约 headless game server (no art; play with the desktop / Android / web client)

usage: stronghold-server [--port 3000] [--host ::] [--data-dir <dir>]
  --port <n>      port to listen on (default 3000, or PORT)
  --host <addr>   bind address (default :: = all IPv6+IPv4; 0.0.0.0 = IPv4 only; 127.0.0.1 = this machine only)
  --data-dir <d>  where the embedded game data is unpacked (default: the user cache dir)
  --version, --help
Ctrl+C stops the server.`;

function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [k, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, null];
    const val = () => { const v = inline ?? argv[++i]; if (v == null) { console.error(`${k}: missing value`); process.exit(2); } return v; };
    if (k === '--port' || k === '-p') o.port = Number(val());
    else if (k === '--host') o.host = val();
    else if (k === '--data-dir') i += inline == null ? 1 : 0; // main.cjs reads it
    else if (k === '--version' || k === '-v') o.version = true;
    else if (k === '--help' || k === '-h' || k === '/?') o.help = true;
    else { console.error(`unknown option ${a}\n\n${HELP}`); process.exit(2); }
  }
  return o;
}

async function publicIp() {
  try {
    const r = await fetch('https://api.ipify.org', { signal: AbortSignal.timeout(3000) });
    const t = (await r.text()).trim();
    return /^[\d.:a-f]+$/i.test(t) ? t : null;
  } catch { return null; }
}

/** Windows double-click: any exit (error, bad option) waits for Enter, so the window shows why. */
function holdOnExit() {
  if (process.platform !== 'win32' || !process.stdin.isTTY) return;
  const exit = process.exit.bind(process);
  process.exit = (code) => { if (code) { holdWindow().then(() => exit(code)); return; } exit(code); };
}

/** Windows double-click: the console window would close on exit; keep it open until Enter. */
function holdWindow() {
  if (process.platform !== 'win32' || !process.stdin.isTTY) return Promise.resolve();
  console.log('\n按回车键关闭窗口 · Press Enter to close this window');
  return new Promise((r) => { process.stdin.resume(); process.stdin.once('data', r); });
}

export async function main() {
  holdOnExit();
  const o = args(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (o.version) { console.log(APP_VERSION); return; }
  if (o.port != null && (!Number.isInteger(o.port) || o.port < 0 || o.port > 65535)) { console.error(`invalid --port ${o.port}`); process.exit(2); }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { startServer } = await import('../../server/index.js');
  let srv;
  try {
    srv = await startServer({
      port: o.port, host: o.host,
      publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), sharedDir: path.join(root, 'shared'),
      packsDir: path.join(root, 'packs'),
    });
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`\n端口已被占用 / port ${o.port ?? process.env.PORT ?? 3000} is in use — try --port 3001`);
    else console.error('[boot] failed to start', e);
    await holdWindow();
    process.exit(1);
  }
  const { lanUrls } = await import('../../server/http/boot.js');
  const p = srv.port;
  console.log(`\n  卫戍协议：盟约 · Stronghold Protocol: Alliance — headless server v${APP_VERSION}`);
  console.log(`  Local:     http://localhost:${p}   (WebSocket ws://localhost:${p}/ws)`);
  if (srv.host === '::' || srv.host === '0.0.0.0') for (const u of lanUrls(p)) console.log(`  LAN:       ${u}`);
  const ip = await publicIp();
  if (ip) console.log(`  Public:    http://${ip.includes(':') ? `[${ip}]` : ip}:${p}   (reachable only if port ${p} is forwarded / open in the firewall)`);
  console.log('  在客户端「自定义服务器」里填上面的地址 · Enter one of these addresses as a custom server in the client.');
  console.log('  Ctrl+C 停止 · Ctrl+C to stop\n');
  let stopping = false;
  const stop = (sig) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`\n[${sig}] shutting down…`);
    setTimeout(() => process.exit(0), 5000).unref();
    srv.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => stop('SIGBREAK'));
}
