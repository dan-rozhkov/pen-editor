#!/usr/bin/env bash
# Refresh the vendored h2d capture bundle from the sibling private repo.
# Usage: ./scripts/update-h2d-capture.sh   (run `npm run build` in ../html-capture first)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="../../html-capture/dist/capture.js"
[ -f "$SRC" ] || SRC="$HOME/prj/html-capture/dist/capture.js"
cp "$SRC" src/vendor/h2dCapture/capture.js
echo "Vendored $(wc -c < src/vendor/h2dCapture/capture.js) bytes from $SRC"
