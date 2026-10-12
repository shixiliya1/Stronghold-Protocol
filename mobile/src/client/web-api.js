// mobile/src/client/web-api.js — window.spDesktop for the reused desktop picker (electron/ui/chooser.js), in the
// browser: settings in localStorage, the probe / address helpers of electron/servers.js, Android update check,
// the Pages service worker (the game page only runs under it).
(function () {
  'use strict';
  var C = window.SP_CLIENT || {};
  var root = new URL(C.platform === 'pages' ? C.base : '/', location.href).href;
  var KEY = 'sp.client.settings';
  var lib = import('./servers.js');
  var load = function () { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } };
  var save = function (s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ } };
  var local = { app: C.game, protocol: C.protocol };

  var swReady = Promise.resolve();
  if (C.platform === 'pages') {
    swReady = !('serviceWorker' in navigator) ? Promise.reject(new Error('这个浏览器不支持 Service Worker（隐私模式？），网页版无法运行'))
      : navigator.serviceWorker.register(root + 'sw.js', { scope: root }).then(function () {
        if (navigator.serviceWorker.controller) return;
        return new Promise(function (res) { navigator.serviceWorker.addEventListener('controllerchange', function () { res(); }, { once: true }); });
      });
    swReady.catch(function () {});
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
  }

  window.spDesktop = {
    state: function () {
      var s = load();
      return Promise.resolve({
        mode: null, label: '', detail: '', error: '', remember: !!s.remember, last: s.mode || null, serverId: s.serverId || null,
        servers: (s.servers || []).map(function (x) { return { id: x.id, name: x.name, url: x.url }; }),
        cloud: C.cloud, game: C.game, protocol: C.protocol, app: C.version,
        appLabel: C.platform === 'android' ? '安卓版' : '网页版',
      });
    },
    choose: function (mode, opts) {
      opts = opts || {};
      return swReady.then(function () {
        var s = load();
        s.mode = mode; s.remember = !!opts.remember;
        if (mode === 'custom') s.serverId = opts.serverId;
        save(s);
        try { sessionStorage.setItem('sp.client.mode', mode); } catch (e) { /* ignore */ }
        location.href = root + 'index.html';
        return {};
      }, function (e) { return { error: String((e && e.message) || e) }; });
    },
    probe: function (url) {
      return lib.then(function (m) { return m.probeServer(String(url || ''), { local: local, timeoutMs: 4000 }); })
        .catch(function (e) { return { ok: false, error: String((e && e.message) || e) }; });
    },
    normalize: function (url) {
      return lib.then(function (m) {
        var n = m.toWsUrl(url);
        if (n && C.platform === 'pages' && n.indexOf('ws:') === 0) return null; // an https page cannot open ws://
        return n;
      });
    },
    saveServers: function (list) {
      return lib.then(function (m) {
        var s = load();
        s.servers = (Array.isArray(list) ? list : []).filter(function (x) { return x && m.toWsUrl(x.url); }).slice(0, 50)
          .map(function (x) { return { id: String(x.id).slice(0, 40), name: String(x.name || '').slice(0, 40), url: String(x.url).trim().slice(0, 300), ws: m.toWsUrl(x.url) }; });
        save(s);
        return s.servers.map(function (x) { return { id: x.id, name: x.name, url: x.url }; });
      });
    },
    checkUpdate: function () {
      if (C.platform === 'android') return import('./updates.js').then(function (m) { return m.check(true); });
      return navigator.serviceWorker && navigator.serviceWorker.getRegistration
        ? navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); })
          .then(function () { alert('已检查更新：有新版本时，下次打开会自动使用。'); return { status: 'ok' }; })
        : Promise.resolve({ status: 'error' });
    },
  };
})();
