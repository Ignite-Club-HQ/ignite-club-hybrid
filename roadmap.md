# Roadmap: full admin tooling in ICP mode

Goal: give Internet Identity app admins the same admin tools as Supabase mode, minus the ones that can't move (payments/Stripe/promo codes, push tools, realtime health, temp password, AdMob — tied to the old backend by design).

## Phase 1 — frontend-only (existing canister APIs) — DONE
- [x] IcpAdminPage lists: User Management, Manage Feedback, Sponsor Analytics, Notification Preferences, Chat Virt Debug, Placement Settings, Engagement, Online Users
- [x] SponsorAnalyticsPage ICP branch: gate via useIsAppAdmin; clubs/sponsors metadata from club_domain (listLiveClubs/listLiveSponsors)
- [x] ClubEngagementAnalyticsPage: canister access check (isLiveAppAdmin + myLiveRoleGrants), club meta via getLiveClubProfile, teams via listLiveTeams; platform mode = club picker (canister has no platform rollup)
- [x] ManageFeedbackPage / ManageUsersPage / NotificationPreferencesPage / OnlineUsersPage verified already canister-gated

## Phase 2 — needs new canister methods (Motoko + redeploy via GitHub workflow)
- [ ] Deleted chats restore (messaging_domain: list-deleted + restore)
- [ ] DM attachment restrictions (messaging_domain: per-club/per-user restriction list)
- [ ] Manage Ads (insights_domain has ad CRUD; creative image storage path needed)
- [ ] Active Games (no canister holds live coaching-board state)
- [ ] App Settings (club_domain app_config exists, but most settings are only read by Supabase-mode code — wiring them would be dead config; needs product decision)

## Blocked by design (not moving)
- Stripe Settings, Promo Codes, AdMob, Send Update Reminder, Push Analytics, Realtime Health, Set Temp Password, AI Chat Recap rollout (external worker), Chat Photo Reminders (external worker), Club Backups (vault edge functions)
