#!/bin/bash
# =========================================================
# Adds ?v=<deploy version> to every local .css and .js link in the
# deployed pages, run by .cpanel.yml right after the site is copied.
#
# Why: .htaccess lets browsers keep CSS and JS for a day instead of
# re-checking each file on every page view (each check is a full
# round trip to the server, ~20 per page). A new deploy changes the
# version in the links, so browsers fetch the new files at once
# rather than using yesterday's.
#
# Only the deployed copies in the document root are changed, never
# the repo. External links (https://..., //...) are left alone.
#
# Usage: stamp-assets.sh <site dir> [version, default: current time]
# =========================================================
set -euo pipefail

SITE_DIR="$1"
VERSION="${2:-$(date +%s)}"

find "$SITE_DIR" -name '*.html' -not -path "$SITE_DIR/uploads/*" -print0 |
  xargs -0 perl -pi -e '
    s{((?:src|href)=")(?!https?:|//|data:)([^"?#]+\.(?:js|css))(?:\?v=[^"]*)?"}{$1$2?v='"$VERSION"'"}g
  '

echo "Stamped CSS/JS links with v=$VERSION"
