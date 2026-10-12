// mobile/src/client/storage.js — the 存储管理 backend of the Android / web picker (window.spDesktop.storageInfo /
// storageAction for electron/ui/storage-ui.js; load after web-api.js).
//   Android: the ArtPack plugin (sizes of filesDir/art, the zip partial, leftovers, free space; clear / remove /
//            verify + repair / delete; 下载美术资源 → art-ui.js).
//   Web (PWA): navigator.storage.estimate / persisted / persist(), the service worker's caches (art 'sp-art-v1',
//            app shells 'sp-shell-<version>': older versions are leftovers).
(function () {
  'use strict';
  var api = window.spDesktop;
  if (!api) return;
  var C = window.SP_CLIENT || {};
  var A = window.SP_ART || null;
  var plugin = window.SP_ARTPACK || null;
  var ART_CACHE = 'sp-art-v1';
  var SHELL = 'sp-shell-' + C.version;
  var mb = function (n) { return (n / 1048576).toFixed(1) + ' MB'; };
  // which server uses which mod packs (public/js/resources.js records it on every join)
  function usageRows() {
    var all = {};
    try { all = JSON.parse(localStorage.getItem('sp.res.usage') || '{}') || {}; } catch (e) { all = {}; }
    return Object.keys(all).slice(0, 20).map(function (k) {
      var packs = (all[k].packs || []).map(function (p) { return (p.name || p.id) + (p.version ? ' ' + p.version : ''); }).join('、');
      return { id: 'srv:' + k, label: '  ' + k, text: packs ? '模组：' + packs : '只用基础美术' };
    });
  }

  function cacheSize(name) {
    return caches.open(name).then(function (c) {
      return c.keys().then(function (keys) {
        keys = keys.filter(function (k) { return !/\/overlay-map$/.test(k.url); });
        var total = 0;
        var bad = [];
        return keys.reduce(function (p, k) {
          return p.then(function () {
            return c.match(k).then(function (r) {
              if (!r || !r.ok) { bad.push(k); return; }
              var len = Number(r.headers.get('content-length'));
              if (len > 0) { total += len; return; }
              return r.clone().blob().then(function (b) { total += b.size; if (!b.size) bad.push(k); });
            });
          });
        }, Promise.resolve()).then(function () { return { bytes: total, files: keys.length, bad: bad, cache: c }; });
      });
    });
  }

  // every sp-cas-v1 entry must hash to its name; bad ones are deleted (downloaded again on the next join)
  function verifyCas() {
    if (typeof caches === 'undefined' || !crypto.subtle) return Promise.resolve(0);
    return caches.open('sp-cas-v1').then(function (c) {
      return c.keys().then(function (keys) {
        var bad = 0;
        return keys.reduce(function (p, k) {
          var h = k.url.split('/').pop();
          if (!/^[0-9a-f]{64}$/.test(h)) return p;
          return p.then(function () { return c.match(k); }).then(function (r) { return r.arrayBuffer(); })
            .then(function (b) { return crypto.subtle.digest('SHA-256', b); })
            .then(function (d) {
              var hex = Array.prototype.map.call(new Uint8Array(d), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
              if (hex !== h) { bad++; return c.delete(k); }
            });
        }, Promise.resolve()).then(function () { return bad; });
      });
    });
  }

  function webInfo() {
    var st = navigator.storage || {};
    var hasCaches = typeof caches !== 'undefined';
    return Promise.all([
      st.estimate ? st.estimate().catch(function () { return null; }) : null,
      st.persisted ? st.persisted().catch(function () { return null; }) : null,
      hasCaches ? caches.keys() : [],
    ]).then(function (r) {
      var est = r[0], persisted = r[1], keys = r[2] || [];
      var old = keys.filter(function (k) { return k.indexOf('sp-shell-') === 0 && k !== SHELL; });
      return Promise.all([
        keys.indexOf(ART_CACHE) >= 0 ? cacheSize(ART_CACHE) : { bytes: 0, files: 0 },
        Promise.all(old.map(cacheSize)),
        keys.indexOf('sp-cas-v1') >= 0 ? cacheSize('sp-cas-v1') : { bytes: 0, files: 0 },
      ]).then(function (s) {
        var art = s[0];
        var cas = s[2];
        var leftover = s[1].reduce(function (n, x) { return n + x.bytes; }, 0);
        var rows = [
          { id: 'art', label: '美术缓存（随玩随存）', bytes: art.bytes, text: art.files + ' 个文件' },
          { id: 'leftover', label: '旧版本程序缓存', bytes: leftover, text: old.length ? old.length + ' 个旧版本' : '无' },
          { id: 'cas', label: '服务器资源缓存（模组，按内容共享）', bytes: cas.bytes, text: cas.files + ' 个文件' },
        ].concat(usageRows());
        if (est) rows.push({ id: 'usage', label: '本站已用 / 配额', bytes: est.usage || 0, of: est.quota || 0 });
        rows.push({ id: 'persist', label: '持久存储', text: persisted == null ? '浏览器不支持' : persisted ? '已开启（浏览器不会自动清除）' : '未开启（空间紧张时浏览器可能清除缓存）' });
        var actions = [
          { id: 'clear-cache', label: '清除美术缓存', confirm: '清除美术缓存？之后用到的图片和声音会重新下载。' },
          { id: 'remove-leftover', label: '删除旧版本缓存', disabled: !old.length },
          { id: 'verify', label: '校验缓存', note: '检查缓存里的每个文件，删除损坏的（之后会自动重新下载）' },
          { id: 'clear-cas', label: '清除服务器资源缓存', confirm: '清除服务器模组资源缓存？再次进入这些服务器时会重新下载。' },
        ];
        if (persisted === false && st.persist) actions.unshift({ id: 'persist', label: '申请持久存储' });
        return { title: '存储管理', rows: rows, actions: actions, note: '网页版的美术随玩随下载并缓存在浏览器里。' };
      });
    });
  }

  function webAction(id) {
    if (id === 'persist') {
      return navigator.storage.persist().then(function (ok) { return ok ? { ok: true, message: '已开启持久存储' } : { error: '浏览器拒绝了持久存储（可先把网页添加到主屏幕再试）' }; });
    }
    if (id === 'clear-cas') return caches.delete('sp-cas-v1').then(function () { return { ok: true, message: '已清除服务器资源缓存' }; });
    if (id === 'clear-cache') return caches.delete(ART_CACHE).then(function () { return { ok: true, message: '已清除美术缓存' }; });
    if (id === 'remove-leftover') {
      return caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k.indexOf('sp-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
      }).then(function (d) { return { ok: true, message: '已删除 ' + d.length + ' 个旧版本缓存' }; });
    }
    if (id === 'verify') {
      return verifyCas().then(function () { return caches.keys(); }).then(function (keys) {
        if (keys.indexOf(ART_CACHE) < 0) return { ok: true, message: '没有美术缓存' };
        return cacheSize(ART_CACHE).then(function (s) {
          return Promise.all(s.bad.map(function (k) { return s.cache.delete(k); })).then(function () {
            return { ok: true, message: '校验完成：' + s.files + ' 个文件，' + s.bad.length + ' 个损坏已删除' };
          });
        });
      });
    }
    return Promise.resolve({ error: 'unknown action ' + id });
  }

  function androidInfo() {
    return plugin.storage().then(function (s) {
      var rows = [
        { id: 'art', label: '美术资源包' + (s.tag ? ' ' + s.tag : ''), bytes: s.artBytes, of: s.total || undefined, text: s.ready ? '已安装 · ' + s.artFiles + ' 个文件' : s.artFiles ? '未完整安装 · ' + s.artFiles + ' / ' + s.files + ' 个文件' : '未下载（无美术模式）' },
        { id: 'cache', label: '下载缓存（未完成的资源包）', bytes: s.partBytes, text: s.zipSize ? '共 ' + mb(s.zipSize) : '' },
        { id: 'leftover', label: '旧版美术残留', bytes: s.leftoverBytes },
        { id: 'cas', label: '服务器资源缓存（模组，按内容共享）', bytes: s.casBytes || 0, text: (s.casFiles || 0) + ' 个文件' },
        { id: 'free', label: '手机可用空间', bytes: s.free, of: s.size },
      ].concat(usageRows());
      return {
        title: '存储管理',
        rows: rows,
        note: s.running ? '美术资源正在下载…' : '',
        actions: [
          { id: 'redownload', label: s.ready ? '重新下载美术资源' : '下载美术资源' },
          { id: 'clear-cache', label: '清除下载缓存', confirm: s.partBytes ? '清除未完成的资源包？下次下载要从头开始。' : null },
          { id: 'remove-leftover', label: '删除旧版美术残留' },
          { id: 'verify', label: '校验并修复美术', note: '逐个检查 sha256，只重新下载损坏的文件', disabled: !s.artFiles },
          { id: 'clear-cas', label: '清除服务器资源缓存', confirm: '清除服务器模组资源缓存？再次进入这些服务器时会重新下载。' },
          { id: 'delete-art', label: '删除全部美术', danger: true, confirm: '删除全部美术资源？之后游戏以无美术模式运行，可随时在这里重新下载。' },
        ],
      };
    });
  }

  function androidAction(id) {
    var freed = function (r) { return mb((r && r.freed) || 0); };
    if (id === 'clear-cas') return plugin.casClear().then(function (r) { return { ok: true, message: '已清除服务器资源缓存 ' + freed(r) }; });
    if (id === 'clear-cache') return plugin.clearCache().then(function (r) { return { ok: true, message: '已清除下载缓存 ' + freed(r) }; });
    if (id === 'remove-leftover') return plugin.removeLeftover().then(function (r) { return { ok: true, message: '已删除旧版美术残留 ' + freed(r) }; });
    if (id === 'delete-art') return plugin.deleteArt().then(function (r) { if (window.SPArtUI) window.SPArtUI.skip(true); return { ok: true, message: '已删除全部美术 ' + freed(r) + '，游戏将以无美术模式运行' }; });
    if (id === 'verify') {
      return plugin.verify().then(function (r) {
        return { ok: true, message: '校验完成：' + r.checked + ' 个文件，' + r.bad + ' 个损坏' + (r.bad ? '，已重新下载 ' + r.repaired + ' 个' : '') };
      });
    }
    if (id === 'redownload') {
      var go = function () { if (window.SPArtUI) window.SPArtUI.open(true); return { ok: true, navigating: true, message: '正在下载美术资源…' }; };
      return plugin.storage().then(function (s) { return s.ready ? plugin.deleteArt().then(go) : go(); });
    }
    return Promise.resolve({ error: 'unknown action ' + id });
  }

  var android = C.platform === 'android' && plugin && A && A.pack;
  var web = C.platform === 'pages' && typeof caches !== 'undefined';
  if (!android && !web) return;
  api.storageInfo = android ? androidInfo : webInfo;
  api.storageAction = function (id) {
    return (android ? androidAction(id) : webAction(id)).catch(function (e) { return { error: String((e && e.message) || e) }; });
  };
})();
