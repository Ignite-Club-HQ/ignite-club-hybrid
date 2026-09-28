
## Tasks
- [x] Admin ICP canister configuration screen (app_settings-backed)
- [x] Backend routing admin: global Supabase/ICP default + per-country eligibility (app_settings `backend_routing_config`); profile `country` column + Edit Profile selector; IP fallback
- [x] Consolidate canister config + backend routing into Infrastructure / Placement Settings (/admin/placement-settings); removed duplicate lab placement panel and old /admin/icp-canisters page (old path redirects)
- [x] Approved targets: per-backend target registry (region/kind/version/enabled) + per-country target pinning in the routing config; resolver `resolveTargetForCountry`/`getEffectiveTarget`
- [ ] Wire feature consumers to getEffectiveBackend() once canisters serve real data (routing resolver is live but nothing reads it yet beyond the admin status card)
- [ ] User deploys canisters; enter IDs via /admin/placement-settings or IGNITE_LIVE_ICP_CANISTER_IDS_JSON
- [ ] Confirm Internet Identity as canister auth before building authenticated update calls
