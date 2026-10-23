# Safe transfer of GitHub secrets and Actions to prod

## Scope
Prepare `Ignite-Club-HQ/ignite-club-hq-prod` before the later app merge. Copy missing GitHub repository secrets, variables and workflow setup only. Do not replace prod’s main branch, merge the app, change Supabase/Lovable/Codemagic settings, deploy canisters, change controllers, fund services or stop current production automation.

## 1. Read-only inventory first
- Verify the source and destination repositories, access, default branches and current commit IDs through the connected GitHub account.
- Inventory repository and relevant environment/organization secret **names**, variables, workflow files, active schedules, running jobs and branch protections. Never read or print secret values.
- Produce a missing/conflicting/identical report. An existing destination secret with the same name is **not** proof of an identical value; leave it untouched and flag any deploy identity or canister-target ambiguity as an activation blocker.
- Capture a recoverable baseline of destination workflow files and readable settings without exporting secrets.

## 2. Harden the one-click tool before running it
- Make this transfer strictly **add-only**: no overwrite option, deletion, force-push or app-source copy. Pin the exact destination and reviewed source commit.
- Fail closed on permission errors, incomplete inventories or unexpected destination changes; never interpret an unsuccessful lookup as “missing”.
- Add a read-only preview and an explicit approved inventory of names/files to copy. Transfer only approved missing items, not every source variable blindly.
- Use a temporary, minimally scoped `TARGET_REPO_PAT` in the source repository through secure GitHub secret entry. The connected GitHub API can inspect and dispatch the workflow, but the current runner still requires this token; no token goes into chat or committed files.
- Explicitly wire every approved source secret into the runner. The current workflow wires only `DEPLOYER_PEM`, `ICP_PUSH_WORKER_SEED` and `FCM_SERVICE_ACCOUNT_JSON`; its extra-name field alone cannot expose other secrets. Preserve the existing deploy identity and push-worker seed exactly.
- Do not copy the migration credential into prod. Environment and organization secrets require separate scope-aware handling; report any unsupported items rather than claiming a complete transfer.

## 3. Stage workflows without activating them
- Stage the approved workflow files and their dependency inventory in a dedicated destination branch and reviewable pull request, not directly on prod’s main branch.
- Keep staged workflow definitions outside `.github/workflows` so copying cannot start schedules, push-triggered deployments or pull-request jobs.
- Preserve every existing destination file. Report path/name conflicts for later review; do not rename into active workflows as a workaround.
- Record required scripts, source folders, mappings and configuration. Workflows remain inactive until the later app merge supplies and verifies those dependencies.
- Do not copy source canister IDs or target settings over existing prod values. Any mismatch blocks activation pending review.

## 4. Transfer and verify
- After the preview is approved, run the protected workflow with the exact destination and approved add-only inventory.
- Copy only missing approved secrets and variables, then stage the inactive workflow bundle. Record each created, skipped, failed or blocked item without secret values.
- Verify readback of names, variable values and staged file hashes; confirm prod’s main commit, existing files/settings and active workflow states are unchanged.
- GitHub cannot reveal secret values for comparison. Report secret creation acceptance, not verified credential equivalence; prove deploy identity later through a non-mutating principal check before permitting deployment.
- If interrupted, resume by re-inventorying and reconciling the recorded writes, without overwriting or deleting anything. Report partial completion accurately.
- Revoke/remove the temporary migration token after completion or an abandoned attempt.

## 5. Separate activation approval later
After the app merge and dependency checks, propose activation separately. Confirm exact live canister mappings, controller identity, routing snapshots and service targets using read-only checks; no test deploy or fuel purchase is required to prove the transfer.

Keep the current repo’s workers running during preparation. At cutover, disable and drain the source worker before enabling its destination replacement, with exactly one push-delivery timer and one owner for each automatic deploy, retention, health or funding job. If verification fails, leave destination automation inactive and retain the source as the operating repository.

## Technical safeguards and tests
- Add focused tests for destination pinning, strict add-only behavior, pagination, fail-closed lookups, collision handling, source/destination commit drift, inactive staging and interruption reconciliation.
- Validate generated YAML and dependency manifests; run the migration tool’s focused tests before dispatch.
- Update the merge document’s transfer section with the new staged procedure and accurate limitations, without treating its older inventory as a current source of truth.

## Result
Prod gains only approved missing credentials and an inactive, reviewable automation bundle. Its existing secrets, files, main branch and running services stay unchanged. App replacement and automation activation remain separate approvals.