# Safe transfer of GitHub secrets and Actions to prod

## Scope
**We are adding to `Ignite-Club-HQ/ignite-club-hq-prod` only. Nothing is being removed or overwritten from that repository: no existing secrets, variables, files, workflows, branches or settings. Any collision is skipped and reported, never replaced. `Ignite-Club-HQ/ignite-club-hybrid` remains unchanged.**

**Copy only, from `Ignite-Club-HQ/ignite-club-hybrid` to `Ignite-Club-HQ/ignite-club-hq-prod`**, before the later app merge. Hybrid remains unchanged: no source commits, secret/variable edits, workflow edits, deletions or disabling jobs. Add only missing approved destination secrets, variables and inactive workflow setup. Never transfer prod’s setup back into hybrid. Do not replace prod’s main branch, merge the app, change Supabase/Lovable/Codemagic settings, deploy canisters, change controllers or fund services.

## 1. Read-only inventory first
- Verify `Ignite-Club-HQ/ignite-club-hybrid` as the source and `Ignite-Club-HQ/ignite-club-hq-prod` as the destination, plus access, default branches and current commit IDs through the connected GitHub account. Stop if either exact repository cannot be verified.
- Inventory repository and relevant environment/organization secret **names**, variables, workflow files, active schedules, running jobs and branch protections. Never read or print secret values.
- Produce a missing/conflicting/identical report. An existing destination secret with the same name is **not** proof of an identical value; leave it untouched and flag any deploy identity or canister-target ambiguity as an activation blocker.
- Capture a recoverable baseline of destination workflow files and readable settings without exporting secrets.

## 2. Prepare a copy-only execution path without changing hybrid
- Make this transfer strictly **add-only**: no overwrite option, deletion, force-push or app-source copy. Pin both exact repository names and the reviewed hybrid source commit; refuse reversed or different repositories.
- Fail closed on permission errors, incomplete inventories or unexpected destination changes; never interpret an unsuccessful lookup as “missing”.
- Add a read-only preview and an explicit approved inventory of names/files to copy. Transfer only approved missing items, not every source variable blindly.
- Check whether hybrid already has `TARGET_REPO_PAT`, without changing it. The existing runner requires this token and copies active workflows directly; do **not** dispatch it unchanged under this plan. Do not add a token or patch the runner in hybrid.
- Prepare and test a separate destination-only/API copy path for variables and inactive workflow files. Any helper changes belong outside hybrid; inspect destination triggers before creating a staging branch, and defer branch/PR creation if existing automation would run unexpectedly.
- GitHub cannot return source secret values. The existing hybrid runner exposes only `DEPLOYER_PEM`, `ICP_PUSH_WORKER_SEED` and `FCM_SERVICE_ACCOUNT_JSON`, and its extra-name field does not expose other values. Because it cannot currently provide the required safe copy without source edits, securely supply original values from the owner's existing credential store into the destination-only copy path. If unavailable, mark those secrets blocked rather than modify hybrid or invent replacements. Never paste values into chat. Preserve the deploy identity and push-worker seed exactly.
- Do not copy the migration credential into prod. Environment and organization secrets require separate scope-aware handling; report unsupported items rather than claiming a complete transfer.

## 3. Stage workflows without activating them
- Stage the approved workflow files and their dependency inventory in a dedicated destination branch and reviewable pull request, not directly on prod’s main branch.
- Keep staged workflow definitions outside `.github/workflows` so copying cannot start schedules, push-triggered deployments or pull-request jobs.
- Preserve every existing destination file. Report path/name conflicts for later review; do not rename into active workflows as a workaround.
- Record required scripts, source folders, mappings and configuration. Workflows remain inactive until the later app merge supplies and verifies those dependencies.
- Do not copy source canister IDs or target settings over existing prod values. Any mismatch blocks activation pending review.

## 4. Transfer and verify
- After the preview is approved and credential prerequisites are satisfied, run only the verified destination-only copy path with the exact repositories and approved add-only inventory.
- Copy only missing approved secrets and variables, then stage the inactive workflow bundle. Record each created, skipped, failed or blocked item without secret values.
- Verify readback of names, variable values and staged file hashes; confirm hybrid’s commit, existing settings and workflow states are unchanged, and prod’s main commit, existing files/settings and active workflow states are unchanged. Run history may record read-only inspections, but no hybrid configuration or code is changed.
- GitHub cannot reveal secret values for comparison. Report secret creation acceptance, not verified credential equivalence; prove deploy identity later through a non-mutating principal check before permitting deployment.
- If interrupted, resume by re-inventorying and reconciling the recorded writes, without overwriting or deleting anything. Report partial completion accurately.
- Revoke only a temporary credential created separately for this copy after completion or abandonment; do not remove or rotate any existing hybrid credential.

## 5. Separate activation approval later
After the app merge and dependency checks, propose activation separately. Confirm exact live canister mappings, controller identity, routing snapshots and service targets using read-only checks; no test deploy or fuel purchase is required to prove the transfer.

Keep hybrid’s workers running and unchanged throughout this copy. Destination automation remains inactive. A later cutover would require separate explicit permission to change hybrid, plus a verified single-worker/single-deploy-owner handover; it is not authorized by this copy plan.

## Technical safeguards and tests
- Add focused tests for destination pinning, strict add-only behavior, pagination, fail-closed lookups, collision handling, source/destination commit drift, inactive staging and interruption reconciliation.
- Validate generated YAML and dependency manifests; run the migration tool’s focused tests before dispatch.
- Include updated transfer instructions with the destination staging bundle; do not commit documentation changes to hybrid. Treat the older merge document's inventory as historical, not current authority.

## Result
**Additions to prod only; nothing removed or overwritten in prod; hybrid unchanged.** Prod gains only approved missing credentials and an inactive, reviewable automation bundle. Prod's existing secrets, variables, files, workflows, branches, settings and running services are preserved. Missing original secret values are explicit blockers. App replacement, source changes and automation activation remain separate approvals.