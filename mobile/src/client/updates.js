// Android: is there a newer APK on the fork's GitHub Releases? Offers to open the download page (system browser).
import { newestReleaseWith } from './release-pick.js';

const C = window.SP_CLIENT || {};
const APK = /^Stronghold-Protocol-Android-.*\.apk$/;

export async function check(manual = false) {
  try {
    const r = await fetch(`https://api.github.com/repos/${C.repo}/releases?per_page=30`, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    let skip = '';
    try { skip = manual ? '' : localStorage.getItem('sp.android.skip') || ''; } catch { /* ignore */ }
    const best = newestReleaseWith(await r.json(), C.version, APK, skip);
    if (!best) { if (manual) alert(`已是最新版本（${C.version}）`); return { status: 'latest' }; }
    if (confirm(`发现新版本 ${best.version}（当前 ${C.version}）。\n打开下载页面安装吗？\n（取消 = 跳过这个版本）`)) {
      window.open(best.url, '_blank');
    } else {
      try { localStorage.setItem('sp.android.skip', best.version); } catch { /* ignore */ }
    }
    return { status: 'available', version: best.version };
  } catch (e) {
    if (manual) alert(`检查更新失败：${(e && e.message) || e}`);
    return { status: 'error' };
  }
}

export function autoCheck() {
  let last = 0;
  try { last = +localStorage.getItem('sp.android.lastCheck') || 0; } catch { /* ignore */ }
  if (Date.now() - last < 6 * 3600e3) return;
  try { localStorage.setItem('sp.android.lastCheck', String(Date.now())); } catch { /* ignore */ }
  check(false);
}
