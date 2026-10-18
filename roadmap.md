# Roadmap — ICP MCP / ChatGPT integration

- [x] 1. Fix notification_queue inbox ownership (list_inbox, get_notification, mark_read, mark_all_read, delete_notification now verify caller's account via identity_access.whoami; fail-closed; migration 20261018_010000)
- [x] 2. Generate /.well-known/ic-architecture manifest in prepare-canister-dist.mjs (JSON content-type, real file wins over SPA fallback)
- [x] 3. Add /.well-known/ii-derivation-origin (canonical icp0.io origin)
- [x] 4. candid:service metadata: Motoko emits by default, Rust canisters use export_candid — verify on deployed canisters post-deploy
- [x] 5. getApiDoc query added to events_domain + club_domain
- [x] 6. Tests pass both modes (101/85), drift check OK, bindings regenerated, deploy wiring added (set_identity_access_canister)
- [ ] 7. USER ACTION: redeploy notification_queue, events_domain, club_domain + frontend canister (deploy-mainnet.sh runs the new wiring), then verify with the spec's acceptance tests and connect ChatGPT
