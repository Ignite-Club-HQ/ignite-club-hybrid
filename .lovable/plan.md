# Remove plaintext sensitive names from events_domain; close identity_access display-name gap

## Decisions (confirmed with user)

- **Adult display names stay in identity_access** as the public, searchable member directory — encrypting them would break member search in ICP mode. They are also registered in the PII canister (already wired) as the authoritative encrypted record. The "move reads off identity_access" follow-up is resolved **by design**, not by code.
- **Scope includes guest names, fill-in player names, and player-of-the-match names** in events_domain, not just child names.

## The authorization problem this solves first

Today a child's name in the PII canister is readable only by its owner (the creating admin) and granted guardians. A coach viewing an event roster is neither — so simply deleting names from events_domain would leave coaches staring at nameless rosters, violating the no-degraded-UI rule. The PII canister must first learn "club staff may read names of people in their club."

`get_decrypted_pii` / `get_decrypted_pii_batch` are update calls, so the PII canister can make an inter-canister check against club_domain.

## Phase 1 — Club-scoped read grants (pii_access_control + club_domain)

**club_domain**
- New query `has_club_staff_role(user : principal, club_id : text) -> bool` — true when the principal holds any role grant in the club. Public query: club membership is already visible to club members under the existing roster-read rules.
- New migration seeds nothing (no state change); .did + bindings regenerated.

**pii_access_control**
- New stable state: `club_grants : [(pii_id, field_id, club_id)]` and `club_domain_canister : ?Principal` (governor-set via new `set_club_domain_canister`), seeded by a new migration.
- New methods: `grant_pii_read_club(pii_id, field_id, club_id)` and `revoke_pii_read_club(...)` — caller must be the record's domain owner or governor.
- `can_read` extended: if a club grant exists for (pii_id, field_id), await club_domain's `has_club_staff_role(caller, club_id)`. Because `can_read` becomes async only on this path, query entry points (`get_encrypted_pii`) keep the existing synchronous checks and deny club-grant-only readers (they must use the decrypt methods).
- .did + bindings regenerated in both binding dirs.

## Phase 2 — Child names out of events_domain

- `Types.Child` drops `name` → `{ id; parent_id : ?Text }`. New migration blanks stored names.
- `admin_upsert_child(id, parent_id)` — name parameter removed (it has zero frontend call sites today; the wrapper in events.ts is updated).
- `event_roster` / `my_child_rsvps` keep returning `child : ?Child` (now id-only); `get_event_child` likewise.
- Frontend: wherever an ICP roster renders a child name — EventDetailPage ICP branch, EventGuestsManager, and the `my_child_rsvps` consumers — resolve names with the existing `getLiveDecryptedPiiBatch(childIds, "name", …)` pattern from homeFeed.ts, best-effort with logged failure. No "not available" states.
- At every child-creation point that already calls `registerLiveChildNamePii`, also `grant_pii_read_club(childId, "name", clubId)` so club staff can read the name (best-effort).

## Phase 3 — Guest names out of events_domain

- `add_event_guest(event_id, guest_name)` keeps its signature, but the canister stores only an opaque reference: frontend first registers the name in the PII canister (`pii_id = "guest:{event_id}:{n}"`, `field_id = "guest_name"`, owner = adding caller, plus club grant), then passes the PII record id as `guest_name`. The canister treats the value as opaque text — no .did change.
- `event_roster` guests render: frontend batch-decrypts `guest_name` values that carry the guest PII id prefix; legacy plaintext values (pre-change guests) render as-is. Recorded limitation: historical guest names remain plaintext on-canister until the events are deleted.

## Phase 4 — Fill-in player and MVP names

- Same opaque-reference pattern as guests: frontend registers the name in the PII canister (`pii_id = "fillin:{match}:{slot}"` / `"mvp:{match}"`, owner = entering caller, club grant) and submits the PII id in the existing `fill_in_player_name` / `mvp_player_name` fields. No .did change.
- Reads decrypt values with the known prefixes; legacy plaintext values display unchanged (same recorded limitation).

## Phase 5 — Close out identity_access

- No canister change. Document the display-name decision in `frontend/AGENTS.md` and `roadmap.md`: adult display names are public directory data by design; child names, invite emails, guest/fill-in/MVP names are PII-canister-only.

## Conventions (new)

- Guest name → `pii_id = "guest:{event_id}:{seq}"`, `field_id = "guest_name"`
- Fill-in name → `pii_id = "fillin:{event_id}:{slot}"`, MVP name → `pii_id = "mvp:{event_id}"`, `field_id = "name"`
- All PII writes and club grants stay best-effort: logged, never thrown, never block the main flow.

## Verification

- Per canister: `moc $(mops sources) --enhanced-migration src/backend/migrations --check src/main.mo` and `--idl` for .did regen; bindings regenerated into BOTH `frontend/src/lab/bindings/<c>` and `frontend/src/lab/generated-contracts/<c>`; `check-candid-drift.mjs` green.
- Fetch the matching ICP skill (per project instructions) before writing the Motoko changes.
- Frontend: typecheck clean, updated/new tests for the roster name-resolution and PII-reference paths, full suite, build OK.
- Update `roadmap.md`, `frontend/AGENTS.md`, `backend/AGENTS.md` with the club-grant rule and the new pii_id conventions.

## Explicitly out of scope

- Historical plaintext guest/fill-in/MVP names already stored in events_domain (displayed as-is; noted as a limitation).
- Deploying canisters or setting canister IDs (remains user work); the deploy script must call `set_club_domain_canister` after deploy — added to the deploy checklist in `backend/AGENTS.md`.
