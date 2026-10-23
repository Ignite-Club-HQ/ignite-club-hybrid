# Stage B: authority-backed membership display directory

Status: caller-bound released private pages, lazy app connection with complete Stage A fallback, and the all-source protected release are implemented and locally verified. Every released page repeats snapshot/source/registry/photo-store/lifecycle verification and account rechecks through awaits. Diagnostic/operator snapshot reports still do not certify permanent freshness. No deployment, publication or signed production performance acceptance has occurred. Current details: `docs/membership-lookup-release.md`.

The dated sections below record earlier stages and their then-open limitations; the release runbook above supersedes historical hard-off/three-target descriptions.

### 23 October acceptance-check implementation

The release runner now binds complete acknowledged fills to the first ownership
reply, validates persisted historical revisions/ownership on restart, pins source
grants to the original identity, and rechecks identity configuration after source
grant writes. Final generated-contract checks perform two complete source-status,
configuration and module/settings sweeps; pending changes, observed rollback,
source outages or late drift refuse. Consensus status also refuses a revision
below the coordinator's persisted observed watermark after reopening.

Those historical reports alone remain non-authorizing. The new governor-only
`check_membership_directory_acceptance()` adds actual consensus snapshot and
restoration verification. Configuration pins replica `canister_info` history
counts and module hashes for identity, router and every source **before** any
reconstruction. Complete ordered revision scans must agree with accepted ownership
and the unchanged complete builds; management-history reads bracket the scans.
The two scans have a common stable interval, establishing snapshot-time evidence
without membership-write locks or relying on notification delivery.

The independent replica history advances on snapshot load, including same-code
and jointly restored identity/source loads; restored local acceptance cannot
repin it through ordinary configuration. A real three-service PocketIC rehearsal
passes complete empty-source fill/ownership, caller/incomplete/mutation refusal,
source snapshot load and jointly restored identity/source refusal. Taking a
snapshot and ordinary stop/start preserve acceptance. This is not general
disaster recovery or populated caller-private page acceptance.

Upgrade remains blocked before live mutation and Stage A remains active. The
released reader still needs per-page snapshot verification and stable caller
binding through awaits; this operator check deliberately reports app disabled
and `verified_current=false`. A passing operator snapshot is not a permanently
current directory or a performance claim.

### 23 October original-source continuation

Identity transport includes original unregistered G1 only under existing pinned deployment and exact original mainnet canister IDs. New ownership acceptance traverses every retained Club row, including tombstones, and checks absence in every other complete source tree; conflicts refuse. It accepts original G1 missing assignments only under that pin plus exclusive complete coverage; registered/nonlegacy missing assignments remain unresolved. All existing positive assignments still verify through the router. Each invocation checks the complete live registry and source status against captured builds, then performs <=100 synchronous local steps. Durable acceptance binds the full inventory and every source revision; notifications/new builds invalidate it. No club placement/media key changes or extra club index are introduced. Ownership acceptance remains historical evidence (`verified_current=false`), not a public lookup/recovery release. Live execution remains pending the protected deployment and existing governor key.

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

Directory transport now runs on disposable local canisters with separate identity-only source status/page/ack endpoints and automatic retry/poll timers. Nothing is installed on mainnet. The optional complete-only frontend seam is not registered by `groupSessionLive`; no public directory reader is exposed. Exact club-placement/legacy coverage, shared account/source indexing, verified-current reads, concurrency/recovery acceptance and physical measurements remain required.

### Owner-requested implementation continuation (21:42)

- `membership_namespace` stores isolated eight-lane source trees behind two supplied stable memories rather than spending eight top-level memory IDs per source/revision. Monotonic namespace IDs never reuse old generations; sparse zero reads, a shared page/build budget and <=100-block durable cleanup are tested through reopen. This logical budget is not a measured production physical-memory ceiling.
- `membership_coordinator` connects verified complete group/placement evidence to reconstruction, journal publication, exact readback acknowledgement and caller-private paging. Missing/duplicate/foreign authorities, incomplete sources and stale callbacks fail closed. Retiring a tree cannot reuse its old acknowledgement; journal preflight precedes namespace allocation, so stale requests consume no namespaces. Only a verified higher inventory generation permits bounded obsolete-journal reclamation.
- `membership_propagation` persists exact source bindings and source-owned traversal positions before the future runtime await. It accepts <=100 scanned edges / <=100 KiB encoded edges, rejects revision/cursor drift and late callbacks, materializes in <=100-step calls and separates publication from exact readback. Its jobs are capped and only obsolete verified-generation jobs are reclaimable. No browser-supplied edges, live endpoint, source reader grant or timer was added.
- Private lookup sessions deduplicate a club across linked aliases and persisted pages, reject conflicting owning sources, cap total clubs/sessions/page sequence, expire after 15 minutes and support <=100-session cleanup. Fresh identity eligibility remains a prerequisite before any replay, not a session-cache permission shortcut.
- `membershipDirectoryDiscovery` requires complete sequential pages pinned to the caller, account version, directory generation/revision and full registry fingerprint. `openGroupSession` skips broad membership reads only with such a complete result, and still validates destination membership/assignment. Unavailable, partial or foreign directory answers discard all provisional directory rows and run complete Stage A discovery. The live adapter remains absent.
- Local acceptance: isolated two-source reconstruction/publication/readback/reopen/removal tests; storage refusal/cleanup and stale callback tests; alias deduplication and conflicting owners; frontend single/multiple-group directory, destination revocation and complete fallback. These are local tests, not mainnet speed measurements or source-transport acceptance.

#### Engineering still required before a runnable release

1. Mainnet upgrade acceptance and physical measurements for the newly allocated identity memories 18–24; existing memories 0–17 remain unchanged.
2. Broader concurrent-callback and populated legacy mutation acceptance for the now-connected transport. Source grants, checked Nat decoding, automatic invalidation/polling and exact acknowledgement/readback are locally exercised; no admission/lifecycle grants or awaited membership commits are used.
3. Exact assigned-club verification and independently proven legacy Group 1 coverage, account/source indexing to avoid traversing every empty source for an ordinary member, and identity link/rekey/merge/removal acceptance.
4. Concurrent-mutation progress: current dirty revisions safely restart snapshots but do not guarantee backfill completion under sustained mutations. Retained snapshots or ordered durable deltas require implementation and tests.
5. Recovery-generation fences, upgrade-interruption/source-outage tests and physical storage/instruction measurements with real local canisters.
6. Dedicated exact-three-target release workflow (G1/G2 `club_domain` plus shared `identity_access`), automatic bounded backfill/readback, verified-current public reader and live frontend registration. No workflow is represented as ready until these engineering gates pass.

Source-binding investigation confirms `read_hosted_club_assignment` can verify assigned clubs at a pinned router revision, resolved against the matching group registry. It returns an error for missing assignments; that must not imply legacy Group 1 ownership. Legacy source coverage needs independently verified exact mappings. The directory coordinator must not repurpose membership checks, admission reader grants or registry location alone as completeness evidence.

Rollback to older authority state is unsupported for directory cutover until an externally fenced replacement generation is bound into source cursors and propagation evidence. A restored local counter cannot discover the central high watermark. Ordinary upgrades must continue preserving revisions. The earlier offline `membership_directory_store` adapter's old chunks are not used by the new namespace coordinator; they still require reclamation if that adapter is ever integrated.

Cover populated legacy backfill with concurrent additions/removals, last-family-link removal, linked aliases, app-wide roles, missed/duplicate/out-of-order acknowledgements, stale writer generations, identity erasure, authority loss, upgrades mid-backfill and failed sources. Verify bounded request/result work and caller privacy against real local canisters. Keep current on-chain admission/lifecycle gates and all photo authorities unchanged.

Implementation and exact-target deployment remain separate work. Signed-in real-account traces and explicit release approval are required; this specification is not an installed directory or a performance claim.

### Connected automatic-update batch (22 October, after 21:58 request)

- Identity memory allocation: pool metadata/blocks 18/19, coordinator 20, update journal 21, worker 22, reserved private sessions 23, runtime binding/progress 24. Namespace budget is 16,384 logical pages with 8,192 builds; neither value is a measured physical limit.
- New frozen club migration `20261109_000000` introduces a disabled-by-default directory-only source binding. Governor configuration pins identity/router/group/deployment/generation/digest. Other services, users and foreign bindings cannot read raw relationship edges or acknowledge source progress. Disable cannot be undone with the old generation.
- Native identity timer rotates one source per 30-second tick and re-arms on upgrade. Club timers notify pending revisions separately from local membership commits. Identity polling repairs missed notifications; no notification clears source pending state.
- Bounded source driver persists captured requests, checked-decodes Motoko Nat, rejects newer known invalidation watermarks and requires an exact source acknowledgement plus consensus status readback. Unknown outcomes retain publication; a newer mutation cannot be cleared by an older callback.
- Namespace reclamation runs independently of allocation, both in the timer and through a bounded governor endpoint. Retired build budgets are recoverable; current unknown publications are not expired.
- Real local three-canister integration exercises two registered sources, automatic initial backfill, timer recovery across identity upgrade, club upgrade-preserved bindings/acknowledgements, removed/restored membership, unrelated-caller refusal, source stop/restart and <=100-work cleanup. It deliberately asserts that no public directory reader exists and linked-account lifecycle stays closed.
- Validation: 95 identity unit tests; source grant and journal Motoko tests; real local transport rehearsal; 35 frontend discovery/fallback tests; all 17 Candid contracts match. Current preview builds successfully. No live-account speed claim or runnable release workflow.

### Revision-bound subject/source indexing stage (22:13 continuation)

- Completed isolated builders enumerate unique effective-member and app-wide-role principals in <=100-subject pages. Family joins/exclusions determine ordinary candidates; app-wide roles remain explicit without global membership expansion.
- Coordinator stages principal/source entries bound to the exact authority/generation/revision/inventory digest. Index traversal progress survives reopen and publication refuses unfinished index staging. Entries from older builds are ignored immediately, even before physical cleanup. Pre-index completed builders cannot certify empty subject coverage: the frozen default version refuses indexing and requires a new source build; automatic same-revision legacy rebuild remains a release integration requirement.
- The private coordinator derives eligible sources only from current identity-owned aliases. One page reads one relevant source/alias; index-proven empty pairs are skipped locally. Every source remains in the completeness and session binding checks, including skipped sources. This does not yet remove the local full-inventory metadata validation in `sources()`; incremental global completeness metadata remains a performance requirement before release.
- Reverse rows permit <=100-entry retirement cleanup; exact binding comparisons preserve newer replacements. Many-source accounts exceeding 100 indexed candidates per alias explicitly require existing discovery rather than returning a partial list.
- The 100-candidate limit includes obsolete rows awaiting cleanup, so fallback can occur even for an account with few current sources. `Page.scanned` bounds content rows, not full-inventory metadata validation, hashing or local empty-pair skipping.
- Independent review found a pre-existing private-session integration gap in sequence-only continuations; the 22:25 continuation below replaces them with persistent instance-bound tokens and bounded independent consumers. The public reader remains disabled.
- Local regressions cover one-group and linked multi-group memberships, empty accounts, app-wide roles, parent/guardian joins, exclusions, removal, incomplete unrelated sources, 200 empty sources with only one relevant content read, 251-subject staging/reopen, bounded cleanup and newer-entry preservation. The real two-source automatic polling/upgrade/removal/outage/readback rehearsal also passes with the new identity module. No public reader, frontend registration or mainnet activation was added.

Validation for this stage: 101 identity regressions pass, the real two-source automatic-update rehearsal passes with the rebuilt identity module, and the preview reports build OK. Independent review found no new missed-membership or replacement-cleanup defect. These are local checks, not signed-in production timings.

### Session isolation and immediate observed invalidation (22:25 continuation)

- Continuations now include an upgrade-persistent monotonic instance and sequential page number. Expiry and cleanup never recycle instances; a delayed old token cannot advance a replacement with identical account/source bindings. Fresh identity/completeness checks precede persisted reply replay.
- Caller-owned consumer IDs separate up to four active traversals. Same-consumer exact retries retain the saved response; a completed traversal can refresh through a new consumer without mixing pages or deduplication state. A fifth active consumer refuses before reading content; expired consumers are reclaimed locally in bounded work.
- Instance-counter overflow refuses before content reads; failed starts do not consume an instance. Cleanup scans at most 100 rows and retains the counter across reopen. Existing sequence-only rows cannot supply a current instance token.
- Exact source notifications now synchronously persist the coordinator's observed watermark before saving runtime progress, with no await between durable writes. Checked consensus status observations also update it. Older complete builds, cached session replays and acknowledgement readbacks refuse immediately after an observed newer revision, before the worker starts rebuilding. Equal/older notifications are idempotent; unrelated/foreign generations cannot poison current evidence.
- This is observed freshness only. Lost notifications are still detected by later polling, not instantly; outages and externally restored authority generations remain release gates. Incremental global completeness counters are designed but not implemented in this batch; private reads still validate the full local source inventory.
- Local acceptance includes upgrade/reopen retry, expired-token replacement, concurrent consumers, linked-alias deduplication, completed refresh, failed starts, counter exhaustion, bounded cleanup, unrelated-source invalidation before worker progress and old-ack refusal. The real two-source automatic-update/upgrade/outage/readback rehearsal passes with the rebuilt identity canister. Nothing is deployed or exposed publicly.

### Essential-only completion batch (22:36)

- The app's optional lookup contract now carries the same instance/sequence continuations as the private Rust session core. Changed instances reject all provisional rows and use complete Stage A discovery; caller/version/registry pins and destination authorization remain unchanged. The live adapter is still not registered.
- Authenticated source `Club` edges now reuse `read_hosted_club_assignment` at the pinned router revision before their page is accepted. Exact club/group/writer mismatch, revision drift and unavailable/malformed replies reject and retain the source page for retry. Each source page remains bounded to <=100 edges; ownership checks are currently sequential within that bound, not a latency optimization.
- Missing assignments remain explicit durable unresolved coverage. Local reconstruction/diagnostic acknowledgements may progress, but `require_resolved_locations` rejects release readiness. Completed location traversal is separately recorded; old stable builds default to unchecked, not verified. Source-local presence alone is not exclusive legacy ownership proof.
- Ownership checks apply only to live club edges; tombstones remain membership-negative evidence, not live ownership claims. Coverage is persisted only after the exact worker request is accepted, so rejected late callbacks cannot poison readiness. Builds created before ownership checking existed cannot certify previously accepted pages merely by reaching a new terminal page.
- The current two-source replica fixture deliberately contains unassigned clubs; its passing transport test proves safe local updates, not ownership readiness or public cutover. Exact assigned-source verification and unresolved/old-build refusal have separate unit regressions.

#### Essential blockers only

1. Establish authoritative legacy Group 1 ownership for clubs without router assignments and verify it against all required sources. No trusted legacy ownership baseline exists in the current lookup configuration; missing assignments cannot supply it.
2. Retained source reconstruction now finishes under ongoing membership changes in local acceptance (continuation below). Verified-current catch-up and recovery acceptance remain separate from historical completion; do not claim an infinitely fast writer can be caught up or release an observed-stale build.
3. Connect the caller-private live reader and app adapter only after the two preceding checks pass, with complete existing discovery on uncertainty. Recovery checks must reject restored-old evidence, not add unrelated lifecycle machinery.
4. Provide the exact-three-target protected release workflow, populated upgrade/interrupt acceptance and signed-in timing verification. No runnable release is represented as ready before its source proof and update contracts exist.

Incremental global completeness counters, additional indexing optimizations, unrelated account-management upgrades and broader scaling/recovery systems are deferred; they are not prerequisites for the first correct lookup release. Nothing deployed or publicly enabled in this batch.

Final local validation: 109 identity regressions, 39 focused frontend discovery/session/invite tests and the real two-source automatic-update/upgrade/outage rehearsal pass. Preview reports build OK. This batch does not complete the essential blockers above or establish production loading speeds.

### Essential retained-source progress continuation (22:46)

- Added `membershipSourceRetention` and frozen migration `20261110_000000`: one directory-bound immutable generation captures references to the existing eight source collections, including nested immutable child-team arrays. Acquisition does not flatten or copy the collections; normal membership writes do not build additional snapshots. This bounds retained generations, not absolute retained bytes.
- Source pages retain the existing wire contract and <=100 scanned-slot limit. Exact sequential progression and last-request replay survive upgrade; skipped, foreign-revision/binding and incomplete completion requests refuse. Governor diagnostic exports remain separate and cannot replace the directory snapshot. Disable or a verified binding change clears the inaccessible old slot.
- Completion acknowledges only the exact fully traversed retained revision. A lost-response retry is idempotent; a newer live revision stays pending. Status continues reporting live revision, never disguising historical completion as freshness.
- Identity keeps the active pull/materialization/publication job through later source writes and observes their newer watermarks independently. Historical completion readback may finish; ordinary fresh acknowledgement and private `sources()` reads still reject the observed-stale build. Only after completion does the worker schedule the latest revision. First capture is revision-pinned; a mutation before capture refreshes the exact unstarted request rather than mixing generations.
- Regression evidence: 110 identity tests and five Motoko membership files pass. The source test scans the original 351 nested slots in four pages while live arrays change each page. The real two-source rehearsal uses 350 extra role edges, writes remove/restore between each bounded worker call, upgrades both source and identity mid-build, confirms one historical revision completes with newer work still pending, retries its acknowledgement and catches up after writes stop. Existing polling, authorization, outage/restart and cleanup checks also pass. Club compiles; 17 Candid contracts match; preview build OK.

Remaining essential release work: independently approved legacy Group 1 ownership evidence corroborated against complete source inventories (none exists in the current configuration); verified-current private reader/app connection and restored-old refusal; final exact-three-target workflow and production signed-in timings. The newly completed finite-snapshot test is not global freshness, arbitrary-rate catch-up, mainnet upgrade or activation evidence. No public reader or deployment was enabled; Stage A stays active.
### Reader gate and release workflow batch (23:56)

- `Coordinator::private_page` now calls `require_resolved_locations` before serving any page: a fully published and acknowledged build still cannot answer while club-ownership coverage is unchecked or marked unresolved. A build marked unresolved can never be certified by `finish_location_checks`; only a fresh rebuild (`begin` resets the marker) can. New regression covers the refuse-then-rebuild-then-serve path.
- Frontend `membershipTransport.ts` is an explicit opt-in adapter: disabled (the default) it strips any inherited directory reader so complete Stage A discovery always runs; enabled, it serves only `verifiedCurrent` pages and propagates every failure so callers fall back to Stage A. It is not registered anywhere in production dispatch.
- Protected draft release workflow `release-membership-lookup.yml` with exact three upgrade targets and an immutable journal. Its initial fill contract was incorrect; the 23 October correction below replaces it. Upgrade is blocked before any mutation, and no readiness record can be emitted.
- Legacy Group 1 ownership evidence, exact source configuration and verified-current reader/release acceptance remain open; historical acknowledgement is not release readiness.

Final local validation: 111 identity regressions, 42 frontend lookup/discovery tests, 7 release-policy tests pass; workflow YAML valid; preview build OK. Nothing deployed or publicly enabled; Stage A stays active.

### Essential fill connection correction (23 October)

- Reused the already implemented governor-only `advance_membership_directory_source(text)` driver and generated identity Candid binding instead of adding a redundant global canister API. Each response is `{ source, phase, revision: nat64, scanned: nat64 }`; at most 100 slots per call. Only `acknowledged` completes a historical source traversal.
- The bounded fill helper rejects fabricated `complete` replies, wrong sources, invalid phases/revisions, unbounded work and duplicate/unknown source lists. It records exact acknowledged revisions only after durable persistence; a persistence failure prevents moving to the next source. Network retries are bounded; definite refusals stop.
- The runner rechecks routing before/after every source call and re-observes previous historical fills instead of treating old `fill: true` as currentness. Source configuration/grants and complete authority coverage are still required; the three upgrade targets do not imply only two current registered sources.
- Workflow and runner both reject upgrade before signing/materialization. Removed automatic readiness emission/commit; policy rejects `ready: true` even after both historical fills. A successful check is service-target inspection only.
- Owner-provided Group 1 names help identify clubs to cross-check, but cannot authorize mappings, attest exclusivity or bypass unresolved coverage. No club placement, media-key authority or permissions are changed.

### Consolidated source configuration and private connection (23 October 00:47)

- Added governor-only `read_membership_directory_configuration` consensus readback of exact binding/generation/source/digest; it always reports app disabled and reveals no memberships.
- Added `read_my_membership_directory_diagnostic(consumer, token)`: only freshly derived caller/account aliases, current coordinator watermarks and resolved ownership can reach the existing durable session core. No arbitrary account selection, no awaited work inside local paging, and every reply explicitly reports `verified_current: false`. It is a diagnostic endpoint, not a currentness release.
- The lazy diagnostic actor uses regenerated identity Candid contracts. The ordinary live group session now connects the opt-in adapter with a hard-disabled release switch: zero additional directory calls during ordinary navigation, and diagnostic/unverified pages cannot replace complete existing discovery. The released reader deliberately still refuses pending a real verified-current contract; wiring this seam is not a finished performance feature.
- Exact source configuration orchestration is connected to the draft runner behind its existing pre-mutation block: journal identity/source intent, read exact generated replies, canonicalize Candid records/bytes/principals, check enabled binding/digest/source inventory, resume matching grants and recheck all sources after the last await. Foreign/disabled bindings and unknown journal outcomes stop. No partial source grant or automatic recovery-generation replacement.
- Important concrete blocker: identity's complete inventory verifier enumerates registered groups only. It cannot include an unregistered original G1 merely because an operator query found its clubs. The runner now explicitly refuses that gap and any additional group outside the approved three upgrade targets. Safe explicit legacy coverage and verified-current/restored-old release acceptance remain unfinished engineering; no activation or deployment is claimed.
