# Ignite Club HQ Hybrid — Simplified scaling completion

## What changes

Finish scaling in four substantial batches, using working code and existing tests. Stop treating ordinary club removal as whole-account deletion. Removing someone from one club must deny future private access and uploads there, while their other clubs and remaining members continue normally.

This is a scope correction, not a claim that unfinished security is complete. Keep existing safeguards. Scaling stays off; this plan does not authorize live changes or deployment.

## Scope removed from the immediate work

- **Pause whole-account deletion expansion:** no further service-by-service global removal barriers, all-target personal-data purges or account-erasure recovery/capacity development in this scaling batch. Existing account deletion is unchanged, not declared safe or silently switched off.
- **No club moves for the initial rollout:** existing clubs stay put; new clubs receive group placement. Media-free moves are a later operational feature. Clubs holding encrypted media remain permanently excluded under the existing policy.
- **Defer optional infrastructure:** no new subnet or Cloud Engine setup, speculative compatibility implementation or extra infrastructure rehearsals. Retain existing boundaries for later separately approved activation.
- **No new general-purpose automatic recovery project:** reuse existing operator tools; actual restores remain blocked without complete, permission-preserving recovery evidence.
- **Stop repeated broad audits:** use focused tests for changed boundaries, then one integrated rehearsal. Do not map every unrelated account-erasure permission alternative again.

Deferred work is not completed work. Nothing that depends on its missing guarantees may be enabled by relabelling it optional.

## Four implementation batches

### 1. Club access and two-group app routing

Combine the essential permission checks with the remaining real app connections. Reuse the existing two-group and encrypted-photo setups.

**Acceptance:**
- Revoke membership in club A: deny new private-photo/key access, uploads and delegated club actions, including an action paused during revocation.
- Remaining members still work in A; the removed person still works in club B.
- Exercise actual affected app reads/writes across both groups with correct club, competition-host and personal ownership. Handle unavailable groups explicitly and keep paging bounded.
- Fix demonstrated gaps only; no automatic retry of non-idempotent writes or silent fallback.

Previously downloaded photos and issued keys cannot be recalled. Publicly published material is not private club access. Test both administrator removal and voluntary leaving when they use different authorization paths.

### 2. Multi-group notifications

Finish existing recipient, device and worker connections rather than introduce another delivery architecture.

**Acceptance:** correct group audiences/devices, explicit queued versus delivered results, supported retry deduplication, bounded polling and outage recovery. Revoked club membership must be checked before authorizing new private club delivery, including relevant claimed-but-not-yet-authorized work. Do not promise recall of sent notifications or atomic global account deletion. Only migrate legacy recipient identities where actual delivery paths require it.

### 3. New-group provisioning and operator readiness

Wire the existing provisioner and registry for complete new groups. Existing clubs remain on their current groups.

**Acceptance:** interrupted provisioning resumes without duplicate groups; incomplete groups never accept clubs; deployment boundaries and page limits remain enforced. Reuse upgrade/recovery evidence for the participating services. No restore may resurrect revoked permissions or corrupt ownership/quotas; unresolved recovery evidence keeps that operation unavailable. Do not expand transfer or snapshot automation merely to complete this rollout.

### 4. One integrated rehearsal, then separately approved release

Run the combined local flow: new club placement, two-group navigation, messages, encrypted upload/download, notifications, club revocation with other-club continuity, interruption and upgrade preservation. Run relevant broad regressions once.

Before live changes, verify actual production inventory, upgrade compatibility, funding, maintenance arrangements and a safe recovery procedure. Obtain separate deployment approval. After approved upgrades, check signed-in browser and real Android flows with disposable test data. Scaling activation remains a separate decision after the required gates pass.

## Efficiency and stop rules

- One bounded acceptance checklist per batch; reuse existing fixtures and source/toolchain-keyed compiled artifacts.
- Run changed-rule tests plus direct regressions. Compile touched services; refresh contracts only when interfaces change.
- Report completed batches and concrete blockers, not repeated small recovery increments.
- Add scope only for a demonstrated failure or an unavoidable release dependency; state why and propose the smallest fix.
- Keep existing admission, recovery, activation and photo-move guards. Do not delete or weaken them to match the shorter plan.

## Technical tracking and dependency gate

`roadmap.md` tracks batches 1–4. Prior plans and `docs/account-removal-release-gates.md` retain historical evidence and paused account-erasure limitations.

Before activation, establish from the actual call paths that deferred global identity/account-erasure features are not dependencies of the activated club-routing path. Existing cross-group account/admission prototypes remain local-only. If current activation requires unfinished all-service identity fences or removal recovery, leave activation off and report that specific dependency; this plan does not waive the gate. Any change to separate that dependency requires a focused implementation and regression evidence, not a documentation-only override.

Only the plan and tracking documents change now; no application changes, live tests or new passing-test claims are part of this review.