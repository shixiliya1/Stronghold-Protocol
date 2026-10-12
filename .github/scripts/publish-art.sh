#!/usr/bin/env bash
# Build the art pack (art-pack.py) and publish it as release art-<hash12> — only when no release of that hash exists
# yet (the art changed). Every client release references the pack through the manifest embedded in it.
#   publish-art.sh OUT_DIR      → OUT_DIR/{art-pack.json,art-manifest.json,<zip>,<zip>.sha256}; env GH_TOKEN, GITHUB_REPOSITORY
# Writes ART_TAG / ART_HASH / ART_ZIP / ART_BYTES to $GITHUB_ENV when set.
set -euo pipefail
OUT="${1:?out dir}"
python3 .github/scripts/art-pack.py --root . --out "$OUT" > /dev/null
TAG=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['tag'])" "$OUT/art-pack.json")
ZIP=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['zip'])" "$OUT/art-pack.json")
HASH=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['hash'])" "$OUT/art-pack.json")
BYTES=$(stat -c %s "$OUT/$ZIP")
cat "$OUT/art-pack.json"
if [ -n "${GITHUB_ENV:-}" ]; then
  { echo "ART_TAG=$TAG"; echo "ART_HASH=$HASH"; echo "ART_ZIP=$ZIP"; echo "ART_BYTES=$BYTES"; } >> "$GITHUB_ENV"
fi
R="${GITHUB_REPOSITORY:?}"
if gh release view "$TAG" -R "$R" --json assets -q '.assets[].name' 2>/dev/null | grep -qx "$ZIP"; then
  echo "art pack $TAG already published — reused"
  exit 0
fi
NOTES="卫戍协议：盟约 美术资源包（游戏素材版权归原权利人，见 NOTICE.md；非官方同人，严禁盈利）。
桌面版 / Android 版首次启动时自动下载并校验（sha256），之后只有美术内容变化（hash 改变）才会重新下载；程序更新不含美术。
hash: $HASH"
if ! gh release view "$TAG" -R "$R" > /dev/null 2>&1; then
  gh release create "$TAG" -R "$R" --title "Art pack $TAG" --notes "$NOTES" --prerelease --latest=false \
    --target "${GITHUB_SHA:-HEAD}" || true
fi
gh release upload "$TAG" -R "$R" --clobber "$OUT/$ZIP" "$OUT/$ZIP.sha256" "$OUT/art-manifest.json" "$OUT/art-pack.json"
echo "published art pack $TAG ($BYTES bytes)"
