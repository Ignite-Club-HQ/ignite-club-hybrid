# Member copying: current implementation boundary

The owner requested continued implementation, not a live migration. No source
records, destination canisters, account claims, emails or routing were changed.

## Added
- Exact-destination claimed-account translation; source UUIDs never become account principals.
- Points/rewards snapshot writer: user/child balances, history, catalog,
  redemptions, cooldowns and points-module settings. It preserves source amounts,
  timestamps, statuses and idempotency keys rather than issuing new awards.
- Ordinary RSVP conversion into the events snapshot, preserving status, notes,
  source, payment flag and timestamp.
- Points Candid schema derived from the actual source snapshot declaration and
  compiler-produced public record types; encoding/decoding regression checks.
- Child balances and cooldown/settings tables now participate in the plan hash.
- Offline family preparation (`migrate-club-family.mjs`): child/team relationships,
  explicit guardian links, club/team role grants and matching account-roster rows,
  club exclusions and encrypted child names/birth years. Guardian relationship,
  primary flag and timestamp are retained separately, not silently discarded.
  The SDK pins the supplied public key to the production destination PII canister
  and immutable `ignite-pii-v1` context; no encryption key is stored in canisters.

## Family preparation boundary
The new helper accepts local input arrays only. It neither fetches source data nor
registers a live writer. Its destination inventory and account maps are inputs,
not live verified evidence. Production wiring still needs complete authenticated
collision scans, exact identity-account resolution, preservation of guardian
metadata and durable ciphertext/intent receipts before import. Fresh encryption
on each preparation is intentional: never regenerate a pending live payload.

Existing destination child/PII IDs refuse because children are shared across clubs
and the current importer replaces their complete record. Season memberships,
team exclusions, global child points and captain-derived grants refuse until
their complete destination contracts are implemented. Ordinary claims never
create membership or grant platform/competition administrator roles.

## Deliberate refusals
- Missing/anonymous account claims, foreign-club rows, duplicate records,
  invalid integer amounts, ambiguous points subjects or missing redemption rewards.
- Child references without verified migrated children; media URLs without verified
  destination references. These dependencies are not yet supplied by live tooling.
- Mini-league RSVP subjects and existing RSVP award flags: the current snapshot
  does not preserve their complete semantics, so the converter refuses rather
  than enabling duplicate awards or silently omitting records.
- Missing overall writers still refuse execution before any live data write.
  Claim emails remain a separately approved auth action; routing remains blocked.

## Not completed or verified live
Live child PII/membership loading, full event duties/results/award receipts, chats,
notifications, media/Vault, stable source inventory and durable remote recovery,
destination reconciliation and separately approved sign-in cutover remain.
The adapter tests exercise encoding, fencing and acknowledgement with fixtures;
they do not establish live Supabase consistency or Internet Identity acceptance.