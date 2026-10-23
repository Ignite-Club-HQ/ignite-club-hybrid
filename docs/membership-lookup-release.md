# Releasing the permanent club lookup

**Status 23 October 2026 02:33 UTC:** the protected all-group release ran
successfully on mainnet (after the one recorded CLI-rejection recovery). The
governor-verified routing snapshot was regenerated and committed with
`approved: true` and the released `club_domain` fingerprint. The lookup is
live; existing discovery remains the automatic fallback and the app is not yet
re-published with the connected lookup for end users.

Check mode is read-only; upgrade performs the bounded release described below.
A missing source-export method fails check mode; there is no public-query fallback.


## Before you run

- Use a computer browser (the GitHub phone app may not list a workflow that
  has never run).
- The run needs the existing `DEPLOYER_PEM` GitHub secret; no new secrets.

## Read-only check

1. Open the repository on GitHub → **Actions** → **Release permanent club
   lookup (all groups)**.
2. Click **Run workflow**, choose **check**, leave confirmation empty.
3. Click the green **Run workflow** button and approve if GitHub asks.

A green **check** means the target/source observation passed, not that the new lookup
is enabled. For the protected release, choose **upgrade** and type exactly
`RELEASE MEMBERSHIP LOOKUP`; use the updated commit containing this work.

## Club ownership cross-check

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

## What the upgrade does

The single protected run derives **every registered club membership source plus
original Group 1** from the live registry. It upgrades only those existing
`club_domain` services and the pinned shared `identity_access` service. It does
not create canisters, move/delete clubs, touch photo stores or keys, open groups,
or publish the app. A complete inventory over the supported 100-source bound
refuses before any upgrade; sources are never truncated.

Each target is checked against its approved subnet, sole existing governor,
module, unchanged settings and fuel floor. Durable receipts are written and read
back before each upgrade. Unknown upgrade outcomes never reinstall automatically;
a different commit/inventory cannot replace an existing journal.

The run then configures exact separate source grants, completes bounded fills
for every source, verifies exclusive club ownership, and checks complete source
revisions plus independent replica-history restoration guards. Only the
identity-owned `enable_membership_directory` operation can record the exact
release commit, after repeating these checks. A lost enable reply is reconciled
with the same commit, without replaying grants or old fills. The run refreshes
and saves governor-verified routing fingerprints for the upgraded modules.

## App connection

The compatible app lazily calls `read_my_membership_directory` with a
caller-owned consumer and sequential continuation. **Every page**, including
saved-page replay, rechecks all source revisions, ownership, complete registry,
photo-store inventory and replica history. Caller account/aliases are captured
before awaits and revalidated after replies. Suspended/changed identities,
incomplete or changing sources, restored state and foreign continuations refuse.

The app verifies the returned actual registry, domain/subnet/photo-store sets,
caller, release/inventory binding and sequential instance. It never supplies an
invented registry proof or promotes diagnostic replies. If any page fails, it
discards the partial lookup and runs complete existing Stage A discovery;
club-resource permissions are still checked by their owning services.

`verified_current` means a verified **snapshot interval for that page**, not
permanent freshness at browser delivery or permission to read club resources.
Regular source updates rebuild through the existing timers; ownership acceptance
is refreshed after acknowledged updates. Until rebuilding is complete, the app
falls back rather than hiding clubs.

## Verification completed locally

- 124 identity unit tests, 63 operator/generated-wire tests, 58 app tests pass.
- Real populated three-source rehearsal passes single-group, multi-group and
  empty callers; sequential pages; suspension during awaits and replay; membership
  changes and automatic released-directory recovery; exact release retries; same-code source and joint identity/source
  restoration refusal.
- 17 active Candid contracts match; workflow YAML parses and preview builds.

No signed mainnet run, production account traversal, measured speed improvement,
app publication or native release has occurred. The page checks still perform
consensus verification across sources, so local correctness is **not** proof of
faster real-account loading. Real-account timing remains the next acceptance.

## If it fails

- Keep the same commit when retrying. Unknown install/receipt outcomes, changed
  inventory, source drift or insufficient fuel stop without automatic replay.
- Do not delete the receipts journal or reset a pending release to bypass a refusal.
- A red run never leaves the app without club discovery — the current search
  stays active throughout.
