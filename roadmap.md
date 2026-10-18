# Roadmap — ICP MCP / ChatGPT integration

- [x] 9. Correct memory-preserving mainnet upgrades: pinned ICP CLI 1.7.0 (verified upstream EOP keep option), reject older tools, explicit auto mode. Three offline safety tests pass; shell syntax and workflow YAML valid. Actual GitHub rerun remains an operator action; the screenshot's ignite_payments command is not in this checkout.

- [x] 8. Layer 4 OQL implemented for events and caller-authorized clubs/teams: discovery, filters, projection, ordering, counts/grouping and paging; contracts regenerated. Event authorization/paging tests and 12 rejection tests pass; focused regressions pass both modes. Other domains retain per-method Candid access.

- [x] 1. Fix notification_queue inbox ownership (list_inbox, get_notification, mark_read, mark_all_read, delete_notification now verify caller's account via identity_access.whoami; fail-closed; migration 20261018_010000)
- [x] 2. Generate /.well-known/ic-architecture manifest in prepare-canister-dist.mjs (JSON content-type, real file wins over SPA fallback)
- [x] 3. Add /.well-known/ii-derivation-origin (canonical icp0.io origin)
- [x] 4. candid:service metadata: Motoko emits by default, Rust canisters use export_candid — verify on deployed canisters post-deploy
- [x] 5. getApiDoc query added to events_domain + club_domain
- [x] 6. Tests pass both modes (101/85), drift check OK, bindings regenerated, deploy wiring added (set_identity_access_canister)
- [ ] 7. USER ACTION: upgrade events_domain and club_domain for OQL; if earlier MCP changes are not live, also redeploy notification_queue + frontend (deploy-mainnet.sh runs its identity wiring). Confirm current operator terms before manifest publication, then verify ChatGPT connection, ordinary-member/linked-account visibility and revoked-member denial. Live verification needs deployment and an Internet Identity delegation; guide: docs/integrations/icp-mcp-oql.md.
