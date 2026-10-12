// electron/update-check.js — pure helpers of the updater (no Electron import; test/desktop-servers.test.js):
// semver comparison and "which GitHub release is the newest desktop build".

/** Parse `v1.2.3-pre.4` / `1.2.3`; null when it is not semver. */
export function parseSemver(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}

/** semver precedence: < 0 when a < b, 0 when equal, > 0 when a > b (invalid versions sort lowest). */
export function compareSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return (x ? 1 : 0) - (y ? 1 : 0);
  for (const k of ['major', 'minor', 'patch']) if (x[k] !== y[k]) return x[k] - y[k];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) - (y.pre.length ? -1 : 0) || 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p - +q; continue; }
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Desktop assets of a release (the GitHub API's `assets`). */
export function desktopAssets(release) {
  const assets = Array.isArray(release && release.assets) ? release.assets : [];
  const pick = (re) => assets.find((a) => re.test(a.name)) || null;
  return {
    zip: pick(/^Stronghold-Protocol-Desktop-.*-win-x64\.zip$/),
    setup: pick(/^Stronghold-Protocol-Desktop-Setup-.*\.exe$/),
  };
}

/**
 * The newest published desktop release newer than `current` (GitHub API `GET /repos/{o}/{r}/releases`), or null.
 * Drafts, non-semver tags and releases without a desktop asset are skipped; `skip` is a version the player skipped.
 */
export function newestDesktopRelease(releases, current, skip = '') {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || !parseSemver(r.tag_name)) continue;
    const a = desktopAssets(r);
    if (!a.zip && !a.setup) continue;
    const version = String(r.tag_name).replace(/^v/, '');
    if (compareSemver(version, current) <= 0) continue;
    if (skip && compareSemver(version, skip) <= 0) continue;
    if (!best || compareSemver(version, best.version) > 0) best = { version, tag: r.tag_name, url: r.html_url, notes: r.body || '', ...a };
  }
  return best;
}
