# Remaining scaling work — Ignite Club HQ Hybrid

## Current position

The 70% preparation-request and 80% fill-first placement foundations are implemented and locally tested. The scheduled workflow queues a **closed preparation request only**; it does not create canisters or open groups. Scaling remains off. No mainnet deployment or live opening has been verified.

Existing clubs stay in their assigned group. Clubs with encrypted media must never be moved; re-encryption work is excluded. Low cycles require funding, not automatic rollover.

## Remaining implementation batches

### 1. Complete capacity measurement and closed-group automation
- [ ] Build an authenticated, complete capacity collector covering each required service's tested usable storage and processing limits. Establish missing processing budgets through load tests; do not substitute ICP headline memory limits or invent evidence.
- [ ] Wire those complete measurements into the router and scheduled preparation workflow, with deployment binding, freshness and fail-closed checks.
- [ ] Add the production create/install adapter and workflow: consume a 70% preparation request, create one new group, install its full service inventory and persist exact intents/receipts for interrupted retries.
- [ ] Compose creation with the existing signed configuration transport, then verify mainnet controller access, environment/settings, cycles, health and business read-back. Keep the group closed and avoid duplicate creation after lost replies.
- [ ] Verify the complete sequence and threshold boundaries: no preparation below 70%; one closed preparation at 70%; current-group placement below 80%; rollover at 80% only to an approved, ready, healthy group. Block creation if none qualifies; never change existing assignments.

**Blockers:** complete authenticated measurements, tested processing budgets and the production create/install adapter are unfinished engineering. Mainnet execution requires the stored GitHub deploy identity; do not request its key in chat.

### 2. Close the actual release-path access prerequisites
- [ ] Review the activated path against the existing full-service inventory/admission/drain and identity-authority gates; resolve demonstrated dependencies in one bounded integrated batch, not repeated speculative removal expansions.
- [ ] Complete any required protected-read, delegated-call and post-await/fence compatibility coverage. Preserve removed-club denial and access to the person's other clubs.
- [ ] Prove deferred global-account lifecycle/recovery features are outside the activated path, or report the exact dependency and obtain approval for the bounded resolution. Do not bypass local-only admission/authority gates.
- [ ] Validate interruption recovery against the full production inventory before any restore or resume. Existing local cancellation, timing and club/vault/events/chat/media drain evidence is not exhaustive global revocation proof.

**Policy:** expanded whole-account/global-drain development remains paused unless a necessary release dependency is identified and explicitly approved. Local-only account admission cannot be silently enabled.

### 3. Approved mainnet deployment and real acceptance
- [ ] Run the approved mainnet upgrade through GitHub's stored deploy key, preserving canister state and reasserting the independent deletion-timing release setting after upgrade.
- [ ] Verify live health and deletion-timing release read-back; separately run new-group installation/configuration while it remains closed.
- [ ] Run signed-in two-group browser and Android flows: new-club placement, club removal, chats, encrypted photos, existing/pending/new uploads, delegated access and retained other-club access.
- [ ] Verify grouped inbox audiences and real FCM/device delivery; local stubbed sends are not delivery acceptance.
- [ ] Complete any required mainnet media/quota and interruption acceptance with complete inventory and an agreed maintenance window.

**External prerequisites:** GitHub workflow access/deploy identity, installed group provision record, `PUSH_WORKER_PRINCIPAL`, authenticated browser/device sessions and real push delivery configuration. No live acceptance is currently established.

### 4. Separately approved opening and rollover
- [ ] After all required evidence passes, obtain the owner's explicit decision to release the local-only access gates and open the prepared group.
- [ ] Enable complete routing only; verify persisted assignments and fail-closed behavior with unavailable, stale, underfunded or unapproved groups.
- [ ] Confirm live fill-first rollover at the 80% tested-capacity threshold without moving existing clubs. Retain approval for opening even when closed preparation becomes automatic.

## Separate or deferred work

- Optional extra subnets and ICP Cloud Engine remain disabled until capability checks and explicit activation approval.
- Encrypted-media club moves and re-encryption are excluded permanently by owner policy.
- A voluntary leave-club flow is a separate product decision, not a substitute for account deletion or a prerequisite to invent here.
- Top up low-cycle services through the existing funding workflow using fresh balances; earlier balance readings are historical, not current evidence.

## Technical references and verification

Use `roadmap.md` and the acceptance documents for detailed historical evidence, not older superseded placement rules. Primary references: `docs/scaling-capacity-policy.md`, `docs/scaling-deletion-timing-acceptance.md`, `docs/scaling-complete-group-acceptance.md`, `docs/scaling-stage-one-acceptance.md` through `docs/scaling-stage-four-acceptance.md`, `docs/account-removal-release-gates.md`, and `docs/icp-deployment-runbook.md`.

Run concrete threshold tests and directly affected regressions per substantial batch, then one integrated rehearsal and the approved live acceptance. Record observed results and blockers in the roadmap. Saving this plan does not authorize deployment, activation or removal of safeguards.