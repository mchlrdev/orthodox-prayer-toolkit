#!/usr/bin/env bash
# Regenerates the Rust core's golden files from the TypeScript core.
#
# Each scripts/core-golden/<area>.mjs writes inputs and expected outputs to
# crates/prayer-core/tests/golden/<area>/. The Rust tests read only those
# files, so they keep working after packages/ is removed. CI runs this and
# fails if the committed goldens differ from what the TypeScript core says.
set -euo pipefail
shopt -s nullglob
cd "$(dirname "$0")/.."

pnpm --filter @orthodox-prayer-toolkit/core build >/dev/null
for script in scripts/core-golden/*.mjs; do
  node "$script"
done
