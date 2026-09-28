#!/usr/bin/env bash
set -Eeuo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CLI=${ICP_CLI:-$(command -v icp || true)}
if [[ -z "$CLI" ]]; then TOOL=/tmp/ignite-icp-tools; mkdir -p "$TOOL"; curl -fsSL https://github.com/dfinity/icp-cli/releases/download/v1.5.0/icp-cli-x86_64-unknown-linux-gnu.tar.xz -o "$TOOL/icp.tar.xz"; tar -xJf "$TOOL/icp.tar.xz" -C "$TOOL"; CLI="$TOOL/icp-cli-x86_64-unknown-linux-gnu/icp"; fi
TMP=$(mktemp -d /tmp/ignite-hybrid-notify.XXXXXX); PORT=${HYBRID_PORT:-5003}; keep=0; cleanup(){ rc=$?; "$CLI" network stop local --project-root-override "$TMP" >/dev/null 2>&1 || true; if [[ $rc -ne 0 ]]; then echo "Probe failed; logs preserved at $TMP" >&2; else rm -rf "$TMP"; fi; exit $rc; }; trap cleanup EXIT
mkdir -p "$TMP/.local-icp"; cp "$ROOT/icp.yaml" "$TMP/icp.yaml"; cp "$ROOT/.local-icp/init.bin" "$TMP/.local-icp/init.bin"; sed -i "s/port: [0-9]*/port: $PORT/" "$TMP/icp.yaml"
"$CLI" network start local -d --project-root-override "$TMP" >"$TMP/network.log" 2>&1 || { cat "$TMP/network.log" >&2; exit 1; }
P=$($CLI canister create --detached -n local --identity anonymous --quiet --project-root-override "$TMP"); N=$($CLI canister create --detached -n local --identity anonymous --quiet --project-root-override "$TMP")
"$CLI" canister install "$P" -n local --identity anonymous --mode install --wasm "$ROOT/target/wasm32-unknown-unknown/release/placement_registry.wasm" --args '(record { governor = principal "wf3fv-4c4nr-7ks2b-xa4u7-kf3no-32glf-lf7e4-4ng4a-wwtlu-a2vnq-nae" })' --project-root-override "$TMP"
"$CLI" canister install "$N" -n local --identity anonymous --mode install --wasm "$ROOT/target/wasm32-unknown-unknown/release/notification_queue.wasm" --args '()' --project-root-override "$TMP"
if ! (cd "$ROOT/frontend" && PLACEMENT_HOST="http://127.0.0.1:$PORT" PLACEMENT_ID="$P" PLACEMENT_BACKEND_CANISTER="$N" PLACEMENT_LEAVE_ACTIVE=1 npm run test:placement-registry) >"$TMP/placement-active.log" 2>&1; then cat "$TMP/placement-active.log" >&2; exit 1; fi
cat "$TMP/placement-active.log"
CLUB=$(sed -n 's/.*"us": "\([^"]*\)".*/\1/p' "$TMP/placement-active.log" | tail -1); [[ -n "$CLUB" ]] || { echo 'Synthetic active club was not configured' >&2; exit 1; }
(cd "$ROOT/frontend" && HYBRID_HOST="http://127.0.0.1:$PORT" PLACEMENT_ID="$P" NOTIFY_ID="$N" HYBRID_CLUB="$CLUB" npm run test:hybrid-notification-live) 2>&1 | tee "$TMP/hybrid.log"; test "${PIPESTATUS[0]}" -eq 0
if ! (cd "$ROOT/frontend" && PLACEMENT_HOST="http://127.0.0.1:$PORT" PLACEMENT_ID="$P" PLACEMENT_BACKEND_CANISTER="$N" npm run test:placement-registry) >"$TMP/placement-readonly.log" 2>&1; then cat "$TMP/placement-readonly.log" >&2; exit 1; fi
cat "$TMP/placement-readonly.log"
echo "PASS: self-provisioned hybrid notification probe ($CLUB)"
