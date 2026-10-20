# Scaling stage three — bounded provisioning readiness

## Implemented locally

- Durable approval and external mutation intents precede creation, installation and directory writes. Lost acknowledgements require exact operator reconciliation; resetting a phase cannot replay an uncertain mutation.
- Returned IDs and observed subnets stay inventoried even when placement is wrong. Individual install acknowledgements prevent repeating completed installs. Missing/duplicate group IDs and per-group global services are rejected.
- Closed-group and immutable-placement receipts persist separately. Definite placement refusal leaves the group closed and resumable; lost committed replies stop for authenticated read-back. Revision drift blocks activation.
- Directory records reject foreign deployments, unapproved subnets, non-HTTPS origins and duplicate canisters. Storage failures preserve unresolved intents.

## Evidence

- 72 focused provisioning/routing tests across seven files pass under the project's legacy Vitest configuration.
- Real local management/directory rehearsal passes: creation committed/reply lost, no duplicate create/install, closed placement refusal, placement committed/reply lost, exact receipt reconciliation and directory upgrade preservation. Script: `frontend/scripts/test-provision-groups-replica.mjs`.
- Domain probes use router WASM only to test management installation, not production domain health or wiring. The unchanged directory service was compiled for this test.
- Existing recovery checks: 45 pass. Safe backend deployment checks: six pass. Incomplete inventory/restore, missing semantic evidence and inconsistent state remain blocked.

## Remaining integration/release dependencies

Follow-up: `docs/scaling-complete-group-acceptance.md` verifies actual twelve-service setup/business read-back/upgrades and dedicated blob encryption. This supersedes the missing-local-artifact limitation below, not production management, recovery/account-access or mainnet/native/FCM requirements.

### Current bounded setup batch (19 October 2026)

- Executor now requires a separate configuration phase between installation and health. `groupProvisionConfiguration` enumerates the existing club/chat/PII/vault/reward/competition/league/notification settings, including shared inbox identity and worker grant, and checkpoints every intent/acknowledgement. All planned calls encode against the actual generated update signatures. No identity admission setter or global-removal authority publication is added.
- Configuration receipts bind proposal, group, deployment, subnet, all per-group IDs, governor and global identity/worker. Changes, unverified governor control, missing IDs, unknown receipts and lost replies stop before health or registration. Acknowledged settings do not repeat. Storage acknowledgement failure leaves the last exact unresolved intent.
- `runProvision(..., { stopAfterRegistration: true })` explicitly prepares a closed registered group without calling enable. Existing default enable behavior and production refusal remain unchanged.
- `scripts/group-provision-journal.mjs` supplies exclusive non-expiring local locking and synced atomic bigint checkpoints. Errors retain locks; no automatic unlock, restore or production transport is supplied.
- Focused setup/routing suite: 65 tests across seven files; journal: five tests; existing safe-deployment tests: six; 17-contract drift passes. This is local executor/contract evidence, not real all-domain installation or signed-in browser/native acceptance. Prior service-slice evidence is reused rather than rebuilt.

**Exact activation blocker:** `routerProvisionSteps.enableGroup` requires local-rehearsal account-authority composition; its production path intentionally refuses even with a callback. `wireVerifiedLocalAccountAuthorities` likewise refuses non-local targets. Club scope alone does not demonstrate account-wide identity/removal independence. No guard was weakened. A bounded separately approved design must establish that independence or finish the required safeguards before activation; whole-account/global-drain development remains paused.

Focused review: `docs/scaling-activation-boundary-review.md` confirms an independent backend authority gate and reachable self/admin deletion paths; closed preparation is separate but accepting new clubs is not yet proven independent. Next evidence is one bounded local contract rehearsal, not automatic resumption of global-drain development.

**Engineering still open:** governor-authenticated management transport, production installation arguments/environment and complete per-domain semantic health, shared-device worker integration, and actual all-domain install/configuration/read-back rehearsal. The configuration transport remains an explicit adapter boundary; stubbed control verification is not production permission. Missing local events/timer/router WASMs and PocketIC binary were not regenerated in this focused batch. Deployment access and real browser/Android/FCM sessions remain release prerequisites, not passing evidence.

Production activation remains blocked by `routerProvisionSteps`' local-only account-authority callback. The local exclusive journal and configuration composition now exist, but these changes do not supply a released authenticated management adapter, complete per-domain installation/semantic-health acceptance or semantic recovery transport.

The integrated rehearsal must verify full domain wiring, app reads/writes, notifications, club revocation and other-club continuity, and establish that paused account-erasure prototypes are outside the activated path. Local probes do not resolve that production dependency.

Before live provisioning: verify exact approved inventory, governor/controller access, pinned toolchain and modules, installation arguments, original PII key attestation, reciprocal domain/notification wiring, shared device directory and worker grants, funding and maintenance approval. Upgrades preserve data; never reinstall for recovery.

Actual restores remain unavailable without complete authenticated inventory, exclusive fencing and semantic permission/ownership/quota evidence. Raw hashes and mock booleans are not that evidence. Ambiguous external mutations remain stopped for exact operator reconciliation, not speculative automatic recovery.

Nothing deployed or activated; existing clubs stay put and encrypted-media moves remain prohibited. Signed-in browser/Android, real push, live upgrade compatibility and separate deployment/activation approval remain outstanding.
