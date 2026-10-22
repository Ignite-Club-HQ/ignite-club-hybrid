# Fix missing Group 1 data and slow pages since Group 2

## What's wrong
**Missing data:**
- Messages and Events send every club's requests to one group. Group 1 clubs are asked in the wrong place, so they come back empty.
- Home, Media and the teams carousel give up completely if any one group or club fails. A slow or refused Group 1 request removes everything, which is why the carousel showed only Group 2 teams.

**Slowness:**
- Every page has to complete a chain of "which group is this club in?" checks, one after another, before it can load any data. Several of these checks read the group directory twice.
- Since the Group 2 account-access repair, many reads use the slower verified path every time. The app remembers to use that path, but it doesn't remember the answers, so it never gets faster.
- Several pages repeat the same group checks for the same clubs at the same moment.

## The fix
1. **Send every read to the right group.** Messages, team chats, message previews, Events, Media and Home will ask each club's own group, through the same shared lookup the clubs page already uses. Clubs in Group 1 go to Group 1, and Group 2 clubs go to Group 2.
2. **One failure never empties a page.** Each group and each club loads on its own. Anything that loads is shown, a slow group fills in when it arrives, and a small "some clubs are still loading / retry" note appears instead of a blank page.
3. **Instant navigation from saved data.** The last good clubs, teams, events, messages and media are kept on your device for your account. Every page opens immediately from that saved copy and refreshes quietly in the background. Signing out clears it. Writes such as RSVP, posting or uploading still go through full checks.
4. **One group check per session, not per page.**
   - Check the group directory once at sign-in and share the result.
   - Ask both groups for your memberships at the same time, not one after the other.
   - Remember which group each club is in for your session and recheck in the background.
   - When several pages ask about the same club at once, do the check once and share it.
   - Keep the full fail-closed checks for creating a club and for any write.
5. **Use the fast read path where it's safe.** Use quick reads for content you're already allowed to see, and keep the slower verified reads only for account access decisions. Check each canister read type against the live Group 2 canister. Where a verified read is still required, cache its answer briefly.
6. **Load in the background on Home.** Show clubs and teams first. Next Up, the carousel, previews and media fill in as they arrive, and every club is requested at the same time.

## Checks before release
- Add timing and accuracy tests for an account with clubs in both groups:
  - each page's data comes from the correct group;
  - one group failing still shows the other group's data;
  - pages open from saved data in under 300 ms;
  - group checks happen once and are shared, not repeated.
- Live measurement with your account in both groups. Targets:
  - first open after sign-in: under 3 seconds;
  - moving between pages: instant;
  - Group 1 events, messages and photos all visible.
- Then publish.

## Technical details
- Problem files:
  - `inboxPreviewSources.ts:130-234` and `EventsPage.tsx:778` use a single context.
  - `homeFeed.ts:205-250`, `mediaReadRepository.ts:75-81` and `groupDispatch.ts:119` / `groupSession.ts:247` use a rejecting `Promise.all`.
  - `groupSession.ts:110-155` runs sequential discovery and has no in-flight dedupe.
  - `groupRegistryPager.ts:38-40` double-reads the registry on every page.
  - `accountReadAdapter.mjs:75` caches the route, not the response.
- Approach:
  - Route through `dispatchForClub` / `everyGroup`.
  - Switch to `Promise.allSettled` with partial-result UI.
  - Persist TanStack Query state per principal, using stale-while-revalidate.
  - Keep a session-wide registry/assignment cache with in-flight coalescing. The double read stays only for writes and club creation.
  - Run membership discovery in parallel.
- Keep the fail-closed routing and admission rules; only reads get faster.
