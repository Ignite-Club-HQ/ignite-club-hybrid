#!/usr/bin/env bash
# Grants the ICP push delivery worker principal on notification_queue
# (mainnet). Run with the governor identity active (icp identity use …)
# and ICP_PUSH_WORKER_SEED exported (64 hex chars). The deploy-icp-mainnet
# workflow performs the same grant automatically when the secret is set.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${ICP_PUSH_WORKER_SEED:-}" ]; then
  echo "Set ICP_PUSH_WORKER_SEED (64 hex chars) before running this script."
  exit 1
fi

WORKER_PRINCIPAL="$(node scripts/push-worker-principal.mjs)"
echo "Granting push worker principal: $WORKER_PRINCIPAL"
icp canister call notification_queue grant_worker "(principal \"$WORKER_PRINCIPAL\")" -e ic
