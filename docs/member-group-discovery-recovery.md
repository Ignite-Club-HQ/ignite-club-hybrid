# Member-group discovery recovery

## Implemented locally
- Shared full-target/account membership display discovery, not a 30-second page-driven broad scan.
- Coalesced 15-minute foreground reconciliation and overdue online/visibility resume; no suspended-app timer. Local membership cache clearing invalidates discovery.
- Generation guards; failed complete discovery retains the previous snapshot. Changed discovery invalidates Home/Clubs/Schedule/inbox/media queries.
- Successful discovery uses existing bounded per-query persistence. Cached state is never authorization.
- `memberGroups` content requests use only verified member sources; `everyGroup` remains distinct wider discovery. Existing strict router/write/admission checks remain.
- Original shared clubs have explicit membership evidence, separate from unknown ownership; known reads no longer reopen just because they lack a newer-group assignment.
- Home known-club details use club scopes; join catalogs load only for the join dialog. Events roster uses member groups. Media uses verified member club IDs, preserves exact global sorting and distinguishes failed sources from empty results; incomplete feeds are not persisted.
- Independent mini-league and removed-club discoveries share complete account/target inventories. Schedule club memberships no longer await league discovery; league loading/failures remain visible separately. Removed-club reads reuse the shared snapshot rather than scanning on every Clubs opening.
- Media publishes each authorized club's assets before filter metadata, comments, reactions or profiles. Late sources re-sort/deduplicate exact IDs; unresolved sources keep the feed provisional and nonpersistent. Post details load near the viewport, separately from photos. Reaction edits reconcile both caches and cannot roll back a later edit; comment failures preserve newer drafts.
- Confirmed club creation, invite acceptance, role/member changes, club lifecycle changes and selected league membership changes invalidate shared display discovery only after acknowledgement. Tests exercise success/refusal at actual feature helpers.
- Media profile/tombstone checks now run independently per club; ready Group 1 photos do not await a slow Group 2 profile. Denied/removed clubs never start asset reads or enter upload choices.
- Foreign-host competition fixtures load in an independent progressive query, including entered/private and public competitions outside member groups. Discovery/match failures remain explicit, successful hosts survive, and member events and fixtures can each paint first. In-flight team/club label reads coalesce; partial replies are excluded from offline snapshots.
- Child assignment/unassignment, guardian links, member/child moves, bulk team additions, team removal/restore/deletion and alternate member removal/restore now clear shared display inventories only after confirmed success; refusal preserves the existing snapshot.

## Validation
Full existing suites: Supabase 6208 passed/358 skipped; ICP 5806 passed/760 skipped. Request-counter tests cover 2/10/100 groups, coalesced discovery beyond 30 seconds, 15-minute external additions, legacy membership, suspended app, generation isolation and media source failure/denial. Additional behavior tests verify photos before delayed metadata, exact-ID duplicates, complete-boundary transitions, pending league discovery not gating club memberships, and acknowledged mutation refresh/refusal retention. ICP boundary guards and changed live-code lint pass; preview build OK.

No usable signed-in Internet Identity session is available here. These results do not establish actual account data or Android navigation timing. No publication, live canister mutation, identity change, club move or payment change occurred.

## Remaining engineering
This is not full plan completion. All-page progressive coverage, per-club member-event publication and bounded independent media source cursors remain. The deployed media contract only exposes list_assets, so real bounded paging requires a separately scoped canister contract/upgrade; client-side slicing is not a bounded network read. Foreign-host competition discovery remains explicit but no longer gates member schedule readiness. The child/alternate restore helper audit is repaired; real signed-in navigation, denial/readback and request-count acceptance remain unavailable. First uncached league/trash discovery still scans all groups; subsequent navigation reuses it until reconciliation or a confirmed mutation.

Stage B needs a durable central caller-membership directory and complete authority-only propagation/backfill. Current `acl_revision` does not advance for ordinary joins/removals; router placements or account history are not complete membership evidence. No central-directory upgrade is included in this app batch.

## Release gates
Signed-in one-group and mixed-group exact data/request traces; tap p95 ≤100 ms, warm content ≤300 ms, cold first useful ≤3 s, uncached media unlock separate. Targets are not yet proven. Publish only with explicit approval; installed native bundles need an app update. Chat-canister upgrade remains the separately protected existing workflow.