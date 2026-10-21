# Group 2 general opening — runbook (21 October 2026)

Group 2 is upgraded on mainnet (13/13 module fingerprints changed 21 Oct, sole
governor preserved, 1.48–1.50T cycles each; see
`docs/group-2-post-upgrade-verification-2026-10-21.md`). It is still closed and
unregistered. This runbook opens it **to everyone**, with admin-only stop
controls, replacing the superseded owner-only trial
(`docs/group-2-owner-opening.md` — do not use it).

## Order of operations (each step is its own GitHub run)

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
