#!/usr/bin/env bash
# Ignite Club HQ — mainnet canister deploy + wiring.
#
# Prerequisites (one-time):
#   1. bun add -g icp-sdk-icp-cli            (or: npm i -g icp-sdk-icp-cli)
#   2. Create/select an identity whose principal is the governor below:
#        icp identity new ignite-governor
#        icp identity principal             # must print GOVERNOR
#   3. Fund that identity with cycles (convert ICP, or top up via icscan.io).
#      Testing budget: ~8 ICP total (see docs/icp-deployment-runbook.md).
#
# Usage:  bash scripts/deploy-mainnet.sh
set -euo pipefail

# Default governor; the GitHub workflow overrides this with the deployer
# identity's actual principal (and seds the sentinel in the canister configs).
GOVERNOR="${GOVERNOR:-gwyap-pqop5-msidu-vlkov-zuejr-7gqjr-dwvkx-2yhgy-mdaxt-2giwn-cae}"
PROJECT_DIR="$(cd "$(dirname "$0")/../deploy/mainnet" && pwd)"
IDS_JSON="$PROJECT_DIR/.icp/data/mappings/ic.ids.json"

cd "$PROJECT_DIR"

echo "==> Checking icp CLI"
command -v icp >/dev/null || { echo "icp CLI not found. Install: bun add -g icp-sdk-icp-cli"; exit 1; }

echo "==> Checking identity"
CURRENT="$(icp identity principal)"
if [ "$CURRENT" != "$GOVERNOR" ]; then
  echo "ERROR: current identity principal is $CURRENT"
  echo "       but the canisters are configured for governor $GOVERNOR"
  echo "       timer_jobs.initialize() and the wiring calls must come from the governor."
  echo "       Switch to the governor identity (icp identity default <name>) and re-run."
  exit 1
fi

echo "==> Deploying all 18 canisters to mainnet (this funds them from your cycles balance)"
icp deploy -e ic

[ -f "$IDS_JSON" ] || { echo "ERROR: $IDS_JSON not found after deploy"; exit 1; }

cid() { node -e "const m=require('$IDS_JSON');const v=m['$1'];if(!v){console.error('missing id for $1');process.exit(1)}console.log(typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]))"; }

CLUB_DOMAIN="$(cid club_domain)"
NOTIFICATION_QUEUE="$(cid notification_queue)"
MESSAGING_DOMAIN="$(cid messaging_domain)"

echo "==> Wiring: timer_jobs.initialize() (first-caller-wins governor)"
icp canister call timer_jobs initialize '()' -e ic

echo "==> Wiring: pii_access_control -> club_domain"
icp canister call pii_access_control set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e ic

echo "==> Wiring: messaging_domain <-> notification_queue"
icp canister call messaging_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e ic
icp canister call notification_queue set_messaging_domain_canister "(principal \"$MESSAGING_DOMAIN\")" -e ic

echo "==> Wiring: club_domain + events_domain -> notification_queue"
icp canister call club_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e ic
icp canister call events_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e ic

echo "==> Wiring: media_blob_store -> club_domain"
icp canister call media_blob_store set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e ic

echo ""
echo "==> Deploy complete. Canister IDs — paste into /admin/placement-settings → Canister configuration:"
node -e "const m=require('$IDS_JSON');for(const [k,v] of Object.entries(m)){const id=typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]);console.log(k+'\t'+id)}"
echo ""
echo "Optional next steps:"
echo "  - Set the routing-config fallback:  icp canister call club_domain set_app_config '(\"backend_routing_config\", \"<JSON mirroring the Supabase app_settings row>\")' -e ic"
echo "  - Commit $IDS_JSON so the team keeps the ID mapping."
