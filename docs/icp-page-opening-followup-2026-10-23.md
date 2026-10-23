# ICP page-opening follow-up — 23 October 2026

The club-selector repair passes its focused checks: switching clubs leaves old content before cache purge. It does not repair every destination page's loading chain.

Source defects repaired in the follow-up batch (none individually proven as the cause of Paul's live session):

1. Shared membership discovery can stay pending forever after session opening succeeds (`membershipDiscoveryCache.ts`, `groupSession.ts` member/every-group reads, `groupDispatch.ts` shared fan-out leg).
2. Single-club dispatch callbacks lack the scoped marker, so nested role reads can trigger caller-wide discovery (`groupDispatch.ts` `readFor`/`read`).
3. Club chat waits for provisioning before reading existing messages, then waits unbounded on profiles/reactions (`ClubChatPage.tsx`).
4. Events membership and member schedule reads have unbounded optional legs (`EventsPage.tsx`, `scheduleMembers.ts`).
5. Home drops successful team events when the club-event read fails (`homeFeed.ts`).
6. Teams carousel waits on club metadata, trial status and league discovery before showing any team (`MyTeamsPremiumCarousel.tsx`).
7. Legacy Media page read waits for every club and discards incompleteness (`mediaReadRepository.ts`).
8. Vault read failures can appear as denial/paywall instead of retry (`vaultAccessRepository.ts`, `useVaultAccessModel.ts`).
9. Club-admin chat mis-decodes the optional club profile (`ClubAdminChatPage.tsx`).

Repair validation: 14 focused files per mode — ICP 158 passed/15 skipped, Supabase 159 passed/14 skipped; preview build OK. Regression coverage includes stalled reads and retry, scoped dispatch callbacks, independent team-event/card/photo progress, cancellation, and Vault failures versus confirmed denial. Dedicated carousel snapshots save only complete inventories; provisional ICP carousel query arrays are excluded from generic persistence. No canister changes, deployment or publication. Signed-in Internet Identity acceptance remains unavailable, so live loading times and Paul's original incident are not certified resolved.

## Renewed page/posting incident

Further concrete defects repaired after the report of only Giddy Goat appearing:

- Group sessions retained the original Internet Identity object under same-principal renewal. The cache now binds that object as well as principal/complete target.
- A verified registry-drift error left the stale session cached. Typed local drift retires that session so the next attempt can reopen; the failed operation is never replayed, including unknown mutations.
- Scoped reads marked reusable session contexts in place; writes lacked the marker. Both now pass copied, callback-local scoped contexts, so nested role reads stay local without contaminating shared discovery.
- Theme/switcher profile and subscription failures became successful omitted clubs. They now reject incomplete retrieval, preserving prior complete query data rather than certifying one club as the full list.
- Clubs progress overwrote the completed query cache. Progress now stays local to the mounted/account-scoped page; failed sources reject completion and provide retry. The full-page loading notice is removed.
- Concurrent writes used a shared `once` key, which the session could coalesce. New operation keys distinguish consecutive comments/actions; club/team chat sends route as single-attempt writes using the same message key. Queued messages replay through their owning scope with the original queue key, not a default canister.

Focused linked validation: 17 files per mode, ICP 137 passed/44 skipped and Supabase 153 passed/28 skipped; final Clubs/queue reruns add two page regressions in each mode (progress before slow-group completion without cache writes, and retention of the previous complete list on failure). The exact ICP guard check passes. Regression coverage includes identity renewal, drift retirement without replay, copied write scopes, incomplete club inventories, consecutive operation keys and owning-group queue replay. These demonstrate local defects and repairs, not the cause or resolution of Paul's authenticated incident. No canister upgrade, publication or account mutations occurred; authenticated Internet Identity opening and send/comment readback remain unavailable here.