// mobile/src/client/boot.js — first script of the game page in the server-less builds (Android app, GitHub Pages PWA).
// Picks the game server for this session (the picker in client/index.html, or a remembered choice), points
// public/js/net.js at it (localStorage sp.server), and for 离线单人 swaps in the in-page server
// (client/offline-server.js) behind the offline WebSocket URL. Pages: the page only runs under its service worker.
(function () {
  'use strict';
  var C = window.SP_CLIENT || {};
  var root = new URL(C.platform === 'pages' ? C.base : '/', location.href).href;
  var picker = root + 'client/index.html';
  var halt = function (to) { location.replace(to); document.write('<plaintext style="display:none">'); }; // swallow the rest of the page
  var get = function (s, k) { try { return s.getItem(k); } catch (e) { return null; } };

  // Android without the art pack installed yet: the picker downloads it first (client/art-ui.js)
  if (window.SP_ART && window.SP_ART.pack && !window.SP_ART.ready) { halt(picker); return; }
  if (C.platform === 'pages' && 'serviceWorker' in navigator && !navigator.serviceWorker.controller) { halt(picker); return; }

  var settings = {};
  try { settings = JSON.parse(get(localStorage, 'sp.client.settings') || '{}') || {}; } catch (e) { settings = {}; }
  var mode = get(sessionStorage, 'sp.client.mode');
  if (!mode) {
    if (settings.remember && settings.mode) { mode = settings.mode; try { sessionStorage.setItem('sp.client.mode', mode); } catch (e) { /* ignore */ } }
    else { halt(picker); return; }
  }
  var url = null;
  if (mode === 'cloud') url = C.cloud;
  else if (mode === 'offline') url = C.offlineUrl;
  else if (mode === 'custom') {
    var s = (settings.servers || []).filter(function (x) { return x.id === settings.serverId; })[0];
    url = s && s.ws;
  }
  if (!url) { try { sessionStorage.removeItem('sp.client.mode'); } catch (e) { /* ignore */ } halt(picker); return; }
  try { localStorage.setItem('sp.server', url); } catch (e) { /* ignore */ }

  if (mode === 'offline') {
    var Native = window.WebSocket;
    var Patched = function (u, p) {
      if (String(u).indexOf(C.offlineUrl) === 0) return new window.SPOffline.OfflineSocket(String(u), root);
      return p === undefined ? new Native(u) : new Native(u, p);
    };
    Patched.prototype = Native.prototype;
    Patched.CONNECTING = 0; Patched.OPEN = 1; Patched.CLOSING = 2; Patched.CLOSED = 3;
    window.WebSocket = Patched;
    window.__spOffline = new Promise(function (res) { window.__spOfflineResolve = res; });
    document.write('<script src="' + root + 'client/offline-socket.js"><\/script><script type="module" src="' + root + 'client/offline-server.js"><\/script>');
  }

  var LABEL = { cloud: '云服务器联机', offline: '离线单人', custom: '自定义服务器' };
  window.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = (LABEL[mode] || mode) + ' · 切换';
    b.setAttribute('style', 'position:fixed;left:40%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 4px);z-index:2147483647;'
      + 'font:12px/1.4 "Noto Sans SC",system-ui,sans-serif;color:#d8e3de;background:rgba(17,22,20,.82);border:1px solid #2c5a4c;'
      + 'border-radius:999px;padding:4px 12px;opacity:.85;transition:opacity .6s;touch-action:manipulation');
    b.addEventListener('click', function () {
      if (!confirm('回到服务器选择？（正在进行的对局会断开）')) return;
      try { sessionStorage.removeItem('sp.client.mode'); } catch (e) { /* ignore */ }
      location.href = picker;
    });
    document.body.appendChild(b);
    setTimeout(function () { b.style.opacity = '.25'; }, 6000);
  });
  if (C.platform === 'android') {
    window.addEventListener('load', function () {
      setTimeout(function () { import(root + 'client/updates.js').then(function (m) { m.autoCheck(); }).catch(function () {}); }, 4000);
    });
  }
})();
