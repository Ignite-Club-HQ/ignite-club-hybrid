# Member-group discovery recovery

## Implemented locally
- Shared full-target/account membership display discovery, not a 30-second page-driven broad scan.
- Coalesced 15-minute foreground reconciliation and overdue online/visibility resume; no suspended-app timer. Local membership cache clearing invalidates discovery.
- Generation guards; failed complete discovery retains the previous snapshot. Changed discovery invalidates Home/Clubs/Schedule/inbox/media queries.
- Successful discovery uses existing bounded per-query persistence. Cached state is never authorization.
- `memberGroups` content requests use only verified member sources; `everyGroup` remains distinct wider discovery. Existing strict router/write/admission checks remain.
- Original shared clubs have explicit membership evidence, separate from unknown ownership; known reads no longer reopen just because they lack a newer-group assignment.
- Home known-club details use club scopes; join catalogs load only for the join dialog. Events roster uses member groups. Media uses verified member club IDs, preserves exact global sorting and distinguishes failed sources from empty results; incomplete feeds are not persisted.

## Validation
Full existing suites: Supabase 6196 passed/358 skipped; ICP 5794 passed/760 skipped. Request-counter tests cover 2/10/100 groups, coalesced discovery beyond 30 seconds, 15-minute external additions, legacy membership, suspended app, generation isolation and media source failure/denial. ICP boundary guards pass; preview build OK.

No usable signed-in Internet Identity session is available here. These results do not establish actual account data or Android navigation timing. No publication, live canister mutation, identity change, club move or payment change occurred.

## Remaining engineering
This is not full plan completion. Mini-league membership/foreign-host and removed-club discovery still require independent coalesced source contracts so their broad reads cannot delay ordinary pages. Media still waits on its included sources/ancillary reactions/comments before final publication; progressive safe cursors and all-page section states remain. Audit every mutation/denial invalidation path and add real signed-in navigation call-count acceptance.

Stage B needs a durable central caller-membership directory and complete authority-only propagation/backfill. Current `acl_revision` does not advance for ordinary joins/removals; router placements or account history are not complete membership evidence. No central-directory upgrade is included in this app batch.

## Release gates
Signed-in one-group and mixed-group exact data/request traces; tap p95 ≤100 ms, warm content ≤300 ms, cold first useful ≤3 s, uncached media unlock separate. Targets are not yet proven. Publish only with explicit approval; installed native bundles need an app update. Chat-canister upgrade remains the separately protected existing workflow.