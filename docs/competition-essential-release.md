# Competition essential release — 24 October 2026

## Approved scope

Release existing competition changes, check signed-in behaviour in both groups, and address account-removal privacy. Full-state exports and historical recovery expansion are deferred. No broader deployment, migration, fuel purchase or replay of unknown deliveries is authorized by this scope.

## Bounded privacy result

- `accountData.ts` previously committed identity erasure even after a personal-content purge failed. It now throws before identity commit/settlement and retains the caller identity and bound reservation for cleanup retries. Successful purges in other services and revoked memberships are not rolled back.
- Competition sender/official fields have cleanup, but `club_domain.broadcastRelayReceipts` and `notification_queue.competitionBroadcastAudiences` can still retain person-linked identifiers. The frontend account deletion path does not coordinate cleanup of these records. This is not certified complete erasure.
- Never delete or rewrite frozen audience proof independently: processing/unknown deliveries and cross-service reconciliation rely on the original evidence. A complete fix requires coordinated settlement-aware anonymization; removing shared club records or claiming erased delivery evidence would be unsafe.
- Account-deletion regression checks: three focused files, ICP 22 passed/17 skipped; Supabase 31 passed/8 skipped. Preview build OK. These are local results, not live erasure acceptance.

## Release findings

Paul's GitHub API returned 37 hybrid Actions and two repository secret names: `DEPLOYER_PEM` and `ICP_PUSH_WORKER_SEED`. Values were not read. Organization/environment secrets were not inventoried, so email credential availability there is unknown.

The existing Group 2 competition workflow validates exactly competition/events. It cannot release club and notification changes. The closed Group 2 workflow upgrades thirteen services and is too broad. The subscription workflow includes photo stores, which are outside this competition release. None was dispatched.

Required exact release scope: pinned router additive public metadata update plus existing Group 1/2 competition, club, events and notification services, with stable-memory preservation, original photo-authority/wiring checks, durable per-target acknowledgements and verified routing snapshot refresh. A coordinated runner for that complete scope remains unfinished; do not substitute a broad workflow or release the app against unavailable methods.

## Acceptance and external prerequisites

- After compatible upgrades/app release: signed-in fixtures/event navigation, welcome/report visibility, broadcast readback, season clone and rollover in both groups. No signed-in Internet Identity session was available during this check; private flows are unverified.
- Email only: trusted worker, encryption keys, Resend credential, verified sender and exact queue configuration; confirm provider acceptance and delivery. Do not send merely to test configuration or retry unknown outcomes.
- No mainnet upgrades, app publication, email dispatch or production account deletion occurred in this batch.