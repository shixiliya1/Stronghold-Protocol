// electron/updater.js — 检查更新 (at start, quietly; from the chooser / Ctrl+Shift+U, with an answer either way).
//
// Two install kinds, two paths (see README.md「自动更新」):
//   * installed with the NSIS setup (Stronghold-Protocol-Desktop-Setup-<v>.exe; an uninstaller sits next to the exe):
//     electron-updater with the GitHub provider — the release's <channel>.yml + .blockmap → download (differential when
//     possible) with progress → 「重启并安装」;
//   * the portable zip (nothing to update in place safely): the GitHub releases API names the newest desktop release →
//     download its zip into 下载 with progress and show it in the folder (or open the release page).
// A version the player chose to skip is not offered again. SP_UPDATE_FEED=<file or URL> replaces the releases API (tests).

import { app, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { newestDesktopRelease } from './update-check.js';

const OWNER = 'shixiliya1';
const REPO = 'Stronghold-Protocol';
// SP_UPDATE_TEST_ANSWERS="0,1": answer the dialogs in order instead of showing them (headless tests); each one is logged.
const testAnswers = process.env.SP_UPDATE_TEST_ANSWERS != null ? process.env.SP_UPDATE_TEST_ANSWERS.split(',').map(Number) : null;
async function ask(win, opts) {
  if (testAnswers) {
    const response = testAnswers.length ? testAnswers.shift() : (opts.cancelId ?? 0);
    console.log(`[update] dialog "${opts.message}" [${(opts.buttons || ['OK']).join('|')}] -> ${response}`);
    return { response };
  }
  return win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
}

const RELEASES_API = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=20`;

/** Installed by the NSIS setup (electron-updater can replace it) rather than unzipped. */
export function isInstalled() {
  if (!app.isPackaged || process.platform !== 'win32') return false;
  const dir = path.dirname(process.execPath);
  try { return fs.readdirSync(dir).some((f) => /^Uninstall .*\.exe$/i.test(f)); } catch { return false; }
}

async function fetchReleases() {
  const feed = process.env.SP_UPDATE_FEED;
  if (feed && !/^https?:/i.test(feed)) return JSON.parse(fs.readFileSync(feed, 'utf8'));
  const res = await fetch(feed || RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'stronghold-protocol-desktop' }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}

/**
 * @param {{ getWin: () => Electron.BrowserWindow | null, getSkip: () => string, setSkip: (v: string) => void,
 *           log?: (m: string) => void }} deps
 */
export function createUpdater(deps) {
  const log = deps.log || ((m) => console.log(m));
  let busy = false;
  let updater = null; // electron-updater's autoUpdater (installed builds only)

  const progress = (p) => {
    const w = deps.getWin();
    if (!w) return;
    w.setProgressBar(p < 0 ? -1 : p);
    w.setTitle(p < 0 ? '卫戍协议：盟约' : `卫戍协议：盟约 — 正在下载更新 ${Math.round(p * 100)}%`);
  };

  async function offer(version, notes) {
    const w = deps.getWin();
    const r = await ask(w, {
      type: 'info', title: '发现新版本', message: `发现新版本 ${version}（当前 ${app.getVersion()}）`,
      detail: (String(notes || '').slice(0, 600) || '').trim() || undefined,
      buttons: ['下载更新', '以后再说', '跳过这个版本'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 2) deps.setSkip(version);
    return r.response === 0;
  }

  async function viaElectronUpdater(manual) {
    if (!updater) {
      const mod = await import('electron-updater');
      updater = (mod.default || mod).autoUpdater;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.logger = { info: log, warn: log, error: log, debug: () => {} };
      updater.on('download-progress', (p) => progress((p.percent || 0) / 100));
    }
    const result = await updater.checkForUpdates();
    const info = result && result.updateInfo;
    const version = info && info.version;
    if (!result || !result.isUpdateAvailable || !version || version === deps.getSkip() && !manual) {
      if (manual) await ask(deps.getWin(), { type: 'info', title: '检查更新', message: `已是最新版本（${app.getVersion()}）` });
      return { status: 'up-to-date' };
    }
    if (!(await offer(version, info.releaseNotes))) return { status: 'declined', version };
    progress(0);
    try { await updater.downloadUpdate(); } finally { progress(-1); }
    const r = await ask(deps.getWin(), {
      type: 'info', title: '更新已下载', message: `新版本 ${version} 已下载完成`, buttons: ['重启并安装', '稍后'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) setImmediate(() => updater.quitAndInstall(false, true));
    return { status: 'downloaded', version };
  }

  async function viaReleases(manual) {
    const best = newestDesktopRelease(await fetchReleases(), app.getVersion(), manual ? '' : deps.getSkip());
    if (!best) {
      if (manual) await ask(deps.getWin(), { type: 'info', title: '检查更新', message: `已是最新版本（${app.getVersion()}）` });
      return { status: 'up-to-date' };
    }
    log(`[update] newer release ${best.tag}`);
    if (!(await offer(best.version, best.notes))) return { status: 'declined', version: best.version };
    const asset = best.zip || best.setup;
    if (!asset || !asset.browser_download_url) { shell.openExternal(best.url); return { status: 'opened', version: best.version }; }
    const dest = path.join(app.getPath('downloads'), asset.name);
    progress(0);
    try {
      const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'stronghold-protocol-desktop' } });
      if (!res.ok || !res.body) throw new Error(`下载失败（${res.status}）`);
      const total = Number(res.headers.get('content-length')) || asset.size || 0;
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      let got = 0;
      for await (const chunk of res.body) {
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (total) progress(got / total);
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
      fs.renameSync(tmp, dest);
    } finally { progress(-1); }
    const r = await ask(deps.getWin(), {
      type: 'info', title: '更新已下载', message: `新版本 ${best.version} 已下载到「下载」文件夹`,
      detail: `${dest}\n\n便携版的更新方法：关闭游戏 → 解压新的 zip → 以后用新文件夹里的 卫戍协议.exe（存档在本机用户目录，不受影响）。安装版会自动更新。`,
      buttons: ['打开所在文件夹', '好的'], defaultId: 0, cancelId: 1,
    });
    if (r.response === 0) shell.showItemInFolder(dest);
    return { status: 'downloaded', version: best.version, path: dest };
  }

  return {
    /** @param {boolean} manual true: from the menu (always answers); false: at start (quiet unless there is news) */
    async check(manual = false) {
      if (busy) return { status: 'busy' };
      busy = true;
      try {
        return isInstalled() ? await viaElectronUpdater(manual) : await viaReleases(manual);
      } catch (e) {
        log(`[update] check failed: ${e && e.message}`);
        if (manual) await ask(deps.getWin(), { type: 'warning', title: '检查更新', message: '检查更新失败', detail: String(e && e.message || e) });
        return { status: 'error', error: String(e && e.message || e) };
      } finally { busy = false; }
    },
  };
}
