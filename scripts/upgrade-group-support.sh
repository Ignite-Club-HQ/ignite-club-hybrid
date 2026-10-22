#!/usr/bin/env bash
# One-time code upgrade of the two existing shared services that a new group
# needs: the router (live routing approvals) and the account service (generic
# group admission). Upgrade only — never creates, rewires or reinstalls.
# Usage: scripts/upgrade-group-support.sh <router 0|1> <identity 0|1>
# Requires the governor as the default icp identity.
set -euo pipefail
ROUTER_ID="jcdfe-vqaaa-aaaal-qxloq-cai"
IDENTITY_ID="mq2sj-fiaaa-aaaal-qxlqa-cai"
GOVERNOR="vk34m-qhp7i-xyaaw-itwxz-uohx7-ucw52-mx2vs-alcau-3h4ga-rayrt-pae"
cd "$(dirname "$0")/../deploy/mainnet"
node -e "const m=require('./.icp/data/mappings/ic.ids.json');if(m.shard_router!=='$ROUTER_ID'||m.identity_access!=='$IDENTITY_ID')process.exit(1)" \
  || { echo "ERROR: pinned mainnet router/account service mapping required"; exit 1; }
test "$(icp identity principal)" = "$GOVERNOR" || { echo "ERROR: governor identity required"; exit 1; }
if [ "${1:-0}" = 1 ]; then
  echo "==> Upgrading the existing shared router (code only)"
  icp deploy shard_router -e ic -y --mode upgrade --no-create
fi
if [ "${2:-0}" = 1 ]; then
  echo "==> Upgrading the existing account service (code only)"
  icp build identity_access
  icp canister install "$IDENTITY_ID" -n ic --mode upgrade --wasm .icp/cache/artifacts/identity_access \
    --args "(record { governor = principal \"$GOVERNOR\" })" -y
fi
