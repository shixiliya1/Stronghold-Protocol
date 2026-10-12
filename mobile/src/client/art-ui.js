// mobile/src/client/art-ui.js — Android: first start (or new art) downloads the art pack before the picker is usable.
// window.SP_ART comes from /client/art-state.js (answered by the app's ArtWebViewClient; the bundled stand-in says
// null = art inside the APK). The download itself runs natively (ArtPackPlugin: resume, mirrors, sha256, extract).
(function () {
  'use strict';
  var A = window.SP_ART;
  if (!A || !A.pack || A.ready) return;
  var cap = window.Capacitor;
  var plugin = window.SP_ARTPACK || (cap && cap.registerPlugin ? cap.registerPlugin('ArtPack') : null);
  var mb = function (n) { return (n / 1048576).toFixed(1) + ' MB'; };
  var box = document.createElement('div');
  box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483646;display:grid;place-items:center;background:rgba(11,15,14,.96);color:#d8e3de;font:14px/1.55 "Noto Sans SC",system-ui,sans-serif;padding:16px');
  box.innerHTML = '<div style="width:min(560px,92vw);background:#121a17;border:1px solid #2c3a35;border-radius:4px;padding:18px 22px">'
    + '<b id="ap-t" style="font-size:16px;color:#eaf5f0">首次启动需要下载美术资源包</b>'
    + '<p style="margin:6px 0;color:#9db5ab;font-size:13px">约 ' + mb(A.bytes || 0) + '，只下载一次；之后的 APK 更新不含美术，不会重复下载。建议使用 Wi-Fi。</p>'
    + '<div style="height:10px;background:#0d1311;border:1px solid #2c3a35;border-radius:999px;overflow:hidden;margin:10px 0 6px"><i id="ap-f" style="display:block;height:100%;width:0;background:#4ed8af"></i></div>'
    + '<div style="display:flex;justify-content:space-between;color:#9db5ab;font-size:13px"><span id="ap-s">准备中…</span><span id="ap-b"></span></div>'
    + '<p id="ap-e" style="color:#ff7a6b;word-break:break-all;display:none"></p>'
    + '<div style="text-align:right;margin-top:10px"><button id="ap-r" class="primary" style="display:none">重试（断点续传）</button></div></div>';
  var $ = function (id) { return document.getElementById(id); };
  var show = function (p) {
    if (!p) return;
    var pct = p.total ? (100 * p.bytes / p.total) : 0;
    $('ap-f').style.width = pct.toFixed(1) + '%';
    $('ap-e').style.display = p.phase === 'error' ? '' : 'none';
    $('ap-r').style.display = p.phase === 'error' ? '' : 'none';
    if (p.phase === 'download') { $('ap-s').textContent = '下载中' + (p.mirror ? '（镜像 ' + p.mirror + '）' : ''); $('ap-b').textContent = mb(p.bytes) + ' / ' + mb(p.total); }
    else if (p.phase === 'verify') { $('ap-s').textContent = '正在校验 sha256…'; }
    else if (p.phase === 'extract') { $('ap-s').textContent = '正在解压 ' + p.bytes + ' / ' + p.total + ' 个文件'; }
    else if (p.phase === 'done') { $('ap-s').textContent = '完成，正在进入…'; setTimeout(function () { location.reload(); }, 300); }
    else if (p.phase === 'error') { $('ap-t').textContent = '美术资源下载失败'; $('ap-e').textContent = p.message || ''; }
  };
  var go = function () { if (plugin) plugin.start().catch(function (e) { show({ phase: 'error', message: String(e && e.message || e) }); }); };
  window.addEventListener('DOMContentLoaded', function () {
    document.body.appendChild(box);
    if (!plugin) { show({ phase: 'error', message: '缺少原生下载组件' }); return; }
    plugin.addListener('progress', show);
    plugin.status().then(function (s) { if (s.ready) { location.reload(); return; } if (s.last) show(s.last); else show({ phase: 'download', bytes: s.have || 0, total: s.total || 0 }); go(); });
    $('ap-r').addEventListener('click', function () { $('ap-r').style.display = 'none'; go(); });
  });
})();
