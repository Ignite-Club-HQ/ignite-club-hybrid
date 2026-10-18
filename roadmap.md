# Roadmap — ICP MCP / ChatGPT integration

- [ ] 1. Fix notification_queue inbox ownership (list_inbox, get_notification, mark_read, mark_all_read must verify caller owns the account)
- [ ] 2. Generate /.well-known/ic-architecture manifest in prepare-canister-dist.mjs (JSON content-type, excluded from SPA fallback)
- [ ] 3. Add /.well-known/ii-derivation-origin
- [ ] 4. Verify/enable candid:service metadata on all canisters (Motoko default; check Rust canisters)
- [ ] 5. Add getApiDoc query to events_domain + club_domain (MVP read surface docs)
- [ ] 6. Update tests, run focused tests + build
- [ ] 7. Document deploy + ChatGPT verification steps for the user
