# Ignite Club HQ Hybrid — Credit-efficient scaling completion

> Superseded execution scope: the owner's 19 October 2026, 08:50 UTC review replaces A–F with the simplified plan and roadmap batches 1–4. Expanded whole-account deletion is paused, not complete. Preserve the historical evidence and existing safety gates below; do not resume this older execution order automatically.

## Outcome and boundaries

Finish the remaining local implementation and checks in substantial, focused batches. Preserve working code and existing test evidence rather than restarting the scaling project.

Scaling is still off. Account admission and cross-group account changes stay local-only. This plan does **not** authorize deployment, changes to live data, production admission flags or scaling activation. Live release is a separate approval after the local gates pass.

Clubs holding encrypted media are never moved. Keep the existing refusal gate; no re-encryption or photo-move work is scheduled. Extra subnets and new Cloud Engine deployments remain optional and disabled pending separate approval and real capability checks.

## How work stays efficient

- Use the existing roadmap, permission review and test setups; one bounded coverage matrix replaces repeated broad audits.
- Inspect only unresolved paths and direct dependants. Parallelize independent implementation only where it saves work; avoid overlapping investigations.
- Complete each related batch in one sweep: implement demonstrated gaps, add focused tests, verify, then update its status and remaining blockers.
- Per batch, run changed-rule tests and direct regressions, compile only touched canisters, and regenerate/check contracts only for interface changes. Reuse compiled artifacts when source, dependencies and toolchain are unchanged.
- Run the broad regression/integrated rehearsal once after all local batches, unless a concrete shared-boundary change requires it earlier. Do not repeat unchanged suites for reassurance.
- Require actual held callbacks, admitted positive controls and concrete read-back/no-partial-effect checks. Mocks, source counts and failed calls alone are not acceptance.
- Stop on a demonstrated external blocker and identify it precisely; do not call unfinished engineering a credential blocker. Report milestones, not incremental narration.

## Implementation order and completion gates

### A. Finish permission coverage

Reuse the delayed-authority fixture and twelve-service rehearsal. Cover the outstanding interrupted single/batch/discovery reads, private-key issuance, changed resource fences/authorities, and trusted-service delegated calls. Map each protected entry point and permission alternative to existing or new evidence; keep public ciphertext and infrastructure maintenance intentionally separate.

**Done when:** all protected alternatives have mapped coverage; suspended/erased/replaced users and stale authorities are denied, admitted users and legitimate delegates still succeed, and rejected mutations leave no partial records/reservations. This closes permission coverage, not global removal atomicity.

### B. Complete removal across every group

Build on existing durable denials and recovery receipts. Add server-verified complete service/group/media inventory, globally bound removal generations, admission fences and in-flight drain acknowledgements. Include pending writes, key requests, queued delivery and stale role mirrors. Preserve surviving identities and denial history through upgrades, restore, replay and history-capacity limits.

Current local progress: server-side group/media inventory, durable identity preparation and persistent PII/blob/club/vault receivers are implemented. Exact fences and original-human operation counters survive retries/upgrades; actual held photo-key requests report nonzero drain until denial settles. Identity directly reads bound receiver receipts; two real stores remain fenced through actual management snapshot reload, and local pending uploads cannot publish. Focused identity, registry/photo/delegated regressions and contract checks pass. **B is not complete:** extend the protocol to every remaining inventoried service, cover already-claimed notification/shared-quota settlement, add all-target completion/personal-data purge and verify history-complete coordinated recovery/capacity. The owner's requested live removal test follows these safety gates with attested production inventory, an authorized upgrade and a disposable signed-in account; do not use production rehearsal flags as a shortcut.

**Done when:** a restarted, unacknowledged group already denies private reads, writes, delegated access and key issuance **before** unlink retry; outages, lost acknowledgements and concurrent retries cannot falsely complete removal. Full inventories are mandatory, never sampled. Already downloaded plaintext, issued keys and delivered notifications cannot be recalled.

### C. Connect the app without changing production behavior

Connect compatible protected reads under local rehearsal, then close the remaining feature-routing gaps using existing club/team/entity/host scopes. Preserve equivalent single, batch and discovery results, personal/shared ownership, and Supabase behavior. Close legacy private-query bypasses; do not introduce silent fallback or enable prototype admission in the live UI.

**Done when:** focused two-group tests verify the affected real app call paths, mixed memberships, denied/unavailable groups, resource ownership and single-attempt writes. Source counts alone do not close this gate.

### D. Complete multi-group notifications

Reuse existing routed fan-out and worker machinery. Finish device registration and canonical recipient mapping, fair bounded polling, unavailable-versus-denied results and delegated audiences. Tie already-claimed delivery to B's removal/drain barrier; keep worker/service identities distinct from human eligibility.

**Done when:** two-group tests demonstrate correct devices/audiences, no duplicate sends on supported retries, fairness, outage recovery and no new delivery authorized after removal completion. Queued counts are not delivered counts.

### E. Finish provisioning, loading and recovery

Reuse the provisioner, registry, indexed paging and durable recovery tools. Close only missing complete-group wiring, remaining hot-path indexes/page bounds, quota confirmation loss after a genuine authority commit, and whole-inventory semantic recovery evidence. Exercise media-free transfer safety only; encrypted-media clubs remain immovable.

Prepare optional subnet/Cloud Engine boundaries and capability rejection locally, not new infrastructure. Actual engine behavior, residency, vetKD and cross-deployment connectivity require a selected engine and verified support; no invented proxy or fallback.

**Done when:** a populated local group is provisioned once despite interruption, incomplete groups never accept clubs, paging remains bounded, and coordinated restore preserves decoded ownership/quotas/journals before explicit authority-first resume. Hashes alone do not prove semantic consistency or continuous exclusive fencing.

### F. Validate once, then release separately

Run one combined local rehearsal of A–E plus relevant broad regressions. Reuse existing fixtures and compiled services; include positive/negative controls, upgrade preservation, outages, recovery, removal and media-free transfer. Record evidence and unresolved gates explicitly.

After local completion, prepare the current live inventory, upgrade compatibility, funding/wiring checks and rollback checklist. Request separate deployment approval and maintenance arrangements. Following approved upgrades, verify signed-in browser and Android flows: creation, multi-club navigation, messages/reopening, encrypted upload/download, notifications and removal. Native results require a real device/build; local or signed-out checks do not substitute.

**Done when:** local integrated checks pass, then approved live/device checks pass before any separate scaling activation decision. No partial activation.

## External prerequisites — only at the relevant gate

- Live deployment/recovery: authorized governor workflow, current complete inventory, funding where required, maintenance window and verified controller fencing.
- Signed-in acceptance: usable Internet Identity sessions and Android build/device access. Do not request passwords or private keys.
- Optional real subnet/Cloud Engine validation: explicitly selected target, verified capabilities/trust configuration and owner-approved activation; no engine is currently assumed available.

Local A–E implementation is not waiting on these prerequisites. The first implementation batch after approval is **A**, followed by **B**; none of these remaining gates is claimed complete by this plan update.

## Technical tracking

`roadmap.md` holds the current A–F execution checklist; `docs/account-removal-release-gates.md` retains detailed permission/removal evidence and limitations. Older plans are historical context: this plan supersedes their execution order and any encrypted-media transfer instructions, but does not discard existing evidence or unrelated MCP/native tasks.