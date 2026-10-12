// mobile/src/client/art-ui.js — Android: first start (or new art) downloads the art pack before the picker is usable.
// window.SP_ART comes from /client/art-state.js (answered by the app's ArtWebViewClient; the bundled stand-in says
// null = art inside the APK). The download itself runs natively (ArtPackPlugin: resume, mirrors, sha256, extract).
// 「跳过，先进入游戏」 (always shown) closes the dialog and remembers it for this pack (localStorage sp.art.skip = tag):
// the game then runs without art (missing images are simply not drawn). The picker's 存储管理 → 下载美术资源
// (storage.js) reopens it: window.SPArtUI.open(true). The download keeps running natively after a skip; a finished
// download is used from the next page load.
(function () {
  'use strict';
  var A = window.SP_ART;
  if (!A || !A.pack) return;
  var SKIP = 'sp.art.skip';
  var cap = window.Capacitor;
  var plugin = window.SP_ARTPACK || (cap && cap.registerPlugin ? cap.registerPlugin('ArtPack') : null);
  var mb = function (n) { return (n / 1048576).toFixed(1) + ' MB'; };
  var skipped = function () { try { return localStorage.getItem(SKIP) === String(A.tag); } catch (e) { return false; } };
  var setSkip = function (on) { try { if (on) localStorage.setItem(SKIP, String(A.tag)); else localStorage.removeItem(SKIP); } catch (e) { /* ignore */ } };
  var box = null;
  var listening = false;
  var $ = function (id) { return document.getElementById(id); };
  var show = function (p) {
    if (!p || !box || !box.isConnected) return;
    var pct = p.total ? (100 * p.bytes / p.total) : 0;
    $('ap-f').style.width = pct.toFixed(1) + '%';
    $('ap-e').style.display = p.phase === 'error' ? '' : 'none';
    $('ap-r').style.display = p.phase === 'error' ? '' : 'none';
    if (p.phase === 'download') { $('ap-s').textContent = '下载中' + (p.mirror ? '（镜像 ' + p.mirror + '）' : ''); $('ap-b').textContent = mb(p.bytes) + ' / ' + mb(p.total); }
    else if (p.phase === 'verify') { $('ap-s').textContent = '正在校验 sha256…'; }
    else if (p.phase === 'extract') { $('ap-s').textContent = '正在解压 ' + p.bytes + ' / ' + p.total + ' 个文件'; }
    else if (p.phase === 'done') { setSkip(false); $('ap-s').textContent = '完成，正在进入…'; setTimeout(function () { location.reload(); }, 300); }
    else if (p.phase === 'error') { $('ap-t').textContent = '美术资源下载失败'; $('ap-e').textContent = p.message || ''; }
  };
  var go = function () { if (plugin) plugin.start().catch(function (e) { show({ phase: 'error', message: String(e && e.message || e) }); }); };
  var open = function (force) {
    if (force) setSkip(false);
    if (box && box.isConnected) return;
    box = document.createElement('div');
    box.id = 'sp-art';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(11,15,14,.96);color:#d8e3de;font:14px/1.55 "Noto Sans SC",system-ui,sans-serif;padding:16px');
    box.innerHTML = '<div style="width:min(560px,92vw);background:#121a17;border:1px solid #2c3a35;border-radius:4px;padding:18px 22px">'
      + '<b id="ap-t" style="font-size:16px;color:#eaf5f0">首次启动需要下载美术资源包</b>'
      + '<p style="margin:6px 0;color:#9db5ab;font-size:13px">约 ' + mb(A.bytes || 0) + '，只下载一次；之后的 APK 更新不含美术，不会重复下载。建议使用 Wi-Fi。</p>'
      + '<div style="height:10px;background:#0d1311;border:1px solid #2c3a35;border-radius:999px;overflow:hidden;margin:10px 0 6px"><i id="ap-f" style="display:block;height:100%;width:0;background:#4ed8af"></i></div>'
      + '<div style="display:flex;justify-content:space-between;color:#9db5ab;font-size:13px"><span id="ap-s">准备中…</span><span id="ap-b"></span></div>'
      + '<p id="ap-e" style="color:#ff7a6b;word-break:break-all;display:none"></p>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px"><button id="ap-k" class="ghost">跳过，先进入游戏</button><button id="ap-r" class="primary" style="display:none">重试（断点续传）</button></div>'
      + '<p style="margin:8px 0 0;color:#7f978d;font-size:12px">跳过后以无美术模式游戏（图片不显示）；随时可在选服页「存储管理」里继续下载。</p></div>';
    document.body.appendChild(box);
    $('ap-k').addEventListener('click', function () { setSkip(true); box.remove(); });
    $('ap-r').addEventListener('click', function () { $('ap-r').style.display = 'none'; go(); });
    if (!plugin) { show({ phase: 'error', message: '缺少原生下载组件' }); return; }
    if (!listening) { listening = true; plugin.addListener('progress', show); }
    plugin.status().then(function (s) {
      if (s.ready && !force) { location.reload(); return; }
      if (s.last && s.last.phase !== 'done') show(s.last); else show({ phase: 'download', bytes: s.have || 0, total: s.total || 0 });
      if (!s.running) go();
    }, function (e) { show({ phase: 'error', message: String(e && e.message || e) }); });
  };
  window.SPArtUI = { open: open, skipped: skipped, skip: setSkip };
  window.addEventListener('DOMContentLoaded', function () { if (!A.ready && !skipped()) open(false); });
})();
