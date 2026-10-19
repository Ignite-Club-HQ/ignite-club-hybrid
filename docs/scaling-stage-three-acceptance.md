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

Production activation remains blocked by `routerProvisionSteps`' local-only account-authority callback. These changes do not supply a released authenticated management adapter, exclusive durable operator journal, complete per-domain install/configuration/health composition or semantic recovery transport.

The integrated rehearsal must verify full domain wiring, app reads/writes, notifications, club revocation and other-club continuity, and establish that paused account-erasure prototypes are outside the activated path. Local probes do not resolve that production dependency.

Before live provisioning: verify exact approved inventory, governor/controller access, pinned toolchain and modules, installation arguments, original PII key attestation, reciprocal domain/notification wiring, shared device directory and worker grants, funding and maintenance approval. Upgrades preserve data; never reinstall for recovery.

Actual restores remain unavailable without complete authenticated inventory, exclusive fencing and semantic permission/ownership/quota evidence. Raw hashes and mock booleans are not that evidence. Ambiguous external mutations remain stopped for exact operator reconciliation, not speculative automatic recovery.

Nothing deployed or activated; existing clubs stay put and encrypted-media moves remain prohibited. Signed-in browser/Android, real push, live upgrade compatibility and separate deployment/activation approval remain outstanding.
