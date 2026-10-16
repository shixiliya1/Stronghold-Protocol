// Packaged desktop app check (windows-client-release.yml): starting at main.js in the extracted app.asar, follow every
// relative import / require / path.join(HERE|GAME_ROOT, '…') recursively and fail if one does not resolve in the
// package. v0.2.5-desktop.3 / v0.2.6-desktop.1 shipped without electron/cas.js and crashed at launch.
// Usage: node tools/check-electron-pack.mjs <extracted app.asar dir> <resources/game dir>
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const [appDir, gameDir] = process.argv.slice(2).map((p) => path.resolve(p));
if (!appDir || !gameDir) { console.error('usage: check-electron-pack.mjs <appDir> <gameDir>'); process.exit(2); }
const builtins = new Set([...builtinModules, 'electron']);
const seen = new Set();
const missing = [];
const STR = String.raw`['"]([^'"]+)['"]`;
const patterns = [
  new RegExp(String.raw`(?:^|[\s;}])import\s[^'"]*?from\s*${STR}`, 'gm'),
  new RegExp(String.raw`(?:^|[\s;}])import\s*${STR}`, 'gm'),
  new RegExp(String.raw`(?:^|[\s;}])export\s[^'"]*?from\s*${STR}`, 'gm'),
  new RegExp(String.raw`\bimport\(\s*${STR}\s*\)`, 'g'),
  new RegExp(String.raw`\brequire\(\s*${STR}\s*\)`, 'g'),
];
const joinRe = /path\.join\(\s*(HERE|GAME_ROOT|root)\s*((?:,\s*['"][^'"]+['"]\s*)+)\)/g;

function resolveFile(p) {
  for (const c of [p, `${p}.js`, `${p}.mjs`, `${p}.cjs`, path.join(p, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}
function visit(file, from) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8').replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const inApp = file.startsWith(appDir + path.sep);
  const refs = [];
  const lazy = new Set(); // import('pkg') / require('pkg') of a bare package: loaded on demand (e.g. the plugin tools) — a warning only
  for (const [i, re] of patterns.entries()) for (const m of src.matchAll(re)) { if (m[1].includes('${')) continue; refs.push(m[1]); if (i >= 3) lazy.add(m[1]); }
  for (const m of src.matchAll(joinRe)) {
    const parts = [...m[2].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
    const base = m[1] === 'HERE' ? path.dirname(file) : gameDir;
    if (/\.(m?js|cjs)$/.test(parts.at(-1))) refs.push(path.join(base, ...parts));
  }
  for (const r of refs) {
    if (path.isAbsolute(r) || r.startsWith('.')) {
      const target = resolveFile(path.isAbsolute(r) ? r : path.resolve(path.dirname(file), r));
      if (!target) missing.push(`${path.relative(path.dirname(appDir), file)}: ${r}`);
      else if (target.endsWith('.js') || target.endsWith('.mjs') || target.endsWith('.cjs')) visit(target, file);
    } else {
      const name = r.replace(/^node:/, '').split('/').slice(0, r.startsWith('@') ? 2 : 1).join('/');
      if (builtins.has(name) || builtins.has(r.replace(/^node:/, ''))) continue;
      const roots = inApp ? [appDir] : [gameDir, path.dirname(gameDir)];
      if (roots.some((d) => fs.existsSync(path.join(d, 'node_modules', name)))) continue;
      if (lazy.has(r)) { console.log(`::warning::lazy package not shipped: ${path.relative(path.dirname(appDir), file)}: ${r}`); continue; }
      missing.push(`${path.relative(path.dirname(appDir), file)}: package ${r}`);
    }
  }
}
visit(path.join(appDir, 'main.js'));
console.log(`checked ${seen.size} modules from main.js`);
if (missing.length) { for (const m of missing) console.error(`::error::unresolved import ${m}`); process.exit(1); }
console.log('every import resolves');
