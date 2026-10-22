#!/usr/bin/env bash
# Kiln (G): give every commit on main the GitHub private address before the FIRST public push
# (BUILD-STATUS publish condition: no personal email in any commit). Rewrites main's history, so:
#   - run it once, in the main folder, on main, after every agent branch is merged;
#   - it refuses if origin already has main (published history is never rewritten);
#   - it keeps a backup bundle in .git/ and moves every clean, merged worktree branch to the new main.
#
#   tools/qa/rewrite-authors.sh          says what it would rewrite, changes nothing
#   tools/qa/rewrite-authors.sh --yes    rewrites

set -euo pipefail

export KILN_EMAIL="239009854+Pug2025@users.noreply.github.com"
export KILN_NAME="Pug2025"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
die() { printf 'rewrite-authors: %s\n' "$*" >&2; exit 1; }

[ "$(git rev-parse --show-toplevel)" = "$ROOT" ] || die "not at the repo top"
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] || die "run it in the main folder, not in a worktree"
[ "$(git symbolic-ref --short -q HEAD || true)" = "main" ] || die "check out main first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "main has uncommitted changes"
[ ! -d .merge-lock ] || die "a merge is in progress (.merge-lock exists)"
if git remote get-url origin >/dev/null 2>&1 && git ls-remote --exit-code origin refs/heads/main >/dev/null 2>&1; then
  die "origin already has main; published history is never rewritten"
fi

BAD="$(git log --format='%H %ae %ce' main | awk -v e="$KILN_EMAIL" '$2 != e || $3 != e { print $1 }')"
if [ -z "$BAD" ]; then echo "every commit on main already uses $KILN_EMAIL; nothing to do"; exit 0; fi
echo "commits to rewrite: $(printf '%s\n' "$BAD" | wc -l | tr -d ' ') of $(git rev-list --count main)"
git log --format='  %h %ae | %ce  %s' main | grep -v "$KILN_EMAIL | $KILN_EMAIL" || true

UNMERGED="$(git branch --format='%(refname:short)' --no-merged main)"
[ -z "$UNMERGED" ] || die "branches with work not on main: $UNMERGED (merge them first)"
WORKTREES=()
while IFS= read -r wt; do
  [ "$wt" = "$ROOT" ] && continue
  [ -z "$(git -C "$wt" status --porcelain --untracked-files=no)" ] || die "worktree $wt has uncommitted changes"
  WORKTREES+=("$wt")
done < <(git worktree list --porcelain | sed -n 's/^worktree //p')

if [ "${1:-}" != "--yes" ]; then echo "dry run: nothing changed. Run with --yes to rewrite."; exit 0; fi

BACKUP=".git/kiln-before-rewrite-$(date -u +%Y%m%dT%H%M%SZ).bundle"
git bundle create "$BACKUP" main >/dev/null 2>&1
echo "backup: $BACKUP"

FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --env-filter '
  if [ "$GIT_AUTHOR_EMAIL" != "$KILN_EMAIL" ]; then export GIT_AUTHOR_EMAIL="$KILN_EMAIL" GIT_AUTHOR_NAME="$KILN_NAME"; fi
  if [ "$GIT_COMMITTER_EMAIL" != "$KILN_EMAIL" ]; then export GIT_COMMITTER_EMAIL="$KILN_EMAIL" GIT_COMMITTER_NAME="$KILN_NAME"; fi
' -- main >/dev/null
git update-ref -d refs/original/refs/heads/main 2>/dev/null || true
git config user.email "$KILN_EMAIL"
git config user.name "$KILN_NAME"

for wt in "${WORKTREES[@]+"${WORKTREES[@]}"}"; do
  git -C "$wt" reset -q --hard main
  echo "moved $(git -C "$wt" symbolic-ref --short -q HEAD || echo detached) in $wt to the new main"
done
# Other local branches were fully merged (checked above): point them at the new main too, so a
# later merge can never bring the old commits (and the old address) back.
CHECKED_OUT="$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p')"
for b in $(git branch --format='%(refname:short)'); do
  [ "$b" = "main" ] && continue
  printf '%s\n' "$CHECKED_OUT" | grep -qx "$b" && continue
  git branch -f "$b" main
  echo "moved branch $b to the new main"
done

LEFT="$(git log --format='%ae %ce' main | grep -vc "^$KILN_EMAIL $KILN_EMAIL\$" || true)"
[ "$LEFT" = "0" ] || die "$LEFT commits still carry another address"
echo "done: main is $(git rev-parse --short main), every commit by $KILN_EMAIL"
