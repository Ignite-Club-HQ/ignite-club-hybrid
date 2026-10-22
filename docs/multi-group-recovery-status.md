# Multi-group recovery: evidence and release gates

## Approved scope
The approved recovery plan is `.lovable/plan/restore-ignite-s-speed-and-reliability-with-multiple-groups-2026-10-22.md`.
No canister has been deployed, reopened, reinstalled, moved or re-keyed by this recovery batch. No app publication was requested.

## Implemented source-confirmed repairs
- Ownership recording checks all clubs in one refreshed session rather than reopening separately for every distinct legacy club. Regression includes three legacy clubs plus a newly discovered group club; opening their conversations performs no ownership scan.
- ICP page persistence now writes one changed query per idle job instead of dehydrating the full cache. Individual snapshots, traversal, count and total storage have bounded budgets. BigInt and byte-array shapes are preserved; keys/object URLs/opted-out queries are excluded.
- Cache restoration and writes capture account/target scope and a generation; late account-switch/startup-timeout replies cannot hydrate another session. Sign-out clears memory snapshots and resets persisted pending work, while persistence remains available for the next sign-in.
- Group listings collapse repeated identical conversation IDs and refuse conflicting club ownership. Distinct same-name conversations remain intact; no chat history was deleted or merged.
- Updated the outdated pinned-message polling test to match the already-shipped 15-second interval; no polling-policy change in this batch.

## Source-confirmed outstanding integration work
- Clubs page now renders each club as its own group answers (`readClubsInOwnGroups` onProgress). Home, Events, Messages and Media still wait for every branch.
- `groupSession.readEveryGroup` retains complete discovery and fresh post-read confirmation. Do not turn security-critical complete discovery into partial authorization evidence.
- Inbox default setup is still on the list-read path. `create_group_with_roles` is create-only; independent devices can create separate IDs for a missing default. Durable repair needs a dedicated authoritative default identity/provisioning contract and canister-level concurrency tests, not name-based deduplication. No backend release was included.
- Page-level scope/invalidation review and progressive section composition remain to be measured and implemented against signed-in expected records.
- Giddy Goat distinct-ID duplicate diagnosis is still unknown; exact-ID deduplication cannot resolve separate existing conversations.

## Baseline prerequisite currently blocked
The environment reports external unmanaged authentication and does not contain an Internet Identity delegation for the reported clubs. The ICP agent-web-identity skill states its CLI link requires the user's browser on the same machine and does not work in this remote/headless sandbox. Do not mint a Supabase session or invent ICP identities as a substitute.

Required evidence: authorized expected club/team/chat/event/photo IDs, actual app/native version, trace of cold/warm navigation, Peanut poll/image readback, Group 2 U9/default chats, a gallery comment acknowledgement and fresh readback. Signed-out browser checks do not satisfy this gate.

## Acceptance targets (unverified)
Tap selection ≤100 ms p95; warm content ≤300 ms p95; cold first useful content ≤3 s p95 on the controlled healthy-network profile. Report uncached media/key latency separately. The present code/tests do not substantiate those production timings.

## Verification completed for this batch
- Full ICP suite: 5775 passed, 760 skipped; full Supabase suite: 6177 passed, 358 skipped. Skipped tests are not live evidence.
- Actual Chromium IndexedDB: synthetic BigInt snapshot write/restoration succeeds; a different scope cannot hydrate it; test records cleared afterwards. No private club data was accessed.
- Public `/index` redirects to `/auth` without page errors at 411 × 770. This does not verify signed-in navigation or ICP functionality.
- Latest preview build reports OK. No production timing measurements or private write/readback flows were obtained.

## Next release boundary
Collect the signed-in baseline and expected-data inventory before claiming recovery or choosing protected-read canister upgrades. Complete the connected page/default-chat changes, then run real-account acceptance and obtain explicit publication/exact-upgrade approval. Web publication does not replace the installed native bundle.