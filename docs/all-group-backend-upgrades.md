# One mainnet backend release across every group

Workflow: **Upgrade backend (all mainnet groups)** (`upgrade-all-groups.yml`) in **Ignite-Club-HQ/ignite-club-hybrid**. It upgrades existing selected services in original Group 1 and every consensus-registered group with a matching checked provision inventory, including future groups. Shared identity upgrades once. It does not deploy the app or touch the prod repository.

## Run it
1. Let the complete source sync to hybrid. Open Actions and select the workflow on `main`.
2. Choose the scope and action **check**. Download **all-group-upgrade-report**, open `check.json` and copy `planHash` (also printed in the log).
3. On the same unchanged source revision/branch, choose **upgrade**, the same scope, paste the hash into `checked_plan`, and enter **UPGRADE ALL MAINNET GROUPS**. Complete the existing protected environment approval.
4. A successful upgrade verifies all selected modules, preserves original settings/wiring/photo keys, refreshes the routing evidence and publishes its exact files through a non-force branch update. Then run **Deploy web app (ICP frontend canister)** after that snapshot commit, and test signed-in flows in both groups.

| Scope | Services per group | Shared once |
|---|---|---|
| app_admin | notification_queue | identity_access |
| team_invites | club_domain, mini_league_domain | — |
| messaging | messaging_domain | — |
| competition | notification_queue, club_domain, events_domain, competition_domain | — |
| history | events_domain, competition_domain | — |
| subscriptions | club_domain, media_blob_store | — |
| events_pitch | notification_queue, club_domain, events_domain | — |
| gallery_vault | club_domain, media_blob_store, media_metadata, vault_domain, messaging_domain, notification_queue | — |

Only the listed reviewed scopes are selectable; a generic “upgrade every service” option is deliberately refused. Router, placement registry, migration coordinator, secret workload identity and unrelated services are excluded. Router changes remain a separately protected prerequisite. It never creates/reinstalls, funds, changes authorities, moves clubs, enables admission/placements, activates Resend or releases permanent discovery. Media metadata index backfill is finished before publication; other separately gated feature activations remain separate.

## Failure and resume
- Upgrades are not atomic. A failed run may leave versions temporarily mixed; neither a green check nor a partly completed installation proves completion.
- Durable receipts live on `all-group-upgrade-receipts`, in `all-group-upgrade.json`. Artifacts are a convenient copy, not the authority.
- Resume the **original source revision and scope/hash**. Completed modules are verified, not reinstalled. A pending module can settle only from exact intended-module readback; an old/foreign module stops for manual evidence, never automatic replay.
- An unresolved older narrow release also stops this workflow. Do not delete/reset its journal or create a new branch to bypass it.
- Publication failure retains the installation journal. If the source branch advanced, do not force-push or reset it; reconcile the exact saved publication first. A new release is allowed only after the previous journal is verified complete and published; its evidence is archived and read back before rotation.
- After the workflow's snapshot commit, rerunning the original run (same source SHA) can verify saved publication. Starting a new run on the new SHA is a new release and needs a fresh check/hash.
- A future group missing from saved inventories, invalid subnet policy, colliding principal, low fuel, failed key/wiring check or incomplete registry stops **before installation**, never silently skips the group.

The old **Deploy ICP canisters (mainnet — base/Group 1 only)** remains for explicitly scoped legacy/router operations. Ordinary synchronized releases use the new workflow. Existing narrow workflows are retained, not removed or automatically activated elsewhere.

## Validation boundary
43 local policy/transport-fake tests passed, verifying inventory expansion, shared-once coverage, drift and interruption/publication rules. Both runner files passed syntax validation and both workflow files parsed as valid YAML. No mainnet check, upgrade or signed-in acceptance was performed while implementing this workflow. Old/new Candid and application compatibility remains a release requirement; module installation alone cannot prove it.