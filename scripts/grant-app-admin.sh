#!/usr/bin/env bash
# Ignite Club HQ — grant app admin to an Internet Identity user.
#
# Run by .github/workflows/grant-app-admin.yml with the governor identity
# selected. Looks the user up by display name on identity_access, then grants
# the app_admin role on every canister that knows the role:
#   - club_domain      add_role_grant (governor passes the admin gate)
#   - insights_domain  grant_role     (gates useIsAppAdmin / admin screens)
#   - messaging_domain grant_role
#   - identity_access  grant_role     (account-keyed roles)
#
# Usage: bash scripts/grant-app-admin.sh ["Display Name"] [club-id]
set -euo pipefail

SEARCH_NAME="${1:-Paul Cranwell}"
CLUB_ID="${2:-966bdaec-ebf1-46da-b2b3-cc53bf05c422}"

# The name travels inside a candid text argument — keep it to plain name
# characters so quoting can't break.
NAME_RE="^[A-Za-z' -]+$"
[[ "$SEARCH_NAME" =~ $NAME_RE ]] || { echo "ERROR: invalid name '$SEARCH_NAME'"; exit 1; }

cd "$(dirname "$0")/../deploy/mainnet"

echo "==> Looking up '$SEARCH_NAME' on identity_access"
OUT="$(icp canister call identity_access search_profiles "(\"$SEARCH_NAME\", 5 : nat16)" -e ic)"
echo "$OUT"

# Optional exact sign-in ID: picks one profile when several share the name.
ONLY_PRINCIPAL="${ONLY_PRINCIPAL:-}"
ACCOUNTS="$(printf '%s' "$OUT" | grep -oE 'account_id = "[^"]+"' | sed 's/^account_id = "//; s/"$//' || true)"
PRINCIPALS="$(printf '%s' "$OUT" | grep -oE 'principal "[a-z0-9-]{20,}"' | sed 's/^principal "//; s/"$//' || true)"
if [ -n "$ONLY_PRINCIPAL" ]; then
  IDX="$(printf '%s\n' "$PRINCIPALS" | grep -nxF "$ONLY_PRINCIPAL" | cut -d: -f1 || true)"
  [ -n "$IDX" ] || { echo "ERROR: no '$SEARCH_NAME' profile has sign-in ID $ONLY_PRINCIPAL"; exit 1; }
  OUT="account_id = \"$(printf '%s\n' "$ACCOUNTS" | sed -n "${IDX}p")\"; principal \"$ONLY_PRINCIPAL\"; display_name"
fi

MATCHES="$(printf '%s' "$OUT" | grep -o 'display_name' | wc -l | tr -d ' ')"
if [ "$MATCHES" != "1" ]; then
  echo "ERROR: expected exactly 1 profile matching '$SEARCH_NAME', found $MATCHES."
  echo "Fix the display name in the app profile, or pass a more specific name, or fill in the sign-in ID input."
  exit 1
fi

# The candid text form quotes reserved words, so the field prints as
#   "principal" = principal "aaaaa-...";
# Match the principal value itself, and tolerate a failed grep so the friendly
# error below prints instead of a silent set -e exit.
ACCOUNT_ID="$(printf '%s' "$OUT" | grep -oE 'account_id = "[^"]+"' | head -1 | sed 's/^account_id = "//; s/"$//' || true)"
PRINCIPAL="$(printf '%s' "$OUT" | grep -oE 'principal "[a-z0-9-]{20,}"' | head -1 | sed 's/^principal "//; s/"$//' || true)"
[ -n "$ACCOUNT_ID" ] && [ -n "$PRINCIPAL" ] || { echo "ERROR: could not parse account id / principal"; exit 1; }
echo "==> Found account $ACCOUNT_ID (principal $PRINCIPAL)"

grant() { # canister method args
  local out
  out="$(icp canister call "$1" "$2" "$3" -e ic)"
  echo "$out"
  printf '%s' "$out" | grep -q 'Ok' || { echo "ERROR: $1.$2 rejected the grant"; exit 1; }
}

echo "==> Granting app_admin on club_domain"
grant club_domain add_role_grant "(principal \"$PRINCIPAL\", \"$CLUB_ID\", \"app_admin\", null)"

echo "==> Granting app_admin on insights_domain"
grant insights_domain grant_role "(principal \"$PRINCIPAL\", \"app_admin\", \"$CLUB_ID\", null)"

echo "==> Granting app_admin on messaging_domain"
grant messaging_domain grant_role "(principal \"$PRINCIPAL\", \"app_admin\", null, null)"

echo "==> Granting app_admin on identity_access"
# identity_access rejects duplicates, so a re-run reporting "Duplicate role"
# here means the grant is already in place — treat it as success.
IA_OUT="$(icp canister call identity_access grant_role "(\"$ACCOUNT_ID\", \"app_admin\", null, null)" -e ic)"
echo "$IA_OUT"
printf '%s' "$IA_OUT" | grep -qE 'Ok|Duplicate role' || { echo "ERROR: identity_access.grant_role rejected the grant"; exit 1; }

echo "==> Done. $SEARCH_NAME is now app admin on the ICP backend."
echo "    They may need to sign out and back in for admin screens to unlock."
