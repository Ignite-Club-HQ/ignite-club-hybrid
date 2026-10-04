# Roadmap: full admin tooling in ICP mode

Goal: give Internet Identity app admins the same admin tools as Supabase mode, minus the ones that can't move (payments/Stripe/promo codes, push tools, realtime health, temp password, AdMob — tied to the old backend by design).

## Phase 1 — frontend-only (existing canister APIs) — DONE
- [x] IcpAdminPage lists: User Management, Manage Feedback, Sponsor Analytics, Notification Preferences, Chat Virt Debug, Placement Settings, Engagement, Online Users
- [x] SponsorAnalyticsPage ICP branch: gate via useIsAppAdmin; clubs/sponsors metadata from club_domain (listLiveClubs/listLiveSponsors)
- [x] ClubEngagementAnalyticsPage: canister access check (isLiveAppAdmin + myLiveRoleGrants), club meta via getLiveClubProfile, teams via listLiveTeams; platform mode = club picker (canister has no platform rollup)
- [x] ManageFeedbackPage / ManageUsersPage / NotificationPreferencesPage / OnlineUsersPage verified already canister-gated

## Phase 2 — new canister methods (Motoko + redeploy via GitHub workflow)
- [x] Deleted chats restore (messaging_domain: list_deleted_groups, restore_group, purge_group; AdminDeletedChatsPage dual-mode + menu entry)
- [x] DM attachment restrictions (messaging_domain: list_dm_attachments_disabled, list_club_dm_settings; AdminDmAttachmentsPage dual-mode + menu entry)
- [x] Manage Ads (insights_domain ad CRUD already live; ad creative in ICP mode now compresses to an inline data URL instead of throwing)
- [ ] Active Games (no canister holds live coaching-board state — useRemoteFillInSync is Supabase-only; needs that sync moved to a canister before an admin view is possible)
- [ ] App Settings (club_domain app_config exists, but most settings are only read by Supabase-mode code — wiring them would be dead config; needs product decision)

## Blocked by design (not moving)
- Stripe Settings, Promo Codes, AdMob, Send Update Reminder, Push Analytics, Realtime Health, Set Temp Password, AI Chat Recap rollout (external worker), Chat Photo Reminders (external worker), Club Backups (vault edge functions)
