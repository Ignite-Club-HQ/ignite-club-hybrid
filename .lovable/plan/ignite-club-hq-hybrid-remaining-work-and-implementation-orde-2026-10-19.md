# Ignite Club HQ Hybrid — Remaining Work and Implementation Order

Prepared: 18 October 2026

## Goal and current position

Complete the Groups A/B/C scaling model: global discovery and placement, club-aware routing to independent data groups, automatic capacity expansion, and safe club transfers without data loss.

The existing scaling foundation, stable-media code, shared upload quota, routing helpers and several recovery cases have passed local tests. **The complete multi-group system is not finished or activated in production.** This plan does not deploy anything or change the running app.

## Recommended order

### 1. Establish the production baseline and rollout checklist

- Confirm the live canister inventory, versions, controllers, wiring, cycles, capacity and which previously tested upgrades actually reached production.
- Identify all media stores and their quota authority; prepare a complete backup and maintenance checklist.
- Check current balances before funding anything. Earlier warnings for timer_jobs and shard_router are not evidence of their current balances.
- Keep existing clubs on the legacy group and leave partial routing disabled.

**Completion gate:** a verified inventory, deployment prerequisites and a written rollback procedure. Read-only inventory can proceed first; production actions require the deployment identity and approval.

### 2. Finish media recovery safety

- Test a lost inter-canister confirmation after the quota authority has genuinely committed. Existing tests cover client acknowledgement loss and authority unavailability, not this failure.
- Implement and test recovery fencing: pause new writes, drain or reconcile pending operations, checkpoint every participant and resume only after consistency checks.
- Reject an incomplete recovery inventory or a restore of only one store against a newer quota ledger.

**Completion gate:** actual callback-loss testing and enforced recovery safeguards demonstrate readable ciphertext, preserved ownership and exactly one quota charge per committed upload.

### 3. Complete global discovery and group authorization

- Add authoritative, private account-to-club-group discovery, including linked accounts and paginated multi-club membership reads.
- Define ownership and group lookup for club, team, event, conversation, vault, personal and competition data.
- Replace single-canister trust assumptions with bounded, authorized group registries wherever necessary, including PII/vetKeys, rewards, competitions, deletion and notification services.
- Verify invitations, joining, role changes and revoked access across groups.
- Make group discovery and authorization deployment-aware for both mainnet and optional ICP Cloud Engines. A destination includes its approved engine/network, host and canister IDs; a canister ID alone is not a globally unique routing or trust key. Scope identity sessions, cached actors, media keys and persisted data to the deployment and account.

**Completion gate:** members discover all their clubs; each destination independently enforces access; revoked members are denied. Browser-provided destinations are never authority.

### 4. Finish bounded storage and wire every club feature

- Add the indexes and capped pagination needed for hot membership, messaging, event and other club-data paths before directing substantial traffic to them.
- Connect the tested routing helpers to real feature calls, in batches: club/team management; events/schedule/pitch board; messaging; vault/media/news; rewards/settings/admin and competition links.
- Aggregate multi-club results without dropped rows, duplicate sends or cross-club leakage. Keep personal/global data explicitly routed.
- Complete multi-group notifications, scheduled jobs, worker polling and account/club deletion fan-out.
- Preserve Supabase behavior and the approved ICP off-chain exceptions; do not introduce Supabase fallback to conceal missing ICP coverage.

**Completion gate:** feature and permission tests pass with at least two isolated data groups, including denials and unavailable-group cases. No partial production routing activation.

### 5. Implement safe club transfer and recovery

- Build a club-scoped, resumable transfer process: fence writes, export bounded pages, copy to the destination and verify manifests, counts, hashes and permissions.
- Include dependent records, media access, timers and notifications; account for cross-club and personal references without blindly copying shared records.
- Cut over the assignment only after verification. Ensure stale clients cannot keep writing to the old group.
- Test interruption, retries, destination failure, rollback and deletion of the old copy only after successful verification.
- Prepare an explicit Cloud Engine transfer path: verify supported export/import mechanisms, identity mapping and destination encryption/key access before moving data. Do not assume vetKeys keys or ciphertext are portable between deployments; where necessary, use authorized client-side decrypt/re-encrypt with verified destination read-back, never plaintext staging or canister-held decryption keys.

**Completion gate:** a populated test club moves between groups with no lost records, unreadable files, duplicate notifications or residual unauthorized access.

### 6. Complete automatic placement and provisioning

- Measure load, latency, peak heap, storage growth and cycles; use those results to set operational capacity thresholds.
- Automatically place new clubs into a healthy, eligible group while honoring residency and backend rules.
- Provision and fully wire another group when capacity requires it, with controller checks, funding safeguards, audit records and duplicate-provisioning protection.
- Support independent domain expansion where needed—for example, additional messaging capacity without unnecessarily duplicating every service.
- Build optional subnet-aware provisioning now, but keep cross-subnet expansion disabled until deliberately enabled by an authorized operator. Record each group's actual subnet and verified deployment target; do not assume that creating more canisters places them on another subnet.
- Keep frequently interacting services together where practical, while allowing additional groups or independently scaled domains on other eligible subnets. Routing and authorization must use verified canister identities, not assume every service shares a subnet.
- Honor existing country/backend eligibility rules; subnet placement alone must never be represented as a country-residency guarantee.
- Extend the existing approved Cloud Engine targets to support complete scaling groups and independent domain capacity within an engine. Keep provisioning, health, controller checks and funding/capacity management target-specific; validate the engine's actual supported APIs and operational model before implementing an adapter.
- Treat mainnet subnets and separate Cloud Engines as distinct deployment cases. Verify native inter-canister connectivity and trust between intended destinations rather than assuming cross-engine calls work like cross-subnet mainnet calls. If connectivity is unsupported, keep tightly coupled authorities, services, quotas and media within the same engine; any required cross-engine coordination needs a separately reviewed authenticated design, not a silent off-chain fallback.
- Preserve the rule that an engine-assigned country never silently falls back to public mainnet or Supabase. Global discovery must respect the engine's residency boundary and expose only permitted metadata; replicate or deploy engine-local discovery/identity authorities where needed rather than require private membership data to leave the engine.
- Never mark an incomplete or unhealthy group eligible for clubs.

**Completion gate:** load tests trigger one correctly configured expansion, place new clubs safely and demonstrate capacity protection when provisioning fails.

### 7. Rehearse the complete rollout locally

- Run the integrated multi-group, migration, recovery and authorization suites—not just isolated helpers.
- Exercise busy clubs, multiple memberships, maximum permitted uploads, simultaneous retries, scheduled delivery and interrupted transfers.
- Validate upgrade compatibility against the identified live versions and rehearse the full operator procedure with snapshots and rollback.
- Test cross-subnet behavior: delayed or lost confirmations, unavailable destinations, idempotent retries, permissions and revocation, notifications, encrypted media access and interrupted club transfers. Local simulations prepare the behavior; they do not prove actual cross-subnet performance.
- Add Cloud Engine compatibility tests for target isolation, supported authentication and delegation, certified responses and trusted root-key configuration, missing capabilities, unavailable engines, no unauthorized fallback, local notifications/quota/PII authority and encrypted-media transfer. Verify vetKD availability, key configuration, timers, snapshots, HTTP serving and push-worker connectivity on the actual engine; source compatibility is not proof of engine support.

**Completion gate:** all relevant regressions pass and every planned production action has a tested stop/rollback point.

### 8. Deploy safely and verify on mainnet and native apps

- Arrange the maintenance window, deployment identity, complete inventory and Internet Identity test session.
- Upgrade with data-preserving migrations; never reinstall to bypass an upgrade failure.
- Activate media quota/storage only through the verified fenced procedure. This can be a separate release from multi-group routing once its own gates pass.
- Deploy the complete group system behind inactive placement, verify a controlled test club, then gradually admit new clubs. Keep existing clubs assigned to the legacy group until deliberately transferred.
- Publish the matching frontend and rebuild native apps. Verify creation, multi-club navigation, send/reopen, uploads/downloads, push delivery, role revocation and transfer recovery on web, Android and iOS where supported.
- Include the outstanding real-device photo-send check: one confirmed message after leaving and reopening the thread.

**Completion gate:** authenticated mainnet and device checks pass; monitor capacity, latency, errors and cycles before expanding use. Local tests alone do not satisfy this gate.

#### Optional later activation: expansion onto additional subnets

- Leave this capability off during the initial scaling rollout. Capacity alerts may recommend expansion, but must not silently enable it or move existing clubs.
- When needed, an authorized operator selects an eligible subnet/deployment target, confirms funding and provisions a fully wired test group there.
- Verify the actual subnet assignment and run authenticated checks across real distinct subnets, measuring latency, error recovery and cycles before admitting clubs.
- Enable new-club placement gradually only after those checks pass. Moving an existing club uses the same fenced, verified transfer procedure in step 5—not a routing toggle or an assumption that its existing canister can simply change subnets.
- If validation fails, keep the new group ineligible and retain existing assignments; use the tested recovery process for any transfer already underway.

**Activation gate:** real cross-subnet checks pass, the group is healthy and fully authorized, and the operator explicitly enables placement. No cross-subnet production activation is requested by this plan update.

#### Optional later activation: ICP Cloud Engines

- Build engine-compatible routing and provisioning boundaries as part of the scaling foundation, but keep new engine scaling deployments disabled until needed and explicitly approved. Do not disable existing approved engine routing.
- Before activation, document the selected engine's host, trust root, identity/delegation support, canister APIs, vetKD/key support, storage limits, recovery facilities, notification delivery and operating costs. Unsupported security-critical capabilities block activation; they must not be bypassed.
- Provision a complete isolated test group on the selected engine and verify authenticated creation, discovery, permissions/revocation, messages, encrypted uploads/downloads, timers, notifications and recovery on web and native apps.
- Verify cross-deployment interaction only where the engine actually supports it. Otherwise keep dependent services engine-local and explicitly constrain or separately design cross-engine club interactions and global discovery.
- Start with new test clubs; migrate existing clubs only through the verified transfer/key-access procedure in step 5. Confirm residency requirements against the actual engine configuration rather than treating the Cloud Engine name as a guarantee.
- Activate placement gradually after compatibility, security, performance and recovery checks pass; retain existing assignments on failure.

**Activation gate:** the selected engine supports every required feature or an explicitly reviewed compatible design, live engine checks pass, and an authorized operator approves activation. This plan prepares Cloud Engine integration; it does not claim it is already implemented or verified, create an engine or authorize production migration.

#### Optional add-on (kept on record, not scheduled): moving photo-heavy clubs

- Owner decision (19 October 2026): existing clubs holding photos are never moved between groups; the `mediaTransferSafety` fail-closed gate is the policy. This add-on does NOT reopen that work now and is not part of the current rollout.
- Purpose of this note: preserve the knowledge so the capability is not lost. If ever wanted, it is an explicitly approved, separately scoped add-on: verified key-carrying transfers or client-side decrypt/re-encrypt with provenance attestation, per-file permission continuity, and a signed-in/native encrypted-move acceptance run — all previously designed and locally rehearsed.
- Escape hatch without code: members re-uploading their media makes any club movable today under the existing gate.
- Any future activation requires a new owner-approved plan, the production evidence readers connected to the operator tool, and all current gates passing. Never relax the fail-closed gate to make a move pass.

### 9. Finish ChatGPT / MCP / OQL live verification

This is a separate track: it does not need to wait for automatic group provisioning. It can follow the inventory check and its own safe deployment review.

- Confirm which OQL, inbox-ownership and discovery changes are already live; upgrade events_domain, club_domain and any other required components only where needed.
- Confirm operator terms before publishing the discovery manifest.
- Verify deployed Candid metadata, discovery and Internet Identity delegation through a real ChatGPT/MCP connection.
- Test “Show me all upcoming events for my club,” linked-account access, ordinary-member visibility and revoked-member denial.
- Before enabling multi-group routing, extend and test OQL discovery/routing for all assigned groups without widening access or returning misleading partial results.

**Completion gate:** successful live authorized queries and denied unauthorized queries. Do not claim ChatGPT compatibility from source changes alone.

## Technical dependencies and tracking

- Roadmap item 24: steps 2, 7 and 8 — recovery and production verification.
- Roadmap item 20: steps 3–7 — discovery, permissions, complete routing, indexing, transfers, placement and provisioning.
- Roadmap item 21: step 8 — production scaling upgrades and authenticated checks.
- Roadmap item 16: step 8 — frontend/native release and photo-send verification.
- Roadmap item 7: step 9 — live MCP/OQL deployment and connection verification.
- Roadmap item 12: step 1 — reassess funding needs rather than reuse old warnings.

Existing references: `roadmap.md`, `docs/ICP_SCALING.md`, and `docs/integrations/icp-mcp-oql.md`.

## What requires your involvement

Local implementation and isolated tests can proceed without a production change. Production deployment, recovery rehearsal on live data and activation require the authorized deployment identity, a complete inventory and an agreed maintenance window. Authenticated mainnet/native and ChatGPT verification also require the appropriate Internet Identity session, devices and connection approval.

## Immediate next task

Start with the read-only inventory, then finish the real inter-canister callback-loss test and recovery fencing. These close the remaining data-safety gap before expanding the routing and migration work.