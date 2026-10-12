// electron/preload.cjs — the small bridge between the desktop shell (main.js) and its pages: the mode chooser
// (ui/chooser.html) and, on the game page, a small badge naming the mode (click / Ctrl+Shift+M → back to the chooser).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('spDesktop', {
  state: () => ipcRenderer.invoke('desktop:state'),
  choose: (mode, opts) => ipcRenderer.invoke('desktop:choose', mode, opts || {}),
  openChooser: () => ipcRenderer.invoke('desktop:chooser'),
  hostInfo: () => ipcRenderer.invoke('desktop:host-info'),
  probe: (url) => ipcRenderer.invoke('desktop:probe', url),
  normalize: (url) => ipcRenderer.invoke('desktop:normalize', url),
  saveServers: (list) => ipcRenderer.invoke('desktop:servers', list),
  checkUpdate: () => ipcRenderer.invoke('desktop:check-update'),
  artState: () => ipcRenderer.invoke('desktop:art-state'),
  artRetry: () => ipcRenderer.invoke('desktop:art-retry'),
  artSkip: () => ipcRenderer.invoke('desktop:art-skip'),
  storageInfo: () => ipcRenderer.invoke('desktop:storage-info'),
  storageAction: (id) => ipcRenderer.invoke('desktop:storage-action', id),
  onArtProgress: (fn) => { ipcRenderer.on('art:progress', (_e, p) => fn(p)); },
});

window.addEventListener('DOMContentLoaded', async () => {
  if (location.protocol !== 'app:') return;
  let st;
  try { st = await ipcRenderer.invoke('desktop:state'); } catch { return; }
  if (!st || !st.label) return;
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = `${st.label} · Ctrl+Shift+M 切换模式`;
  b.title = st.detail || '';
  b.setAttribute('style', [
    'position:fixed', 'left:50%', 'bottom:6px', 'transform:translateX(-50%)', 'z-index:2147483647',
    'font:12px/1.4 "Noto Sans SC",system-ui,sans-serif', 'color:#d8e3de', 'background:rgba(17,22,20,.82)',
    'border:1px solid #2c5a4c', 'border-radius:999px', 'padding:3px 12px', 'cursor:pointer',
    'opacity:.9', 'transition:opacity .6s',
  ].join(';'));
  b.addEventListener('click', () => ipcRenderer.invoke(st.mode === 'host' ? 'desktop:host-info' : 'desktop:chooser'));
  b.addEventListener('mouseenter', () => { b.style.opacity = '.9'; });
  b.addEventListener('mouseleave', () => { b.style.opacity = '.12'; });
  document.body.appendChild(b);
  setTimeout(() => { b.style.opacity = '.12'; }, 8000);
});
