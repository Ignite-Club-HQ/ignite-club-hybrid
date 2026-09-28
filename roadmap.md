
## Tasks
- [x] Admin ICP canister configuration screen (/admin/icp-canisters, app_settings-backed)
- [x] Backend routing admin: global Supabase/ICP default + per-country eligibility (app_settings `backend_routing_config`); profile `country` column + Edit Profile selector; IP fallback
- [ ] Wire feature consumers to getEffectiveBackend() once canisters serve real data (routing resolver is live but nothing reads it yet beyond the admin status card)
- [ ] User deploys canisters; enter IDs via /admin/icp-canisters or IGNITE_LIVE_ICP_CANISTER_IDS_JSON
- [ ] Confirm Internet Identity as canister auth before building authenticated update calls
