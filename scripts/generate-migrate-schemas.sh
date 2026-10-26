#!/usr/bin/env bash
# Regenerates scripts/migrate-schemas/<canister>.snapshot.did(.js) from each
# canister's own source by appending a `schema(<SnapshotType>)` query to a temp
# copy of main.mo. Run after any snapshot type change; tests encode against it.
set -euo pipefail
MOC=${MOC:-/root/.cache/mops/moc/1.16.1/moc}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
gen() { # canister SnapshotType
  local c=$1 t=$2 d="$ROOT/backend/$1"; local tmp="$d/src/zz_migrate_schema.mo"
  python3 - "$d/src/main.mo" "$tmp" "$t" <<'PY'
import sys; s=open(sys.argv[1]).read(); i=s.rstrip().rfind('}')
open(sys.argv[2],'w').write(s[:i]+f"\n  public query func zz_migrate_schema(_ : {sys.argv[3]}) : async () {{}};\n"+s[i:])
PY
  (cd "$d" && "$MOC" $(mops sources) --default-persistent-actors --enhanced-migration src/backend/migrations --idl src/zz_migrate_schema.mo -o "/tmp/$c.snapshot.did") || { rm -f "$tmp"; exit 1; }
  rm -f "$tmp"
  cp "/tmp/$c.snapshot.did" "$ROOT/scripts/migrate-schemas/$c.snapshot.did"
  "$ROOT/frontend/node_modules/.bin/icp-bindgen" --force --did-file "/tmp/$c.snapshot.did" --out-dir "/tmp/bg-$c" >/dev/null
  sed '/^import { IDL }/d' "/tmp/bg-$c/declarations/$c.snapshot.did.js" > "$ROOT/scripts/migrate-schemas/$c.snapshot.did.js"
}
gen club_domain ClubSnapshot
gen events_domain EventsSnapshot
gen competition_domain FenceSnapshot
gen mini_league_domain LeagueSnapshot
gen club_points_domain PointsSnapshot
gen messaging_domain ChatPage
gen notification_queue FenceSnapshot
gen media_metadata FenceSnapshot
gen vault_domain VaultSnapshot
gen pii_access_control FenceSnapshot
