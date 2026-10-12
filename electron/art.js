// electron/art.js — the game art outside the program: the desktop app ships without public/assets (≈650 MB) and keeps
// the art in userData/art, installed from the versioned art pack (.github/scripts/art-pack.py → release art-<hash12>).
//
// The pack is a zip of *stored* entries; its manifest (embedded in the app at build: resources/art-manifest.json) lists
// every file's path, size, sha256 and the byte offset of its data inside the zip. So the app
//   · reuses every local file that already matches (art from an earlier install, migrated art of desktop.3, an
//     interrupted download) — only what is missing or changed is fetched,
//   · fetches those files as HTTP Range spans of the zip (resume = the next run fetches only what is still missing;
//     each span is retried and falls back across mirrors),
//   · verifies the sha256 of every file before it is moved into place (a bad download is never served),
// and remembers the installed hash in art/.art-state.json (a later start only stats the files: fast).
// Pure Node (no electron import): test/electron-art.test.js runs it against a local HTTP server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const STATE_FILE = '.art-state.json';
export const MIRRORS = ['', 'https://ghfast.top/', 'https://gh-proxy.com/']; // gh-proxy ignores Range (whole zip): last
const GAP = 256 * 1024;        // merge files into one span when the bytes between them are at most this
const SPAN_MAX = 48 << 20;     // …and the span stays at most this big (granularity of retry / progress)
const PARALLEL = 3;

/** The zip URL of a manifest, plus its mirrors. */
export function packUrls(manifest, { base, mirrors = MIRRORS } = {}) {
  const b = base || manifest.base;
  const direct = `${String(b).replace(/\/+$/, '')}/${manifest.tag}/${manifest.zip}`;
  return mirrors.map((m) => (m ? m + direct : direct));
}

function safeRel(p) {
  const rel = String(p).replace(/\\/g, '/');
  if (!rel || rel.startsWith('/') || rel.split('/').some((s) => s === '..' || s === '')) throw new Error(`bad art path ${p}`);
  return rel;
}

async function sha256File(file) {
  const h = crypto.createHash('sha256');
  const s = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  for await (const b of s) h.update(b);
  return h.digest('hex');
}

async function statSize(file) {
  try { const st = await fsp.stat(file); return st.isFile() ? st.size : -1; } catch { return -1; }
}

export function readState(artDir) {
  try { return JSON.parse(fs.readFileSync(path.join(artDir, STATE_FILE), 'utf8')); } catch { return null; }
}

/** Quick: the installed art is this manifest's (state hash matches and every file has its size). */
export async function artReady(manifest, artDir) {
  const st = readState(artDir);
  if (!st || st.hash !== manifest.hash) return false;
  for (const e of manifest.entries) if (await statSize(path.join(artDir, safeRel(e.p))) !== e.s) return false;
  return true;
}

async function placeFrom(src, dst) {
  await fsp.mkdir(path.dirname(dst), { recursive: true });
  try { await fsp.rename(src, dst); } catch { await fsp.copyFile(src, dst); }
}

/** Group the entries to fetch into Range spans of the zip. */
export function planSpans(entries, { gap = GAP, max = SPAN_MAX } = {}) {
  const list = [...entries].sort((a, b) => a.o - b.o);
  const spans = [];
  for (const e of list) {
    const last = spans[spans.length - 1];
    if (last && e.o - last.end <= gap && e.o + e.s - last.start <= max) { last.entries.push(e); last.end = e.o + e.s; }
    else spans.push({ start: e.o, end: e.o + e.s, entries: [e] });
  }
  return spans;
}

/** Read exactly the body of a Range request, writing each entry to its .part, verifying its sha256. */
async function fetchSpan(url, span, artDir, { fetchImpl, onBytes, onFile, signal }) {
  const start = span.entries[0].o;
  const end = span.entries[span.entries.length - 1].o + span.entries[span.entries.length - 1].s;
  const res = await fetchImpl(url, { headers: { Range: `bytes=${start}-${end - 1}`, 'User-Agent': 'Stronghold-Protocol-Desktop' }, redirect: 'follow', signal });
  if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
  let pos = res.status === 206 ? start : 0; // a server ignoring Range sends the whole zip: skip to the span
  const queue = span.entries; // consumed as files complete: a retry continues with what is left
  let cur = null; // { e, fd, hash, got }
  const open = async (e) => {
    const file = path.join(artDir, safeRel(e.p));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    return { e, file, part: `${file}.part`, fh: await fsp.open(`${file}.part`, 'w'), hash: crypto.createHash('sha256'), got: 0 };
  };
  const close = async () => {
    await cur.fh.close();
    const sha = cur.hash.digest('hex');
    if (sha !== cur.e.h) { await fsp.rm(cur.part, { force: true }); throw new Error(`sha256 mismatch ${cur.e.p}`); }
    await fsp.rm(cur.file, { force: true });
    await fsp.rename(cur.part, cur.file);
    const e = cur.e;
    cur = null;
    onFile(e);
  };
  try {
    const reader = res.body.getReader();
    for (;;) {
      if (!queue.length && !cur) { try { await reader.cancel(); } catch { /* ignore */ } break; }
      const { value, done: eof } = await reader.read();
      if (eof) break;
      let buf = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      while (buf.length) {
        if (!cur) {
          const next = queue[0];
          if (!next) { buf = Buffer.alloc(0); break; }
          if (pos < next.o) { const skip = Math.min(next.o - pos, buf.length); pos += skip; buf = buf.subarray(skip); continue; }
          cur = await open(queue.shift());
          if (cur.e.s === 0) { await close(); continue; }
        }
        const take = Math.min(cur.e.s - cur.got, buf.length);
        const chunk = buf.subarray(0, take);
        cur.hash.update(chunk);
        await cur.fh.write(chunk);
        cur.got += take; pos += take; buf = buf.subarray(take);
        onBytes(take);
        if (cur.got === cur.e.s) await close();
      }
    }
    while (!cur && queue.length && queue[0].s === 0) { cur = await open(queue.shift()); await close(); }
  } finally {
    if (cur) { try { await cur.fh.close(); } catch { /* ignore */ } await fsp.rm(cur.part, { force: true }); onBytes(-cur.got); queue.unshift(cur.e); }
  }
  if (queue.length) throw new Error('short body');
}

/**
 * Make artDir hold exactly the manifest's art.
 *   manifest   { hash, tag, zip, base, entries: [{ p, s, h, o }] }
 *   legacyDirs directories laid out like the pack (assets/…, data/local-assets.json) whose matching files are reused
 *              (moved when `moveLegacy`, else copied)
 *   urls       the zip URLs, tried in order (packUrls)
 *   onProgress ({ phase: 'check'|'download'|'done', files, filesDone, bytes, bytesDone, mirror })
 */
export async function ensureArt({ manifest, artDir, legacyDirs = [], moveLegacy = false, urls, onProgress = () => {}, fetchImpl = globalThis.fetch, signal, retries = 3, retryDelay = 1500 }) {
  if (await artReady(manifest, artDir)) { onProgress({ phase: 'done', reused: manifest.entries.length, fetched: 0 }); return { status: 'ready', fetched: 0, reused: manifest.entries.length }; }
  await fsp.mkdir(artDir, { recursive: true });
  const total = manifest.entries.length;
  const need = [];
  let reused = 0;
  let migrated = 0;
  let checked = 0;
  const wanted = new Set();
  for (const e of manifest.entries) {
    const rel = safeRel(e.p);
    wanted.add(rel);
    const dst = path.join(artDir, rel);
    let ok = (await statSize(dst)) === e.s && (await sha256File(dst)) === e.h;
    if (!ok) {
      for (const dir of legacyDirs) {
        const src = path.join(dir, rel);
        if ((await statSize(src)) === e.s && (await sha256File(src)) === e.h) {
          await fsp.rm(dst, { force: true });
          if (moveLegacy) await placeFrom(src, dst); else { await fsp.mkdir(path.dirname(dst), { recursive: true }); await fsp.copyFile(src, dst); }
          ok = true; migrated++;
          break;
        }
      }
    } else reused++;
    if (!ok) need.push(e);
    if (++checked % 200 === 0) onProgress({ phase: 'check', files: total, filesDone: checked });
  }
  const bytes = need.reduce((n, e) => n + e.s, 0);
  let bytesDone = 0;
  let filesDone = 0;
  let mirror = 0;
  const report = () => onProgress({ phase: 'download', files: need.length, filesDone, bytes, bytesDone, mirror, url: urls[mirror] });
  report();
  const spans = planSpans(need);
  let failed = null;
  const work = async () => {
    for (;;) {
      if (failed) return;
      const span = spans.shift();
      if (!span) return;
      let attempt = 0;
      while (span.entries.length) {
        if (signal && signal.aborted) throw new Error('aborted');
        try {
          await fetchSpan(urls[mirror], span, artDir, { fetchImpl, signal, onBytes: (n) => { bytesDone += n; report(); }, onFile: () => { filesDone++; } });
          report();
        } catch (e) {
          if (signal && signal.aborted) throw e;
          if (++attempt >= retries) {
            if (mirror < urls.length - 1) { mirror++; attempt = 0; console.error(`[art] ${e.message}; mirror → ${urls[mirror]}`); }
            else { failed = e; return; }
          } else await new Promise((r) => setTimeout(r, retryDelay * attempt));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, spans.length || 1) }, work));
  if (failed) throw failed;
  // stale art (files of an older pack) and leftovers are removed
  await prune(artDir, wanted);
  await fsp.writeFile(path.join(artDir, STATE_FILE), JSON.stringify({ hash: manifest.hash, tag: manifest.tag, at: new Date().toISOString() }));
  onProgress({ phase: 'done', reused, migrated, fetched: need.length, bytes });
  return { status: 'installed', reused, migrated, fetched: need.length, bytes };
}

async function prune(artDir, wanted) {
  const walk = async (dir, rel) => {
    let list;
    try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const full = path.join(dir, d.name);
      if (!rel && d.name === STATE_FILE) continue;
      if (d.isDirectory()) { await walk(full, r); try { await fsp.rmdir(full); } catch { /* not empty */ } }
      else if (!wanted.has(r)) await fsp.rm(full, { force: true });
    }
  };
  await walk(artDir, '');
}

// ---- storage management (存储管理: ui/storage-ui.js through main.js) ----------------------------------------------

async function walkFiles(dir, rel, out) {
  let list;
  try { list = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) await walkFiles(full, r, out);
    else if (d.isFile()) { try { out.push([r, (await fsp.stat(full)).size]); } catch { /* gone */ } }
  }
  return out;
}

/**
 * What the art takes on disk: installed files of this manifest (artBytes / artFiles / missing), download partials
 * (`*.part`, partBytes), leftover files of older packs (leftoverBytes, plus every file under `extraDirs`, e.g.
 * userData/art-migrate), and whether the installed state is this manifest's.
 */
export async function artStorage(manifest, artDir, { extraDirs = [] } = {}) {
  const wanted = new Map((manifest ? manifest.entries : []).map((e) => [safeRel(e.p), e.s]));
  const out = { tag: manifest ? manifest.tag : null, total: manifest ? manifest.bytes : 0, files: wanted.size, artBytes: 0, artFiles: 0, partBytes: 0, leftoverBytes: 0, leftoverFiles: 0 };
  for (const [rel, size] of await walkFiles(artDir, '', [])) {
    if (rel === STATE_FILE) continue;
    if (rel.endsWith('.part')) out.partBytes += size;
    else if (wanted.get(rel) === size) { out.artBytes += size; out.artFiles++; }
    else { out.leftoverBytes += size; out.leftoverFiles++; }
  }
  for (const d of extraDirs) for (const [, size] of await walkFiles(d, '', [])) { out.leftoverBytes += size; out.leftoverFiles++; }
  out.missing = out.files - out.artFiles;
  const st = readState(artDir);
  out.ready = !!(manifest && st && st.hash === manifest.hash && out.missing === 0);
  return out;
}

/** Delete the download partials (`*.part`). @returns {Promise<number>} bytes freed */
export async function clearPartials(artDir) {
  let n = 0;
  for (const [rel, size] of await walkFiles(artDir, '', [])) if (rel.endsWith('.part')) { await fsp.rm(path.join(artDir, rel), { force: true }); n += size; }
  return n;
}

/** Delete files that are not part of this manifest (older packs, partials) and the `extraDirs`. */
export async function removeLeftovers(manifest, artDir, { extraDirs = [] } = {}) {
  await prune(artDir, new Set((manifest ? manifest.entries : []).map((e) => safeRel(e.p))));
  for (const d of extraDirs) await fsp.rm(d, { recursive: true, force: true });
}

/**
 * Re-check every installed file's sha256; bad ones are deleted and the installed state is dropped, so the next
 * ensureArt() re-downloads exactly those (repair). @returns {Promise<{ checked: number, bad: string[] }>}
 */
export async function verifyArt(manifest, artDir, { onProgress = () => {} } = {}) {
  const bad = [];
  let checked = 0;
  for (const e of manifest.entries) {
    const f = path.join(artDir, safeRel(e.p));
    const size = await statSize(f);
    if (size >= 0 && (size !== e.s || (await sha256File(f)) !== e.h)) { bad.push(e.p); await fsp.rm(f, { force: true }); }
    if (++checked % 200 === 0) onProgress({ phase: 'check', files: manifest.entries.length, filesDone: checked });
  }
  if (bad.length || (await artStorage(manifest, artDir)).missing) await fsp.rm(path.join(artDir, STATE_FILE), { force: true });
  return { checked, bad };
}
