# One mainnet backend release across every group

Workflow: **Upgrade backend (all mainnet groups)** (`upgrade-all-groups.yml`) in **Ignite-Club-HQ/ignite-club-hybrid**. Default scope **full_backend** upgrades every existing backend in original Group 1 and every consensus-registered group with a matching checked provision inventory, including future groups. All five shared services upgrade once; all thirteen group services upgrade per group, even when their Wasm is unchanged. Current saved inventory is 31 backend targets (18 original/shared plus 13 Group 2). It does not deploy the frontend asset canister, touch prod, or upgrade isolated test stores.

## Run it
1. Let the complete source sync to hybrid. Open Actions and select the workflow on `main`.
2. Leave action **upgrade** and scope **full_backend** selected; leave `checked_plan` empty.
3. Enter **UPGRADE ALL MAINNET GROUPS** and complete the existing protected environment approval. The same run automatically checks the exact source/inventory/artifacts, binds its plan hash, then upgrades and verifies all targets. No separate check run or feature-by-feature runs are required. Optional action **check** remains read-only. The **club_migration** scope also performs same-source automatic preflight; other narrow scopes still require a separately checked hash on the same source revision.
4. A successful upgrade verifies all selected modules, preserves original settings/wiring/photo keys, refreshes the routing evidence and publishes its exact files through a non-force branch update. Then run **Deploy web app (ICP frontend canister)** after that snapshot commit, and test signed-in flows in both groups.

| Scope | Services per group | Shared once |
|---|---|---|
| full_backend (default) | all 13 group services, including PII, timers, insights and points | identity_access, placement_registry, migration_coordinator, secret_workload_identity, shard_router |
| club_migration | club_domain only, including closed registered groups | — |
| app_admin | notification_queue | identity_access |
| team_invites | club_domain, mini_league_domain | — |
| messaging | messaging_domain | — |
| competition | notification_queue, club_domain, events_domain, competition_domain | — |
| history | events_domain, competition_domain | — |
| subscriptions | club_domain, media_blob_store | — |
| events_pitch | notification_queue, club_domain, events_domain | — |
| gallery_vault | club_domain, media_blob_store, media_metadata, vault_domain, messaging_domain, notification_queue | — |

The complete scope includes shared infrastructure, with router last and no legacy deploy/rewiring calls. Unknown mainnet mapping names, missing groups or mismatched inventories fail closed rather than silently skipping services. It never creates/reinstalls, funds, changes authorities, moves clubs, enables admission/placements, activates Resend or releases permanent discovery. Media metadata index backfill finishes before publication; a separate complete module manifest is published at `deploy/mainnet/backend-release.json` alongside routing evidence. Feature activations remain separate.

## Failure and resume
For the approved migration-readiness service release, select **club_migration** instead of **full_backend**, leave the checked plan empty, and use the same confirmation. This upgrades only club_domain in original Group 1 and every registered group, including closed groups. It adds the account-claim methods without registering claims, sending emails, copying data, changing sign-ins/routing or opening groups. Each real migration still needs the owner's separate exact-club/group data and authentication approvals. New unregistered groups are not created by this release; their normal provisioning uses the updated club service source.

- For the specific **Gallery authority inventory missing for g1** failure after module installation, use the fixed workflow on `main`, action **recover**, the same scope (**full_backend**), `checked_plan` **eac3e577bb4e5998cad15271ef868e50a623a6e4c5b2eb7b54843ad709940b5c**, and confirmation **RECOVER COMPLETED MAINNET RELEASE**. Complete the protected approval. Do not rerun the old failed job: it contains the old bug. Recovery reads the existing journal, requires every module's acknowledged completion and `modulesComplete`, preserves the original release/hash, and verifies modules/settings/wiring/keys twice. It never builds or installs modules. It finishes exact idempotent gallery authority setup, bounded index backfill and verified snapshot publication against the pinned repair source. Drift, pending steps, unknown installs or moved source branches still stop; no journal reset or bypass is allowed. Local checks do not certify the live journal is eligible; the protected run verifies that.
- Upgrades are not atomic. A failed run may leave versions temporarily mixed; neither a green check nor a partly completed installation proves completion.
- Durable receipts live on `all-group-upgrade-receipts`, in `all-group-upgrade.json`. Artifacts are a convenient copy, not the authority.
- Resume the **original source revision and scope/hash**. Completed modules are verified, not reinstalled. A pending module can settle only from exact intended-module readback; an old/foreign module stops for manual evidence, never automatic replay.
- If an unchanged-Wasm upgrade loses its reply, identical module hashes cannot prove it happened: retain the pending intent and require manual management-history reconciliation. Never replay or claim success solely from hash equality.
- An unresolved older narrow release also stops this workflow. Do not delete/reset its journal or create a new branch to bypass it.
- Publication failure retains the installation journal. If the source branch advanced, do not force-push or reset it; reconcile the exact saved publication first. A new release is allowed only after the previous journal is verified complete and published; its evidence is archived and read back before rotation.
- After the workflow's snapshot commit, rerunning the original run (same source SHA) can verify saved publication. Starting a new run on the new SHA is a new release and needs a fresh check/hash.
- A future group missing from saved inventories, invalid subnet policy, colliding principal, low fuel, failed key/wiring check or incomplete registry stops **before installation**, never silently skips the group.

The old **Deploy ICP canisters (mainnet — base/Group 1 only)** remains for explicitly scoped legacy/router operations. Ordinary synchronized releases use the new workflow. Existing narrow workflows are retained, not removed or automatically activated elsewhere.

## Validation boundary
47 local safeguard tests passed, including complete/future inventory coverage, upgrading unchanged modules, ambiguous same-Wasm interruption locks, runtime arguments and manifest publication. Runner syntax was validated. No mainnet check, upgrade or signed-in acceptance was performed. Old/new Candid and application compatibility remains a release requirement; module installation alone cannot prove it. Shared readback checks router authority, placement version/availability/operator, migration status and workload registrations; these are bounded preservation signals, not a complete decoded-state backup or atomic proof against concurrent writes. An installed router lacking the registry API cannot be repaired by bypassing preflight. Additional production stores must be incorporated into checked inventories before this workflow can cover them.