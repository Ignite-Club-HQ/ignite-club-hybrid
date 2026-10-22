# Make ordinary navigation use only the member’s groups

## Outcome
A member whose clubs are all in Group 1 loads their club content from Group 1 only. Group 2 must not delay their Home, Clubs, Messages, Events or Media pages. Members in several groups load each club from its own group, with healthy sections appearing independently.

Cross-group discovery is separate from opening pages. It is not permanently one-off: someone can be added to a club elsewhere by another administrator or device. The design must detect that without scanning every group on ordinary navigation.

## Current defects this replaces
- Session opening checks every group; its result is reused only in memory.
- A second role-grant path repeats all-group discovery after a 30-second memo expires when a caller refetches.
- Home, Events, Media and removed-club queries independently request every group.
- Known legacy Group 1 ownership and genuinely unknown ownership are not consistently distinguished.
- A central routing-directory check is currently mixed into page loading; it is not the same as membership discovery.

## 1. One shared membership directory in the app
Create one account-and-deployment-scoped coordinator consumed by every page and widget. Its snapshot contains verified club IDs, owning groups, role/team references, per-source status, completeness evidence and generation/revision metadata. Store bounded snapshots using the existing per-query device storage, not a whole-cache rewrite.

On startup, restore the last snapshot for fast display and verify it in the background. Cached membership is a display/routing hint, never permission. A new account or changed deployment cannot reuse it.

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
- Until a trustworthy cross-group change signal exists, run a coalesced **15-minute foreground background reconciliation**, plus reconciliation on online resume if overdue and explicit refresh. No hidden background timer while the app is suspended. Ordinary content refresh does not trigger it.
- External additions can therefore take up to the reconciliation interval to appear while continuously active. State this limitation; do not call Stage A a permanently one-off solution.
- An unsuccessful group reply is unknown/failed, never evidence that the member has no clubs there. Background discovery cannot block navigation or replace the complete snapshot with an empty/partial list.

### Stage B — eliminate periodic all-group reconciliation
Use an authenticated on-chain caller membership directory with a lightweight per-account change revision. This requires a completeness audit and, if existing contracts cannot supply it, a narrowly scoped canister extension under separate release approval.

- Cover original Group 1 clubs and all registered groups, principal/account aliases, parent memberships, team-only grants, administrative role changes, invitations, restores and removals.
- Only verified club authorities may register/update membership references; browsers cannot nominate their own memberships or groups.
- Commit durable notification/outbox intent with the club membership mutation. Retry directory propagation idempotently with source ordering; older replies must not undo removals. Source club authorization remains authoritative during any propagation delay.
- Existing memberships need a bounded, revision-checked backfill and readback before marking the directory complete. Account-side historical/removal records or router club placements alone are not proof of current membership completeness.
- One small revision read on startup, foreground resume and a coalesced visible-session interval replaces broad scans. An unchanged revision means no membership discovery. A changed revision fetches bounded directory deltas/pages and updates only affected clubs/groups.
- Where completeness or delivery lag cannot be proven, retain Stage A reconciliation. Never switch it off merely because the new endpoint exists.

This separates app recovery from an optional later upgrade rather than blocking all speed improvements on new infrastructure.

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
Progressive display must not corrupt pagination or create authoritative empty lists.

- Use per-club loading/empty/failed/denied state and cursors.
- Render ready gallery sources without skipping or duplicating exact asset IDs. Do not claim a globally sorted page is complete until each included source has supplied its required boundary; retain unresolved source cursors for later fetches.
- Reconcile acknowledged comments/messages by ID and preserve pending mutations across harmless refreshes.
- Deleted clubs are excluded before their live sections are published; failed deletion checks are not absence.

## Technical implementation
- Add a browser-safe discovery coordinator with injected transports; preserve existing lazy ICP imports and supported preview/dependency setup.
- Adapt groupDispatch/groupSession to accept verified discovery state without an independent page-driven membership sweep. Persisted state cannot authorize writes; required consensus validation remains.
- Move membership query keys/invalidation into one account-and-full-target-scoped contract; remove target-incomplete aggregated role keys.
- Audit every `everyGroup` caller and classify it as member content, genuine wider discovery, personal/shared or operator/security inventory. Replace only the member-content fan-outs.
- Keep global registry configuration revisions separate from per-account membership changes and ordinary content refreshes; adding a group must not rescan all memberships for every navigation click.
- Record request reasons/counts and timings without message bodies, child names, credentials or decrypted media.

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

Run focused suites in both backend modes and delayed/denied source integration checks. Then capture signed-in one-group and mixed-group request traces, cold/warm content times and navigation responsiveness on browser and Android. Target the existing recovery gates: tap feedback p95 ≤100 ms, warm useful content ≤300 ms, cold first useful content ≤3 seconds; report uncached media unlock separately. These are acceptance targets, not established timings.

## Delivery order and completion
1. Implement Stage A coordinator, routing reuse and all affected member-content pages as one connected batch, including safe media cursors and mutation invalidation.
2. Run request-count/lifecycle regressions and collect signed-in acceptance when an authorized Internet Identity session is available.
3. Audit Stage B directory completeness and propose only the exact needed canister changes/backfill/release path; no upgrade is authorized by this design request.
4. Publish/update native bundles only with explicit approval and verified release evidence. A web publication does not update installed native code.

Completion means actual one-group page traces stop querying unrelated group content, external membership changes still appear, and signed-in data/timing checks pass—not merely that a cache was added.