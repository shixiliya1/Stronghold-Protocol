// electron/main.js — 卫戍协议：盟约 desktop client: one window, the game's files from this computer (app://game/,
// served in-process by protocol.js — no local HTTP server), game sync with the remote server over WebSocket.
//
//   卫戍协议.exe [--server=wss://host/ws]      default: DEFAULT_SERVER below (env SP_SERVER also works)
//   SP_SHOT=<png> SP_SHOT_AFTER=<ms>          test hook: capture the window to a PNG, then quit
//
// The game files live next to the app (resources/game/ when packaged, the repository root in development).

import { app, BrowserWindow, Menu, protocol, session, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProtocolHandler } from './protocol.js';

const DEFAULT_SERVER = 'wss://stronghold-xili.japaneast.cloudapp.azure.com/ws';
const TITLE = '卫戍协议：盟约';
const SCHEME = 'app';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.resolve(HERE, '..');

function serverUrl() {
  const arg = process.argv.find((a) => a.startsWith('--server='));
  const v = (arg ? arg.slice('--server='.length) : process.env.SP_SERVER || DEFAULT_SERVER).trim();
  try {
    const u = new URL(v);
    if (u.protocol === 'ws:' || u.protocol === 'wss:') return u.toString();
  } catch { /* fall through */ }
  return DEFAULT_SERVER;
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const { createStaticHandler } = await import(pathToFileURL(path.join(GAME_ROOT, 'server', 'http', 'static.js')).href);
    const { APP_VERSION, PROTOCOL_VERSION } = await import(pathToFileURL(path.join(GAME_ROOT, 'shared', 'constants.js')).href);
    const serveStatic = createStaticHandler({
      publicDir: path.join(GAME_ROOT, 'public'),
      dataDir: path.join(GAME_ROOT, 'data'),
      sharedDir: path.join(GAME_ROOT, 'shared'),
      simDir: path.join(GAME_ROOT, 'server', 'sim'),
      packsDir: path.join(GAME_ROOT, 'packs'),
    });
    const handler = createProtocolHandler(serveStatic, {
      healthz: () => ({ ok: true, version: PROTOCOL_VERSION, app: APP_VERSION }),
      log: (m) => console.error(m),
    });
    protocol.handle(SCHEME, (request) => handler(request));

    // log the game-server sockets (test runs read this from stdout)
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*'] }, (d, cb) => {
      console.log(`[ws] connect ${d.url}`);
      cb({});
    });
    session.defaultSession.webRequest.onCompleted({ urls: ['ws://*/*', 'wss://*/*'] }, (d) => {
      console.log(`[ws] handshake ${d.statusCode} ${d.url}`);
    });

    const icon = path.join(GAME_ROOT, 'public', 'icons', 'app-512.png');
    win = new BrowserWindow({
      width: 1600, height: 900, minWidth: 960, minHeight: 540,
      title: TITLE, backgroundColor: '#111614', autoHideMenuBar: true,
      icon: fs.existsSync(icon) ? icon : undefined,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    });
    win.removeMenu();
    win.on('page-title-updated', (e) => e.preventDefault());

    const external = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`${ORIGIN}/`)) { e.preventDefault(); external(url); } });
    win.webContents.on('console-message', (e) => {
      const level = e.level ?? 'info';
      console.log(`[page:${level}] ${e.message}${e.sourceId ? ` (${e.sourceId}:${e.lineNumber})` : ''}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`[load] failed ${code} ${desc} ${url}`));
    win.webContents.on('did-finish-load', () => console.log(`[load] finished ${win.webContents.getURL()}`));
    win.webContents.on('render-process-gone', (_e, d) => console.log(`[load] renderer gone: ${d.reason}`));

    await win.loadURL(`${ORIGIN}/?server=${encodeURIComponent(serverUrl())}`);

    const shot = process.env.SP_SHOT;
    if (shot) {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          fs.writeFileSync(shot, img.toPNG());
          console.log(`[shot] ${shot} ${img.getSize().width}x${img.getSize().height}`);
        } catch (e) { console.log(`[shot] failed ${e && e.message}`); }
        app.quit();
      }, Number(process.env.SP_SHOT_AFTER) || 20000);
    }
  });

  app.on('window-all-closed', () => app.quit());
}
