# Group 2 general opening — runbook (21 October 2026)

Group 2 is upgraded on mainnet (13/13 module fingerprints changed 21 Oct, sole
governor preserved, 1.48–1.50T cycles each; see
`docs/group-2-post-upgrade-verification-2026-10-21.md`). It is still closed and
unregistered. This runbook opens it **to everyone**, with admin-only stop
controls, replacing the superseded owner-only trial
(`docs/group-2-owner-opening.md` — do not use it).

## Order of operations (each step is its own GitHub run)

### Account admission rejection during creation (22 October 2026)

`read_my_club_memberships_indexed` can reject with `Account admission denied or
unavailable` even after the old opening checks passed. Those checks verified
destination environment settings and the separately released bound-deletion
connection, but not whether shared identity permits the destination's
`read_principal_eligibility` call. The current identity source still protects
that endpoint behind the unreleased cross-group rehearsal gate and its
authorized-reader inventory. Destination settings alone do not release it.

The corrected check requires governor-read identity evidence
`account_admission_released=true` plus `eligibility_authority` for each enabled
destination. Missing evidence blocks check/snapshot/open. This change does not
release admission, register readers, alter deployed settings, or fix live
creation by itself. Do not set rehearsal flags, disable admission, or fall back
to shared canisters. Publishing alone cannot repair the live authorization.

The dedicated **Repair Group 2 account access** workflow now provides the narrow
repair. Choose action **repair**, confirmation **REPAIR GROUP 2 ACCOUNT ACCESS**.
It builds/upgrades only the pinned existing shared identity canister, authorizes
the exact eleven Group 2 admission domains plus its dedicated photo store from
two consensus router inventory reads, verifies the grant, then regenerates and
commits the routing snapshot. It preserves existing accounts, settings, Group 1
services, club/media assignments and placement accepting state. It never sets
the identity rehearsal flag or enables account-link/removal recovery features.
The workflow uses the existing DEPLOYER_PEM in the protected group-2-admin-controls
environment and the shared deployment concurrency lock. An immutable-commit
journal retains unknown upgrade outcomes and refuses automatic upgrade replay.
Once green, publish the updated app and create/read back a fresh Group 2 club.
If snapshot generation fails after authorization, rerun the existing snapshot
action after resolving its reported mismatch; do not repeat opening.
Action **disable**, confirmation **DISABLE GROUP 2 ACCOUNT ACCESS**, revokes the
narrow eligibility grant (not the placement accepting switch). It blocks Group 2
account-protected operations; ordinary stop-new-placement remains the preferred
control when current clubs should keep working.

This environment has no governor key or GitHub Actions token. Implementation and
local tests do not establish deployment or authenticated mainnet club creation.
Focused verification: 58 identity Rust tests, 8 release/workflow/journal tests,
30 frontend opening/session/error regressions and 17-contract drift passed.
Real local router/identity rehearsal passed with no identity rehearsal flag:
exact 12 readers, governor-only authorization/disable, stale-registry rejection,
active/unknown/suspended eligibility, full-account/lifecycle/recovery refusal,
grant and suspension preservation through upgrade. Destination services in that
rehearsal are inventory metadata; actual signed-in club creation is unverified.

The app shows a short account-connection message instead of dumping the replica
request, headers and identifiers into the pop-up; technical details stay in logs.

### Repair for the club-creation approval error (22 October 2026)

Ordinary club reservations previously advanced the same revision used by the
frontend approval. A fresh snapshot alone was therefore only a temporary fix.
The router now stores a separate stable configuration revision, while keeping
the original assignment/deletion/session revision and all creator checks.

For an already-open Group 2:
1. Sync these changes to GitHub.
2. Run **Deploy ICP canisters (mainnet)** with scope **router**. It upgrades
   only the pinned existing router; it never creates canisters or rewires
   club/media services. Do not choose `all` for this repair.
3. Run **Open Group 2 to everyone** with action **snapshot**, confirmation empty.
   Do not repeat `open` for a group that is already accepting.
4. Sync the generated snapshot to Lovable and publish.
5. Create two fresh test clubs and confirm their membership/details read back.
   Report their names if either fails; this repair does not move existing clubs.

Health and ordinary placements do not change configuration approval. Group
registration, admission changes, placement bindings and authorization/capacity
baseline changes invalidate it. Complete consensus reads remain assignment-
revision-pinned and reject concurrent drift; service/placement/policy inventory
must still match the approved canonical projection exactly. Old snapshots and
old router responses fail closed until upgraded and regenerated.

Local verification is not authenticated mainnet creation or an actual Wasm
upgrade rehearsal. The owner-run upgrade, snapshot and two-club check are still
required before claiming this repair is live.

1. **Deploy the shared router upgrade first** — run
   `Deploy ICP canisters (mainnet)` with scope `all`. This is required because:
   - placement needs health readings fresher than 15 minutes and the new
     acceptance window is 2 hours (`backend/shard_router/src/groups.rs`);
   - health reporting must stop bumping the registry revision
     (`record_group_health` now patches the group record without CAS revision
     change), otherwise every health report invalidates a shipped routing
     snapshot and the app switch fails closed forever.
2. **Enable the reporting cadence** — the `Report group health to the router`
   workflow is scheduled every 15 minutes; confirm one green run. It reports
   every registered group anonymously (public `cycles_balance` / `memory_stats`)
   and refuses partial or shared-canister readings.
3. **register-closed** — `Open Group 2 to everyone` → action `register-closed`,
   confirmation `REGISTER GROUP 2 CLOSED`. Registers the installed group and
   placement records **closed**. Settings and fingerprint collection require
   this registry entry; do not run them before registration.
4. **Service settings** — `Open Group 2 to everyone` → action `settings`
   (confirmation `SET SERVICE SETTINGS`):
   - binds all g2 services and the photo store to `identity_access`
     (`IGNITE_ACCOUNT_IDENTITY_ACCESS`),
   - then sets `IGNITE_ACCOUNT_GROUP_ADMISSION_RELEASE=1`,
   - then sets the creator placement binding
     (`IGNITE_ACCOUNT_CLUB_PLACEMENT_ROUTER=jcdfe-vqaaa-aaaal-qxloq-cai`),
   - verifies each write by read-back. Group 1 stays untouched.
5. **prepare-hashes** — records the live module fingerprints of the thirteen
   services plus the photo store into `deploy/groups/g2/general-opening.json`
   (committed automatically). Refuses to proceed without them.
6. **Report group health**, then **check** — refresh the newly registered
   group's health and verify the full opening case without mutating: exact
   inventory/fingerprints, closed registration state, live health (fresh
   readings from step 2), every registered group's reciprocal configuration,
   identity wiring and removal wiring. Any mismatch fails the run.
7. **snapshot** — governor-verified runtime switch snapshot. Re-reads the
   registry and every service, verifies reciprocal/removal wiring, and writes
   `frontend/src/live/generated/routingGates.ts` (committed automatically).
   The app's ICP routing switch uses it: routing is active only when the live
   registry exactly matches the approved snapshot (revision, group set,
   endpoints, photo store, module fingerprints) and only for signed-in
   accounts. Any registry drift fails closed — never to shared canisters.
8. **open** — confirmation `OPEN GROUP 2 TO EVERYONE`. Verifies the same case
   as `check`, then flips `accepting=true` on the group and placement records
   with a revision CAS and a fresh health report. New clubs placed by the
   router land in the healthiest accepting group.
9. **close** (stop new clubs) — confirmation `CLOSE GROUP 2 TO NEW CLUBS`.
   Flips `accepting=false` with a revision CAS. Existing clubs keep their
   assignments, endpoints, keys and access.

## Safety properties

- Every mutating action requires its exact confirmation phrase and the
  protected `group-2-admin-controls` GitHub environment, serialized with all
  other governor operations.
- `register_group` is governor-only with immutable endpoints; a stop preserves
  endpoints and assignments.
- Opening requires removal wiring for **every** registered group; a new group
  cannot be opened while an older registered group lacks wiring.
- No workflow creates identities, installs canisters, mints cycles or writes
  settings outside the `settings` action; the signing key is removed
  unconditionally (`if: always()`).
- The frontend switch is evidence-bound: a snapshot that no longer matches the
  live registry deactivates routing rather than falling back.

## Known limits

- The settings action writes canister environment variables on the Group 2
  services only. Enabling the admission-release flag on shared Group 1
  canisters is intentionally out of scope (legacy account queries would trap).
- If the `snapshot` run reports a mismatch for another registered group, fix
  that group's wiring; do not weaken the snapshot checks.
- Health reporting currently covers registered groups; a newly registered
  group appears automatically on the next 15-minute run.

## Account-service link (part of `settings`)
`settings` also links the shared account service once, skipping anything already correct and reading every value back: identity `IGNITE_BOUND_DELETION_RELEASE=1`, router `deletion_authority` = identity, identity pinned to this router (`pin_owner_test_deletion_registry`, mainnet), and each group's club service bound to the identity (only while it is empty). A different existing binding stops the run for review. `open`/`close` re-pin the identity forward to the new registry revision so account deletions keep working.

## Reload after `settings` (Upgrade Group 2 → `reload`)
Motoko services read their service settings only when installed or upgraded, so values written by `settings` are saved but inactive until a reload. Run "Upgrade Group 2 (closed)" with action `reload` and confirmation `RELOAD GROUP 2 SETTINGS`: it reinstalls each of the thirteen services in upgrade mode with the identical module (refuses if any staged build differs from the live module), keeps memory and settings, checks the photo key, journals each step on `group-2-upgrade-receipts`, and leaves fingerprints unchanged. Then rerun `settings` (it resumes, skipping finished links) and `check`.
