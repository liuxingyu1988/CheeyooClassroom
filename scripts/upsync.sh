#!/usr/bin/env bash
#
# Merge upstream/main into custom/main — the brand layer's sync entry point.
#
# Topology:
#   upstream/main ──merge──> custom/main   (brand layer lives here)
#       └──ff-only──> main                  (pure mirror, never edited)
#
# Merge, not rebase. A merge preserves the divergence point, so when a
# conflict appears you can tell which upstream commit introduced it by reading
# the merge history. A rebase flattens that history and force-pushes, and a
# force-push silently rewrites anyone else's work on custom/main.
#
# Stops on conflict. There is no "known-safe file" allowlist: predicting how
# upstream will next edit a file you both touch is a guess, and a wrong guess
# corrupts the brand silently.
set -euo pipefail

MIRROR_BRANCH=main
BRAND_BRANCH=custom/main

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty. Commit or stash before syncing." >&2
  exit 1
fi

echo "==> Fetching upstream"
git fetch upstream

# The mirror fast-forwards only. If it cannot, main has diverged from upstream
# and is not a mirror anymore — that is a bug to fix by hand, not to paper over.
echo "==> Fast-forwarding $MIRROR_BRANCH to upstream/main"
git checkout "$MIRROR_BRANCH"
if ! git merge --ff-only upstream/main; then
  echo "error: $MIRROR_BRANCH has diverged from upstream/main." >&2
  echo "       The mirror must never diverge. Reset it with:" >&2
  echo "         git checkout $MIRROR_BRANCH && git reset --hard upstream/main" >&2
  exit 1
fi
git push origin "$MIRROR_BRANCH"

echo "==> Merging upstream/main into $BRAND_BRANCH"
git checkout "$BRAND_BRANCH"
if ! git merge --no-edit upstream/main; then
  echo >&2
  echo "error: merge conflict. Resolve it, then re-run the gate and push:" >&2
  echo "         git add -A && pnpm check && pnpm test && pnpm build" >&2
  echo "         git commit && git push origin $BRAND_BRANCH" >&2
  echo >&2
  echo "       To inspect what upstream changed: git log --oneline HEAD..upstream/main" >&2
  exit 1
fi

# Nothing to merge — upstream had nothing new. Nothing to verify or push.
if [ -z "$(git log --oneline @{u}..HEAD 2>/dev/null)" ]; then
  echo "==> Already up to date."
  exit 0
fi

# build first: it runs assert-vendor-maic-importer.mjs, which catches a vendor
# drift that a merge upstream is the most likely thing to introduce.
echo "==> Verifying (check, test, build)"
pnpm check
pnpm test
pnpm build

echo "==> Pushing $BRAND_BRANCH"
git push origin "$BRAND_BRANCH"
echo "==> Done."