#!/usr/bin/env bash
# Publish web/landing to the gh-pages branch (GitHub Pages serves it from there).
# Usage: scripts/publish-pages.sh        Run from anywhere inside the repo.
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R "$root/web/landing/." "$tmp/"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git commit -q -m "Publish landing page"
git push -f "$(git -C "$root" remote get-url origin)" gh-pages:gh-pages
echo "Pushed gh-pages. Site: https://$(git -C "$root" remote get-url origin | sed -E 's#.*[:/]([^/]+)/([^/.]+)(\.git)?$#\1.github.io/\2#')/"
