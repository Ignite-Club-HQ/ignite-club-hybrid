# ICP speed-up, part 2: the rest of the app

The club-records batching is done. Each change below makes the app send fewer requests, or wait less for them, in other areas. All canister changes go out in one mainnet deploy. Until then the app keeps working the current way, so nothing breaks.

## What you'll notice

1. **Schedule and events open faster.** The event list, RSVPs, attendance and duties for all your teams arrive in one request instead of one per team. Home also stops downloading the whole event store just to show your RSVP summary.
2. **Messages list and chats open faster.** The inbox gets every conversation's latest message, unread count and mute state in one request. Opening a chat loads its messages, reactions and pinned messages together.
3. **Names and photos appear together.** Names of people (posters, reactors, commenters, roster players) and hidden child names load in one batch per screen instead of one by one.
4. **Mini-leagues, competitions, leaderboards, media and the vault** each get the same "one request per screen" treatment for their lists.
5. **Taps feel instant.** RSVPs, reactions, joining groups, marking duties done and sending messages update on screen straight away. If a change fails, it's undone with a clear message.
6. **Fewer requests the app doesn't need.** Pages stop asking again for information they fetched moments earlier, and background checking slows down while a page is loading.
7. **The next page loads before you tap it.** The app starts loading likely next pages (Schedule, Messages, your club) in the background after Home appears.

## Order of work

1. Events: combined reads (biggest win, used by Home and Schedule).
2. Messaging: inbox summary and combined chat-open reads.
3. Names and child names: batched lookups.
4. Mini-leagues, competitions, media, vault, points: batched list reads.
5. Instant-update taps and fewer duplicate requests (app only, no deploy needed; can go live first).
6. Background preloading of likely next pages.
7. Timing measurements so we can compare before and after the deploy.

## Limits

- Saving anything still takes the Internet Computer 2–5 seconds. Instant updates hide that wait but don't remove it.
- The first open after sign-in can't use the saved copy, so it gets only the batching gains.
- Live speed can't be checked until after the mainnet deploy.

## Technical details

- **events_domain:** `get_schedule_bundle(team_ids, club_ids, from_ms, until_ms)` returns events, the caller's RSVPs, RSVP counts, duties and lineups for the window. `get_home_summary()` replaces Home's `export_state()` snapshot. Add `list_events_multi`. Each call checks visibility for the caller and has size limits.
- **messaging_domain:** `list_inbox_summaries()` returns per-conversation last message, unread count and mute state. `get_thread_bundle(conv_id, before, limit)` returns messages, reactions and pins. Add `get_conversations(ids)`.
- **identity_access (Rust):** `get_profiles_batch(ids)` (check `listLiveProfilesByIds` first, since it may already batch internally). **pii_access_control:** batch vetKey derivation for several pii refs in `resolveLivePiiTextBatch`, so it's one relay call per screen.
- **mini_league / competition / media_metadata / vault / club_points:** `*_multi` list variants for the per-id helpers that pages call inside `Promise.all`. Biggest users: HomePage, ClubsPage, ProfilePage, useClubTheme, AppHeader.
- **Frontend:** generalise the same-tick coalescer in `live/features/club.ts` into `live/features/batching.ts`, reused by every domain. It falls back per method to single-id calls on older canisters.
- **Optimistic mutations:** React Query `onMutate` / rollback for RSVP, reactions, duty completion, group join and message send. Already partly done for send.
- **Query hygiene:** align `staleTime` for ICP-routed keys (60s default); dedupe duplicate keys (e.g. `club` vs `club-profile`); pause the polling timers while a navigation is in the foreground (see `pendingCalls.ts`).
- **Prefetch:** `queryClient.prefetchQuery` on idle after Home's first paint, through `requestIdleCallback` like `MessagesBootstrapPrefetcher`.
- **Instrumentation:** send ICP call count per page open alongside the existing `home_open` / `inbox_open` / `schedule_open` latency samples.
- **Per-canister process:** new migration only when state changes (none are expected; these are read-only queries), then `.did` regeneration, bindings for both `frontend/src/lab` folders, drift check, coalescer unit tests, and an `AGENTS.md` rule update.
