#!/bin/bash
# =========================================================
# VETRA auto-deploy from GitHub, run by a cPanel cron job.
#
# Every run: fetch the GitHub branch into the cPanel Git Version Control
# clone. If there's a new commit, move the clone to it and run cPanel's
# own deployment, which runs .cpanel.yml: the website (frontend) is
# copied into the document root, and the API (backend) is copied,
# installed, migrated and restarted. Nothing new, nothing happens.
#
# Cron Jobs -> Add New Cron Job, every 5 minutes (*/5 * * * *):
#   /bin/bash $HOME/repositories/vetra/deploy/cpanel-autodeploy.sh >> $HOME/vetra-autodeploy.log 2>&1
#
# Settings (override in the cron line, e.g. BRANCH=main /bin/bash ...):
#   REPO_DIR  the Git Version Control clone (default ~/repositories/vetra)
#   BRANCH    the branch to deploy (default main)
#
# The clone is only ever a deploy target: local edits on the server are
# discarded, GitHub is the source of truth.
# =========================================================

# Wrapped in a function and run in one go: this file lives inside the
# repo it updates, and bash reads scripts as it runs them, so a changed
# copy landing mid-run would otherwise be half-executed.
main() {
  set -euo pipefail
  local REPO_DIR="${REPO_DIR:-$HOME/repositories/vetra}"
  local BRANCH="${BRANCH:-main}"
  local LOCK="$HOME/.vetra-autodeploy.lock"
  now() { date '+%Y-%m-%d %H:%M:%S'; }

  # Never two deploys at once (a slow npm install can outlast 5 minutes).
  exec 9>"$LOCK"
  if ! flock -n 9; then
    echo "[$(now)] previous deploy still running, skipping"
    return 0
  fi

  cd "$REPO_DIR"
  if ! git fetch --quiet origin "$BRANCH"; then
    echo "[$(now)] git fetch failed (network or deploy key), will retry next run"
    return 1
  fi

  local current target
  current="$(git rev-parse HEAD)"
  target="$(git rev-parse "origin/$BRANCH")"
  if [ "$current" = "$target" ]; then
    return 0
  fi

  echo "[$(now)] deploying $BRANCH ${current:0:7} -> ${target:0:7}: $(git log -1 --format=%s "$target")"
  git checkout --quiet "$BRANCH" 2>/dev/null || git checkout --quiet -b "$BRANCH" "origin/$BRANCH"
  git reset --quiet --hard "origin/$BRANCH"
  git clean --quiet -fd

  # cPanel's deployment runs the tasks in .cpanel.yml and records the
  # result in Git Version Control's deploy history.
  local result
  result="$(uapi --output=jsonpretty VersionControlDeployment create repository_root="$REPO_DIR" 2>&1)" || true
  if echo "$result" | grep -q '"status" *: *1'; then
    echo "[$(now)] deployment queued for ${target:0:7}, see Git Version Control > History for its log"
  else
    echo "[$(now)] cPanel refused the deployment:"
    echo "$result"
    # Roll the clone back so the next run tries this commit again.
    git reset --quiet --hard "$current"
    return 1
  fi
}

main "$@"
exit $?
