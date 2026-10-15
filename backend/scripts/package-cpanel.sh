#!/usr/bin/env bash
# Builds two zips at the project root for uploading through cPanel's
# File Manager, when you're not deploying via Git Version Control:
#
#   vetra-api-cpanel.zip  the backend, without node_modules or .env.
#                         Extract into the Node.js app's Application
#                         root, then "Run NPM Install" and Restart.
#   vetrahq-site.zip      the website. Extract into the vetrahq.org
#                         document root.
#
# Same file selection as .cpanel.yml's Git deploy. See backend/README.md,
# "Setting up on cPanel".
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
API_ZIP="$ROOT_DIR/vetra-api-cpanel.zip"
SITE_ZIP="$ROOT_DIR/vetrahq-site.zip"

rm -f "$API_ZIP" "$SITE_ZIP"

cd "$BACKEND_DIR"
zip -rq "$API_ZIP" . \
  -x "node_modules/*" -x ".env" -x "tmp/*" -x "*.log" -x ".DS_Store" -x "*/.DS_Store"

cd "$ROOT_DIR"
zip -rq "$SITE_ZIP" . \
  -x "backend/*" -x ".git/*" -x ".gitignore" -x ".cpanel.yml" \
  -x ".claude/*" -x ".qodo/*" -x ".vscode/*" -x ".env*" -x "*.DS_Store" \
  -x "*.md" -x "*.pdf" -x "*.zip"

for z in "$API_ZIP" "$SITE_ZIP"; do
  echo "Wrote $z ($(unzip -l "$z" | tail -1 | awk '{print $2}') files)"
done
