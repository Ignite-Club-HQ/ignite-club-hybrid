# Roadmap: full admin tooling in ICP mode

Goal: give Internet Identity app admins the same admin tools as Supabase mode, minus the ones that can't move (payments/Stripe/promo codes, push tools, realtime health, temp password, AdMob — tied to the old backend by design).

## Phase 1 — frontend-only (existing canister APIs)
- [ ] Audit which admin pages can run against existing canister methods
- [ ] Wire those pages into IcpAdminPage + fix their admin gates (useIsAppAdmin)

## Phase 2 — needs new canister methods (Motoko + redeploy via GitHub workflow)
- [ ] Deleted chats restore (messaging_domain)
- [ ] DM attachment restrictions (messaging_domain)
- [ ] Chat photo reminders config (messaging_domain)
- [ ] Engagement / sponsor analytics (insights_domain)
- [ ] App settings + AI recap rollout (club_domain app_config?)
- [ ] Club backups (export across canisters)

## Blocked by design (not moving)
- Stripe Settings, Promo Codes, AdMob, Send Update Reminder, Push Analytics, Realtime Health, Set Temp Password
