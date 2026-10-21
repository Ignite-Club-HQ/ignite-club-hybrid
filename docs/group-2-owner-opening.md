# Group 2 owner-only opening

## What is implemented

The manual **Group 2 owner opening** GitHub workflow has four actions:

- `register-closed`: registers the already-installed, checked g2 inventory and immutable placement. Does not open it.
- `check`: checks exact approved deployed modules, sole governor controllers, certified subnet IDs, health, mandatory creator binding, actual reciprocal settings and bound-deletion configuration. It does not mutate placement or open anything.
- `open`: repeats those checks, records current g2 health and signs a separate owner-only grant for 1–10 explicit fresh club UUIDs. All other creators are excluded; general `accepting` stays false.
- `stop`: stops further owner placements without changing existing assignments, membership or access. A stopped receipt cannot be reset into a different approval.

Opening, stopping and registration require the matching phrase shown in the workflow. Surrounding whitespace is trimmed. Readback verifies the opening acknowledgement; failures do not replay creation. Existing global activation/prototype lifecycle and encrypted-media-move gates remain unchanged.

The app's ordinary creation screens select the next approved unused UUID and create once in g2. The approved owner can read their existing shared clubs and g2 clubs. Supabase and other users retain their current routing. Membership—not the receipt—continues to control private resources. Saved creator receipts cannot create for erased/suspended/deletion-pending owners: both placement and destination creation check the shared identity through the pinned router.

## Before running it

Nothing was deployed or opened by this implementation. The workflow intentionally refuses the currently installed older modules/configuration.

1. Configure GitHub environment **group-2-owner-opening** with **Paul as the required reviewer**, prevent self-approval if your repository requires a separate reviewer, and restrict deployment branches to the approved release branch. Repository write access alone is not verified to be Paul; the environment restriction is required for owner control over the deploy key.
2. Perform separately approved upgrades/configuration using the existing deploy identity. Upgrade router/identity and the g2 services to the reviewed recipe artifacts; do not reinstall or repoint any Group 1 service. Preserve the existing PII key attestation process. Keep all `LOCAL_REHEARSAL` flags off.
3. g2 club authority needs the three `IGNITE_NEW_CLUB_PLACEMENT_ROUTER`, `IGNITE_NEW_CLUB_PLACEMENT_GROUP=g2`, `IGNITE_NEW_CLUB_PLACEMENT_TARGET` settings. Its independent governor-only `set_owner_test_deletion_identity` binds the shared identity only while empty; it does not release linked-account sync. The identity's existing `IGNITE_BOUND_DELETION_RELEASE=1` and router deletion authority must be configured. `pin_owner_test_deletion_registry` separately pins the released deletion protocol's exact deployment without enabling history/lifecycle rehearsal. Existing binding substitution, pending-deletion and rollback refusals remain.
4. Commit an opening approval under `deploy/groups/g2/` with the fields below. Use your app Internet Identity principal as `owner`, not the deploy principal. Use module SHA-256 values from the reviewed **icp recipe build/deployed comparison**, never local smoke artifacts. No placeholder approval is supplied: it would pretend live verification has happened.
5. Register CLOSED if necessary. Update the committed revision after registration. Run `check`; then separately run `open` with `OPEN GROUP 2 OWNER TEST`. Use `stop` with the current approved revision and `STOP GROUP 2 TEST PLACEMENTS` when finished. A revision conflict requires rereading and reviewing, not removing the CAS check.

### Approval fields

`governor`, `owner`, `routerId`, `identityAccess`, `pushWorker`, `targetAlias`, `deploymentId`, `host` (pinned `https://icp-api.io`), `revision` (decimal text), `clubIds` (1–10 fresh UUIDs), `minCycles`, `heapBudgetBytes`, and `services` (exact twelve per-group domains plus `media_blob_store`, each with `name`, `canisterId`, `subnetId`, `moduleHash`). Budgets must match the closed router group and reviewed test capacity, not inferred ICP headline limits.

For `register-closed`, additionally supply `provisionFile="../deploy/groups/g2/provision.json"`, `workloadIdentity` (existing shared service), `deploymentRevision`, `primarySubnet`, and `maxClubs`.

### Limitations

- GitHub identity/reviewer restrictions, release modules/configuration, live opening and actual signed-in browser/Android/FCM acceptance were not available in this sandbox and remain unverified.
- Account deletion fails closed if the identity's pinned registry revision is stale; the owner must reconcile/repin the already-released deletion protocol before deletion. This opening path does not silently disable or replace it.
- The owner-only trial is not a general launch: do not invite ordinary users into the trial expecting multi-group app routing. Enabling other users or reopening with a new grant is a separate release decision.
- Broader recovery, account-wide lifecycle completion, PlayHQ, paid capacity fills and photo moves remain out of scope.