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
- Messaging loader (`migrate-club-messaging.mjs`): team/club/group/club-admin
  conversations with canonical ids (team chat id = team id, club chat id = club
  id), ordered per-conversation sequences, replies, image attachments and
  system-message attribution to the deploy identity. Imported through the
  canister's paged import (500 messages per page, idempotent per message id).
- Notifications loader (`migrate-club-notifications.mjs`): historical
  notifications import as delivered receipts with stable idempotency keys;
  pending scheduled messages keep send time, recurrence and status variants.
- Media and Vault loaders (`migrate-club-media.mjs`, `migrate-club-vault.mjs`):
  photo/folder/file metadata with scoping, captions and attribution. The
  `media_bytes` step (`migrate-club-bytes.mjs`) then downloads each file from
  Supabase storage, IBE-encrypts it offline to the destination group's
  production PII key (identity `path ++ U+001F ++ "blob"`, deterministic seed
  so resume reproduces the identical ciphertext/hash), uploads the ciphertext
  to the group's media_blob_store with the chunked contract, registers the
  matching pii_access_control record (owner = claimed uploader, else the
  deploy identity) with a best-effort club read grant, and patches the
  blob_ref pointers into both snapshots via idempotent re-import. Per-item
  journal on disk (never plaintext); unknown outcomes are retained and stop
  the run, never replayed. External links keep pointing at their URL.
- Children writer (the `children` step): encrypted child names/birth years load
  into pii_access_control under the pinned production key; family, role and
  exclusion arrays re-import into club_domain (idempotent replace of the club
  step's snapshot). Account mirrors use the canister's own `principal:` fallback
  convention. Cross-club shared children are refused canister-side by the PII
  ciphertext-collision check.
- Game results (`migrate-club-event-results.mjs`): scores, period/player stat
  JSON blobs, formations and per-player stats import into the events snapshot.

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
- Polls and photo albums: votes and album names/covers have no field in the
  destination snapshots, so clubs carrying them refuse rather than lose data.
- Event duties, captains, goalkeepers, player-of-the-match and event guests:
  no destination snapshot contract; any row stops the events step.
- MVP and fill-in player names, assists, position minutes, guardian
  relationship labels/primary flags, and live in-progress games: refused
  rather than stored as plaintext, converted with unverified units, or dropped.
- Event payments: excluded by design — payments stay in Supabase.
- Direct messages: account-to-account, not club-owned; excluded from the club
  migration entirely.
- Claim emails remain a separately approved auth action; routing remains blocked.

## Not completed or verified live
Preservation contracts for the refused event/guardian/poll/album data (needs
new canister snapshot fields and a separately approved service upgrade) and
the separately approved sign-in cutover remain. All eleven plan steps have
writers, and the run now includes:

- **Stable source inventory** — `check` records the plan hash (which binds
  every table count, media totals, canister IDs and revision); `migrate` and
  `recover` refuse if the source changed since that check.
- **Durable remote recovery** (`migrate-club-remote.mjs`) — every acknowledged
  journal state is mirrored to the repository's `migration-journals` branch
  and hash-verified on readback; a lost runner restores from the remote copy.
  A failed push stops the run as an unknown outcome.
- **Final reconciliation** (`migrate-club-reconcile.mjs`) — the `verify` step
  reads every destination canister's own export back, counts records per
  domain and proves they match what the writers acknowledged; after
  media_bytes it also proves every photo/Vault record points at on-chain
  bytes. Any mismatch stops the run; routing stays blocked regardless.

A live run is gated by the owner setting, the exact-club/group data approval,
the plan hash and the typed confirmation.
The adapter tests exercise encoding, fencing and acknowledgement with fixtures;
they do not establish live Supabase consistency or Internet Identity acceptance.