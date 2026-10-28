#!/usr/bin/env bash
# Run one tscircuit attempt.
# Usage: baselines/scripts/run_tscircuit.sh <validation> <NN> <K>
#        baselines/scripts/run_tscircuit.sh neutral <name> <K>
# Reads baselines/out/tscircuit/<set>/caseNN/attempt-K.config.json (created empty if missing), or
# baselines/out/tscircuit/neutral/<name>/attempt-K.config.json for a neutral circuit.
# tscircuit itself is installed outside the repo; set SCHEM_BASELINES to the folder that holds the
# "tscircuit" install (default $HOME/schem-baselines).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
MODE=$1; A=$2; K=$3
if [ "$MODE" = "neutral" ]; then
  NL="$REPO/baselines/scripts/tscircuit/neutral/$A.json"
  OUT="$REPO/baselines/out/tscircuit/neutral/$A"
else
  NL="$REPO/baselines/out/_netlist/$MODE/case$A.json"
  OUT="$REPO/baselines/out/tscircuit/$MODE/case$A"
fi
mkdir -p "$OUT"
[ -f "$OUT/attempt-$K.config.json" ] || echo '{}' > "$OUT/attempt-$K.config.json"
SCHEM_BASELINES="${SCHEM_BASELINES:-$HOME/schem-baselines}" \
  node "$REPO/baselines/scripts/tscircuit_draw.mjs" "$NL" "$OUT/attempt-$K.config.json" "$OUT" "$K"
