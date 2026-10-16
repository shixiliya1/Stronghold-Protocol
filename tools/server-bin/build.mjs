#!/usr/bin/env node
// tools/server-bin/build.mjs [--out dist/server-bin] — the headless server as one executable for THIS platform (Node SEA):
//   the SEA main is main.cjs; the code (server/, shared/, tools/server-bin/entry.mjs, node_modules/ws, package.json) and
//   the data it reads (data/, packs/, docs/research/*.json) plus a one-page public/ ride in as the SEA asset 'tree'
//   (no bundling: the simulation's kits load through computed dynamic imports and top-level await).
//   Output: stronghold-server-<version>-<win-x64.exe|linux-x64|macos-arm64> (+ .sha256). Needs esbuild + postject
//   (npm i --no-save postject). The node binary injected is this one (process.execPath).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(outArg > 0 ? process.argv[outArg + 1] : path.join(ROOT, 'dist', 'server-bin'));
const WORK = path.join(OUT, '.work');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
const { APP_VERSION } = await import(pathToFileURL(path.join(ROOT, 'shared', 'constants.js')).href);

// 2. the data tree
const files = {};
const add = (abs, rel) => {
  const st = fs.statSync(abs);
  if (st.isDirectory()) { for (const n of fs.readdirSync(abs).sort()) if (!n.startsWith('.')) add(path.join(abs, n), `${rel}/${n}`); return; }
  files[rel] = fs.readFileSync(abs).toString('base64');
};
const skip = (rel) => /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(md|d\.ts)$/.test(rel);
const addTree = (rel) => add(path.join(ROOT, rel), rel);
for (const rel of ['server', 'shared', 'node_modules/ws']) addTree(rel);
for (const rel of Object.keys(files)) if (skip(rel)) delete files[rel];
// files outside those trees the server imports (0.3.0: server/plugins + server/studio import tools/assets/*.mjs,
// tools/golden.mjs): follow every static and literal dynamic relative import until nothing new is reached
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s*)['"](\.{1,2}\/[^'"]+)['"]/gm;
for (let grew = true; grew;) {
  grew = false;
  for (const rel of Object.keys(files)) {
    if (!/\.(m?js|cjs)$/.test(rel) || rel.startsWith('node_modules/')) continue;
    const src = Buffer.from(files[rel], 'base64').toString('utf8').replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``');
    for (const m of src.matchAll(IMPORT_RE)) {
      const dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
      if (files[dep] || dep.startsWith('..') || skip(dep)) continue;
      const abs = path.join(ROOT, dep);
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) { files[dep] = fs.readFileSync(abs).toString('base64'); grew = true; }
    }
  }
}
files['package.json'] = Buffer.from(JSON.stringify({ name: 'stronghold-server', version: APP_VERSION, type: 'module', private: true })).toString('base64');
files['tools/server-bin/entry.mjs'] = fs.readFileSync(path.join(HERE, 'entry.mjs')).toString('base64');
add(path.join(ROOT, 'data'), 'data');
add(path.join(ROOT, 'packs'), 'packs');
for (const n of fs.readdirSync(path.join(ROOT, 'docs', 'research')).filter((n) => n.endsWith('.json'))) add(path.join(ROOT, 'docs', 'research', n), `docs/research/${n}`);
files['public/index.html'] = fs.readFileSync(path.join(HERE, 'index.html')).toString('base64');
for (const rel of Object.keys(files)) if (/\.(png|webp|jpg|mp3|ogg|skel|atlas)$/i.test(rel) || rel.startsWith('data/assets/')) throw new Error(`art in the server tree: ${rel}`);
fs.writeFileSync(path.join(WORK, 'tree.json'), gzipSync(JSON.stringify({ files }), { level: 9 }));

// 3. SEA blob, injected into a copy of this node
const plat = process.platform === 'win32' ? 'win-x64' : process.platform === 'darwin' ? `macos-${process.arch}` : `linux-${process.arch}`;
const name = `stronghold-server-${APP_VERSION}-${plat}${process.platform === 'win32' ? '.exe' : ''}`;
const exe = path.join(OUT, name);
fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify({
  main: path.join(HERE, 'main.cjs'), output: path.join(WORK, 'sea.blob'), disableExperimentalSEAWarning: true,
  useCodeCache: false, useSnapshot: false, assets: { tree: path.join(WORK, 'tree.json') },
}));
execFileSync(process.execPath, ['--experimental-sea-config', path.join(WORK, 'sea-config.json')], { stdio: 'inherit' });
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);
if (process.platform === 'linux') { try { execFileSync('strip', [exe]); } catch { /* no strip: the larger binary still works */ } }
if (process.platform === 'darwin') execFileSync('codesign', ['--remove-signature', exe]);
const postject = path.join(ROOT, 'node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, exe, 'NODE_SEA_BLOB', path.join(WORK, 'sea.blob'), '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : [])], { stdio: 'inherit' });
if (process.platform === 'darwin') execFileSync('codesign', ['--sign', '-', exe]);
const sha = createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
fs.writeFileSync(exe + '.sha256', `${sha}  ${name}\n`);
fs.rmSync(WORK, { recursive: true, force: true });
console.log(`${name}  ${(fs.statSync(exe).size / 1048576).toFixed(1)} MB  sha256 ${sha}`);
