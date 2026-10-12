// Virtual node:fs for the offline server: data/*.json preloaded into globalThis.__SP_VFS (basename → text).
const vfs = () => globalThis.__SP_VFS || {};
const base = (p) => String(p).split('/').pop();
const enoent = (p) => Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
export function readdirSync(dir, opts) {
  if (!/\/data\/?$/.test(String(dir))) throw enoent(dir);
  const names = Object.keys(vfs()).sort();
  return opts && opts.withFileTypes ? names.map((name) => ({ name, isFile: () => true, isDirectory: () => false })) : names;
}
export function readFileSync(p) { const t = vfs()[base(p)]; if (t == null) throw enoent(p); return t; }
export function existsSync(p) { return vfs()[base(p)] != null; }
export function statSync(p) { if (!existsSync(p)) throw enoent(p); return { isFile: () => true, isDirectory: () => false, mtimeMs: 0, size: 0 }; }
export function watch() { return { close() {} }; }
export const promises = { readFile: async (p) => readFileSync(p), stat: async (p) => statSync(p), readdir: async (d) => readdirSync(d) };
export default { readdirSync, readFileSync, existsSync, statSync, watch, promises };
