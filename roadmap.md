# Roadmap

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
