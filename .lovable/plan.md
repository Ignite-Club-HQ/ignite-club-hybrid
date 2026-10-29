# Run hybrid workflows from the prod repository

## Result
Make the copied hybrid workflows available in **Ignite-Club-HQ/ignite-club_hq-prod → Actions**, without merging the hybrid application into main or changing either database connection.

## Changes
1. Add missing **manual-only workflow entry points** to prod main in one reviewed pull request. All 48 copied workflow paths are distinct from prod's 13 existing workflows; leave those existing files untouched. CI stays on its existing triggers; do not enable copied schedules or automatic deployment.
2. Preserve each manual workflow's inputs, confirmations and permission checks. Ensure runs use the hybrid branch's code, pinned to the selected revision—not prod main's application. Clearly prevent accidental runs against the wrong branch. Keep separately pinned private-name approval sources unchanged.
3. Check and adapt main-only release assumptions narrowly so intended hybrid runs work without bypassing reviewed-source safeguards. Preserve original canister IDs, keys, group inventory, concurrency and unknown-outcome locks.
4. Recreate missing protected release environments with the source's actual reviewers and settings, including any additional environments beyond the two already listed. Prod currently has **no environments**. Do not allow missing environments to become unreviewed release jobs.
5. Keep the missing-secret checklist up to date. GitHub cannot reveal existing secret values: Paul supplies the required missing values later; existing prod secrets are never overwritten.
6. Preserve repository-local release journals and evidence before using prod for live releases. Read the source's unresolved release, reconcile it using its original approved plan, and transfer only verified retained evidence. Never treat an empty prod journal as permission to start another upgrade. If the source release cannot be settled safely, leave the affected release workflow blocked with the exact reason.

## Verification
- Confirm all intended manual workflows are registered in prod and select the correct hybrid code.
- Confirm prod's existing workflow files, application code, secrets and database settings are unchanged.
- Test branch/repository selection, manual-only triggers and fail-closed approval/evidence requirements.
- Run one isolated, no-production-credentials test from prod after registration; do not run a live deployment, migration, cleanup, funding or group opening.

## Technical details
Use add-only GitHub API changes with parent revision checks; use a reviewed pull request for main rather than replacing its tree or bypassing branch protection. Reuse existing hybrid workflow implementations and their protected jobs instead of inventing a new release engine. Registration alone does not certify that secrets, approval settings or release history are ready.

## Remaining owner input
Enter the missing secret values when ready. Approval of this plan covers workflow setup and the isolated test only—not a live release or replay of an unresolved release.