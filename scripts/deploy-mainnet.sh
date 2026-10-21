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
export GOVERNOR
DEPLOY_TARGET="${DEPLOY_TARGET:-mainnet}"
ICP_ENV="${ICP_ENV:-ic}"
DEPLOY_SCOPE="${DEPLOY_SCOPE:-all}"
case "$DEPLOY_SCOPE" in all|history) ;; *) echo "ERROR: unsupported deployment scope"; exit 1;; esac
PROJECT_DIR="$(cd "$(dirname "$0")/../deploy/$DEPLOY_TARGET" && pwd)"
IDS_JSON="$PROJECT_DIR/.icp/data/mappings/$ICP_ENV.ids.json"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Held across attestation, upgrade and key read-back. Never treat a local
# lock as proof against another controller: preflight requires sole governor.
mkdir -p "$PROJECT_DIR/.icp/data/media-key-attestations"
exec 9>"$PROJECT_DIR/.icp/data/media-key-attestations/deploy.lock"
flock -n 9 || { echo "ERROR: another deployment holds the photo-key lock"; exit 1; }
KEY_RECEIPT="$PROJECT_DIR/.icp/data/media-key-attestations/$ICP_ENV.json"

cd "$PROJECT_DIR"

echo "==> Checking icp CLI"
command -v icp >/dev/null || { echo "icp CLI not found. Install: npm i -g @icp-sdk/icp-cli @icp-sdk/ic-wasm ic-mops"; exit 1; }
# Modern icp deploy auto-detects EOP and sends wasm_memory_persistence=keep.
# Reject older tools before any deploy rather than risking IC0504 or data loss.
INSTALL_HELP="$(icp canister install --help)"
if ! grep -q -- '--wasm-memory-persistence' <<< "$INSTALL_HELP"; then
  echo "ERROR: this icp CLI lacks EOP memory-preserving upgrade support."
  echo "Install @icp-sdk/icp-cli@1.7.0 and re-run; do not reinstall canisters."
  exit 1
fi
icp --version

echo "==> Checking identity"
CURRENT="$(icp identity principal)"
if [ "$CURRENT" != "$GOVERNOR" ]; then
  echo "ERROR: current identity principal is $CURRENT"
  echo "       but the canisters are configured for governor $GOVERNOR"
  echo "       timer_jobs.initialize() and the wiring calls must come from the governor."
  echo "       Switch to the governor identity (icp identity default <name>) and re-run."
  exit 1
fi

if [ -f "$IDS_JSON" ] && node -e "const m=require('$IDS_JSON');process.exit(m.pii_access_control ? 0 : 1)"; then
  echo "==> Attesting original encrypted-photo key before any upgrade"
  node "$REPO_DIR/frontend/scripts/media-key-deploy-preflight.mjs" before "$IDS_JSON" "$KEY_RECEIPT" "$DEPLOY_TARGET" "$ICP_ENV"
fi
if [ "$DEPLOY_SCOPE" = history ]; then
  [ "$DEPLOY_TARGET" = mainnet ] && [ "$ICP_ENV" = ic ] || { echo "ERROR: History upgrade requires mapped mainnet"; exit 1; }
  [ -f "$KEY_RECEIPT" ] || { echo "ERROR: original key attestation required before upgrade"; exit 1; }
  node -e "const m=require('$IDS_JSON');for(const k of ['events_domain','competition_domain','club_domain'])if(typeof m[k]!=='string')process.exit(1)"
  echo "==> Upgrading only competition_domain and events_domain; no creation, media or scaling changes"
  icp deploy competition_domain events_domain -e "$ICP_ENV" -y --mode upgrade --no-create
  node "$REPO_DIR/frontend/scripts/media-key-deploy-preflight.mjs" after "$IDS_JSON" "$KEY_RECEIPT" "$DEPLOY_TARGET" "$ICP_ENV"
  HISTORY_EVENTS="$(node -e "console.log(require('$IDS_JSON').events_domain)")"
  HISTORY_COMPETITION="$(node -e "console.log(require('$IDS_JSON').competition_domain)")"
  HISTORY_CLUB="$(node -e "console.log(require('$IDS_JSON').club_domain)")"
  icp canister call competition_domain set_events_domain_canister "(principal \"$HISTORY_EVENTS\")" -e "$ICP_ENV"
  icp canister call events_domain set_competition_domain_canister "(principal \"$HISTORY_COMPETITION\")" -e "$ICP_ENV"
  icp canister call competition_domain set_club_domain_canister "(principal \"$HISTORY_CLUB\")" -e "$ICP_ENV"
  icp canister call events_domain set_club_domain_canister "(principal \"$HISTORY_CLUB\")" -e "$ICP_ENV"
  echo "==> History-only upgrade complete"
  exit 0
fi
echo "==> Deploying all 18 canisters to $DEPLOY_TARGET (this funds them from your cycles balance)"
# 1T cycles per canister (18T total) fits a ~8 ICP budget with headroom; top up later as needed.
# -y skips interactive candid/confirmation prompts so this runs unattended in CI.
# Auto installs new canisters and upgrades existing ones, preserving EOP memory.
# Never fall back to reinstall or wasm-memory-persistence=replace on failure.
icp deploy -e "$ICP_ENV" -y --mode auto --cycles 1000000000000
if [ -f "$KEY_RECEIPT" ]; then
  node "$REPO_DIR/frontend/scripts/media-key-deploy-preflight.mjs" after "$IDS_JSON" "$KEY_RECEIPT" "$DEPLOY_TARGET" "$ICP_ENV"
fi

[ -f "$IDS_JSON" ] || { echo "ERROR: $IDS_JSON not found after deploy"; exit 1; }

cid() { node -e "const m=require('$IDS_JSON');const v=m['$1'];if(!v){console.error('missing id for $1');process.exit(1)}console.log(typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]))"; }

CLUB_DOMAIN="$(cid club_domain)"
NOTIFICATION_QUEUE="$(cid notification_queue)"
MESSAGING_DOMAIN="$(cid messaging_domain)"
EVENTS_DOMAIN="$(cid events_domain)"
COMPETITION_DOMAIN="$(cid competition_domain)"
MINI_LEAGUE_DOMAIN="$(cid mini_league_domain)"
VAULT_DOMAIN="$(cid vault_domain)"
PII_ACCESS_CONTROL="$(cid pii_access_control)"
IDENTITY_ACCESS="$(cid identity_access)"

# Cross-group account lifecycle remains local-only until complete inventory,
# authority-wide revocation fencing and mirror invalidation are proven.
# Never singleton-overwrite identity_access authorities or set the rehearsal env.

echo "==> Wiring: timer_jobs.initialize() (first-caller-wins governor)"
icp canister call timer_jobs initialize '()' -e "$ICP_ENV"

echo "==> Wiring: pii_access_control -> club_domain"
icp canister call pii_access_control set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call pii_access_control set_competition_domain_canister "(principal \"$COMPETITION_DOMAIN\")" -e "$ICP_ENV"
icp canister call vault_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_points_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: messaging_domain <-> notification_queue"
icp canister call messaging_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"
icp canister call notification_queue set_messaging_domain_canister "(principal \"$MESSAGING_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: club_domain + events_domain -> notification_queue"
icp canister call club_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"
icp canister call events_domain set_notification_queue_canister "(principal \"$NOTIFICATION_QUEUE\")" -e "$ICP_ENV"

echo "==> Wiring: notification_queue -> club_domain (app-admin gated push health/cleanup)"
icp canister call notification_queue set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: notification_queue -> identity_access (inbox ownership checks)"
icp canister call notification_queue set_identity_access_canister "(principal \"$IDENTITY_ACCESS\")" -e "$ICP_ENV"

# Push delivery worker grant — principal derived from ICP_PUSH_WORKER_SEED
# (64 hex chars). Skip silently when the secret is not configured; the
# icp-push-deliver workflow no-ops until both this grant and its secrets exist.
if [ -n "${ICP_PUSH_WORKER_SEED:-}" ]; then
  NODE_PATH_DIR="$REPO_DIR/frontend/node_modules"
  if ! node -e "require.resolve('@icp-sdk/core/identity', { paths: ['$NODE_PATH_DIR'] })" 2>/dev/null; then
    echo "==> Installing @icp-sdk/core for push worker principal derivation"
    mkdir -p "${RUNNER_TEMP:-/tmp}/icp-push-deps" && npm install --prefix "${RUNNER_TEMP:-/tmp}/icp-push-deps" @icp-sdk/core --no-fund --no-audit >/dev/null
    NODE_PATH_DIR="${RUNNER_TEMP:-/tmp}/icp-push-deps/node_modules"
  fi
  WORKER_PRINCIPAL="$(PUSH_WORKER_NODE_PATH="$NODE_PATH_DIR" node "$REPO_DIR/scripts/push-worker-principal.mjs")"
  echo "==> Granting push worker principal on notification_queue: $WORKER_PRINCIPAL"
  icp canister call notification_queue grant_worker "(principal \"$WORKER_PRINCIPAL\")" -e "$ICP_ENV"
fi

echo "==> Wiring: media_blob_store -> club_domain"
icp canister call media_blob_store set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
# Photo-store shards (media_blob_store_2, _3, …) get the same wiring. Each
# shard is its own canister entry in icp.yaml built from the media_blob_store
# source with GOVERNOR_PRINCIPAL set; register its ID in Placement Settings.
for SHARD in $(node -e "const m=require('$IDS_JSON');console.log(Object.keys(m).filter(k=>/^media_blob_store_\\d+$/.test(k)).join(' '))"); do
  echo "==> Wiring: $SHARD -> club_domain"
  icp canister call "$SHARD" set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
done

echo "==> Wiring: permanent-delete fan-out (club_domain -> events/messaging/pii, events/messaging <- club_domain)"
# Without these, club_domain skips cross-canister cleanup (local purge still
# completes) and events_domain/messaging_domain reject every delete_*_data
# call — fail-open-by-skip on the sender, fail-closed on the receivers.
icp canister call club_domain set_events_domain_canister "(principal \"$EVENTS_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_messaging_domain_canister "(principal \"$MESSAGING_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_pii_canister "(principal \"$PII_ACCESS_CONTROL\")" -e "$ICP_ENV"
icp canister call events_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call competition_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call competition_domain set_events_domain_canister "(principal \"$EVENTS_DOMAIN\")" -e "$ICP_ENV"
icp canister call competition_domain set_vault_domain_canister "(principal \"$VAULT_DOMAIN\")" -e "$ICP_ENV"
icp canister call competition_domain set_pii_access_control_canister "(principal \"$PII_ACCESS_CONTROL\")" -e "$ICP_ENV"
icp canister call events_domain set_competition_domain_canister "(principal \"$COMPETITION_DOMAIN\")" -e "$ICP_ENV"
icp canister call vault_domain set_competition_domain_canister "(principal \"$COMPETITION_DOMAIN\")" -e "$ICP_ENV"
icp canister call messaging_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"
icp canister call messaging_domain set_competition_domain_canister "(principal \"$COMPETITION_DOMAIN\")" -e "$ICP_ENV"

icp canister call events_domain set_mini_league_domain_canister "(principal \"$MINI_LEAGUE_DOMAIN\")" -e "$ICP_ENV"
icp canister call mini_league_domain set_events_domain_canister "(principal \"$EVENTS_DOMAIN\")" -e "$ICP_ENV"

echo "==> Wiring: club news audiences (club_domain <-> mini_league_domain/competition_domain)"
icp canister call club_domain set_mini_league_domain_canister "(principal \"$MINI_LEAGUE_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_competition_domain_canister "(principal \"$COMPETITION_DOMAIN\")" -e "$ICP_ENV"
icp canister call club_domain set_competition_authorities "(vec { principal \"$COMPETITION_DOMAIN\" })" -e "$ICP_ENV"
icp canister call competition_domain set_participant_club_authorities "(vec { principal \"$CLUB_DOMAIN\" })" -e "$ICP_ENV"
icp canister call mini_league_domain set_club_domain_canister "(principal \"$CLUB_DOMAIN\")" -e "$ICP_ENV"

echo ""
echo "==> Deploy complete. Canister IDs — paste into /admin/placement-settings → Canister configuration:"
node -e "const m=require('$IDS_JSON');for(const [k,v] of Object.entries(m)){const id=typeof v==='string'?v:(v.ic||v.id||Object.values(v)[0]);console.log(k+'\t'+id)}"
echo ""
echo "Optional next steps:"
echo "  - Set the routing-config fallback:  icp canister call club_domain set_app_config '(\"backend_routing_config\", \"<JSON mirroring the Supabase app_settings row>\")' -e "$ICP_ENV""
echo "  - Commit $IDS_JSON so the team keeps the ID mapping."
