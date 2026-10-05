# Roadmap

## Club and team selectors in ICP mode
- [x] Unwrap optional club profiles in event creation; allow club admins to choose club teams and ignore stale active-club filters.
- [x] Read ICP clubs and teams for event editing, photo uploads, competition organisers, mini leagues, and leaderboard selectors rather than querying Supabase roles with an Internet Identity principal.
- [ ] Verify the picker interactions in a signed-in Internet Identity browser session (requires a working II session in the preview).

## Event map is broken in ICP mode
- [x] Replace invalid event map iframe URL with Google Maps Embed using the connected public browser key; forward the key through the guarded live preview/build configuration and offer a location link if the key is unavailable.

## Team & club chat replies don't persist (ICP mode)
- [x] Root cause: canister `Message` had no `reply_to_id`; ICP fetch branches hardcoded `reply_to_id: null` / `reply_to: null`, so replies only showed via the optimistic update and vanished on refetch.
- [x] Canister: `Message` gains `reply_to_id : ?Text`; `send_message` takes a 5th `reply_to_id` param (validated: target must exist in the same conversation; old 4-arg clients still decode); migration `20261010_000000.mo` maps existing messages with `reply_to_id = null`. Compiles clean under `--enhanced-migration`.
- [x] Frontend: `sendLiveMessage` gains optional `replyToId`; TeamChatPage + ClubChatPage ICP branches pass `reply_to_id` on send and resolve the quote from messages in the loaded page (try/optional chaining tolerates pre-redeploy canisters). did files + both binding sets regenerated via icp-bindgen, drift check passes, strict typecheck clean.
- [ ] User: re-run "Deploy ICP mainnet" workflow — replies persist only after the updated canister is live.
- [ ] Out of scope (unchanged): GroupChatPage, BroadcastChatPage, ClubAdminChatPage, DirectMessagePage reply threading stays Supabase-only in ICP mode.

## Team chat reactions don't persist (ICP mode)
- [x] Root cause: canister `list_messages_page` returns no reactions, so the ICP fetch branch hardcoded `reactions: []` — every refetch wiped them (they only "appeared" via the optimistic update).
- [x] Canister: new `list_reactions(conversation_id)` query (full user+emoji rows, caller access-checked); `toggle_reaction` now verifies the caller can read the message's conversation (was unauthenticated-by-conversation).
- [x] Frontend: `listLiveReactions` in live/features/messaging.ts; TeamChatPage ICP branch fetches and maps reactions (try/catch tolerates pre-redeploy canisters). did + both binding sets regenerated, drift check passes, typecheck clean.
- [ ] User: re-run "Deploy ICP mainnet" workflow — reactions persist only after `list_reactions` is live.

## Club creation / "Club not found" (ICP mode)
- [x] Verified user's club "Dingo" (ee23c110-6332-4913-a54e-df704956dcc3) exists on club_domain canister — creation succeeded
- [x] "Club not found" dead-end now has a "Back to Clubs & Teams" link (ClubDetailPage)
- [x] Club creation failures now log the real error to console (CreateClubPage) for telemetry
- [ ] Root-cause: preview repro shows create_club failing for a brand-new II user ("Failed to create club" toast, no message) — needs the new console error from a real attempt
- [ ] Root-cause: setup-wizard team creation failed silently in preview repro — same logging gap
- [ ] Stale activeClubTheme (deleted Test club id) is the likely cause of the user's "Club not found" — consider auto-clearing the filter when the club can't be loaded
- [ ] ICP-mode Supabase leaks (PostgREST 400s, principal-as-UUID): InviteAutoAccept, profileCache batch, club-backend enforcement

## Pending user actions (from earlier work)
- Deploy `send-email` edge function (paste /mnt/documents/send-email-supabase-function.ts, Verify JWT OFF, RESEND_API_KEY)
- Re-run "Deploy ICP mainnet" workflow — now also ships reaction persistence (`list_reactions`) and reply persistence (`reply_to_id`), on top of invites/media-tagging/news/app-settings

## Chat image upload failure (ICP) — diagnosis
- Canister path fully verified end-to-end against mainnet (vetkey fetch, IBE encrypt, begin/put/finalize on media_blob_store, register_pii, club grant) with a fresh authenticated identity — all pass.
- Published bundle confirmed current (chat upload code + all canister IDs present).
- Browser-side repro blocked: headless II sign-in handshake never completes; IndexedDB session injection deadlocks on version upgrade while the app holds the DB open.
- Fix shipped: ChatImageInput's file-select catch now surfaces the real error (getReadableUploadError) instead of the generic "Failed to upload image" toast, and logs the full error — the next failure will be diagnosable from the toast/console.
- OPEN: ask the user to retry the image upload and report the exact toast text (or console error) — that pinpoints the remaining browser-side step.

## Club admin rights missing in ICP mode (Dingo club)
- [x] Verified on-chain: live club_domain create_club grants club_admin to the creator (probe club + my_role_grants) — the Dingo grant exists.
- [x] Root cause: ClubDetailPage's userRole + isAppAdmin queries were Supabase-only (II principal sent as UUID → no rows → not admin). Fixed: ICP branch reads my_role_grants (mirrors TeamDetailPage); isAppAdmin now uses the shared useIsAppAdmin hook.
- [x] Checked siblings: useNewsPublishableClubs already has an ICP branch; build OK + typecheck clean.
- NOTE: leftover probe club "Probe" (id probe-1791172353502) on mainnet — undeletable without the discarded probe identity or the governor; invisible to members (membership-scoped lists).

## Chat paging / virtuoso (ICP mode)
- [x] Live probe proved the bug: `list_messages_page(after=null)` returns the OLDEST page (35-msg probe → 1–31, next=31) while the app treats `next_sequence` as "has older" → any chat longer than one page showed the oldest messages and scroll-back silently stopped.
- [x] Canister: new `list_latest_messages_page(conversation_id, before, limit)` — newest-first, backward cursor (`next_sequence` = oldest seq in page, null when nothing older), stale-cursor error, limit 1–100; compiled with moc 1.16.1, did + both binding sets regenerated, drift check OK, no migration needed.
- [x] App: `listLiveLatestMessagesPage` in live/features/messaging.ts falls back to the forward read when the canister predates the method (live reject is IC0536 "Canister has no query method", not IC0504) — live-verified with a throwaway chat (3 msgs returned via fallback), so the published app keeps loading chat before the redeploy.
- [x] Wired newest-first read + real scroll-back: TeamChatPage, ClubChatPage, GroupChatPage (useGroupMessagesQuery + useGroupOlderMessagesLoader), DirectMessagePage.
- [x] typecheck clean (exit 0), preview build OK (exit 0).
- [x] BroadcastChatPage: real platform feed. Canister `ensure_broadcast_conversation()` creates the fixed `"broadcast"` conversation, open-read for every signed-in member (`canAccessConversation`/`canReadTeamMessages`), posting gated in `send_message` on club_domain's new `is_app_admin` query. App reads the newest page + reactions and pages back with the same cursor as the other chats.
- [x] ClubAdminChatPage: mirrors Supabase semantics — one thread per club member answered by that club's admins. Canister `ensure_club_admin_thread(club, member)` (id `club-admin-<club>-<member>`, membership re-read from club_domain on every open) + `list_club_admin_threads(club)` for the admin inbox; club_domain gained `is_app_admin` / `list_club_admins`. App page now derives the thread from the route id, reads messages + reactions, and resolves the club name from the club canister; the synthetic lab stub is gone.
- [x] Canisters compile (moc 1.16.1), did + both binding sets regenerated, drift check OK, typecheck clean, preview build OK. No state migration needed.
- [x] Club-admin chat scroll-back (ICP): page tracks the canister's backward `next_sequence` cursor, merges older pages by id, and wires `hasOlderMessages`/`isLoadingOlder`/`onLoadOlder` into the scroller. Replies, edits and reactions on older messages work via the existing canister methods; the ICP send path now passes `replyToId` (was dropped with a "Supabase-only" comment).
- [x] BroadcastChatPage cursor bug fixed: it read nonexistent `page.nextBefore`/`page.hasMore`, so scroll-back silently never loaded older messages; now derives the cursor from `page.next_sequence` like the other chats, and its ICP send path passes `reply_to_id`.
- [x] ClubAdminInboxList ICP branch: fetchClubAdminConversations routes to the canisters when messaging is ICP-routed — club_admin grants via club_domain my_role_grants, threads via list_club_admin_threads, previews via list_latest_messages_page (limit 1), member names via the shared profile cache; deleted/inactive clubs dropped, empty threads hidden (same rules as Supabase). MessagesPage inbox query no longer disabled in ICP mode.
- [x] Raw-shape mapping fix: ClubAdminChatPage and BroadcastChatPage read canister messages as camelCase (m.authorId/m.text/m.createdAtMs) that the live actor never returns — messages would have rendered empty with Invalid dates. Both now map the raw candid shape (sender/body/created_at_ms, opts as [] | [v]) matching the user-verified TeamChatPage/DirectMessagePage mapping. Typecheck, preview build, and 17-contract drift check all pass.
- [ ] User: re-run "Deploy ICP mainnet" — that one deploy also ships reactions, replies, invites, media tagging, news publishing and app settings.
- [ ] User (push notifications): set GitHub secrets `ICP_PUSH_WORKER_SEED` and `FCM_SERVICE_ACCOUNT_JSON`, then redeploy — the deploy script grants the delivery worker; delivery then runs on the 5-minute Actions poll.


## Admin button vanishes for II app admin (Paul Cranwell)
- [x] Root cause: ~20 pages declared their own useQuery on the shared ["is-app-admin", userId] key with Supabase-only queryFns / stricter enabled gates; first mounter owns the cache entry, so an ICP-disabled or Supabase-only copy left the flag false/undefined and the Admin button vanished.
- [x] ProfilePage: now uses shared useIsAppAdmin hook; isTeamAdminOrCoach query now routes via withFeatureBackend (canister role grants in ICP mode).
- [x] All 18 remaining files converted to useIsAppAdmin (AdminPage, AdminChatPhotoReminders, AdminActiveGames, AdminTempPassword, SponsorAnalytics, AppStripeSettings, SendUpdateReminder, ManageBackups, RealtimeHealth, ClubRewardsReport, ClubRewards, NotificationPreferences, OnlineUsers, RewardRedemptionCard, ClubChatPage, EventDetailPage, ManageAdsPage, useMessagesPageAccessData, useVaultAccessModel). useMessagesPageBootstrap's Supabase-only RPC seed of the shared key is now gated on `!isFeatureRoutedToIcp("admin")`.
- [x] Vault access-model tests updated to mock useIsAppAdmin (all 18 pass); typecheck exit 0; preview build OK; build-errors.log "build OK". rg confirms only comments + the gated seed + the hook itself still mention the key.
- Frontend-only fix; no canister redeploy required for this item.

## No click feedback on buttons in ICP mode
- [x] Root cause: canister UPDATE calls take ~2–5s and most ICP-mode buttons have no per-button pending state, so taps look dead.
- [x] Fix: live/pendingCalls.ts (pure store) + icpAgent.createLiveActor wraps every actor UPDATE method (query/composite-query methods left bare so polling never flashes it) + IcpPendingBar — a 3px indeterminate top bar (200ms show delay, 500ms min visible, pointer-events none, reduced-motion aware) mounted in App.tsx.
- [x] Verified: candid introspection against real club_domain bindings detects 97 update methods; typecheck exit 0; ICP guard + topology checks pass; preview build OK.
- Frontend-only; no canister redeploy required.
- [x] Extended: navigation + page-load reads also drive the bar. pendingCalls tracks UPDATE calls always + QUERY calls only within 4s after a route change (noteIcpNavigation via IcpNavActivityTracker inside BrowserRouter); icpAgent now wraps query/composite-query methods with trackIcpQueryCall so background polling stays silent. Logic unit-tested with bun (background query silent, nav-window query + update counted, settles to 0, one-way passthrough); typecheck 0; preview build OK.
