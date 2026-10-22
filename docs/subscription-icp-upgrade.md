# App subscription release — both ICP groups

## GitHub Actions

Use the branch containing these changes in this app's repository.

1. Run **Upgrade subscriptions (both ICP groups)** with `action: check`, confirmation empty.
2. After a successful check, run the same workflow with `action: upgrade` and confirmation **UPGRADE BOTH GROUPS SUBSCRIPTIONS**.
3. Approve the existing `group-2-admin-controls` environment if GitHub requests it.
4. Wait for every step, including **Refresh governor-verified routing snapshot** and **Save verified fingerprints and snapshot**, to succeed. The snapshot refresh is included; there is no separate opening or account-repair action.
5. Sync the generated GitHub commit into the app before publishing. For the ICP-hosted web app, run **Deploy web app (ICP frontend canister)** on that updated branch. For Lovable hosting, publish the synced app only after acceptance below.

The existing repository secret `DEPLOYER_PEM` must contain the original governor key. The existing delivery seed or configured worker principal is required for snapshot verification. Never paste a private key into chat.

This upgrades exactly `club_domain` and `media_blob_store` in Group 1 and Group 2. It does not create, fund, rewire, open/close groups, enable experimental storage modes, change capacities, replace encryption authorities or activate purchases. Group 1's original mapped pair is checked separately because it may not be a registered router group; Group 2 must match the checked provision and live consensus registry. Certified subnet, sole controller, running state, 1T fuel floor, module/settings and both original photo keys are checked.

Only the two upgraded Group 2 fingerprints are updated in its opening approval. Existing full-service reciprocal/removal/account-admission checks produce the snapshot; no readiness bypass is added. Ordinary club placement revision changes do not invalidate the upgrade: routing configuration/inventory/admission state must stay identical.

## Interrupted or failed run

- Use **Re-run failed jobs** on the same release commit. The immutable-commit-verified journal lives on `subscription-upgrade-receipts` in `subscription-upgrade.json`.
- A pending install is settled only when the exact new module is read back with unchanged settings. Old/unknown modules stop; no automatic retry, reinstall or journal reset.
- A failed snapshot step can be rerun; it never installs code. Do not publish an old snapshot after a partial or unverifiable release.
- A different release cannot replace the existing journal automatically. Review and reconcile the settled release before arranging a later upgrade; do not delete unknown/pending evidence.
- A failed snapshot/save after successful installs means the modules may already be live, but the release is not complete. Inspect the report and rerun on the same commit.

## Signed-in acceptance before completion

Use real authorized accounts and existing clubs in each group. Do not alter production promo grants merely to test limits. New-plan acceptance needs approved disposable test clubs and governor-authorized test entitlements; paid purchases remain disabled.

- Read existing clubs, theme picker and teams carousel from both groups.
- Verify Free 20 teams, Small 3, Growing 5, Established 10 and Large 20; refuse the next team unless the correct verified extra-seat entitlement exists. Verify no self-granted seats, and retained existing teams on expiry/downgrade.
- Verify combined gallery/chat/Vault: Free 250 MiB, Single Team 1 GiB scoped to its exact team, new paid club 3 GiB shared and nonstacking. Existing legacy Starter/Standard/Unlimited retain their authorized 5 GiB storage and team limits.
- Upload and decrypt a real encrypted file, including pending/concurrent near-limit admission, wrong-team denial and final assembled-size recheck. Original files survive expiry/reduced allowance; no unintended deletion.
- Confirm applicable Free monthly counts and six-month retention, active paid retention and branding exemption.

Local tests and module/key verification are not signed-in upload or purchase acceptance. The sandbox has no GitHub-held governor signing access or an authenticated Internet Identity session, so live execution/acceptance and publication remain operator steps. Website/Apple/Google verified fulfillment is a separate blocker for enabling purchases.