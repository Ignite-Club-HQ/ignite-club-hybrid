# NEEDS-CANISTER completion pass

Close every recorded "NEEDS-CANISTER" gap so ICP mode has no degraded or gated-off
screens (standing rule: no "not available" UI — wire it or it isn't done).

## Phase 1 — Messaging domain
- Canister: add presence/online-count query, user blocking (block/unblock/list), and a
  conversation recap digest query (text + outstanding actions/questions per scope) to
  `messaging_domain`. One new timestamped migration file; self-contained, mo:core only.
- Frontend: wire `useChatOnlineCount`, `useBlockedUsers`, `GlobalChatRecapSheet` to the
  new methods via withFeatureBackend; recap LLM call happens canister-side via HTTPS
  outcall per the locked design decision.
- Frontend-only (canister methods already exist): wire `AddGroupMembersDialog`,
  `CreateGroupDialog`, `StartDMDialog` to addLiveGroupMembers /
  createLiveGroupWithRoles / getOrCreateLiveDm using list_role_grants candidates.

## Phase 2 — Club domain
- Canister: add club branding read, fuzzy invitable-profile search, club terms CRUD
  (class/season terms), and PlayHQ link fields on the team shape.
- Frontend: wire `AddClubAdminSheet` (F3), `TermsManager` (F10), `PlayHQTeamLinkCard`
  team update (F7, team side).

## Phase 3 — Events / notifications / payments ledger
- Canisters: household RSVP roll-up (children/child_guardians shape) in events/club
  domain (F1); association-scoped multi-club event fan-out (F5); player_of_match
  notification type in notification_queue (F8); manual payment ledger + bulk fee
  reminder fan-out (F6). Payments here are the manual "mark paid / remind" ledger only —
  non-IAP money stays Supabase-gated per the payments rule.
- Frontend: wire `NextUpCarousel` useChildRsvps, `AssociationEventsPanel`,
  `PlayerOfMatchSelector`, `MemberSubscriptionPaymentsManager`.

## Phase 4 — Competitions / mini-leagues
- Canisters: admins-only chat toggle read, competition entry-invite accept/decline
  writes, join-link role param for admin-grant links, children/child-assignment cascade
  equivalents for delete/duplicate/mock-player flows.
- Frontend: CompetitionMemberChatCard admins-only, TeamCompetitionsSection invite
  accept/decline, MiniLeagueAdminJoinLinkCard, ManagePlayersDialog /
  AddSecondParentDialog / AddMiniLeagueMemberSheet / MiniLeagueSettingsDialog.

## Phase 5 — Sponsors + remaining read sweep
- Canister: cross-club sponsor/strip lookup without an explicit club filter (F9).
- Frontend: SponsorOrAdCarousel, then the remaining ~55 degraded read items
  (useProfiles, useProfileTeamHistory, useClubSeasons, useChatSharedMedia,
  EventCancellationRecipients/GroupMap, admin analytics tabs, carousels, link cards) —
  each wired to a canister read or, where the canister genuinely lacks the shape,
  added to the canister in the same pass.

## Technical details
- Per canister change: exactly ONE new timestamped file in that canister's
  `src/backend/migrations/` (sorts after 20261001_000000.mo), fully self-contained
  (inline old+new types, mo:core imports only), OldActor = NewActor of the current
  chain tail copied exactly; never modify applied migrations.
- Motoko rules from the writing-motoko skill: no `stable` keyword, no mo:base, dot
  notation, `??` coalesce, no inline initializers on stable fields, no type annotations
  on inline lambda call arguments.
- Verify each canister: `moc $(mops sources) --enhanced-migration src/backend/migrations
  --check src/main.mo`; regenerate `.did`, then icp-bindgen bindings in BOTH
  `frontend/src/lab/bindings/<c>` and `frontend/src/lab/generated-contracts/<c>`;
  `node frontend/scripts/check-candid-drift.mjs` must stay 17/17 green.
- Frontend gating only via isFeatureRoutedToIcp / resolveAuthBackend /
  withFeatureBackend / assertSupabaseWritePath — never resolveLocalAuthMode/useIcpLab.
- After each phase: `node scripts/check-product-type-errors.mjs` clean; vitest shards
  1/3, 2/3, 3/3 run sequentially and green; roadmap updated with per-area status.
- If the sandbox wiped /root: reinstall toolchain (`bun add -g ic-mops &&
  mops toolchain use moc 1.16.1`, `mops install` per canister) before compiling.
