# Roadmap — ICP MCP / ChatGPT integration

- [ ] 15. Fix chat photo sends staying pending and duplicating after reopening; test acknowledgement and concurrent-send recovery.

- [x] 14. Recover stopped frontend before syncing existing assets; remove destructive reinstall fallback. Offline regression tests pass. Live recovery and funding require the deployer workflow/account.

- [x] 13. Correct frontend balance grant: verified and pinned ICP CLI 1.7.0, use `canister settings update --add-controller --force`, test failure propagation. Live grant requires rerunning the frontend workflow with this change.

- [x] 10. Fix insights_domain M0250: removed actor initializer; added data-preserving partial migration 20261018_015713. Per-canister mops check, migration test and mops build pass. Root-wide check cannot verify all canisters because root dependencies omit events_domain's ic package; deploy uses per-canister dependency contexts. GitHub rerun still required.

- [x] 9. Correct memory-preserving mainnet upgrades: pinned ICP CLI 1.7.0 (verified upstream EOP keep option), reject older tools, explicit auto mode. Three offline safety tests pass; shell syntax and workflow YAML valid. Actual GitHub rerun remains an operator action; the screenshot's ignite_payments command is not in this checkout.

- [x] 8. Layer 4 OQL implemented for events and caller-authorized clubs/teams: discovery, filters, projection, ordering, counts/grouping and paging; contracts regenerated. Event authorization/paging tests and 12 rejection tests pass; focused regressions pass both modes. Other domains retain per-method Candid access.

- [x] 1. Fix notification_queue inbox ownership (list_inbox, get_notification, mark_read, mark_all_read, delete_notification now verify caller's account via identity_access.whoami; fail-closed; migration 20261018_010000)
- [x] 2. Generate /.well-known/ic-architecture manifest in prepare-canister-dist.mjs (JSON content-type, real file wins over SPA fallback)
- [x] 3. Add /.well-known/ii-derivation-origin (canonical icp0.io origin)
- [x] 4. candid:service metadata: Motoko emits by default, Rust canisters use export_candid — verify on deployed canisters post-deploy
- [x] 5. getApiDoc query added to events_domain + club_domain
- [x] 6. Tests pass both modes (101/85), drift check OK, bindings regenerated, deploy wiring added (set_identity_access_canister)
- [ ] 7. USER ACTION: upgrade events_domain and club_domain for OQL; if earlier MCP changes are not live, also redeploy notification_queue + frontend (deploy-mainnet.sh runs its identity wiring). Confirm current operator terms before manifest publication, then verify ChatGPT connection, ordinary-member/linked-account visibility and revoked-member denial. Live verification needs deployment and an Internet Identity delegation; guide: docs/integrations/icp-mcp-oql.md.
- [x] 11. Fix "Memory-incompatible program upgrade" on mainnet: matched live versions by module hash; added catch-up migrations (vault backups, club news/settings, events fields, messaging competition link), moved back-dated competition/events steps after the live ones, restored edited applied steps. All five verified compatible with live via moc --stable-compatible; full icp build passes.
- [ ] 12. USER ACTION: top up timer_jobs (and any other canister reporting out of cycles, e.g. shard_router) before rerunning the deploy workflow.
