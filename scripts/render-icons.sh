#!/usr/bin/env bash
# Renders src/icons/icon.svg to the PNG sizes Chrome expects, using headless Chrome.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
icons="$root/src/icons"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for size in 16 32 48 128; do
  cat > "$tmp/icon.html" <<HTML
<!doctype html>
<style>html, body { margin: 0; background: transparent; } img { display: block; width: ${size}px; height: ${size}px; }</style>
<img src="file://$icons/icon.svg">
HTML
  "$chrome" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 --window-size="$size,$size" \
    --screenshot="$icons/icon-$size.png" "file://$tmp/icon.html" >/dev/null 2>&1
  echo "wrote src/icons/icon-$size.png"
done
