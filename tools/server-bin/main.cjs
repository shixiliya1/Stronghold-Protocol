// tools/server-bin/main.cjs — the SEA main (CommonJS): unpack the embedded tree (asset 'tree': gzipped JSON { files: { rel: base64 } })
// once per content hash into the user cache dir (or --data-dir), then import tools/server-bin/entry.mjs from it.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const sea = require('node:sea');

function cacheRoot() {
  const i = process.argv.findIndex((a) => a === '--data-dir' || a.startsWith('--data-dir='));
  if (i > 0) return path.resolve(process.argv[i].includes('=') ? process.argv[i].split('=').slice(1).join('=') : process.argv[i + 1]);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'StrongholdServer');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'StrongholdServer');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'stronghold-server');
}

const blob = Buffer.from(sea.getAsset('tree'));
const hash = createHash('sha1').update(blob).digest('hex').slice(0, 12);
const dir = path.join(cacheRoot(), hash);
if (!fs.existsSync(path.join(dir, '.complete'))) {
  const { files } = JSON.parse(require('node:zlib').gunzipSync(blob).toString('utf8'));
  const tmp = `${dir}.tmp-${process.pid}`;
  for (const [rel, b64] of Object.entries(files)) {
    const f = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
  }
  fs.writeFileSync(path.join(tmp, '.complete'), hash);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
}
import(pathToFileURL(path.join(dir, 'tools', 'server-bin', 'entry.mjs')).href)
  .then((m) => m.main())
  .catch((e) => { console.error(e); process.exit(1); });
