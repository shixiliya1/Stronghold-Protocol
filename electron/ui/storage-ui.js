// ui/storage-ui.js — 存储管理 panel of the server picker, shared by the desktop app (main.js storageInfo / storageAction
// through preload.cjs) and the Android / web client (mobile/src/client/storage.js through web-api.js). The backend
// describes itself: info() → { title, rows: [{ id, label, bytes?, of?, text? }], actions: [{ id, label, danger?,
// confirm?, note? }], note? }; act(id) → { ok, message?, navigating? } | { error }. After an action the panel lists
// every row whose size changed as before → after.
(function (g) {
  'use strict';
  var fmt = function (n) {
    if (n == null || !isFinite(n)) return '';
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' GB';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  };
  /** Rows whose bytes changed: [{ label, before, after }]. */
  var diff = function (a, b) {
    var out = [];
    var prev = {};
    (a && a.rows || []).forEach(function (r) { prev[r.id] = r; });
    (b && b.rows || []).forEach(function (r) {
      var p = prev[r.id];
      if (p && typeof p.bytes === 'number' && typeof r.bytes === 'number' && p.bytes !== r.bytes) out.push({ id: r.id, label: r.label, before: p.bytes, after: r.bytes });
    });
    return out;
  };
  var rowText = function (r) {
    var t = [];
    if (typeof r.bytes === 'number') t.push(fmt(r.bytes) + (typeof r.of === 'number' && r.of > 0 ? ' / ' + fmt(r.of) : ''));
    if (r.text) t.push(r.text);
    return t.join(' · ');
  };
  var open = function (api) {
    if (!api || !api.storageInfo) return null;
    var old = document.getElementById('sp-storage');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'sp-storage';
    box.setAttribute('style', 'position:fixed;inset:0;z-index:2147483640;display:grid;place-items:center;background:rgba(6,9,8,.78);padding:12px;overflow:auto');
    box.innerHTML = '<section style="width:min(620px,96vw);background:#121a17;border:1px solid #2c3a35;border-radius:4px;padding:18px 22px;color:#d8e3de;font:14px/1.55 \'Noto Sans SC\',system-ui,sans-serif">'
      + '<div style="display:flex;justify-content:space-between;align-items:center"><h2 class="st-title" style="margin:0;font-size:17px">存储管理</h2><button class="ghost st-close">关闭</button></div>'
      + '<table class="st-rows" style="width:100%;border-collapse:collapse;margin:12px 0;font-size:13px"></table>'
      + '<p class="st-note" style="color:#9db5ab;font-size:12px;margin:4px 0"></p>'
      + '<div class="st-acts" style="display:flex;flex-wrap:wrap;gap:8px"></div>'
      + '<div class="st-msg" style="margin-top:12px;color:#4ed8af;font-size:13px;white-space:pre-line"></div></section>';
    document.body.appendChild(box);
    var q = function (s) { return box.querySelector(s); };
    var cur = null;
    var busy = false;
    q('.st-close').addEventListener('click', function () { box.remove(); });
    var render = function (info) {
      cur = info;
      q('.st-title').textContent = info.title || '存储管理';
      var t = q('.st-rows');
      t.textContent = '';
      (info.rows || []).forEach(function (r) {
        var tr = document.createElement('tr');
        tr.dataset.id = r.id;
        tr.innerHTML = '<td style="padding:4px 8px 4px 0;color:#9db5ab;white-space:nowrap;vertical-align:top"></td><td style="padding:4px 0;word-break:break-all"></td>';
        tr.children[0].textContent = r.label;
        tr.children[1].textContent = rowText(r);
        t.appendChild(tr);
      });
      q('.st-note').textContent = info.note || '';
      var acts = q('.st-acts');
      acts.textContent = '';
      (info.actions || []).forEach(function (a) {
        var b = document.createElement('button');
        b.className = a.danger ? 'ghost danger' : 'ghost';
        b.dataset.act = a.id;
        b.textContent = a.label;
        if (a.note) b.title = a.note;
        if (a.danger) b.style.color = '#ff7a6b';
        if (a.disabled) b.disabled = true;
        b.addEventListener('click', function () { run(a); });
        acts.appendChild(b);
      });
    };
    var refresh = function () { return Promise.resolve(api.storageInfo()).then(render); };
    var run = function (a) {
      if (busy) return;
      if (a.confirm && !g.confirm(a.confirm)) return;
      busy = true;
      var before = cur;
      q('.st-msg').style.color = '#9db5ab';
      q('.st-msg').textContent = a.label + '…';
      Promise.resolve(api.storageAction(a.id)).then(function (r) {
        if (r && r.error) throw new Error(r.error);
        if (r && r.navigating) { q('.st-msg').textContent = r.message || ''; return; }
        return Promise.resolve(api.storageInfo()).then(function (after) {
          render(after);
          var lines = diff(before, after).map(function (d) { return d.label + '：' + fmt(d.before) + ' → ' + fmt(d.after); });
          q('.st-msg').style.color = '#4ed8af';
          q('.st-msg').textContent = ((r && r.message) || '完成') + (lines.length ? '\n' + lines.join('\n') : '');
        });
      }).catch(function (e) {
        q('.st-msg').style.color = '#ff7a6b';
        q('.st-msg').textContent = String((e && e.message) || e);
      }).then(function () { busy = false; });
    };
    q('.st-msg').textContent = '正在统计…';
    refresh().then(function () { q('.st-msg').textContent = ''; }, function (e) { q('.st-msg').textContent = String((e && e.message) || e); });
    return box;
  };
  g.SPStorage = { open: open, diff: diff, fmt: fmt };
})(typeof window !== 'undefined' ? window : globalThis);
