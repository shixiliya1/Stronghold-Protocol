// electron/main.js — 卫戍协议：盟约 desktop client: one window; the game's files always come from this computer
// (app://game/, served in-process by protocol.js — the page itself never needs a local HTTP server).
//
// Server picker (ui/chooser.html at start unless the last choice is remembered; Ctrl+Shift+M at any time):
//   cloud    云服务器联机   game sync with DEFAULT_SERVER (wss)
//   offline  离线单人      the bundled game server (server-host.mjs, a utilityProcess) on 127.0.0.1, any free port
//   host     本机开服      the same server on the LAN (:: / 0.0.0.0, port 3000 when free); Ctrl+Shift+H shows the addresses
//   custom   自定义服务器   a saved server (name + address: wss://host/ws, ws://ip:port/ws or http(s)://host)
// The picker probes servers (servers.js: /healthz or a handshake → online, latency, version) and warns on a mismatch.
// 检查更新: updater.js (at start, and from the picker / Ctrl+Shift+U).
//
//   卫戍协议.exe [--mode=cloud|offline|host] [--server=wss://host/ws]   (env SP_MODE / SP_SERVER work too)
//   SP_SHOT=<png> SP_SHOT_AFTER=<ms>    test hook: capture the window to a PNG after the game page loaded, then quit
//
// The game files live next to the app (resources/game/ when packaged, the repository root in development).

import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, utilityProcess } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProtocolHandler } from './protocol.js';
import { MODES, normalizeSettings, probeServer, toWsUrl } from './servers.js';
import { createUpdater } from './updater.js';
import { STATE_FILE, artReady, ensureArt, packUrls, artStorage, clearPartials, removeLeftovers, verifyArt } from './art.js';

const DEFAULT_SERVER = 'wss://stronghold-xili.japaneast.cloudapp.azure.com/ws';
const TITLE = '卫戍协议：盟约';
const SCHEME = 'app';
const HOST = 'game';
const ORIGIN = `${SCHEME}://${HOST}`;
const HOST_PORT = 3000;
const LABELS = { cloud: '云服务器联机', offline: '离线单人', host: '本机开服', custom: '自定义服务器' };
let LOCAL = { app: '?', protocol: 0 }; // this client's game version (shared/constants.js), read at start

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.resolve(HERE, '..');

const argOf = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : null;
};
// ---- the art pack (electron/art.js) ------------------------------------------------------------------------------
// A packaged app carries resources/art-manifest.json and no public/assets: the art lives in userData/art, installed from
// the art release once and only again when its hash changes. Without a manifest (development) the bundled art is used.
// Art of an older install (desktop.3 bundled it; the installer moves it to userData/art-migrate) is reused.
const ART = (() => {
  const file = process.env.SP_ART_MANIFEST || (app.isPackaged ? path.join(process.resourcesPath, 'art-manifest.json') : '');
  if (!file || !fs.existsSync(file)) return null;
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { manifest, dir: process.env.SP_ART_DIR || path.join(app.getPath('userData'), 'art'), migrate: path.join(app.getPath('userData'), 'art-migrate') };
  } catch (e) { console.error('[art] bad manifest', e.message); return null; }
})();
let artProgress = null;
let artRetry = null;
let artSkip = null;
/**
 * Install / repair the art pack (art.html shows the progress). 「跳过，先进入游戏」 (desktop:art-skip) stops it at any
 * point — the game then runs without (some) art: missing files are 404s the page renders around. A later
 * 「下载美术资源」 (存储管理) resumes: files already downloaded and verified are kept.
 * @param {{ force?: boolean }} [o] force: run ensureArt even when the quick check passes (repair after verify)
 * @returns {Promise<'none'|'ready'|'installed'|'skipped'>}
 */
async function prepareArt({ force = false } = {}) {
  if (!ART) return 'none';
  const m = ART.manifest;
  const info = { tag: m.tag, bytes: m.bytes, files: m.files };
  const send = (p) => { artProgress = { ...p, info }; if (win && !win.isDestroyed()) win.webContents.send('art:progress', artProgress); };
  const cleanup = () => { try { fs.rmSync(ART.migrate, { recursive: true, force: true }); } catch { /* ignore */ } };
  if (!force && await artReady(m, ART.dir)) { cleanup(); console.log(`[art] ready ${m.tag}`); return 'ready'; }
  artProgress = null;
  win.loadFile(path.join(HERE, 'ui', 'art.html'));
  const ctl = new AbortController();
  const skipped = new Promise((r) => { artSkip = () => { ctl.abort(); r('skipped'); }; });
  const urls = process.env.SP_ART_URL ? [process.env.SP_ART_URL] : packUrls(m);
  try {
    for (;;) {
      const job = ensureArt({
        manifest: m, artDir: ART.dir, urls, moveLegacy: true, signal: ctl.signal,
        legacyDirs: [ART.migrate, ...(app.isPackaged ? [path.join(GAME_ROOT, 'public'), GAME_ROOT] : [])].filter((d) => fs.existsSync(d)),
        onProgress: send,
      });
      job.catch(() => {}); // a skip abandons it
      try {
        const r = await Promise.race([job, skipped]);
        if (r === 'skipped') { console.log('[art] skipped by the player'); return 'skipped'; }
        console.log(`[art] ${r.status} ${m.tag}: fetched ${r.fetched}, reused ${r.reused}, migrated ${r.migrated || 0}`);
        cleanup();
        return 'installed';
      } catch (e) {
        if (ctl.signal.aborted) return 'skipped';
        console.error('[art] failed', e.message);
        send({ phase: 'error', message: e.message });
        const w = await Promise.race([new Promise((r) => { artRetry = r; }), skipped]);
        if (w === 'skipped') return 'skipped';
      }
    }
  } finally { artSkip = null; artRetry = null; }
}

const diskFree = (dir) => {
  try { const s = fs.statfsSync(dir); return { free: s.bavail * s.bsize, size: s.blocks * s.bsize }; } catch { return null; }
};
/** 存储管理: rows + actions for ui/storage-ui.js. */
async function storageInfo() {
  const userData = app.getPath('userData');
  const disk = diskFree(userData);
  if (!ART) {
    return { title: '存储管理', rows: [{ id: 'art', label: '美术资源', text: '随程序附带（开发版），无需管理' }, ...(disk ? [{ id: 'free', label: '磁盘可用空间', bytes: disk.free, of: disk.size }] : [])], actions: [] };
  }
  const a = await artStorage(ART.manifest, ART.dir, { extraDirs: [ART.migrate] });
  return {
    title: '存储管理',
    rows: [
      { id: 'art', label: `美术资源包 ${a.tag}`, bytes: a.artBytes, of: a.total, text: a.ready ? `已安装 · ${a.artFiles} 个文件` : `未完整安装 · ${a.artFiles} / ${a.files} 个文件` },
      { id: 'cache', label: '下载缓存（未完成的分段）', bytes: a.partBytes },
      { id: 'leftover', label: '旧版美术残留', bytes: a.leftoverBytes, text: a.leftoverFiles ? `${a.leftoverFiles} 个文件` : '无' },
      ...(disk ? [{ id: 'free', label: '磁盘可用空间', bytes: disk.free, of: disk.size }] : []),
      { id: 'path', label: '位置', text: ART.dir },
    ],
    actions: [
      { id: 'clear-cache', label: '清除下载缓存' },
      { id: 'remove-leftover', label: '删除旧版美术残留' },
      { id: 'verify', label: '校验并修复美术', note: '逐个检查 sha256，损坏的文件重新下载' },
      { id: 'redownload', label: a.ready ? '重新下载美术资源' : '下载美术资源' },
      { id: 'delete-art', label: '删除全部美术', danger: true, confirm: '删除全部美术资源？之后游戏以无美术模式运行，可随时在这里重新下载。' },
    ],
  };
}
async function storageAction(id) {
  if (!ART) return { error: '开发版：美术随程序附带' };
  const m = ART.manifest;
  if (id === 'clear-cache') { const n = await clearPartials(ART.dir); return { ok: true, message: `已清除 ${(n / 1048576).toFixed(1)} MB 下载缓存` }; }
  if (id === 'remove-leftover') { await removeLeftovers(m, ART.dir, { extraDirs: [ART.migrate] }); return { ok: true, message: '已删除旧版美术残留' }; }
  if (id === 'delete-art') { fs.rmSync(ART.dir, { recursive: true, force: true }); return { ok: true, message: '已删除全部美术资源，游戏将以无美术模式运行' }; }
  if (id === 'verify' || id === 'redownload') {
    let bad = null;
    if (id === 'verify') bad = (await verifyArt(m, ART.dir)).bad;
    else fs.rmSync(path.join(ART.dir, STATE_FILE), { force: true });
    setTimeout(async () => { const r = await prepareArt({ force: true }); showChooser(r === 'skipped' ? '美术资源下载已跳过，可在「存储管理」里继续' : ''); }, 50);
    return { ok: true, navigating: true, message: bad ? `校验完成：${bad.length} 个文件损坏，正在重新下载` : '正在下载美术资源…' };
  }
  return { error: `unknown action ${id}` };
}

const cloudServer = () => toWsUrl(argOf('server') || process.env.SP_SERVER || DEFAULT_SERVER) || DEFAULT_SERVER;

// ---- settings (userData/desktop-mode.json) ---------------------------------------------------------------------
// { mode, remember, serverId (the custom server last used), servers: [{ id, name, url }], skipVersion }
const settingsFile = () => path.join(app.getPath('userData'), 'desktop-mode.json');
function loadSettings() {
  try { return normalizeSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); } catch { return normalizeSettings({}); }
}
function saveSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(normalizeSettings(s), null, 2)); } catch (e) { console.error('[settings]', e.message); }
}

// ---- the bundled game server -------------------------------------------------------------------------------------
let child = null;      // utilityProcess
let childInfo = null;  // { host, port }
function stopServer() {
  const c = child;
  child = null;
  childInfo = null;
  if (!c) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(t); resolve(); };
    const t = setTimeout(() => { try { c.kill(); } catch { /* gone */ } resolve(); }, 3000);
    c.once('exit', done);
    try { c.postMessage({ type: 'stop' }); } catch { done(); }
  });
}
async function startServer(host, port) {
  if (child && childInfo && childInfo.bindHost === host) return childInfo;
  await stopServer();
  const c = utilityProcess.fork(path.join(HERE, 'server-host.mjs'), [], {
    serviceName: 'Stronghold Protocol server',
    stdio: 'pipe',
    env: { ...process.env, ...(ART ? { SP_ART_DIR: ART.dir } : {}), SP_GAME_ROOT: GAME_ROOT, SP_HOST: host, SP_PORT: String(port) },
  });
  c.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  c.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  child = c;
  const info = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('本机服务器 30 秒内没有启动')), 30000);
    c.on('message', (m) => {
      if (m && m.type === 'ready') { clearTimeout(t); resolve({ bindHost: host, host: m.host, port: m.port }); }
      else if (m && m.type === 'error') { clearTimeout(t); reject(new Error(`本机服务器启动失败：${m.message}`)); }
    });
    c.once('exit', (code) => { clearTimeout(t); reject(new Error(`本机服务器已退出（${code}）`)); });
  }).catch(async (e) => { await stopServer(); throw e; });
  c.once('exit', (code) => {
    if (child !== c) return;
    child = null; childInfo = null;
    console.log(`[server] exited ${code}`);
    if (!quitting && win) showChooser(`本机服务器意外退出（${code}），请重新选择。`);
  });
  childInfo = info;
  console.log(`[server] ready ${info.host}:${info.port}`);
  return info;
}

/** LAN addresses of this computer (IPv4, not loopback / link-local). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.internal || a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.push(a.address);
    }
  }
  return out;
}

// ---- window & modes ----------------------------------------------------------------------------------------------
let win = null;
let quitting = false;
let current = { mode: null, url: null, detail: '' };
let pendingError = '';
let blockFonts = false;

function hostInfoText() {
  if (current.mode !== 'host' || !childInfo) return null;
  const p = childInfo.port;
  const addrs = lanAddresses();
  const lines = addrs.length ? addrs.map((a) => `http://${a}:${p}`) : ['（没有检测到局域网地址：检查网线 / Wi-Fi）'];
  return [
    '朋友在同一局域网里用浏览器打开下面的地址，或在桌面版的「自定义服务器」里添加它：',
    '',
    ...lines,
    '',
    `本机：http://127.0.0.1:${p}`,
    '建房后把 4 位「同盟密钥」发给朋友即可。',
    'Windows 防火墙弹窗时请允许「专用网络」，否则朋友连不上；访客 Wi-Fi 的「AP 隔离」也会挡住连接。',
    '关闭游戏窗口即停止服务器。随时按 Ctrl+Shift+H 再次查看。',
  ].join('\n');
}
function showHostInfo() {
  const text = hostInfoText();
  if (!text || !win) return;
  dialog.showMessageBox(win, { type: 'info', title: TITLE, message: '本机开服已启动', detail: text, buttons: ['好的'] });
}

function showChooser(error = '') {
  if (!win) return;
  pendingError = error;
  current = { mode: null, url: null, detail: '' };
  win.loadFile(path.join(HERE, 'ui', 'chooser.html'));
}

/** Switch to a mode: start / stop the bundled server as needed, then load the game page. */
async function applyMode(mode, opts = {}) {
  let ws;
  let detail = '';
  blockFonts = false;
  if (mode === 'cloud') {
    await stopServer();
    ws = cloudServer();
    detail = ws;
  } else if (mode === 'offline') {
    const info = await startServer('127.0.0.1', 0);
    ws = `ws://127.0.0.1:${info.port}/ws`;
    blockFonts = true; // no internet needed: the page falls back to the bundled fonts at once
    detail = '本机服务器（只本机可用）';
  } else if (mode === 'host') {
    const info = await startServer('::', HOST_PORT);
    ws = `ws://127.0.0.1:${info.port}/ws`;
    detail = `局域网端口 ${info.port}`;
  } else if (mode === 'custom') {
    ws = toWsUrl(opts.url);
    if (!ws) throw new Error('地址看不懂：请填 wss://域名/ws、ws://IP:端口/ws 或 http://IP:端口');
    await stopServer();
    detail = opts.name ? `${opts.name} · ${ws}` : ws;
  } else {
    throw new Error(`unknown mode ${mode}`);
  }
  current = { mode, url: ws, detail };
  console.log(`[mode] ${mode} ${ws}`);
  await win.loadURL(`${ORIGIN}/?server=${encodeURIComponent(ws)}`);
  if (mode === 'host') showHostInfo();
}

async function choose(mode, opts = {}) {
  if (!MODES.includes(mode)) return { error: '未知的模式' };
  const s = loadSettings();
  let server = null;
  if (mode === 'custom') {
    server = s.servers.find((x) => x.id === opts.serverId) || null;
    if (!server) return { error: '请先选择或添加一个服务器' };
  }
  try {
    await applyMode(mode, server ? { url: server.url, name: server.name } : opts);
  } catch (e) {
    return { error: e.message || String(e) };
  }
  saveSettings({ ...s, mode, remember: !!opts.remember, serverId: server ? server.id : s.serverId });
  return { ok: true };
}

let updater = null;

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const { createStaticHandler } = await import(pathToFileURL(path.join(GAME_ROOT, 'server', 'http', 'static.js')).href);
    const { APP_VERSION, PROTOCOL_VERSION } = await import(pathToFileURL(path.join(GAME_ROOT, 'shared', 'constants.js')).href);
    LOCAL = { app: APP_VERSION, protocol: PROTOCOL_VERSION };
    const serveStatic = createStaticHandler({
      publicDir: path.join(GAME_ROOT, 'public'),
      dataDir: path.join(GAME_ROOT, 'data'),
      sharedDir: path.join(GAME_ROOT, 'shared'),
      simDir: path.join(GAME_ROOT, 'server', 'sim'),
      packsDir: path.join(GAME_ROOT, 'packs'),
      artDir: ART ? ART.dir : null,
    });
    const handler = createProtocolHandler(serveStatic, {
      healthz: () => ({ ok: true, version: PROTOCOL_VERSION, app: APP_VERSION }),
      log: (m) => console.error(m),
    });
    protocol.handle(SCHEME, (request) => handler(request));

    // game-server sockets are logged (test runs read stdout); web fonts are skipped offline (the bundled ones apply)
    const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['ws://*/*', 'wss://*/*', 'https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] }, (d, cb) => {
      if (FONT_HOSTS.test(d.url)) { cb({ cancel: blockFonts }); return; }
      console.log(`[ws] connect ${d.url}`);
      cb({});
    });
    session.defaultSession.webRequest.onCompleted({ urls: ['ws://*/*', 'wss://*/*'] }, (d) => {
      console.log(`[ws] handshake ${d.statusCode} ${d.url}`);
    });

    ipcMain.handle('desktop:state', () => {
      const s = loadSettings();
      const err = pendingError;
      pendingError = '';
      return {
        mode: current.mode, label: current.mode ? LABELS[current.mode] : '', detail: current.detail, error: err,
        remember: s.remember, last: s.mode, serverId: s.serverId, servers: s.servers,
        cloud: cloudServer(), game: LOCAL.app, protocol: LOCAL.protocol, app: app.getVersion(),
      };
    });
    ipcMain.handle('desktop:choose', (_e, mode, opts) => choose(mode, opts || {}));
    ipcMain.handle('desktop:chooser', () => showChooser());
    ipcMain.handle('desktop:host-info', () => showHostInfo());
    ipcMain.handle('desktop:probe', (_e, url) => probeServer(String(url || ''), { local: LOCAL, timeoutMs: 4000 }));
    ipcMain.handle('desktop:normalize', (_e, url) => toWsUrl(url));
    ipcMain.handle('desktop:servers', (_e, servers) => {
      const s = loadSettings();
      saveSettings({ ...s, servers: Array.isArray(servers) ? servers : s.servers });
      return loadSettings().servers;
    });
    ipcMain.handle('desktop:art-state', () => artProgress);
    ipcMain.handle('desktop:art-retry', () => { const r = artRetry; artRetry = null; if (r) r(); });
    ipcMain.handle('desktop:art-skip', () => { if (artSkip) artSkip(); });
    ipcMain.handle('desktop:storage-info', () => storageInfo());
    ipcMain.handle('desktop:storage-action', (_e, id) => storageAction(String(id || '')));
    ipcMain.handle('desktop:check-update', () => (updater ? updater.check(true) : { status: 'error' }));

    const icon = path.join(GAME_ROOT, 'public', 'icons', 'app-512.png');
    win = new BrowserWindow({
      width: 1600, height: 900, minWidth: 960, minHeight: 540,
      title: TITLE, backgroundColor: '#111614', autoHideMenuBar: true,
      icon: fs.existsSync(icon) ? icon : undefined,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(HERE, 'preload.cjs') },
    });
    win.removeMenu();
    win.on('page-title-updated', (e) => e.preventDefault());
    win.on('closed', () => { win = null; });

    const external = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };
    win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
    win.webContents.on('will-navigate', (e, url) => {
      if (url.startsWith(`${ORIGIN}/`) || url.startsWith('file:')) return;
      e.preventDefault();
      external(url);
    });
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown' || !input.shift || !(input.control || input.meta)) return;
      const k = String(input.key || '').toLowerCase();
      if (k === 'm') { e.preventDefault(); showChooser(); }
      else if (k === 'h') { e.preventDefault(); showHostInfo(); }
      else if (k === 'u') { e.preventDefault(); if (updater) updater.check(true); }
    });
    win.webContents.on('console-message', (e) => {
      const level = e.level ?? 'info';
      console.log(`[page:${level}] ${e.message}${e.sourceId ? ` (${e.sourceId}:${e.lineNumber})` : ''}`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`[load] failed ${code} ${desc} ${url}`));
    win.webContents.on('did-finish-load', () => {
      const url = win.webContents.getURL();
      console.log(`[load] finished ${url}`);
      const shot = process.env.SP_SHOT;
      if (shot && url.startsWith(`${ORIGIN}/`) && !shotTaken) {
        shotTaken = true;
        setTimeout(async () => {
          try {
            const img = await win.webContents.capturePage();
            fs.writeFileSync(shot, img.toPNG());
            console.log(`[shot] ${shot} ${img.getSize().width}x${img.getSize().height}`);
          } catch (err) { console.log(`[shot] failed ${err && err.message}`); }
          app.quit();
        }, Number(process.env.SP_SHOT_AFTER) || 20000);
      }
    });
    win.webContents.on('render-process-gone', (_e, d) => console.log(`[load] renderer gone: ${d.reason}`));

    // start: --mode / SP_MODE, else the remembered choice, else the chooser
    updater = createUpdater({
      getWin: () => win,
      getSkip: () => loadSettings().skipVersion,
      setSkip: (v) => saveSettings({ ...loadSettings(), skipVersion: v }),
    });
    await prepareArt();
    const forced = argOf('mode') || process.env.SP_MODE;
    const s = loadSettings();
    const start = MODES.includes(forced) && forced !== 'custom' ? forced : (s.remember && s.mode ? s.mode : null);
    if (start) {
      const server = start === 'custom' ? s.servers.find((x) => x.id === s.serverId) : null;
      try { await applyMode(start, server ? { url: server.url, name: server.name } : {}); } catch (e) { showChooser(e.message || String(e)); }
    } else {
      showChooser();
    }
    if (process.env.SP_NO_UPDATE_CHECK !== '1') setTimeout(() => updater.check(false), 8000);
  });

  let shotTaken = false;
  app.on('before-quit', (e) => {
    if (quitting || !child) { quitting = true; return; }
    quitting = true;
    e.preventDefault();
    stopServer().finally(() => app.quit());
  });
  app.on('window-all-closed', () => app.quit());
}
