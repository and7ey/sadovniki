#!/usr/bin/env bash
# Publish the static viewer (viewer/) to GitHub Pages.
#
#   ./tools/deploy_pages.sh
#
# The site lives on the orphan `gh-pages` branch, which holds the *contents* of
# viewer/ at its root. `main` keeps the sources and the Blender pipeline.
set -euo pipefail

REPO="${REPO:-and7ey/sadovniki}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ staging viewer/ (without tools and backups)"
cd "$ROOT/viewer"
cp -R index.html src public vendor "$TMP"/
: > "$TMP/.nojekyll"

cd "$TMP"
git init -q -b gh-pages
git add -A
git -c user.name="and7ey" -c user.email="and7ey@users.noreply.github.com" \
    commit -q -m "Deploy viewer to GitHub Pages"
git remote add origin "https://github.com/${REPO}.git"
git push -f origin gh-pages

echo "✓ https://${REPO%%/*}.github.io/${REPO##*/}/"
