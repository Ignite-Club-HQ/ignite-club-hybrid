#!/usr/bin/env bash
# Reuse the existing delivery identity; never generate a replacement worker.
set -euo pipefail
if [ -n "${ICP_PUSH_WORKER_SEED:-}" ]; then
  worker="$(node scripts/push-worker-principal.mjs)"
else
  worker="${PUSH_WORKER_PRINCIPAL:-}"
fi
test -n "$worker" || { echo '::error::Set the existing ICP_PUSH_WORKER_SEED repository secret or PUSH_WORKER_PRINCIPAL repository variable; no canisters created.' >&2; exit 1; }
printf 'PUSH_WORKER_PRINCIPAL=%s\n' "$worker" >> "$GITHUB_ENV"