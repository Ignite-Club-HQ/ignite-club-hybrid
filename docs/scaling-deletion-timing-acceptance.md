# Deletion timing — local acceptance

19 October 2026. Final registry timing is protected by an additive **local-only** reservation protocol. No deployment, live deletion or scaling activation occurred.

## Contract

Identity memory 16 stores an immutable account/principals/version and pinned registry binding before requesting a reservation. Router memories 10/11 pin the trusted identity authority and bounded non-expiring locks. Acquisition checks the expected registry revision synchronously. Every route/group/placement/health mutation and new-club placement rejects while any reservation is held; reads continue.

Grouped self/admin deletion prepares the reservation before revocation. Commit reacquires the same lock, reads the real registry, validates required legacy authority coverage and checks every captured alias through each club's `read_account_membership_erased`. Final account/binding/ticket validation and identity erasure contain no intervening awaits. The registry remains reserved through commit.

Only identity's confirmed-erasure settlement calls the router release; the router trusts its immutable configured identity authority, not user-provided commit receipts. No browser or governor release bypass exists. Router and identity upgrades retain locks and tickets. Unknown outcomes retain reservations rather than expire them. Pinned identity deployments refuse direct legacy erasure. New identity methods remain guarded by the existing rehearsal flag; deployment scripts do not enable it.

## Evidence

`frontend/src/live/accountDeletion.timing.test.ts` invokes the actual admin entrypoint through real PocketIC identity, router and two club services. Connector wrappers call real actors; the frontend session checks real router revisions but is not browser membership discovery. Other service IDs are valid principal fixtures, not running domains. Club admission remains off; setter-only wiring temporarily uses the existing local flag.

Five passing real cases:

1. Final-window group changes and new-club placement fail; both aliases lose both clubs, re-registration fails, unrelated members retain roles, and registry writes resume after settlement.
2. Drift before reservation rejects without membership/identity erasure.
3. Remaining club access blocks commit; legacy erasure and unauthorized release fail; router and identity upgrades preserve reservation; retry succeeds after revocation.
4. A lost commit reply retains the lock; confirmed-erasure settlement releases it.
5. Changed linked-account snapshots block commit and retain identity/reservation.

Validation: **65 frontend tests**, **52 identity Rust tests**, **19 router Rust tests**, and **17-contract Candid drift checks** pass. Identity/router WASMs and club's enhanced-migration WASM compile. Replica suites run serially to avoid competing PocketIC shutdowns.

## Limits and operational impact

This is not global operation draining or an all-service identity-admission rollout. Club verification is point-in-time authorization evidence; privileged ACL restoration, unsynchronized aliases, newly created club ACLs, cached photo keys/downloads and full content-purge behavior remain unproven. Browser/Android/mainnet acceptance is not claimed.

Interrupted deletion blocks deployment-wide registry mutations, including placement and health updates. There is intentionally no timeout or forced unlock. Pre-commit changed-account snapshots or ambiguous reservation failures remain locked; **abort/rebase reconciliation and retry UX are not implemented** and need separate release review. A lost commit reply is settled explicitly, not by blindly restarting deletion. These operational and all-service release gates keep scaling off.

## Reproduce

Compile identity/router into workspace `target/wasm32-unknown-unknown/release`; compile club with pinned Motoko/enhanced migrations. From `frontend/`:

```sh
POCKET_IC_BIN=/tmp/boundary-replica/pocket-ic \
IDENTITY_ACCESS_WASM=/dev-server/target/wasm32-unknown-unknown/release/identity_access.wasm \
SHARD_ROUTER_WASM=/dev-server/target/wasm32-unknown-unknown/release/shard_router.wasm \
CLUB_DOMAIN_WASM=/dev-server/backend/club_domain/main.wasm \
bunx vitest run --no-file-parallelism --config vitest.legacy.config.mjs \
  src/live/accountDeletion.timing.test.ts src/live/accountDeletion.boundary.test.ts \
  src/live/adminAccountDeletion.test.ts src/live/accountData.erase.test.ts \
  src/live/accountData.groups.test.ts src/live/groupSession.test.ts \
  src/live/groupSessionWrite.test.ts src/live/groupSessionCrossGroup.test.ts
```