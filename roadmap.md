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
- [x] App Settings (club_domain app_config; set_app_config now allows app admins — needs mainnet redeploy. ICP page + runtime readers wired: club_creation_locked, chat_virtualization_enabled, chat_basic_chunk_size, welcome_dm_message. Supabase-only settings — photo prompts, notif prefetch, free-club polling, AI recap, legal reacceptance — stay off the ICP page by design)

## Blocked by design (not moving)
- Stripe Settings, Promo Codes, AdMob, Send Update Reminder, Push Analytics, Realtime Health, Set Temp Password, AI Chat Recap rollout (external worker), Chat Photo Reminders (external worker), Club Backups (vault edge functions)

## Club setup wizard ICP enablement — DONE
- [x] Removed the hard "ICP lab mode" placeholder gate so the real wizard renders in ICP mode (teams, invites, branding, sponsors, review all already had ICP branches)
- [x] Working-groups step: ICP branch creates role groups via messaging_domain create_group_with_roles, seeding club admins/committee as members and the creator as owner
- [x] Draft persistence (localStorage) now allowed in ICP mode
- Verified: typecheck 0 diagnostics, preview build OK, messaging + featureRouter tests pass (11/11)

## Open
- [ ] Duplicate teams reported after publish — not yet investigated
- [x] Club page ICP follow-ups (done, typecheck 0 diagnostics): team folders (club_domain state+methods+migration 20261008_000000, bindings regenerated); ClubDetailPage — club/teams/folders/clubSubscription queries ICP-wired, folder mutations + subscription toggle to canister, role-request and club-deletion lab gates removed; TeamDetailPage — team query ICP-wired (activates existing delete/restore/permanent/member-removal branches), team role request via requestLiveRole (no parent/child metadata on canister); CreateTeamPage — club/team-count/subscription/folders queries ICP-wired, folder_id set on create and edit. Canister changes need the deploy-icp-mainnet workflow run before they work live
- [ ] Canister changes (set_app_config admin access, deleted chats, DM attachments) pending mainnet redeploy via deploy-icp-mainnet workflow
