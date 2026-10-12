#!/usr/bin/env python3
"""Install the art of an upstream release (sganggs/Stronghold-Protocol) into a checkout.

The upstream full bundle `Stronghold-Protocol-v<version>.zip` carries every file of public/assets/ — including
public/assets/local/ + data/local-assets.json (the official 3D board, HUD icons and summon / enemy models that
`tools/setup.mjs` can only extract from a local Arknights client, so a CI runner never gets them) — and public/fonts/.
This downloads that zip from the upstream GitHub Release for the checkout's version, verifies its sha256 against the
digest GitHub publishes for the asset, and extracts only the art paths. `node tools/setup.mjs -y --no-local` afterwards
finds the files in place and fills anything missing from the public mirrors.

  python3 .github/scripts/upstream-art.py [--dest .] [--version 0.2.4] [--repo sganggs/Stronghold-Protocol] [--zip f]

Exit 0: installed; 3: the upstream release / asset / digest is missing (the caller may fall back to setup.mjs alone);
1: anything else (checksum mismatch, unsafe path, network error). GH_TOKEN / GITHUB_TOKEN is used for the API if set.
"""
import argparse, hashlib, json, os, shutil, sys, tempfile, urllib.error, urllib.request, zipfile

ROOT = 'Stronghold-Protocol/'
ART = ('public/assets/', 'public/fonts/')
ART_FILES = ('data/local-assets.json',)


def api(url):
    req = urllib.request.Request(url, headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'stronghold-desktop-ci'})
    tok = os.environ.get('GH_TOKEN') or os.environ.get('GITHUB_TOKEN')
    if tok:
        req.add_header('Authorization', f'Bearer {tok}')
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(url, dest):
    h = hashlib.sha256()
    req = urllib.request.Request(url, headers={'User-Agent': 'stronghold-desktop-ci'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            h.update(b)
            f.write(b)
    return h.hexdigest()


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def wanted(rel):
    return rel.startswith(ART) or rel in ART_FILES


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', default='.')
    ap.add_argument('--version')
    ap.add_argument('--repo', default='sganggs/Stronghold-Protocol')
    ap.add_argument('--zip', help='an already downloaded copy (still verified against the release digest)')
    a = ap.parse_args()
    dest = os.path.realpath(a.dest)
    version = a.version or json.load(open(os.path.join(dest, 'package.json'), encoding='utf-8'))['version']
    tag = f'v{version}'
    name = f'Stronghold-Protocol-{tag}.zip'
    try:
        rel = api(f'https://api.github.com/repos/{a.repo}/releases/tags/{tag}')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print(f'::warning::{a.repo} has no release {tag}; art comes from tools/setup.mjs alone')
            return 3
        raise
    asset = next((x for x in rel.get('assets', []) if x.get('name') == name), None)
    if not asset:
        print(f'::warning::{a.repo} release {tag} has no {name}; art comes from tools/setup.mjs alone')
        return 3
    digest = str(asset.get('digest') or '')
    if not digest.startswith('sha256:'):
        print(f'::warning::{name} has no published sha256 digest; not using an unverifiable download')
        return 3
    want = digest.split(':', 1)[1].lower()
    tmpdir = None
    if a.zip:
        zpath, got = a.zip, sha256_file(a.zip)
    else:
        tmpdir = tempfile.mkdtemp(prefix='upstream-art-')
        zpath = os.path.join(tmpdir, name)
        print(f'downloading {asset["browser_download_url"]} ({asset.get("size", 0) / 1e6:.0f} MB)', flush=True)
        got = download(asset['browser_download_url'], zpath)
    if got != want:
        print(f'::error::{name}: sha256 {got} does not match the release digest {want}')
        return 1
    print(f'{name}: sha256 {got} matches the release digest')
    n = size = 0
    with zipfile.ZipFile(zpath) as z:
        for info in z.infolist():
            if info.is_dir() or not info.filename.startswith(ROOT):
                continue
            rel_path = info.filename[len(ROOT):]
            if not wanted(rel_path):
                continue
            out = os.path.realpath(os.path.join(dest, rel_path))
            if not out.startswith(dest + os.sep) or '..' in rel_path.split('/'):
                print(f'::error::unsafe path in {name}: {info.filename}')
                return 1
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with z.open(info) as src, open(out, 'wb') as dst:
                shutil.copyfileobj(src, dst, 1 << 20)
            n += 1
            size += info.file_size
    if tmpdir:
        shutil.rmtree(tmpdir, ignore_errors=True)
    local = os.path.isfile(os.path.join(dest, 'data', 'local-assets.json'))
    print(f'installed {n} art files ({size / 1e6:.0f} MB) from {a.repo} {tag}; local-client art: {"yes" if local else "no"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
