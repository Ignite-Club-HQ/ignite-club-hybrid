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

Interrupted deletion blocks deployment-wide registry mutations, including placement and health updates. There is intentionally no timeout or forced unlock. A lost commit reply is settled explicitly, not by blindly restarting deletion. These operational and all-service release gates keep scaling off.

## Interrupted pre-commit recovery (19 October 2026, second batch)

`cancel_account_deletion` closes the stuck pre-commit gap. It requires the rehearsal flag and an authorized caller, refuses once the account is erased (committed deletions recover through `settle_account_deletion` instead), verifies the account record still matches the ticket, releases the router lock at the ticket's pinned revision — idempotently, so a lost cancel reply is retried safely, and a stale ticket can never release a newer lock — then rechecks erasure before dropping the ticket. A commit interleaved after the release fails its final ticket check, so cancellation wins pre-commit and never races erasure. Registry repinning stays refused while any ticket exists, so the recovery runbook for registry drift is: cancel, repin the binding, then run the normal prepare/commit/settle flow. A separate rebase endpoint was considered and deliberately dropped: the repin guard makes it unreachable, and cancel+repin+prepare covers the same ground without dead code.

Three new real PocketIC cases pass (8 total in the timing suite):

6. Cancel releases the reservation (registry writable again), preserves the account and both clubs' memberships, a repeated cancel reports the missing ticket, and a full admin deletion after repinning completes normally.
7. Cancel after commit is refused with "settle instead"; settlement then releases the lock and the registry accepts writes.
8. When the reservation call itself fails (revision mismatch), the persisted ticket holds no lock, the registry stays writable, retrying the exact same ticket acquires the reservation, and cancel still abandons it cleanly.

Validation: **8 timing + 8 boundary PocketIC tests**, **6 admin-deletion unit tests**, **53 identity Rust tests**, and **17-contract Candid drift** pass. The remaining release decision is wiring this rehearsal-flagged protocol into the live release path; browser/Android/mainnet acceptance is still not claimed.

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
## Live release wiring (19 October 2026, third batch)

The protocol now has its own release gate. `bound_deletion_released()` in
identity_access accepts the local rehearsal flag (tests unchanged) or the
production canister environment variable `IGNITE_BOUND_DELETION_RELEASE=1`.
The four deletion-timing endpoints use this gate; every other
rehearsal-gated feature (cross-group eligibility, service admission, history
access, authority setters, identity revocation) still requires the rehearsal
flag and stays closed in production. A new PocketIC case proves the release
flag alone opens prepare/commit/cancel/settle (they reach their real
precondition checks) while a flag-less canister still answers "Bound deletion
not released".

Validation: **9 timing + 8 boundary PocketIC tests**, **53 identity Rust
tests** pass; identity_access WASM compiles. The mainnet release step is
documented in `docs/icp-deployment-runbook.md`. Still open before new groups
open live: all-service admission/drain proof, production operator
composition, and signed-in browser/Android/push acceptance.

## All-service drain proof (19 October 2026, fourth batch)

`frontend/src/live/accountDeletion.drain.test.ts` runs a full admin deletion
against real PocketIC identity, club, vault, events, messaging and media
canisters. Before deletion the member can create a vault folder, create an
event, send a club chat message and begin a club photo upload; after
`eraseIcpAccountAsAdmin` completes, the same principal is denied by every
service (vault/events return Err, messaging and media reject with membership
errors), the club roster carries no grant for the account, and re-registration
of the erased identity fails. This closes the "non-club erasure unproven"
gap for access drain: vault, events, messaging and media all delegate
authorization to live club_domain queries and fail closed once club
membership is erased. Content-purge coverage (caller's own files, messages,
RSVPs) remains the self-deletion `purge_my_data` path and is not claimed here.

## Production operator transport (19 October 2026, fifth batch)

`frontend/src/live/operatorTransport.ts` is the production operator transport:
an Ed25519 operator identity loaded from PEM signs every call, governor
control is proven per canister through the management canister's
`canister_status` (target canister as the effective id), and configuration
calls go through per-canister Candid contracts. `statusOverride` exists only
for local replicas because PocketIC's management canister refuses ingress
`canister_status`; it is never set on mainnet.

`frontend/src/live/operatorTransport.rehearsal.test.ts` runs the full
install/health/read-back rehearsal over the live HTTP gateway with real
signed calls: all twelve routed services plus blob storage and identity are
installed with the operator as controller, `configureProvisionGroup`
completes through the signed transport (resume repeats no call), a foreign
principal is rejected by `verifyGovernor`, health read-back
(`cycles_balance`, `memory_stats`) succeeds on every service, and business
read-back (create club, grant role, create and list an event) succeeds
through the same transport. The group is never registered or enabled.
