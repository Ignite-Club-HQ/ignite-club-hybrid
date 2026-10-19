# Complete new-group local acceptance — 19 October 2026

## Verified

`frontend/src/live/groupProvision.fullServices.test.ts` installs the actual twelve routed services: club, events, messaging, notifications, PII, vault, points, competition, mini-league, media metadata, insights and timer jobs. A dedicated supplementary encrypted blob store and shared identity are installed too. No group is registered/opened and no account-admission flags are enabled in this suite.

All reciprocal settings execute through real controller-checked governor calls, with durable intents, acknowledgements, exact inventory binding and replay protection. Configuration includes blob membership authority, club quota-store registration and timer worker permission. The supplied blob must be dedicated to this group: never repoint an existing photo store. Quota registration is preparation, not quota cutover activation.

Real club-admin business flows pass: training create/read; club-to-messaging conversation creation; chat send/read and real queued notifications; worker claim/ack and outsider rejection; PII access; vault folder creation; reward role refresh and seven-point award/read; competition and league creation; media registration and insights recording; timer scheduling/worker completion. Real vetKeys encrypt/upload/read/decrypt photos before and after upgrades. All twelve services and the blob store upgrade in place; EOP memory is retained. Event/chat/points/media read-back passes afterwards. Removed administrators cannot create leagues, upload, or obtain fresh photo keys.

## Corrected demonstrated gaps

- League creation reads current club-admin roles through bounded consensus and rechecks admission, authority and transfer fence. It no longer needs manual grants; removed and outsider denial are tested.
- Timer installation captures its sender atomically. Compatibility initialization requires controller authority and is idempotent only for the captured governor. Existing upgrade state remains intact; outsider takeover is tested.
- Identity inventory permits exactly the same shared workload global across groups, never duplicated routed domains or mixed workload IDs. Unit and real deletion fixtures use this shared-global topology.
- Deletion tickets prevent new/pre-issued linking, unlinking, account status changes and principal rekeying from changing the captured account snapshot. Commit and settlement guards remain intact.

## Evidence and reproduction

- Full-service/configuration: 10 tests pass.
- Focused provisioning/routing/deletion: 80 tests pass; final real timing/boundary rerun: 13 pass.
- Rust identity: 53 tests; timer: 13 tests pass.
- Same-instance two-group encrypted-photo/chat/upload/notification removal and upgrade rehearsal passes; outbound push sends remain stubbed.
- 17-contract drift and six offline deployment safeguards pass; preview build OK, HTTP 200.

From `frontend/`, run the new file with `vitest.legacy.config.mjs --no-file-parallelism`, `NEW_GROUP_FULL_REPLICA=1`, `POCKET_IC_BIN` and actual `<DOMAIN>_WASM` paths, plus `MEDIA_BLOB_STORE_WASM` and `IDENTITY_ACCESS_WASM`. Missing artifacts fail when enabled. Compile Motoko with moc 1.16.1 and each directory's migration chain. Run replicas serially. Timing tests additionally need `SHARD_ROUTER_WASM` and enable the existing timing protocol only in their isolated fixture.

## Live opening remains blocked

1. **Interrupted precommit deletion:** safe cancellation/rebase is unimplemented. Ambiguous reservations/commits retain locks. A cancellation protocol must distinguish in-flight commits, prevent stale releases unlocking replacement tickets, and preserve revoked access. No timeout or forced unlock was added.
2. **Complete access/drain and recovery proof:** topology stability and absence of club ACLs do not prove every service, alias or delegated/delayed operation is denied, or that restoring authorities cannot resurrect access. Independent local-only account-authority/activation gates stay closed.
3. **Production operator composition:** the test supplies real local management, not a released production command. Actual dedicated blob placement/key attestation, deployment inventory, shared device/worker, quota/retention cutover and install/environment settings require verification.
4. **Approved live acceptance:** mainnet upgrades, signed-in browser/Android and real device push have not run. Opening needs approval, verified recovery, complete routing and the exact approved registry revision.

Nothing deployed; shipped scaling gates remain OFF. Complete local service interaction is verified, not live-opening readiness.
