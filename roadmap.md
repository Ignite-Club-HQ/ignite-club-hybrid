# Roadmap

## Completed

- [x] Migrate the hybrid frontend and 13 ICP canister source domains from the
  isolated lab into this repository.
- [x] Keep the browser build on the guarded live target and remove lab-only
  fixture, synthetic identity, and local actor implementations.
- [x] Add live Supabase configuration through `IGNITE_LIVE_*` environment
  variables; keep credentials out of the repository.
- [x] Add shared ICP target/agent and Internet Identity support. The canister
  source and Candid contracts are present, but are not deployed.
- [x] Validate frontend build, lab-runtime exclusion, canister topology,
  Candid drift, and Rust workspace compilation.

## Remaining

- [ ] Validate login, profile, and RLS behavior against the approved DEV
  Supabase project after private hosting configuration is available.
- [ ] Wire live domain pages to ICP adapters where intended; do not expose an
  ICP data mode until its domain adapters and authorization model are ready.
- [ ] Plan canister provisioning, controllers, cycles, and deployment as a
  separately authorized step.
