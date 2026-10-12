// mobile/scripts/build-www.mjs — the server-less web client: the game's browser files laid out exactly as the Node
// server serves them (/ → public/, /data/, /shared/, /sim/, /data.js, /packs/index.json), plus mobile/src/client
// (picker, boot, offline in-page server bundle). Used by the Android app (Capacitor, webDir www) and by the GitHub
// Pages PWA (service worker sw.js, any base path).
//
//   node scripts/build-www.mjs [--target android|pages] [--out DIR] [--base /Stronghold-Protocol/]
//                              [--cloud wss://host/ws] [--version 0.2.4-android.1] [--no-art-copy]
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.resolve(HERE, '..');
const ROOT = path.resolve(MOBILE, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const target = arg('target', 'android');
const OUT = path.resolve(arg('out', path.join(MOBILE, 'www')));
let BASE = arg('base', '/');
if (!BASE.endsWith('/')) BASE += '/';
const CLOUD = arg('cloud', 'wss://stronghold-xili.japaneast.cloudapp.azure.com/ws');
const GAME = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const VERSION = arg('version', JSON.parse(fs.readFileSync(path.join(MOBILE, 'package.json'), 'utf8')).version);
const { PROTOCOL_VERSION } = await import(pathToFileURL(path.join(ROOT, 'shared', 'constants.js')).href);

async function copyDir(src, dst, filter = () => true) {
  await fsp.mkdir(dst, { recursive: true });
  for (const e of await fsp.readdir(src, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d, filter);
    else if (e.isFile() && filter(s)) await fsp.copyFile(s, d);
  }
}

await fsp.rm(OUT, { recursive: true, force: true });
await copyDir(path.join(ROOT, 'public'), OUT, (f) => !f.includes(`${path.sep}dev${path.sep}`));
await copyDir(path.join(ROOT, 'data'), path.join(OUT, 'data'));
await copyDir(path.join(ROOT, 'shared'), path.join(OUT, 'shared'));
await copyDir(path.join(ROOT, 'server', 'sim'), path.join(OUT, 'sim'), (f) => f.endsWith('.js') && path.basename(f).toLowerCase() !== 'nodedata.js');
if (fs.existsSync(path.join(ROOT, 'packs'))) await copyDir(path.join(ROOT, 'packs'), path.join(OUT, 'packs'));

const { DATA_SHIM_JS } = await import(pathToFileURL(path.join(ROOT, 'server', 'http', 'static.js')).href);
await fsp.writeFile(path.join(OUT, 'data.js'), DATA_SHIM_JS);
if (!fs.existsSync(path.join(OUT, 'data', 'local-assets.json'))) {
  await fsp.writeFile(path.join(OUT, 'data', 'local-assets.json'), JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} }));
}
const dataNames = fs.readdirSync(path.join(ROOT, 'data')).filter((n) => n.endsWith('.json') && n !== 'local-assets.json').sort();
await fsp.writeFile(path.join(OUT, 'data', 'index.json'), JSON.stringify(dataNames));
const { createPackRegistry } = await import(pathToFileURL(path.join(ROOT, 'server', 'packs.js')).href);
const reg = createPackRegistry({ publicDir: path.join(ROOT, 'public'), dataDir: path.join(ROOT, 'data'), packsDir: path.join(ROOT, 'packs') }, { log: { info() {}, warn() {}, error() {}, debug() {} } });
await fsp.mkdir(path.join(OUT, 'packs'), { recursive: true });
await fsp.writeFile(path.join(OUT, 'packs', 'index.json'), JSON.stringify(reg.index()));
// a static stand-in for /healthz (the build guard reads `build`; none here, so it never reloads the page)
await fsp.writeFile(path.join(OUT, 'healthz'), JSON.stringify({ ok: true, app: GAME, protocol: PROTOCOL_VERSION }));

// client: picker (the desktop chooser, reused), boot, offline server
const CL = path.join(OUT, 'client');
await copyDir(path.join(MOBILE, 'src', 'client'), CL);
for (const f of ['servers.js', 'update-check.js']) await fsp.copyFile(path.join(ROOT, 'electron', f), path.join(CL, f));
await fsp.copyFile(path.join(ROOT, 'electron', 'ui', 'chooser.css'), path.join(CL, 'chooser.css'));
await fsp.writeFile(path.join(CL, 'chooser.js'), fs.readFileSync(path.join(ROOT, 'electron', 'ui', 'chooser.js'), 'utf8')
  .replace('`桌面版 ${s.app}', '`${s.appLabel || \'客户端\'} ${s.app}').replace("'正在启动本机服务器…'", "'正在进入…'"));
let chooser = fs.readFileSync(path.join(ROOT, 'electron', 'ui', 'chooser.html'), 'utf8');
chooser = chooser
  .replace(/<button class="card" data-mode="host">[\s\S]*?<\/button>\s*/, '')
  .replace(/（之后随时按[^）]*）/, '（游戏中点底部的模式标签可回到这里）')
  .replace('在这台电脑上运行游戏服务器，只本机可用，不需要联网。', '游戏服务器在本机运行，只自己玩，不需要联网。')
  .replace('画面素材从本机读取。', target === 'pages' ? '画面素材随用随缓存。' : '画面素材从本机读取。')
  .replace(/朋友开服时会显示地址[^<]*<code>[^<]*<\/code>。/, target === 'pages' ? '例如 <code>wss://域名/ws</code>（网页版只能连 wss:// 加密地址）。' : '例如 <code>wss://域名/ws</code> 或局域网朋友的 <code>http://192.168.1.23:3000</code>。')
  .replace(/script-src 'self'/, "script-src 'self'; connect-src 'self' https: wss: ws: http:")
  .replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />')
  .replace('<link rel="stylesheet" href="chooser.css" />', '<link rel="stylesheet" href="chooser.css" />\n<link rel="stylesheet" href="mobile.css" />\n<link rel="manifest" href="../manifest.json" />')
  .replace('<script src="chooser.js"></script>', '<script src="config.js"></script>\n<script src="web-api.js"></script>\n<script src="chooser.js"></script>');
await fsp.writeFile(path.join(CL, 'index.html'), chooser);
const config = { platform: target, version: VERSION, game: GAME, protocol: PROTOCOL_VERSION, cloud: CLOUD, base: BASE,
  repo: 'shixiliya1/Stronghold-Protocol', offlineUrl: 'ws://offline.invalid/ws' };
await fsp.writeFile(path.join(CL, 'config.js'), `window.SP_CLIENT = ${JSON.stringify(config)};\n`);

await build({
  entryPoints: [path.join(MOBILE, 'src', 'offline-server.js')],
  outfile: path.join(CL, 'offline-server.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  legalComments: 'none', logLevel: 'warning',
  banner: { js: 'var process=globalThis.process||{env:{}};globalThis.setImmediate||(globalThis.setImmediate=(f,...a)=>setTimeout(f,0,...a));' },
  // the simulation stays the served /sim/ copy the page itself uses (its content loads kits with computed dynamic
  // imports a bundle cannot follow; one module instance shared with the page)
  plugins: [{ name: 'sim-external', setup(b) {
    const SIM = path.join(ROOT, 'server', 'sim') + path.sep;
    b.onResolve({ filter: /^\.\.?\// }, (a) => {
      const abs = path.resolve(a.resolveDir, a.path);
      if (abs.startsWith(SIM)) return { path: '/sim/' + path.relative(SIM, abs).split(path.sep).join('/'), external: true };
      return null;
    });
  } }],
  alias: {
    'node:crypto': path.join(MOBILE, 'src/shims/crypto.js'), 'node:net': path.join(MOBILE, 'src/shims/net.js'),
    'node:fs': path.join(MOBILE, 'src/shims/fs.js'), 'node:fs/promises': path.join(MOBILE, 'src/shims/fs.js'),
    'node:path': path.join(MOBILE, 'src/shims/path.js'), 'node:url': path.join(MOBILE, 'src/shims/url.js'),
    'node:os': path.join(MOBILE, 'src/shims/empty.js'), ws: path.join(MOBILE, 'src/shims/empty.js'),
  },
});

// index.html: the boot script runs first (mode → server, offline socket, Pages service worker)
const idxPath = path.join(OUT, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
idx = idx.replace('<meta charset="utf-8" />', '<meta charset="utf-8" />\n  <script src="client/config.js"></script>\n  <script src="client/boot.js"></script>');
if (target === 'pages') {
  // The page keeps its root-relative URLs (/js/…, /sim/…, ../../shared/ clamping at the root): the service worker
  // answers every same-origin /x outside BASE with BASE/x under the *requested* URL, so module identity is unchanged.
  // Only the manifest / icon links (fetched outside the worker on some browsers) get the base.
  idx = idx.replace(/(<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*href=")\//g, `$1${BASE}`);
  const m = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
  Object.assign(m, { id: BASE, start_url: BASE, scope: BASE });
  m.icons = m.icons.map((i) => ({ ...i, src: BASE + i.src.replace(/^\//, '') }));
  await fsp.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(m, null, 2));
  const sw = fs.readFileSync(path.join(MOBILE, 'src', 'sw.js'), 'utf8')
    .replace('__BASE__', BASE).replace('__VERSION__', `${VERSION}-${Date.now().toString(36)}`);
  await fsp.writeFile(path.join(OUT, 'sw.js'), sw);
  await fsp.writeFile(path.join(OUT, '.nojekyll'), '');
  await fsp.writeFile(path.join(OUT, '404.html'), `<!doctype html><meta charset="utf-8"><script>location.replace(${JSON.stringify(BASE)})</script>`);
}
await fsp.writeFile(idxPath, idx);
console.log(`www (${target}, base ${BASE}, v${VERSION}, game ${GAME}) → ${OUT}`);
