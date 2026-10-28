#!/usr/bin/env bash
# Run one hand-written schemdraw attempt and rasterise it.  Usage: baselines/scripts/run_schemdraw.sh <validation|test> <NN> <K>
# Drawing code: validation -> baselines/scripts/schemdraw/validation/caseNN/attempt-K.py
#               test       -> baselines/out/schemdraw/test/caseNN/attempt-K.py   (kept with the test images, see README)
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PY="${SCHEM_BASELINES:-/c/Users/ntlak/schem-baselines}/venv/Scripts/python.exe"
SET=$1; NN=$2; K=$3
OUT="$REPO/baselines/out/schemdraw/$SET/case$NN"
if [ "$SET" = test ]; then CODE="$OUT/attempt-$K.py"; else CODE="$REPO/baselines/scripts/schemdraw/$SET/case$NN/attempt-$K.py"; fi
mkdir -p "$OUT"
PYTHONPATH="$REPO/baselines/scripts" "$PY" "$CODE" "$REPO/baselines/out/_netlist/$SET/case$NN.json" "$OUT/attempt-$K.svg"
node "$REPO/baselines/scripts/rasterize.mjs" "$OUT/attempt-$K.svg" "$OUT/attempt-$K.png" >/dev/null
