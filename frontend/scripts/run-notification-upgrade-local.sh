#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
TMP=$(mktemp -d /tmp/ignite-notify-upgrade.XXXXXX)
PORT=${NOTIFY_PORT:-5010}
CLI=${ICP_CLI:-$(command -v icp || true)}
if [[ -z "$CLI" && -x /tmp/ignite-icp-tools/icp-cli-x86_64-unknown-linux-gnu/icp ]]; then CLI=/tmp/ignite-icp-tools/icp-cli-x86_64-unknown-linux-gnu/icp; fi
if [[ -z "$CLI" ]]; then
  TOOL_DIR=/tmp/ignite-icp-tools
  mkdir -p "$TOOL_DIR"
  curl -fsSL https://github.com/dfinity/icp-cli/releases/download/v1.5.0/icp-cli-x86_64-unknown-linux-gnu.tar.xz -o "$TOOL_DIR/icp.tar.xz"
  tar -xJf "$TOOL_DIR/icp.tar.xz" -C "$TOOL_DIR"
  CLI="$TOOL_DIR/icp-cli-x86_64-unknown-linux-gnu/icp"
fi
cleanup(){ rc=$?; "$CLI" network stop local --project-root-override "$TMP" >/dev/null 2>&1 || true; if [[ $rc -eq 0 ]]; then rm -rf "$TMP"; else echo "Probe failed; logs preserved at $TMP" >&2; fi; exit $rc; }; trap cleanup EXIT
mkdir -p "$TMP/.local-icp"
cp "$ROOT/icp.yaml" "$TMP/icp.yaml"; cp "$ROOT/.local-icp/init.bin" "$TMP/.local-icp/init.bin"
sed -i "s/port: [0-9]*/port: $PORT/" "$TMP/icp.yaml"
"$CLI" network start local -d --project-root-override "$TMP" >/dev/null
ID=$("$CLI" canister create --detached -n local --identity anonymous --quiet --project-root-override "$TMP")
"$CLI" canister install "$ID" -n local --identity anonymous --mode install --wasm "$ROOT/target/wasm32-unknown-unknown/release/notification_queue.wasm" --args '()' --project-root-override "$TMP"
(cd "$ROOT/frontend" && NOTIFY_HOST="http://127.0.0.1:$PORT" NOTIFY_ID="$ID" NOTIFY_PHASE=before npm run test:notification-upgrade)
"$CLI" canister install "$ID" -n local --identity anonymous --mode upgrade --wasm "$ROOT/target/wasm32-unknown-unknown/release/notification_queue.wasm" --args '()' --project-root-override "$TMP"
(cd "$ROOT/frontend" && NOTIFY_HOST="http://127.0.0.1:$PORT" NOTIFY_ID="$ID" NOTIFY_PHASE=after npm run test:notification-upgrade)
echo "PASS: notification upgrade probe ($ID)"
