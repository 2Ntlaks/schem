#!/usr/bin/env bash
# Run one netlistsvg attempt.  Usage: baselines/scripts/run_netlistsvg.sh <validation|test> <NN> <K>
# Reads baselines/out/netlistsvg/<set>/caseNN/attempt-K.config.json (created empty if missing).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SET=$1; NN=$2; K=$3
OUT="$REPO/baselines/out/netlistsvg/$SET/case$NN"
mkdir -p "$OUT"
[ -f "$OUT/attempt-$K.config.json" ] || echo '{}' > "$OUT/attempt-$K.config.json"
node "$REPO/baselines/scripts/netlistsvg_draw.mjs" "$REPO/baselines/out/_netlist/$SET/case$NN.json" "$OUT/attempt-$K.config.json" "$OUT" "$K"
