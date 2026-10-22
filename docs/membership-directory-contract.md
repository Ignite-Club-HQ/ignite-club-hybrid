# Stage B: authority-backed membership display directory

Status: durable source invalidation, operator traversal, bounded membership reconstruction and offline directory/staging core implemented locally; central propagation/read API and cutover not implemented or released.
Stage A complete discovery remains mandatory until the requirements below pass.

## Scope and ownership

The shared identity authority is the proposed directory owner because it already owns verified account/principal associations. This proposal must not activate its rehearsal-only linked-account synchronization, release account lifecycle operations, or repurpose service reader grants. The directory is a caller-private display/discovery index, never a resource authorization source.

Index effective active club membership from each exact club authority. League memberships, removed-club discovery, chat membership, payment permissions, app-admin discovery and resource reads remain separate. Preserve explicit handling of app-wide roles rather than enumerating every club as an ordinary member.

## Current authority and revision gaps

`club_domain.isMember` combines explicit roles and parent/guardian relationships through assigned teams, exclusions and removed-member state. The transient `currentMemberIndex()` produces candidates and the indexed consensus endpoint rechecks membership. It now uses the migration-backed discovery journal revision for ordinary mutations, while the returned ACL version remains distinct. The dirty journal cannot by itself prove complete stable directory propagation.

Router placement establishes location only. Shared identity account roles/families and frontend acknowledgement invalidation cannot independently establish effective membership at every club authority.

## Required contracts and invariants

1. Each club authority atomically commits a durable membership outbox with its local effective-membership mutation. No awaited central call inside the atomic commit; failed delivery never undoes the legitimate local mutation.
2. Events bind deployment, router, group, club, current writer canister, writer generation and monotonic sequence. The identity authority verifies that exact writer against the complete live registered authority inventory. A browser or arbitrary registered service cannot submit membership claims.
3. Identity resolves account aliases from its own verified, versioned binding. Older account versions, erased/unlinked principals and obsolete authority generations cannot revive a directory entry.
4. Upserts/revocations are idempotent. Duplicate equal-sequence payloads agree exactly; conflicts reject. Out-of-order deliveries cannot overwrite newer membership or tombstones. Unknown acknowledgements retain durable pending events for safe idempotent replay.
5. A caller-only directory read returns bounded club/source rows with account binding version, directory generation, authority inventory revision and completeness status. Continuations pin those fields. No arbitrary-account enumeration is public.
6. An unchanged directory revision replaces broad discovery only after all required authorities have reached their verified completeness watermark. Missing authority, inventory drift or incomplete backfill requires the existing complete Stage A discovery, not an empty list.
7. All data/mutation/media-key permissions remain current source-canister checks. Cached directory rows are routing/display hints only.

## Mutation coverage matrix

| Mutation family | Affected subjects and required evidence |
|---|---|
| Create club, join, invitations, grant/revoke roles | Original creator and all changed principals; exact acknowledged local membership predicate |
| Remove/restore member, exclusions | Recompute effective membership including surviving family access and removal overrides |
| Child team assignment/unassignment, bulk additions | Primary parent and every guardian; remove membership on loss of the last qualifying assignment |
| Guardian add/remove, parent/member/child moves | Both previous and new subjects, teams and clubs |
| Team removal/restore/permanent deletion | All affected family relationships and role grants; no surviving stale team candidates |
| Club soft deletion/restore/permanent purge, timers | Active lifecycle status and ordered negative evidence; trash inventory stays separate |
| ACL replacement, import/drop, principal replacement | Full old/new differences, including removals; authority/source generation fences |
| Identity link/unlink, suspension/erasure, synchronization | Verified account version and aliases; stale deliveries cannot recreate removed identity entries |
| Approved authority replacement | Old writer fenced, destination completeness established; existing photo-bearing-club move ban unchanged |

Every row requires actual helper/timer entry-point mapping and a regression before central cutover. Existing frontend cache invalidation is not substitute evidence.

## Bounded resumable backfill and cutover

- Inventory every required authority, including legacy Group 1, from verified complete registry evidence.
- Record a durable generation and local membership-state watermark. Enumerate membership-bearing state in bounded batches, not only visitors/remembered accounts/router placements.
- Journal backfill batches and concurrent outbox deltas. Completion requires both complete baseline and ordered delta replay through a captured watermark.
- Retain explicit incomplete/error outcomes and resumable progress across upgrades. One failed authority must prevent the central result from claiming completeness while leaving existing complete Stage A discovery usable.
- Verify exact inventory, account binding and authority generations again before switching discovery. Changes invalidate completeness, not source permissions.

## Acceptance before release

### Local implementation evidence (22 October)

- Club mutation epochs are migration-backed dirty state. `restore_member` also invalidates discovery. A new migration initializes revision 1 as pending; normal upgrades retain it.
- Governor-only consensus exports scan at most 100 raw edges, including individual nested child/team assignments; mutation invalidates cursors. They do not expose relationships to browsers or the configured identity service.
- Offline central state enforces exact writer/generation, complete-source watermarks, conflicting/stale replay rejection and same-revision completion after invalidation. Delayed same-revision invalidations do not undo completion.
- Isolated stable staging uses separate caller-provided memories, <=100 rows of <=1024 bytes per chunk, exact ordered replay and resumable progress across reopen. It allocates no production memory IDs and has no public methods. Source manifests remain incomplete during replacement staging.
- Populated legacy local upgrade passes: 251 child/team edges across bounded pages, normal upgrade/cursor preservation, governor-only access, removal/restore revisions and last-family-assignment removal preserving another club.
- Real two-group encrypted-media regression passes: fresh key/upload denial after removal (including pending work), retained-member and other-club access, authority outage, marker restore and upgrade persistence.
- Bounded stable materialization now indexes roles, family relationships, child teams, live-team OR evidence, exclusions and active clubs. Each ingest/join/read advances at most 100 edges/steps/rows; join cursors survive reopening stable memories. A complete pinned authority/generation/revision/inventory digest is required; drift rejects instead of reusing an old stage.
- Null-club roles remain explicit, with bounded caller-scoped active-club paging rather than expanding all app-wide accounts across every club during backfill. Removed/deleted clubs and excluded subjects never appear in effective outputs.
- The disposable populated-canister test feeds real exported edges into the Rust builder and compares results to `is_club_member`, including parents, guardians, app-wide roles, removal/restore, last-assignment loss and club deletion/restore. Unit tests cover 251-team resume, live/deleted team overlap, missing teams, direct-role veto, ordered replay and a 205-club app-wide read in bounded pages.
- 72 identity tests and 35 existing frontend membership/discovery tests pass; new Motoko discovery tests and existing membership index/page tests pass. All 17 interfaces match; ICP-mode guards and preview checks pass.

### Automatic-update/private-reader continuation (20:56)

- Added isolated stable source-update journals with exact authority/generation/inventory binding. New revisions stay pending until complete reconstruction is published and the exact revision is read back; unknown/stale acknowledgements cannot clear newer work. Reopen and exact retry are tested.
- Added caller-private bounded account lookup aggregation, one local source/alias page and <=100 scanned rows per request. Fresh identity-owned account aliases are checked through existing suspension, denial, erasure, stale-index, unlink and deletion-ticket protections; no caller-supplied account ID or alias list becomes authority.
- Continuations pin initiating caller, account binding/version/alias set and complete source inventory via compact digests. A stable session adapter owns traversal position and saved replies; future clients submit only sequential page numbers, not cursor positions. Skipped pages, foreign-alias continuations, inventory/account drift and nonadvancing source cursors reject. Exact reply replay survives reopening.
- Full identity regressions: 78 passed. These modules remain offline with no production memory allocations, public endpoint, timer or live delivery enabled. Cross-page duplicate club/source aggregation and session reclamation/budgets remain integration requirements.

### Remaining integration and release gates

No propagation worker, source acknowledgement endpoint, authenticated central reader or frontend directory cutover is installed. Bounded raw-source joins are locally parity-tested, but production integration still needs exact registry/placement bindings, shared account/source indexing, verified alias/version handling and rekey/merge/erasure acceptance. Production memory IDs have not been allocated. Builder stages currently use isolated test memories; a multi-source generation namespace and bounded reclamation/budgets are mandatory before production allocation.

Source-binding investigation confirms `read_hosted_club_assignment` can verify assigned clubs at a pinned router revision, resolved against the matching group registry. It returns an error for missing assignments; that must not imply legacy Group 1 ownership. Legacy source coverage needs independently verified exact mappings. The directory coordinator must not repurpose membership checks, admission reader grants or registry location alone as completeness evidence.

Rollback to older authority state is unsupported for directory cutover until an externally fenced replacement generation is bound into source cursors and propagation evidence. A restored local counter cannot discover the central high watermark. Ordinary upgrades must continue preserving revisions. Old staging-chunk reclamation and bounded storage budgets also remain required before enabling ingestion.

Cover populated legacy backfill with concurrent additions/removals, last-family-link removal, linked aliases, app-wide roles, missed/duplicate/out-of-order acknowledgements, stale writer generations, identity erasure, authority loss, upgrades mid-backfill and failed sources. Verify bounded request/result work and caller privacy against real local canisters. Keep current on-chain admission/lifecycle gates and all photo authorities unchanged.

Implementation and exact-target deployment remain separate work. Signed-in real-account traces and explicit release approval are required; this specification is not an installed directory or a performance claim.