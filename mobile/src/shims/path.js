function norm(p) {
  const abs = p.startsWith('/'); const out = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return (abs ? '/' : '') + out.join('/');
}
export const sep = '/';
export const join = (...a) => norm(a.filter(Boolean).join('/')) || '.';
export const resolve = (...a) => { let p = ''; for (const s of a) p = s.startsWith('/') ? s : p + '/' + s; return norm(p) || '/'; };
export const dirname = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); };
export const basename = (p, ext) => { const b = String(p).split('/').pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };
export const relative = (a, b) => b;
export const isAbsolute = (p) => p.startsWith('/');
export default { sep, join, resolve, dirname, basename, extname, relative, isAbsolute };
