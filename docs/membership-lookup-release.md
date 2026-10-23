# Releasing the permanent club lookup

The release is **not ready to run in upgrade mode**. The draft workflow now
refuses upgrade before installing tools, restoring the signing key or changing
any canister. Existing club discovery stays active. Check mode inspects the
three pinned service targets and all registered membership sources plus original
Group 1, using bounded consensus exports and unchanged revision checks. It does
not certify lookup readiness, create grants or enable the app. A missing live
export method fails the check; there is no public-query fallback.

## Before you run

- Use a computer browser (the GitHub phone app may not list a workflow that
  has never run).
- The run needs the existing `DEPLOYER_PEM` GitHub secret; no new secrets.

## Read-only check

1. Open the repository on GitHub → **Actions** → **Release permanent club
   lookup (both ICP groups)**.
2. Click **Run workflow**, choose **check**, leave confirmation empty.
3. Click the green **Run workflow** button and approve if GitHub asks.

A green **check** means the target/source observation passed, not that the new lookup
is ready. Do not run **upgrade** yet; it deliberately stops without changes.

## Essential work before upgrade

### Owner-named legacy clubs: public cross-check

On 23 October the existing public `list_clubs` query returned these active
records from the original Group 1 club service; they were absent from the
Group 2 query observed in the same check:

| Club | Exact candidate ID |
| --- | --- |
| Winter Cats | `c1ba8739-5368-4ca9-8143-baa1d3ecfbc6` |
| Giddy Goat | `c1f2ed52-fda3-45b4-84d3-57fcf253116e` |
| Riverdogs | `f9f7d89c-a51f-454d-af8e-b976c10d2fc4` |

These are public-query observations, not consensus/exclusive ownership proof.
They are not an exhaustive inventory of Group 1: other active records exist.

`frontend/scripts/check-membership-ownership.ts` now provides the operator
check: use the existing governor PEM path and a report path as its arguments.
It reads the complete registry, includes the explicitly pinned original Group 1
authority, traverses every source's governor-only consensus export twice,
rechecks revisions and registry, and rejects missing/deleted/duplicate matches.
It emits only club IDs/source counts/revisions and `ready: false`; no raw ACL
relationships, grants, placements or media-key changes. The same transport is
now used by release check mode, not as upgrade acceptance. It needs the existing signing key and
supported live source-export methods. It has not been run signed on mainnet.

### Remaining release prerequisites

The source-grant setup and exact readback orchestration are now connected to the
draft runner, and the private diagnostic endpoint/app actor connection exist.
The app's ordinary lookup switch remains off, so navigation makes no new lookup
calls and continues using existing discovery. Diagnostic replies explicitly
say they are not verified-current.

Identity transport includes explicitly pinned original Group 1 without
inventing a placement. Ownership acceptance implementation is complete locally:
the governor-only `advance_membership_directory_ownership` operation reuses
complete retained Club rows, checks exclusive IDs across every source (including
tombstones), persists bounded progress across upgrades, and binds acceptance to
exact source revisions/status and inventory. Missing assignments can resolve only
for the pinned original G1 after this acceptance; no router placement is written.
Any changed source invalidates acceptance. The generated release driver journals
its result, never `ready: true`. Signed live acceptance has not run.

Final historical acceptance checks now compare every filled source revision with
the first and every subsequent ownership response. Saved revisions/ownership are
validated on restart; foreign or contradictory checkpoints cannot authorize work.
Grants must name the pinned identity, not simply agree with each other. Identity
configuration is checked again after all source grants finish.

The runner then checks all source statuses, identity configuration and installed
module/settings fingerprints in two complete sweeps. Pending changes, a source
restored below its acknowledged revision, unavailable sources and late drift stop
the check. Reports explicitly distinguish `sampledCurrent` from
`verified_current`, and keep readiness/app activation false. The workflow runs
these tests before using the signing key; its upgrade block remains in place.

**These checks cannot finish live currentness by themselves.** A membership can
change after its status reply and before its notification reaches the lookup.
Likewise, restoring both a source and its local revision counters can look
consistent. A real read-freshness protocol and independent restoration fence are
still missing engineering, not a secret or approval the owner can supply.

The verified-current/old-restored-state release contract remains unfinished. Additional registered groups
are inspected, but cannot be silently ignored or added to this three-target upgrade.
The protected upgrade still refuses before making changes.

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

After source fill, the runner now invokes the generated ownership operation
until its bounded traversal completes, verifies the exact digest/source list and
unchanged revisions, and records the ownership result. This reuses the existing
trees rather than adding another per-club index or filling club records again.
Ownership acceptance is not currentness/recovery approval; upgrade remains gated.

## If it fails

- Send a screenshot of the failed check. Upgrade currently refuses intentionally;
  rerunning it cannot bypass the missing release checks.
- A red run never leaves the app without club discovery — the current search
  stays active throughout.
