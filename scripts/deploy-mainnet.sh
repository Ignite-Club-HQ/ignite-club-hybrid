#!/usr/bin/env bash
# Ignite Club HQ — mainnet canister deploy + wiring.
#
# Prerequisites (one-time):
#   1. npm i -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops            (or: npm i -g @icp-sdk/icp-cli)
#   2. Create/select an identity whose principal is the governor below:
#        icp identity new ignite-governor
#        icp identity principal             # must print GOVERNOR
#   3. Fund that identity with cycles (convert ICP, or top up via icscan.io).
#      Testing budget: ~8 ICP total (see docs/icp-deployment-runbook.md).
#
# Usage:  bash scripts/deploy-mainnet.sh
#   Cloud Engine: DEPLOY_TARGET=eu-engine ICP_ENV=eu-engine bash scripts/deploy-mainnet.sh
#   (deploy/<DEPLOY_TARGET>/icp.yaml must define environment ICP_ENV pointing at the engine;
#    paste the printed ID table into Placement Settings > Approved targets for that engine.)
set -euo pipefail

# Default governor; the GitHub workflow overrides this with the deployer
# identity's actual principal (and seds the sentinel in the canister configs).
GOVERNOR="${GOVERNOR:-gwyap-pqop5-msidu-vlkov-zuejr-7gqjr-dwvkx-2yhgy-mdaxt-2giwn-cae}"
DEPLOY_TARGET="${DEPLOY_TARGET:-mainnet}"
ICP_ENV="${ICP_ENV:-ic}"
PROJECT_DIR="$(cd "$(dirname "$0")/../deploy/$DEPLOY_TARGET" && pwd)"
IDS_JSON="$PROJECT_DIR/.icp/data/mappings/$ICP_ENV.ids.json"

cd "$PROJECT_DIR"

echo "==> Checking icp CLI"
command -v icp >/dev/null || { echo "icp CLI not found. Install: npm i -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops"; exit 1; }

echo "==> Checking identity"
CURRENT="$(icp identity principal)"
if [ "$CURRENT" != "$GOVERNOR" ]; then
  echo "ERROR: current identity principal is $CURRENT"
  echo "       but the canisters are configured for governor $GOVERNOR"
  echo "       timer_jobs.initialize() and the wiring calls must come from the governor."
  echo "       Switch to the governor identity (icp identity default <name>) and re-run."
  exit 1
fi

echo "==> Deploying all 18 canisters to $DEPLOY_TARGET (this funds them from your cycles balance)"
# 1T cycles per canister (18T total) fits a ~8 ICP budget with headroom; top up later as needed.
# -y skips interactive candid/confirmation prompts so this runs unattended in CI.
icp deploy -e "$ICP_ENV" -y --cycles 1000000000000

[ -f "$IDS_JSON" ] || { echo "ERROR: $IDS_JSON not found after deploy"; exit 1; }

cid() { node -e "const m=require('$IDS_JSON');const v=m['$1'];if(!v){console.error('missing id for $1');process.exit(1)}console.log(typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]))"; }

CLUB_DOMAIN="$(cid club_domain)"
NOTIFICATION_QUEUE="$(cid notification_queue)"
MESSAGING_DOMAIN="$(cid messaging_domain)"
EVENTS_DOMAIN="$(cid events_domain)"
PII_ACCESS_CONTROL="$(cid pii_access_control)"

echo "==> Wiring: timer_jobs.initialize() (first-caller-wins governor)"
icp canister call timer_jobs initialize '()' -e "$ICP_ENV"

echo "==> Wiring: pii_access_control -> club_domain"
icp canister call pii_access_control set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: messaging_domain <-> notification_queue"
icp canister call messaging_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"
icp canister call notification_queue set_messaging_domain_canister "(principal \"$MESSAGING_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: club_domain + events_domain -> notification_queue"
icp canister call club_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"
icp canister call events_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"

# Push delivery worker grant — principal derived from ICP_PUSH_WORKER_SEED
# (64 hex chars). Skip silently when the secret is not configured; the
# icp-push-deliver workflow no-ops until both this grant and its secrets exist.
if [ -n "${ICP_PUSH_WORKER_SEED:-}" ]; then
  NODE_PATH_DIR="$PWD/frontend/node_modules"
  if ! node -e "require.resolve('@icp-sdk/core/identity', { paths: ['$NODE_PATH_DIR'] })" 2>/dev/null; then
    echo "==> Installing @icp-sdk/core for push worker principal derivation"
    mkdir -p "${RUNNER_TEMP:-/tmp}/icp-push-deps" && npm install --prefix "${RUNNER_TEMP:-/tmp}/icp-push-deps" @icp-sdk/core --no-fund --no-audit >/dev/null
    NODE_PATH_DIR="${RUNNER_TEMP:-/tmp}/icp-push-deps/node_modules"
  fi
  WORKER_PRINCIPAL="$(PUSH_WORKER_NODE_PATH="$NODE_PATH_DIR" node scripts/push-worker-principal.mjs)"
  echo "==> Granting push worker principal on notification_queue: $WORKER_PRINCIPAL"
  icp canister call notification_queue grant_worker "(principal \"$WORKER_PRINCIPAL\")" -e "$ICP_ENV"
fi

echo "==> Wiring: media_blob_store -> club_domain"
icp canister call media_blob_store set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: permanent-delete fan-out (club_domain -> events/messaging/pii, events/messaging <- club_domain)"
# Without these, club_domain skips cross-canister cleanup (local purge still
# completes) and events_domain/messaging_domain reject every delete_*_data
# call — fail-open-by-skip on the sender, fail-closed on the receivers.
icp canister call club_domain set_events_domain_canister "(principal \"$EVENTS_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_messaging_domain_canister "(principal \"$MESSAGING_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_pii_canister "(principal \"$PII_ACCESS_CONTROL\")" -e "$ICP_ENV"
icp canister call events_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call messaging_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo ""
echo "==> Deploy complete. Canister IDs — paste into /admin/placement-settings → Canister configuration:"
node -e "const m=require('$IDS_JSON');for(const [k,v] of Object.entries(m)){const id=typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]);console.log(k+'\t'+id)}"
echo ""
echo "Optional next steps:"
echo "  - Set the routing-config fallback:  icp canister call club_domain set_app_config '(\"backend_routing_config\", \"<JSON mirroring the Supabase app_settings row>\")' -e "$ICP_ENV""
echo "  - Commit $IDS_JSON so the team keeps the ID mapping."
