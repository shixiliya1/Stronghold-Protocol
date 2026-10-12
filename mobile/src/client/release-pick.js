// Pure: the newest non-draft release (semver tag) newer than `current` that carries an asset matching `re`.
import { parseSemver, compareSemver } from './update-check.js';

export function newestReleaseWith(releases, current, re, skip = '') {
  let best = null;
  for (const r of Array.isArray(releases) ? releases : []) {
    if (!r || r.draft || !parseSemver(r.tag_name)) continue;
    const asset = (r.assets || []).find((a) => re.test(a.name));
    if (!asset) continue;
    const version = String(r.tag_name).replace(/^v/, '');
    if (compareSemver(version, current) <= 0) continue;
    if (skip && compareSemver(version, skip) <= 0) continue;
    if (!best || compareSemver(version, best.version) > 0) best = { version, tag: r.tag_name, url: r.html_url, asset: asset.browser_download_url };
  }
  return best;
}
