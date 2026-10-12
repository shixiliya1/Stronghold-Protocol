// ui/art.js — progress page of the art-pack install (main.js prepareArt, electron/art.js).
const $ = (id) => document.getElementById(id);
const mb = (n) => `${(n / 1048576).toFixed(n > 1e9 ? 0 : 1)} MB`;
let last = { t: Date.now(), b: 0 };
let speed = 0;
function show(p) {
  if (!p) return;
  if (p.info) $('ver').textContent = `美术资源包 ${p.info.tag} · ${mb(p.info.bytes)} · ${p.info.files} 个文件`;
  $('err').hidden = p.phase !== 'error';
  $('retry').hidden = p.phase !== 'error';
  if (p.phase === 'check') {
    $('title').textContent = '正在检查本机已有的美术文件…';
    $('fill').style.width = `${(100 * p.filesDone / Math.max(1, p.files)).toFixed(1)}%`;
    $('files').textContent = `${p.filesDone} / ${p.files} 个文件`;
  } else if (p.phase === 'download') {
    $('title').textContent = p.files ? '正在下载美术资源…' : '正在完成…';
    $('fill').style.width = `${(100 * p.bytesDone / Math.max(1, p.bytes)).toFixed(1)}%`;
    $('files').textContent = `${p.filesDone} / ${p.files} 个文件`;
    $('bytes').textContent = `${mb(p.bytesDone)} / ${mb(p.bytes)}`;
    const now = Date.now();
    if (now - last.t > 1000) { speed = (p.bytesDone - last.b) / ((now - last.t) / 1000); last = { t: now, b: p.bytesDone }; }
    $('speed').textContent = speed > 0 ? `${mb(speed)}/s` : '';
    $('src').textContent = p.mirror ? `镜像 ${p.mirror}` : 'GitHub';
  } else if (p.phase === 'done') {
    $('title').textContent = '美术资源已就绪，正在进入游戏…';
    $('fill').style.width = '100%';
  } else if (p.phase === 'error') {
    $('title').textContent = '美术资源下载失败';
    $('err').textContent = `${p.message || ''}（已下载并校验的文件会保留，重试只下载剩余部分）`;
  }
}
window.spDesktop.onArtProgress(show);
window.spDesktop.artState().then(show);
$('retry').addEventListener('click', () => { $('retry').hidden = true; window.spDesktop.artRetry(); });
$('skip').addEventListener('click', () => { $('skip').disabled = true; $('title').textContent = '正在进入游戏（无美术模式）…'; window.spDesktop.artSkip(); });
