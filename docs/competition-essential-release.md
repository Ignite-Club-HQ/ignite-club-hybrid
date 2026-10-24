# Competition essential release — 24 October 2026

## Approved scope

Release existing competition changes, check signed-in behaviour in both groups, and address account-removal privacy. Full-state exports and historical recovery expansion are deferred. No broader deployment, migration, fuel purchase or replay of unknown deliveries is authorized by this scope.

## Bounded privacy result

- `accountData.ts` previously committed identity erasure even after a personal-content purge failed. It now throws before identity commit/settlement and retains the caller identity and bound reservation for cleanup retries. Successful purges in other services and revoked memberships are not rolled back.
- Self-deletion now captures notification queues, resolves aliases through each configured identity authority, installs durable broadcast-only fences, checks complete frozen competition plans, retires exact queue audience evidence through the original club relay, removes relay identifiers, and purges the account's queue/device records before identity commit.
- Processing deliveries, unknown relay counts and incomplete/missing competition plans refuse cleanup. Terminal relay/queue markers prevent resend/reconciliation replay; permanent subject fences prevent a suspended callback or alias from recreating broadcast work. Security denial tombstones retain principals intentionally; this is not a promise to remove every identifier from security history or arbitrary text.
- Disposable canister checks pass: processing refusal, exact retirement, alias inbox cleanup, unrelated recipients retained, lost/duplicate cleanup retries and upgrade replay barriers. Concrete settlement-predicate tests pass. Three focused app files: ICP 23 passed/17 skipped; Supabase 32 passed/8 skipped. Eighteen upgrade/journal checks and 17-contract Candid drift/ICP guards pass; preview build OK. No live erasure acceptance.
- Admin account removal remains access/identity removal, not a personal-content-erasure promise. Historical unknown operations remain blocked; no evidence is reconstructed.

## Release findings

Paul's GitHub API returned 37 hybrid Actions and two repository secret names: `DEPLOYER_PEM` and `ICP_PUSH_WORKER_SEED`. Values were not read. Organization/environment secrets were not inventoried, so email credential availability there is unknown.

The existing Group 2 competition workflow validates exactly competition/events. It cannot release club and notification changes. The closed Group 2 workflow upgrades thirteen services and is too broad. The subscription workflow includes photo stores, which are outside this competition release. None was dispatched.

The new **Upgrade competitions (both ICP groups)** workflow builds only notification_queue, club_domain, events_domain and competition_domain. Its dedicated runner validates exactly eight existing targets, registered placements, sole governor/subnets/fuel, original authority wiring and both photo-key receipts. Wiring and relevant management settings are journal-bound; ambiguous upgrades do not replay. It never creates, funds, rewires or opens groups.

Run `check` first. Upgrade confirmation: `UPGRADE BOTH GROUPS COMPETITION`. Keep the router additive public metadata API as a separate pinned `router` upgrade through the existing mainnet workflow, before the eight-target release; do not change router configuration mid-journal. Missing reciprocal grants or identity service-reader access fail closed and need an exact approved configuration repair, not implicit setters.

After successful upgrade readback, the workflow refreshes the verified routing snapshot and only matching G2 service fingerprints. Release the compatible app only after this completes. Existing History/subscription/thirteen-service workflows remain unchanged.

Local reproduction:
1. Build club_domain using its own Mops configuration; build competition_domain and notification_queue using the root configuration.
2. Compile `frontend/scripts/broadcast-erasure-identity.mo` only as a disposable test authority, never deploy it.
3. Run `frontend/scripts/test-broadcast-erasure-replica.mjs` with `BROADCAST_IDENTITY_WASM`, `CLUB_DOMAIN_WASM`, `COMPETITION_DOMAIN_WASM`, `NOTIFICATION_QUEUE_WASM` and `POCKET_IC_BIN` pointing to those local artifacts.

## Acceptance and external prerequisites

- After compatible upgrades/app release: signed-in fixtures/event navigation, welcome/report visibility, broadcast readback, season clone and rollover in both groups. No signed-in Internet Identity session was available during this check; private flows are unverified.
- Email only: trusted worker, encryption keys, Resend credential, verified sender and exact queue configuration; confirm provider acceptance and delivery. Do not send merely to test configuration or retry unknown outcomes.
- No mainnet upgrades, app publication, email dispatch or production account deletion occurred in this batch.