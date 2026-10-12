// electron/ui/chooser.js — the server picker (talks to main.js through preload.cjs window.spDesktop):
// presets (cloud / offline / host), saved custom servers (add / edit / delete), connectivity + version check, remember.
const api = window.spDesktop;
const $ = (s) => document.querySelector(s);
const status = (t) => { $('#status').textContent = t || ''; };
let st = null;
let servers = [];
let editing = null; // id of the server being edited, '' = a new one

function probeText(el, r) {
  el.className = 'probe';
  if (!r) { el.textContent = ''; return; }
  if (!r.ok) { el.classList.add('bad'); el.textContent = `离线 · ${r.error || '连接失败'}`; return; }
  const lvl = r.check ? r.check.level : 'ok';
  el.classList.add(lvl === 'ok' ? 'ok' : lvl === 'warn' ? 'warn' : 'bad');
  el.textContent = `在线 · ${r.latencyMs} ms${r.app ? ` · v${r.app}` : ''}${lvl !== 'ok' && r.check ? ` · ${r.check.text}` : ''}`;
}

/** Probe before connecting; a version mismatch asks first. @returns {Promise<boolean>} go on */
async function confirmServer(url, el) {
  status('正在检测服务器…');
  const r = await api.probe(url);
  if (el) probeText(el, r);
  if (!r.ok) return confirm(`服务器没有响应（${r.error || '连接失败'}）。\n仍要尝试连接吗？`);
  if (r.check && r.check.level !== 'ok') return confirm(`${r.check.text}。\n仍要连接吗？`);
  return true;
}

async function choose(mode, extra = {}, probeUrl = null, el = null) {
  document.body.classList.add('busy');
  try {
    if (probeUrl && !(await confirmServer(probeUrl, el))) { status(''); return; }
    status(mode === 'offline' || mode === 'host' ? '正在启动本机服务器…' : '正在连接…');
    const r = await api.choose(mode, { remember: $('#remember').checked, ...extra });
    if (r && r.error) status(r.error);
  } catch (e) {
    status(String((e && e.message) || e));
  } finally {
    document.body.classList.remove('busy');
  }
}

function render() {
  const ul = $('#list');
  ul.textContent = '';
  $('#empty').hidden = servers.length > 0;
  for (const s of servers) {
    const li = document.createElement('li');
    li.className = 'srv' + (st.last === 'custom' && st.serverId === s.id ? ' last' : '');
    li.innerHTML = '<div class="who"><b></b><small></small></div><span class="probe">检测中…</span>'
      + '<button class="go">连接</button><button class="act edit">编辑</button><button class="act del">删除</button>';
    li.querySelector('b').textContent = s.name || '未命名服务器';
    li.querySelector('small').textContent = s.url;
    const pe = li.querySelector('.probe');
    api.probe(s.url).then((r) => probeText(pe, r));
    li.querySelector('.go').addEventListener('click', () => choose('custom', { serverId: s.id }, s.url, pe));
    li.querySelector('.edit').addEventListener('click', () => openForm(s));
    li.querySelector('.del').addEventListener('click', async () => {
      if (!confirm(`删除「${s.name || s.url}」？`)) return;
      servers = await api.saveServers(servers.filter((x) => x.id !== s.id));
      render();
    });
    ul.appendChild(li);
  }
}

function openForm(s) {
  editing = s ? s.id : '';
  $('#form').hidden = false;
  $('#f-name').value = s ? s.name : '';
  $('#f-url').value = s ? s.url : '';
  $('#f-probe').textContent = '';
  showNorm();
  $('#f-url').focus();
}
async function showNorm() {
  const v = $('#f-url').value;
  const n = v.trim() ? await api.normalize(v) : null;
  $('#f-norm').textContent = !v.trim() ? '' : n ? `将连接：${n}` : '地址看不懂：请填 wss://域名/ws、ws://IP:端口/ws 或 http://IP:端口';
  return n;
}
$('#f-url').addEventListener('input', showNorm);
$('#add').addEventListener('click', () => openForm(null));
$('#f-cancel').addEventListener('click', () => { $('#form').hidden = true; editing = null; });
$('#f-test').addEventListener('click', async () => {
  if (!(await showNorm())) return;
  $('#f-probe').className = 'probe';
  $('#f-probe').textContent = '检测中…';
  probeText($('#f-probe'), await api.probe($('#f-url').value));
});
$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!(await showNorm())) return;
  const entry = { id: editing || `s${Date.now().toString(36)}`, name: $('#f-name').value.trim(), url: $('#f-url').value.trim() };
  servers = await api.saveServers(editing ? servers.map((x) => (x.id === editing ? entry : x)) : [...servers, entry]);
  $('#form').hidden = true;
  editing = null;
  render();
});

document.querySelectorAll('button.card').forEach((b) => b.addEventListener('click', () => {
  const m = b.dataset.mode;
  if (m === 'cloud') choose('cloud', {}, st.cloud, $('#probe-cloud'));
  else choose(m);
}));
// 存储管理 (ui/storage-ui.js): art pack, download cache, leftovers, free space; verify / repair / delete / download
if (api.storageInfo && window.SPStorage && $('#storage')) {
  $('#storage').hidden = false;
  $('#storage').addEventListener('click', () => window.SPStorage.open(api));
}
$('#update').addEventListener('click', async () => {
  $('#update').disabled = true;
  try { await api.checkUpdate(); } finally { $('#update').disabled = false; }
});

api.state().then((s) => {
  st = s;
  servers = s.servers || [];
  $('#remember').checked = !!s.remember;
  $('#ver').textContent = `桌面版 ${s.app} · 游戏 ${s.game}`;
  document.querySelectorAll('button.card').forEach((b) => b.classList.toggle('last', b.dataset.mode === s.last));
  if (s.error) status(s.error);
  render();
  api.probe(s.cloud).then((r) => probeText($('#probe-cloud'), r));
});
