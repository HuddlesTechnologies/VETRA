#!/bin/bash
# =========================================================
# What the cPanel cron job runs every 10 minutes (backend/README.md,
# step 9). Runs scripts/delivery-cron.js with the Node.js app's own Node,
# found by itself instead of a version folder written into the cron line,
# so changing the app's Node version in "Setup Node.js App" doesn't
# quietly stop the sweep.
#
#   */10 * * * * /bin/bash $HOME/vetra-api/scripts/run-sweep.sh
#
# Output and errors both go to ~/vetra-cron.log. Errors are also printed,
# so cPanel emails them to the Cron Email address.
#
# Settings (override in the cron line): APP_DIR (default ~/vetra-api),
# LOG (default ~/vetra-cron.log).
# =========================================================

APP_DIR="${APP_DIR:-$HOME/vetra-api}"
LOG="${LOG:-$HOME/vetra-cron.log}"
stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
fail() { echo "[$(stamp)] run-sweep: $1" | tee -a "$LOG" >&2; exit 1; }

# The newest Node in the app's virtualenv, then whatever is on PATH.
NODE="$(ls -d "$HOME/nodevenv/$(basename "$APP_DIR")"/*/bin/node 2>/dev/null | sort -V | tail -n 1)"
[ -x "$NODE" ] || NODE="$(command -v node 2>/dev/null)"
[ -n "$NODE" ] || fail "no Node.js found under ~/nodevenv/$(basename "$APP_DIR") or on PATH"
cd "$APP_DIR" 2>/dev/null || fail "can't open $APP_DIR"
[ -f scripts/delivery-cron.js ] || fail "$APP_DIR/scripts/delivery-cron.js is missing (has the API been deployed?)"

"$NODE" scripts/delivery-cron.js >> "$LOG" 2> >(tee -a "$LOG" >&2)
