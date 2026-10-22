# Make ordinary navigation use only the member’s groups

## Outcome
A member whose clubs are all in Group 1 loads their club content from Group 1 only. Group 2 must not delay their Home, Clubs, Messages, Events or Media pages. Members in several groups load each club from its own group, with healthy sections appearing independently.

Discovery stays separate from navigation, while still detecting clubs joined through another device or administrator.

## 1. One shared membership directory in the app
Create one account/deployment-scoped coordinator for every page. Its snapshot contains verified club IDs, owning groups, role/team references, per-source status, completeness evidence and generation/revision metadata. Persist bounded snapshots using existing per-query storage.

On startup, restore the last snapshot for fast display and verify it in the background. Cached membership is a display/routing hint, never permission. Isolate accounts and deployments.

Replace the independent 30-second all-group grant memo with this coordinator. Content freshness and membership freshness are separate: refreshing events or messages must not rediscover memberships.

Expose two distinct operations:
- **Read known memberships:** reused by normal pages, no all-group discovery.
- **Refresh discovery:** one shared job, with explicit reason and completeness status; never one job per widget.

## 2. Two stages, with honest discovery guarantees
### Stage A — remove repeated scans using existing contracts
This is the first connected app implementation batch, with no canister upgrade required.

- Run one initial full discovery when there is no verified in-memory session; coalesce every caller.
- Preserve positive, verified Group 1 and newer-group routes across page opens. Do not reopen the session merely because a verified legacy club has no newer-group assignment.
- Refetch role details only from known membership sources. Do not run all-group grants after 30 seconds.
- Refresh after acknowledged create/join/leave/removal/role changes in this app. Carry an invite’s verified destination into the update; unknown tokens use separate bounded discovery.
- Until a trustworthy cross-group change signal exists, run a coalesced **15-minute foreground background reconciliation**, plus reconciliation on online resume if overdue and explicit refresh. No timer while suspended. Ordinary content refresh does not trigger it.
- External additions can therefore take up to the reconciliation interval to appear while continuously active. State this limitation; do not call Stage A a permanently one-off solution.
- An unsuccessful group reply is unknown/failed, never evidence that the member has no clubs there. Background discovery cannot block navigation or replace the complete snapshot with an empty/partial list.

### Stage B — eliminate periodic all-group reconciliation
The audit found no complete central caller-membership API today. Existing `acl_revision` does not advance for ordinary joins/removals; it cannot validate this cache. Use an authenticated on-chain caller membership directory with a new durable per-account change revision. This requires a completeness audit and, if existing contracts cannot supply it, a narrowly scoped canister extension under separate release approval.

- Cover original Group 1 clubs and all registered groups, principal/account aliases, parent memberships, team-only grants, administrative role changes, invitations, restores and removals.
- Only verified club authorities update references, never browsers.
- Commit durable notification/outbox intent with the club membership mutation. Retry directory propagation idempotently with source ordering; older replies must not undo removals. Source club authorization remains authoritative during any propagation delay.
- Require bounded revision-checked legacy backfill/readback before declaring completeness; historical records and placements alone are insufficient.
- One small revision read on startup, foreground resume and a coalesced visible-session interval replaces broad scans. An unchanged revision means no membership discovery. A changed revision fetches bounded directory deltas/pages and updates only affected clubs/groups.
- Where completeness or delivery lag cannot be proven, retain Stage A reconciliation. Never switch it off merely because the new endpoint exists.

App recovery does not wait for the later upgrade.

## 3. Normal page loading
| Area | New source and behaviour |
|---|---|
| Clubs/theme picker | Shared membership snapshot → active profiles from exact owning groups. Only the theme picker filters My Clubs. |
| Home/team carousel | Shared team/club references; independent club-scoped sections. Remove broad directory reads from ordinary filtered Home loading. |
| Events/Next Up | Reuse membership and team-name references; refresh events from member/selected clubs only. Foreign-host competitions follow their verified host route. |
| Messages | Reuse memberships, fetch each club’s chats from its group, remember exact conversation→club routes. Refreshing previews/history never refreshes every group’s memberships. DMs remain shared personal data. |
| Media | Build sources from authorized member club IDs, not an all-group club listing. Keep independent club cursors and exact-ID merge rules. |
| Removed clubs | Separate discoverable trash scope from active memberships. Keep known former-club source references; until complete trash indexing exists, broad refresh is background discovery, not a blocker for active clubs. |

Known team/chat/event/photo links retain verified club context. Unknown deep links may perform authoritative targeted lookup; a failed lookup must not silently route to Group 1 or become “not found.”

Search for clubs to join, unknown invitations, foreign-host resources, operator inventory and account erasure remain distinct discovery cases. They must not be restricted to current member groups when correctness requires wider coverage.

## 4. Routing safety and failure isolation
- Keep routing approval, admission, source-club authorization, exact assignments and strict write checks unchanged. Do not lengthen or remove safety windows just to lower request counts.
- Share existing central router checks; perform them when required, independently of membership scans. Registry configuration drift still fails closed.
- Ownership states are explicit: verified legacy, verified assigned, unresolved and failed. Null/transport loss cannot prove legacy ownership or membership absence.
- A confirmed denial/removal invalidates that club’s protected display/query state and pending reads. Existing media-key retention policy is unchanged; this design cannot revoke previously downloaded content.
- Generation guards prevent old discovery or content replies from restoring removed clubs or another account’s data.
- Healthy verified clubs render independently during discovery failures. Complete-inventory security operations continue requiring complete evidence.
- No history deletion, club moves, photo-key changes, payment/allowance changes, group opening or broad deployment.

## 5. Media and aggregate completeness
Use per-club loading/empty/failed/denied state and cursors. Ready gallery sources may render, but do not declare a globally sorted page complete until every included source supplies its boundary. Retain unresolved cursors and deduplicate by exact asset ID. Reconcile acknowledged comments/messages by ID. Exclude confirmed deleted clubs before publishing sections; failed deletion checks are not absence.

## Technical implementation
Use injected transports, lazy ICP imports and account/full-target-scoped keys. Reuse verified discovery in groupDispatch/groupSession; retain consensus write validation. Audit every `everyGroup` caller before replacing it. Separate membership, content and configuration revisions; record privacy-safe request counts/timings.

## Verification gates
Add behaviour tests with real call counters, not source-text assertions:
1. A verified Group 1-only account navigates Home → Clubs → Events → Messages → Media and refreshes content: **zero Group 2 club-content requests and zero page-triggered full membership scans** after bootstrap.
2. Same result for a Group 2-only account; a mixed account requests only relevant club sources.
3. Concurrent pages share exactly one bootstrap/discovery job; memo expiry alone does not start another scan.
4. Unknown, failed and verified-empty group results remain distinct; failures cannot permanently hide memberships.
5. Local joins/create/removal update all pages; external additions appear within Stage A’s 15-minute reconciliation policy. Stage B unchanged revision performs zero broad scans; changed revision discovers new memberships safely.
6. Account/target switches, stale replies, legacy clubs, deleted clubs, revocation and registry drift remain safe.
7. Gallery late sources do not skip/duplicate assets; chat histories and acknowledged comments are preserved.
8. Simulate 2, 10 and 100 registered groups: ordinary known-club content request counts depend on relevant clubs, not total group count.

Run both backend modes and delayed/denied-source checks, then signed-in browser/Android traces. Existing recovery targets: tap p95 ≤100 ms, warm content ≤300 ms, cold first useful ≤3 seconds; media unlock separate. These are targets, not verified timings.

## Delivery and completion
Implement Stage A coordinator, routing reuse and affected pages in one connected batch; run request/lifecycle regressions and signed-in acceptance. Then separately audit and propose Stage B’s exact upgrade/backfill. No canister upgrade or publication is authorized by this design request; native bundles need their own update.

Done means signed-in one-group traces stop querying unrelated content, external changes still appear and data/timing gates pass. Account testing remains unavailable in this sandbox.
