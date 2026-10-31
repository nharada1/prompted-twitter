#!/usr/bin/env bash
# Zips src/ into dist/ for upload to the Chrome Web Store.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "require('$root/src/manifest.json').version")"
out="$root/dist/prompted-feed-$version.zip"

mkdir -p "$root/dist"
rm -f "$out"
(cd "$root/src" && zip -qr "$out" . -x "*.DS_Store")
echo "wrote ${out#$root/}"
