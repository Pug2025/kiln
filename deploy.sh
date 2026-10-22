#!/usr/bin/env bash
# Kiln deploy (OWNER: G). Run from the main folder on branch main:
#
#   ./deploy.sh              offline file list, tests, BUILD stamp in sw.js, local commit, one
#                            snapshot commit on the public main, pre-publish check, push, wait for Pages
#   ./deploy.sh --dry-run    every check (on a snapshot of main as it is now); changes nothing
#   ./deploy.sh --no-push    stamp and commit locally, build and check the snapshot, push nothing
#   ./deploy.sh --no-wait    push, but do not wait for GitHub Pages to serve the new build
#
# What goes public is a SNAPSHOT, never this repo's history (LEAD 2026-10-22 09:00: early commits
# used another author email): each release is one new commit whose tree is main's tree and whose
# parent is the public main (none on the very first publish), authored and committed by the
# GitHub no-reply address. Pushing it is a plain fast-forward of the public main; nothing is ever
# force-pushed and no local branch or commit is pushed. The pre-publish check runs on exactly
# what becomes public: the snapshot's files plus the public history under it.
# The offline file list comes from D's `node src/app/sw-files.mjs --write` (sw.js FILES block and
# src/app/present.js), then the gate runs with KILN_RELEASE=1 so every shipped file must be listed.
# Publishing only happens when the last "- Publish ..." line of BUILD-STATUS.md -> "Approvals"
# says an exact YES (tools/qa/approval.mjs).
# The first publish creates the public repo Pug2025/kiln with gh (empty) and turns on GitHub
# Pages (branch main, folder /). tools/qa/rewrite-authors.sh is not needed for any of this.

set -euo pipefail

SLUG="Pug2025/kiln"
PAGES_URL="https://pug2025.github.io/kiln/"
PUBLISH_EMAIL="239009854+Pug2025@users.noreply.github.com"
PUBLISH_NAME="Pug2025"
TRAILER="Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
# Pushed to by URL: this repo keeps no `origin` remote, so a habitual `git push origin main` can
# never publish the private history. KILN_PUBLIC_URL points the script at another repo (tests use
# a local bare repo; GitHub steps such as gh and Pages are skipped for anything not on github.com).
PUBLIC_URL="${KILN_PUBLIC_URL:-https://github.com/$SLUG.git}"
ON_GITHUB=0
case "$PUBLIC_URL" in https://github.com/*) ON_GITHUB=1 ;; esac

DRY=0; PUSH=1; WAIT=1
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --no-push) PUSH=0 ;;
    --no-wait) WAIT=0 ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $a (try --help)" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
say() { printf '%s\n' "$*"; }
die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
run() { if [ "$DRY" = 1 ]; then printf '  (dry run) %s\n' "$*"; else "$@"; fi; }

# ---- 1. where we are
[ "$(git rev-parse --show-toplevel)" = "$ROOT" ] || die "deploy.sh must sit at the top of the repo"
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] || die "run it in the main folder, not in a worktree"
[ "$(git symbolic-ref --short -q HEAD || true)" = "main" ] || die "check out main first"
[ -z "$(git status --porcelain --untracked-files=no)" ] || die "main has uncommitted changes; commit or merge them first"
# D's file list counts untracked files as shipped: one here would be cached but never published
UNTRACKED="$(git ls-files --others --exclude-standard)"
[ -z "$UNTRACKED" ] || die "untracked files (commit them or add them to .gitignore first): $(printf '%s ' $UNTRACKED)"
[ -f sw.js ] || die "sw.js is missing (D owns it); nothing to stamp"
[ -f src/app/sw-files.mjs ] || die "src/app/sw-files.mjs is missing (D owns it); cannot build the offline file list"
grep -Eq "^const BUILD = '[^']*';" sw.js || die "sw.js has no line like: const BUILD = '...';"
EMAIL="$(git config user.email || true)"
[ "$EMAIL" = "$PUBLISH_EMAIL" ] || die "git user.email here is '$EMAIL'; set it to $PUBLISH_EMAIL (git config user.email $PUBLISH_EMAIL)"

# ---- 2. one deploy or merge at a time (team/RULES.md merge lock)
LOCK="$ROOT/.merge-lock"
LOCKED=0
if [ "$DRY" = 0 ]; then
  tries=0
  until mkdir "$LOCK" 2>/dev/null; do
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then
      say "removing a stale merge lock (older than 15 minutes)"; rmdir "$LOCK" 2>/dev/null || true; continue
    fi
    tries=$((tries + 1)); [ "$tries" -le 20 ] || die "the merge lock stayed busy for 10 minutes"
    say "merge lock busy, waiting 30 s"; sleep 30
  done
  LOCKED=1
fi
# On any exit: put back generated files that were never committed, then release the lock.
GENERATED="sw.js src/app/present.js"
DIRTY=0
cleanup() {
  if [ "$DIRTY" = 1 ]; then git checkout -q -- $GENERATED 2>/dev/null || true; fi
  if [ "$LOCKED" = 1 ]; then rmdir "$LOCK" 2>/dev/null || true; LOCKED=0; fi
}
trap cleanup EXIT

# ---- 3. the offline file list and the gate
say "== offline file list (src/app/sw-files.mjs, D)"
RELEASE=1
if [ "$DRY" = 1 ]; then
  if node src/app/sw-files.mjs --check; then :; else
    say "  (dry run) --write would rewrite the list above; the gate runs without KILN_RELEASE this time"
    RELEASE=0
  fi
else
  DIRTY=1
  node src/app/sw-files.mjs --write || die "src/app/sw-files.mjs --write failed; nothing deployed"
fi
say "== tests$([ "$RELEASE" = 1 ] && printf ' (KILN_RELEASE=1)')"
LOG="$(mktemp -t kiln-deploy-tests)"
if [ "$RELEASE" = 1 ]; then
  KILN_RELEASE=1 node tests-node.mjs > "$LOG" 2>&1 || { tail -40 "$LOG"; rm -f "$LOG"; die "the test suite failed; nothing deployed"; }
else
  node tests-node.mjs > "$LOG" 2>&1 || { tail -40 "$LOG"; rm -f "$LOG"; die "the test suite failed; nothing deployed"; }
fi
tail -1 "$LOG"; rm -f "$LOG"

# ---- 4. the public side: its current main (read-only; GIT_TERMINAL_PROMPT=0 so a missing repo
# fails at once instead of asking for a password)
export GIT_TERMINAL_PROMPT=0
STATUS="$ROOT/BUILD-STATUS.md"
APPROVED=0
# tools/qa/approval.mjs: only the Approvals section, only its last "- Publish" line, an exact YES
if node tools/qa/approval.mjs "$STATUS"; then APPROVED=1; fi
NEW_REPO=0; PARENT=""
code=0; git ls-remote --exit-code "$PUBLIC_URL" refs/heads/main >/dev/null 2>&1 || code=$?
case "$code" in
  0) git fetch -q "$PUBLIC_URL" main || die "cannot fetch the public main from $PUBLIC_URL"
     PARENT="$(git rev-parse FETCH_HEAD)" ;;
  2) say "== $PUBLIC_URL has no main yet: the snapshot starts its history" ;;
  *) [ "$ON_GITHUB" = 1 ] || die "cannot reach $PUBLIC_URL"
     NEW_REPO=1; say "== $SLUG cannot be read: a first publish (gh confirms before creating it)" ;;
esac
# Nothing to release when the public main already holds these files (sw.js compared without its
# BUILD line, which changes on every run): a new BUILD alone would only make players reload.
if [ -n "$PARENT" ] && git diff --quiet "$PARENT" -- . ':(exclude)sw.js' &&
  [ "$(git show "$PARENT:sw.js" 2>/dev/null | grep -v '^const BUILD = ')" = "$(grep -v '^const BUILD = ' sw.js)" ]; then
  say "== the public main ($(git rev-parse --short "$PARENT")) already has these files; nothing new to publish"
  exit 0
fi

# ---- 5. stamp and commit locally
SHA="$(git rev-parse --short HEAD)"
BUILD="$(date -u +%Y-%m-%dT%H%MZ)-$SHA"
say "== BUILD $BUILD"
if [ "$DRY" = 1 ]; then
  say "  (dry run) sw.js: $(grep -E "^const BUILD = " sw.js) -> const BUILD = '$BUILD';"
  say "  (dry run) git commit -m 'Deploy $BUILD' ($GENERATED)"
else
  BUILD="$BUILD" node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'node:fs';
    const src = readFileSync('sw.js', 'utf8');
    const re = /^const BUILD = '[^']*';/m;
    if ((src.match(/^const BUILD = '[^']*';/gm) || []).length !== 1) { console.error('sw.js needs exactly one BUILD line'); process.exit(1); }
    writeFileSync('sw.js', src.replace(re, \"const BUILD = '\" + process.env.BUILD + \"';\"));
  "
  git add -- $GENERATED
  git commit -q -m "Deploy $BUILD" -m "$TRAILER"
  DIRTY=0
  say "committed $(git rev-parse --short HEAD) Deploy $BUILD ($(git show --stat --format= HEAD | tail -1 | sed 's/^ *//'))"
fi

# ---- 6. one snapshot commit on top of the public main
TREE="$(git rev-parse 'HEAD^{tree}')"
SNAP="$(GIT_AUTHOR_NAME="$PUBLISH_NAME" GIT_AUTHOR_EMAIL="$PUBLISH_EMAIL" GIT_COMMITTER_NAME="$PUBLISH_NAME" GIT_COMMITTER_EMAIL="$PUBLISH_EMAIL" \
  git commit-tree "$TREE" ${PARENT:+-p "$PARENT"} -m "Kiln $BUILD" -m "Release snapshot of the game (one commit per release)." -m "$TRAILER")"
say "== snapshot $(git rev-parse --short "$SNAP") on top of $([ -n "$PARENT" ] && git rev-parse --short "$PARENT" || printf 'nothing (a new history)')"
say "== pre-publish safety check (exactly what becomes public: the snapshot and the public history under it)"
node tools/qa/prepublish.mjs --ref "$SNAP" || die "the pre-publish check failed; nothing deployed"

# ---- 7. publish (only when approved)
if [ "$PUSH" = 0 ]; then say "== --no-push: committed locally, snapshot built and checked, nothing pushed"; exit 0; fi
if [ "$APPROVED" = 0 ]; then say "== publishing waits for approval (tools/qa/approval.mjs: the last 'Publish' line of BUILD-STATUS.md Approvals has no exact YES); committed locally, nothing pushed"; exit 0; fi
say "== publish to $PUBLIC_URL"
if [ "$ON_GITHUB" = 1 ]; then
  command -v gh >/dev/null || die "the gh command is not installed"
  gh auth status >/dev/null 2>&1 || die "gh is not logged in to GitHub (needs the owner: gh auth login)"
  if [ "$NEW_REPO" = 1 ]; then
    if gh repo view "$SLUG" >/dev/null 2>&1; then die "$SLUG exists but its main could not be read; check the network and run again"; fi
    run gh repo create "$SLUG" --public --description "Kiln: a brick breaker in a burning kiln."
  fi
fi
run git push "$PUBLIC_URL" "$SNAP:refs/heads/main" || die "push refused (the public main moved while deploying?). Never force: run ./deploy.sh again"
if [ "$DRY" = 0 ]; then git update-ref -m "deploy $BUILD" refs/kiln/public "$SNAP"; fi
if [ "$ON_GITHUB" = 1 ]; then
  if [ "$NEW_REPO" = 1 ] || { [ "$DRY" = 0 ] && ! gh api "repos/$SLUG/pages" >/dev/null 2>&1; }; then
    run gh api --method POST "repos/$SLUG/pages" -f 'source[branch]=main' -f 'source[path]=/'
  fi
fi

# the repo is done with: let other merges go while Pages builds
if [ "$LOCKED" = 1 ]; then rmdir "$LOCK" 2>/dev/null || true; LOCKED=0; fi

# ---- 8. wait until Pages serves this build
if [ "$DRY" = 1 ] || [ "$WAIT" = 0 ] || [ "$ON_GITHUB" = 0 ]; then say "== done (not waiting for Pages)"; exit 0; fi
say "== waiting for $PAGES_URL to serve BUILD $BUILD (Pages can take a few minutes)"
for i in $(seq 1 40); do
  if curl -fsS "${PAGES_URL}sw.js?nocache=$i$$" 2>/dev/null | grep -q "$BUILD"; then
    say "live: $PAGES_URL (BUILD $BUILD)"; exit 0
  fi
  sleep 15
done
die "pushed, but $PAGES_URL did not serve BUILD $BUILD within 10 minutes; check the repo's Pages settings"
