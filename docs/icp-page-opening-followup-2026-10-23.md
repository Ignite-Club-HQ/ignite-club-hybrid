# ICP page-opening follow-up — 23 October 2026

The club-selector repair passes its focused checks: switching clubs leaves old content before cache purge. It does not repair every destination page's loading chain.

Remaining source defects (not yet repaired; none proven as the cause of Paul's live session):

1. Shared membership discovery can stay pending forever after session opening succeeds (`membershipDiscoveryCache.ts`, `groupSession.ts` member/every-group reads, `groupDispatch.ts` shared fan-out leg).
2. Single-club dispatch callbacks lack the scoped marker, so nested role reads can trigger caller-wide discovery (`groupDispatch.ts` `readFor`/`read`).
3. Club chat waits for provisioning before reading existing messages, then waits unbounded on profiles/reactions (`ClubChatPage.tsx`).
4. Events membership and member schedule reads have unbounded optional legs (`EventsPage.tsx`, `scheduleMembers.ts`).
5. Home drops successful team events when the club-event read fails (`homeFeed.ts`).
6. Teams carousel waits on club metadata, trial status and league discovery before showing any team (`MyTeamsPremiumCarousel.tsx`).
7. Legacy Media page read waits for every club and discards incompleteness (`mediaReadRepository.ts`).
8. Vault read failures can appear as denial/paywall instead of retry (`vaultAccessRepository.ts`, `useVaultAccessModel.ts`).
9. Club-admin chat mis-decodes the optional club profile (`ClubAdminChatPage.tsx`).

Validation: 24 focused files per mode — ICP 222 passed/11 skipped, Supabase 225 passed/8 skipped; preview build OK; signed-out pages redirect to sign-in with no errors. Signed-in Internet Identity acceptance remains unavailable.