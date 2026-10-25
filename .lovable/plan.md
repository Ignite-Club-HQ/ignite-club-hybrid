# One protected mainnet release for every group

## What you get
Add **Upgrade backend (all mainnet groups)** in the hybrid repository. Choose a release scope and run **check** or **upgrade** once, rather than separately remembering Group 1 and Group 2.

The workflow covers every registered mainnet group, including future groups, and updates shared services only once. It reports each canister's original, intended and verified version. A green check means readiness; only a green verified upgrade means completion.

## Release controls
- Resolve the full live group registry and compare it with the saved group inventories before any change. Missing, extra, conflicting or unsupported targets stop the release rather than silently skipping a group.
- Build the selected services once from a pinned source revision and use those same artifacts across all applicable groups.
- Preserve existing scope-specific safety checks for competition, invitations, messaging, subscriptions, media and shared identity. An unreviewed service combination is refused, not sent through a generic installer.
- Keep router changes a separately confirmed prerequisite when required; do not combine them silently with a feature release.
- Use the existing protected approval, deploy identity and shared deployment lock. Never create or reinstall canisters, move clubs, change photo keys, open placements or buy fuel automatically.
- Save and read back progress before each upgrade. On interruption, verify completed work and stop on unknown outcomes; do not replay an uncertain installation.
- Verify all selected groups after upgrades, preserve settings and key evidence, then refresh the verified routing snapshot. Release the matching app only after the backend release passes.

## Avoid the old trap
Clearly label the old mainnet workflow as base/Group 1-only and direct ordinary feature releases to the new workflow. Retain existing narrow protected workflows for exceptional operations; do not remove their safeguards or activate copied prod-repository automation.

## Important limitation
ICP cannot upgrade every canister atomically. A failure can temporarily leave versions mixed. The release must report that state, retain its journal and block a success claim/app release until resolved. Compatibility between the old and new versions remains a release requirement.

## Technical implementation and checks
- Reuse the current exact-target planners, management readers, key attestations and immutable GitHub journals; generalize target enumeration to the complete registered group inventory with a bounded limit and principal deduplication.
- Add reviewed scope adapters where the current runners hardcode two groups, including an app-admin scope for shared identity and every group's notification queue.
- Test future-group inclusion, shared-target deduplication, inventory drift, unsupported scopes, partial completion, unknown calls, journal readback failure and verified resume.
- Document the workflow inputs and recovery instructions. Run the focused operator tests; no mainnet upgrade is performed as part of implementation.