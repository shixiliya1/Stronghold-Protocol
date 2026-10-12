#!/usr/bin/env bash
# Upstream sync for the fork (used by .github/workflows/upstream-sync-build.yml; runnable locally for a dry run).
#
#   upstream-sync.sh check   which upstream version is current, has the fork built a desktop release of it?
#                            → outputs: version, utag, uref, source (release|branch), build (true|false), tag
#   upstream-sync.sh merge   merge that upstream ref into the checked-out master (no force, no rebase)
#                            → outputs: ref (commit to build), merged (true|false|already)
#
# Upstream version: the latest GitHub Release of $UPSTREAM (a vX.Y.Z[-pre] tag), else package.json on its default
# branch. The fork's builds of it: tags v<version>-desktop.N (N = 1, 2, …) on $FORK. Nothing new → build=false
# (FORCE=true builds the next N anyway). A merge that conflicts, or that would change .github/workflows (the
# workflow's GITHUB_TOKEN may not push workflow files), stops: an issue on $FORK when issues are enabled, otherwise an
# error annotation + job summary; the run fails so GitHub notifies the owner.
# Env: UPSTREAM (sganggs/Stronghold-Protocol), UPSTREAM_URL (its git URL), FORK ($GITHUB_REPOSITORY), FORCE, DRY_RUN=1 (no push / issue),
#      GH_TOKEN for gh.
set -euo pipefail
UPSTREAM=${UPSTREAM:-sganggs/Stronghold-Protocol}
FORK=${FORK:-${GITHUB_REPOSITORY:-shixiliya1/Stronghold-Protocol}}
FORCE=${FORCE:-false}
DRY_RUN=${DRY_RUN:-0}
UPSTREAM_URL=${UPSTREAM_URL:-https://github.com/$UPSTREAM.git}
OUT=${GITHUB_OUTPUT:-/dev/stdout}
SEMVER='^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'

out() { echo "$1=$2" >> "$OUT"; }
summary() { if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; else printf '%s\n' "$@"; fi; }

stop_with_issue() { # title body
  local title=$1 body=$2
  echo "::error::$title"
  summary "## $title" "" "$body"
  if [ "$DRY_RUN" = 1 ]; then echo "(dry run: no issue)"; return 1; fi
  if [ "$(gh api "repos/$FORK" --jq .has_issues 2>/dev/null || echo false)" = true ]; then
    if gh issue list -R "$FORK" --state open --search "\"$title\" in:title" --json number --jq '.[0].number' | grep -q .; then
      echo "an open issue already says so"
    else
      gh issue create -R "$FORK" --title "$title" --body "$body" || echo "::warning::could not open an issue"
    fi
  else
    echo "::warning::issues are disabled on $FORK (Settings → General → Features → Issues); see the job summary"
  fi
  return 1
}

cmd_check() {
  local utag version uref source
  utag=$(gh api "repos/$UPSTREAM/releases/latest" --jq .tag_name 2>/dev/null || true)
  if printf '%s' "$utag" | grep -Eq "$SEMVER"; then
    version=${utag#v}; uref="refs/tags/$utag"; source=release
  else
    local branch
    branch=$(gh api "repos/$UPSTREAM" --jq .default_branch)
    version=$(gh api "repos/$UPSTREAM/contents/package.json?ref=$branch" --jq .content | base64 -d | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')
    utag="v$version"; uref="refs/heads/$branch"; source=branch
    if ! printf '%s' "$utag" | grep -Eq "$SEMVER"; then echo "::error::upstream version '$version' is not semver"; return 1; fi
  fi
  local esc n
  esc=$(printf '%s' "$version" | sed 's/[.]/\\./g')
  n=$( { gh api "repos/$FORK/releases" --paginate --jq '.[].tag_name' 2>/dev/null || true;
         git ls-remote --tags "https://github.com/$FORK.git" 2>/dev/null | sed 's#.*refs/tags/##; s#\^{}$##' || true; } \
       | grep -E "^v${esc}-desktop\.[0-9]+$" | sed 's/.*-desktop\.//' | sort -n | tail -1 || true)
  local build=false
  if [ -z "$n" ]; then build=true; n=0; elif [ "$FORCE" = true ]; then build=true; fi
  local tag="v${version}-desktop.$((n + 1))"
  echo "upstream $UPSTREAM: $utag (from $source, $uref); fork's newest desktop build of it: ${n:-none} → build=$build$( [ "$build" = true ] && echo " tag=$tag")"
  out version "$version"; out utag "$utag"; out uref "$uref"; out source "$source"; out build "$build"; out tag "$tag"
  if [ "$build" = true ]; then summary "Upstream $utag: building $tag"; else summary "Upstream $utag is already built (v${version}-desktop.$n) — nothing to do."; fi
}

cmd_merge() {
  local uref=${UREF:?UREF} utag=${UTAG:?UTAG}
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git remote get-url upstream > /dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"
  git fetch --no-tags --quiet upstream "+$uref:refs/remotes/upstream/sync-target"
  local target base
  target=$(git rev-parse 'refs/remotes/upstream/sync-target^{commit}')
  if git merge-base --is-ancestor "$target" HEAD; then
    echo "master already contains $UPSTREAM $utag ($target)"
    out merged already; out ref "$(git rev-parse HEAD)"; return 0
  fi
  base=$(git merge-base HEAD "$target" || true)
  local wf
  wf=$(git diff --name-only "${base:-$target}" "$target" -- .github/workflows || true)
  if [ -n "$wf" ]; then
    stop_with_issue "Upstream $utag changes workflow files — sync master manually" \
"$UPSTREAM $utag ($target) changes files under .github/workflows:

$(printf '%s\n' "$wf" | sed 's/^/- /')

The scheduled workflow's GITHUB_TOKEN may not push workflow changes, so the fork was left as it was. Merge by hand on a computer:

\`\`\`
git remote add upstream https://github.com/$UPSTREAM.git   # once
git fetch upstream --tags
git merge $utag
git push
\`\`\`
then run **Upstream sync & desktop build** again (or Windows client release with tag v${utag#v}-desktop.1)."
    return 1
  fi
  if ! git merge --no-ff --no-edit -m "Merge upstream $utag ($UPSTREAM)" "$target"; then
    local conflicts
    conflicts=$(git diff --name-only --diff-filter=U || true)
    git merge --abort || true
    stop_with_issue "Upstream $utag does not merge cleanly — sync master manually" \
"Merging $UPSTREAM $utag ($target) into master conflicts in:

$(printf '%s\n' "$conflicts" | sed 's/^/- /')

The merge was aborted; master is unchanged (nothing was force-pushed). Resolve on a computer:

\`\`\`
git remote add upstream https://github.com/$UPSTREAM.git   # once
git fetch upstream --tags
git merge $utag      # fix the conflicts, keep the desktop changes (electron/, .github/)
git commit
git push
\`\`\`
then run **Upstream sync & desktop build** again."
    return 1
  fi
  echo "merged $UPSTREAM $utag → $(git rev-parse HEAD)"
  out merged true; out ref "$(git rev-parse HEAD)"
}

cmd_push() {
  if [ "$DRY_RUN" = 1 ]; then echo "(dry run: not pushing $(git rev-parse HEAD))"; return 0; fi
  git push origin HEAD:master
}

case "${1:-}" in
  check) cmd_check ;;
  merge) cmd_merge ;;
  push) cmd_push ;;
  *) echo "usage: $0 check|merge|push" >&2; exit 2 ;;
esac
