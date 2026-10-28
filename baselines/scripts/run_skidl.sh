#!/usr/bin/env bash
# Run one SKiDL attempt and rasterise it.  Usage: baselines/scripts/run_skidl.sh <validation|test> <NN> <K>
# Reads baselines/out/skidl/<set>/caseNN/attempt-K.config.json (created empty if missing).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${SCHEM_BASELINES:-/c/Users/ntlak/schem-baselines}/venv/Scripts/python.exe"
SET=$1; NN=$2; K=$3
OUT="$REPO/baselines/out/skidl/$SET/case$NN"
mkdir -p "$OUT"
[ -f "$OUT/attempt-$K.config.json" ] || echo '{}' > "$OUT/attempt-$K.config.json"
WORK="$(mktemp -d)"   # SKiDL writes .log/.erc files into the working directory
( cd "$WORK" && KICAD10_SYMBOL_DIR="${KICAD10_SYMBOL_DIR:-${SCHEM_BASELINES:-/c/Users/ntlak/schem-baselines}/kicad-symbols}" \
  "$PY" "$REPO/baselines/scripts/skidl_draw.py" "$REPO/baselines/out/_netlist/$SET/case$NN.json" \
  "$OUT/attempt-$K.config.json" "$OUT" "$K" 2>&1 | grep -v "SYMBOL_DIR environment variable\|fp-lib-table" ) || true
cp "$WORK"/*.erc "$OUT/attempt-$K.erc" 2>/dev/null || true
rm -rf "$WORK"
[ -f "$OUT/attempt-$K.svg" ] && node "$REPO/baselines/scripts/rasterize.mjs" "$OUT/attempt-$K.svg" "$OUT/attempt-$K.png"
