# Cross-group account proof — 20 October 2026

## Result

The approved bounded offline account checks pass. No live service was upgraded, group opened, club moved or money spent. This is not permission to open Group 2 and is not proof of complete global account removal.

## Demonstrated bug and correction

The existing real two-group account runner failed first because its older setup omitted the current service-admission authority and used legacy private queries. After correcting the fixture, it reproduced a surviving principal losing `club-a` from indexed membership discovery after a club upgrade and one account synchronization.

The transient index started with membership epoch `0`, index epoch `1` and an empty index. The first synchronization after upgrade advanced membership epoch to `1`, making the empty index appear current. `club_domain` now represents an unbuilt index with a null optional epoch; only an actual rebuild sets a numeric epoch. No persistent state, migration, contract or permission was changed.

The same runner passes with the corrected compiled club module. Surviving membership remains visible through upgrades and synchronization. Denied identities remain denied.

## Fresh verification

- Actual PocketIC identity plus two club canisters: interrupted unlink, restarted unacknowledged group **before retry**, removed-alias protected role/membership/sync denial, surviving-principal membership, durable denial history, explicit newer relink without automatic role restoration, stale receipt replay, concurrent unlink and upgrades pass.
- Actual local self/admin application deletion entrypoints: **9 boundary cases pass**, including the new ordinary-removal case. Removing one linked alias from the legacy club denies both aliases there after sync and upgrade, retains both aliases' new-club membership, preserves another member's legacy-club membership, and leaves shared account ID/version/principals unchanged.
- Actual local identity/router/club deletion timing: **9 cases pass**, including final-window registry/placement locks, alias snapshot freeze, unavailable reservation, lost commit response, upgrade preservation, cancel/retry and release-flag separation.
- Identity Rust rules: **55 pass**. Existing frontend account rules: **37 pass, 18 skipped** in the initial unconfigured run; the 17 skipped boundary/timing cases were then explicitly enabled and passed, alongside the new boundary case. One recovery-banner skip remains; it is not acceptance evidence.
- Corrected club module compiles with pinned Motoko 1.16.1; only pre-existing warnings remain.

Replica suites ran sequentially. Boundary discovery/connector seams and personal purge transports remain fixtures; timing uses real router calls. No real browser, native device or FCM delivery was verified.

## What remains before a new group can open

1. **Release dependency, not the old 64-group cap:** authority publication and service-admission activation remain local-only. Current provisioning requires that unreleased composition; wiring checks alone do not prove its behavior.
2. **Complete cross-service guarantees remain unfinished:** restarted-club protected reads are now tested, but this does not prove every other service, delegated alternative, in-flight callback/claimed notification, full-inventory completion or permission-preserving coordinated recovery. The broader global-drain project remains paused; this batch did not expand it or bypass it.
3. **Separately approved live acceptance:** exact production inventory/controller checks, approved upgrades, signed-in two-group browser/native access/removal and actual notification delivery, then explicit opening approval.
4. **Separate media acceptance:** tiny-file results and existing/pending-photo reconciliation plus gallery/chat/vault acceptance remain prerequisites to larger storage activation, not to completing these local account tests.

The group registry's 4,096 safety bound and paging work are separate, offline-tested changes awaiting an approved upgrade. Neither that capacity work nor this proof makes capacity unlimited.

## Reproduce locally

Build `identity_access` and production `shard_router` Wasm without the scale-probe feature. Compile corrected `club_domain` with the existing enhanced-migration chain. Supply their exact paths through `IDENTITY_ACCESS_WASM`, `CLUB_DOMAIN_WASM`, `SHARD_ROUTER_WASM` and `POCKET_IC_BIN`.

Run `frontend/scripts/test-account-groups-replica.mjs`, then the existing Vitest boundary/timing files with one worker and file parallelism disabled. Never deploy the rehearsal flags, the PocketIC fixtures or the scale probe.