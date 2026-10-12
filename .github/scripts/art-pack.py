#!/usr/bin/env python3
"""The game-art pack: everything the clients need that is art, apart from the program.

Art = public/assets/** + data/local-assets.json (the local-client art manifest). The pack is a zip with *stored*
(uncompressed — the files are png / mp3 / atlas, already compressed) entries in sorted order, so every file is one byte
range of the zip: the desktop app fetches only the ranges of the files it lacks or that changed (HTTP Range), the
Android app downloads the whole zip. Identity: `hash` = sha256 over the sorted "path\\0size\\0sha256\\n" lines — the
same art always gives the same hash, so a release only publishes a new pack when the art really changed (tag
art-<hash12>, reused by every client release with that art).

  python3 .github/scripts/art-pack.py --root . --out DIR      # → DIR/Stronghold-Protocol-Art-<h12>.zip,
                                                               #   DIR/art-manifest.json (files + offsets), DIR/art-pack.json
  python3 .github/scripts/art-pack.py --root . --hash-only     # print the hash (no zip)
"""
import argparse, hashlib, json, os, struct, sys, zipfile

ART_DIRS = ('public/assets',)
ART_FILES = ('data/local-assets.json',)
PREFIX = 'Stronghold-Protocol-Art-'


def collect(root):
    out = []
    for d in ART_DIRS:
        base = os.path.join(root, d)
        for dp, dns, fns in os.walk(base):
            dns[:] = sorted(x for x in dns if not x.startswith('.'))
            for fn in fns:
                if fn.startswith('.'):
                    continue
                full = os.path.join(dp, fn)
                rel = os.path.relpath(full, os.path.join(root, 'public')).replace(os.sep, '/')  # assets/…
                out.append((rel, full))
    for f in ART_FILES:
        full = os.path.join(root, f)
        if os.path.isfile(full):
            out.append((f, full))
    out.sort(key=lambda x: x[0])
    return out


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.')
    ap.add_argument('--out', default='art-pack')
    ap.add_argument('--hash-only', action='store_true')
    ap.add_argument('--base', default='https://github.com/%s/releases/download' % os.environ.get('GITHUB_REPOSITORY', 'shixiliya1/Stronghold-Protocol'),
                    help='release download base URL (the zip is <base>/<tag>/<zip>)')
    a = ap.parse_args()
    files = [(rel, full, os.path.getsize(full), sha256_file(full)) for rel, full in collect(a.root)]
    if not files:
        print('no art files found', file=sys.stderr)
        sys.exit(2)
    tree = hashlib.sha256()
    for rel, _, size, sha in files:
        tree.update(f'{rel}\0{size}\0{sha}\n'.encode())
    h = tree.hexdigest()
    if a.hash_only:
        print(h)
        return
    os.makedirs(a.out, exist_ok=True)
    name = f'{PREFIX}{h[:12]}.zip'
    zpath = os.path.join(a.out, name)
    with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_STORED, allowZip64=True) as z:
        for rel, full, _, _ in files:
            zi = zipfile.ZipInfo(rel, date_time=(2020, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_STORED
            zi.external_attr = 0o644 << 16
            with open(full, 'rb') as src, z.open(zi, 'w', force_zip64=False) as dst:
                for b in iter(lambda: src.read(1 << 20), b''):
                    dst.write(b)
    # data offsets of the entries (local header 30 bytes + name + extra)
    offs = {}
    with open(zpath, 'rb') as f, zipfile.ZipFile(zpath) as z:
        for zi in z.infolist():
            f.seek(zi.header_offset)
            hdr = f.read(30)
            n, m = struct.unpack('<HH', hdr[26:30])
            offs[zi.filename] = zi.header_offset + 30 + n + m
    entries = [{'p': rel, 's': size, 'h': sha, 'o': offs[rel]} for rel, _, size, sha in files]
    zsize = os.path.getsize(zpath)
    zsha = sha256_file(zpath)
    pack = {'version': 1, 'hash': h, 'tag': f'art-{h[:12]}', 'zip': name, 'zipSize': zsize, 'zipSha256': zsha,
            'files': len(entries), 'bytes': sum(e['s'] for e in entries), 'base': a.base}
    with open(os.path.join(a.out, 'art-pack.json'), 'w') as f:
        json.dump(pack, f, indent=2)
    with open(os.path.join(a.out, 'art-manifest.json'), 'w') as f:
        json.dump({**pack, 'entries': entries}, f, separators=(',', ':'))
    with open(zpath + '.sha256', 'w') as f:
        f.write(f'{zsha}  {name}\n')
    print(json.dumps(pack))


if __name__ == '__main__':
    main()
