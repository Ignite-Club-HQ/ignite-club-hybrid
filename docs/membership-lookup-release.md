# Releasing the permanent club lookup

The release is **not ready to run in upgrade mode**. The draft workflow now
refuses upgrade before installing tools, restoring the signing key or changing
any canister. Existing club discovery stays active. Check mode inspects only
the three pinned service targets and routing configuration; it does not verify
lookup readiness, source grants or memberships.

## Before you run

- Use a computer browser (the GitHub phone app may not list a workflow that
  has never run).
- The run needs the existing `DEPLOYER_PEM` GitHub secret; no new secrets.

## Read-only check

1. Open the repository on GitHub → **Actions** → **Release permanent club
   lookup (both ICP groups)**.
2. Click **Run workflow**, choose **check**, leave confirmation empty.
3. Click the green **Run workflow** button and approve if GitHub asks.

A green **check** means the target inspection passed, not that the new lookup
is ready. Do not run **upgrade** yet; it deliberately stops without changes.

## Essential work before upgrade

- The intended upgrade scope is only three existing services: the shared account service
  (`identity_access`) and each group's club service (`club_domain`). No other
  service is touched, created or rewired.
- Configure the exact complete authority inventory and separate source grants;
  refuse missing Group 1 or additional registered sources rather than ignoring them.
- Cross-check owner-supplied Group 1 names against authoritative club IDs and
  complete source inventories. Names identify candidates, not verified ownership;
  they must never write placements or move clubs or their photo keys.
- Verify current private reads and interrupted/old-state refusal, then connect
  the opt-in app reader with complete existing discovery on uncertainty.

## Fill driver now connected

The runner uses the existing generated `advance_membership_directory_source`
contract, separately for `g1` and `g2`. Each call resumes bounded durable work;
only the exact source's `acknowledged` phase records its historical revision.
Malformed replies, foreign sources, refusals, retry exhaustion and failed
journal persistence stop the fill. There is no invented global fill API.

Historical acknowledgement may leave newer changes pending. Even both groups
acknowledging does not establish currentness or exclusive legacy ownership.
The runner therefore cannot emit a readiness record or enable the app.

## If it fails

- Send a screenshot of the failed check. Upgrade currently refuses intentionally;
  rerunning it cannot bypass the missing release checks.
- A red run never leaves the app without club discovery — the current search
  stays active throughout.
