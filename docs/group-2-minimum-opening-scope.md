# Minimum scope: limited Group 2 test opening

Owner scope clarification: 21 October 2026, 03:07 UTC. This replaces the expanded removal/disaster-recovery backlog as the active work, not as an authorization to deploy or open g2.

## Necessary work

1. **Controlled new-test-club placement.** Bind g2's verified service inventory, own photo store, authority configuration and approved router revision. Admission must be explicitly bounded to the owner test; existing clubs remain on their existing services. Reject stale approvals, missing configuration and partial setup.
2. **Production-safe routing and permissions.** The same account must reach its clubs in both groups. Each service must still check the relevant club membership; account existence is not membership. Verify removed-club private-photo keys/uploads/chat/delegated actions are denied while other members, other clubs and DMs continue to work. Preserve existing account-deletion locks and safeguards without expanding that subsystem.
3. **Normal g2 use.** Create and read back an actual test club; exercise sign-in, club reads, photos, messaging and authorized notifications. Reuse existing local integration setups; add focused tests only for changed rules. Check real signed-in/browser/device behavior after separately approved deployment.
4. **Controlled opening and stop.** Stop further placements without changing existing club assignments or disabling those clubs' access. Verify exact revision checks, retries/ambiguous replies and failed acceptance stay closed. No mainnet local-test flags or unconditional accepting switch.

## Concrete source blockers

- `routerProvisionSteps.enableGroup` refuses nonlocal activation before its authority-wiring and placement-revision checks. Installation and closed registration do not remove that refusal.
- `groupDispatch` uses globally OFF activation gates. There is no existing isolated live owner-test/g2-only admission path; opening the router alone would not establish app routing, and globally turning routing on could affect existing clubs.

The next implementation is the bounded production admission/dispatch path plus its authority/club-access checks, not completing every item from the broader 1–5 backlog. Determining the exact checks requires tracing that path; source refusals must not simply be removed. No current readiness or mainnet verification is claimed.

## Limited implementation batch: 21 October 2026

- Router memory 14 persistently binds every new self-placement to its original principal. A different caller or a legacy/governor-created assignment cannot claim a retry. Consensus creator receipts are registry-revision checked and refuse while deletion locks exist; receipts never grant club membership.
- Destination verification is an update callable only by the registered club authority, with complete group placement and original creator/group checks. Newly provisioned club authorities may enable mandatory creation binding with all three placement-router/group/target settings; no settings preserves existing creation behavior, partial settings refuse, unavailable/denying router refuses. This is not an activation flag and no deployed settings were changed.
- Dispatcher now reserves placement before opening its fresh session, then verifies the exact creator receipt before a single creation attempt. It no longer uses a pre-placement registry snapshot. Principal/host/network/target IDs isolate cached sessions.
- Real two-authority rehearsal passed: creates/readback in both groups, direct unplaced/stolen creation denial, stale/foreign receipt denial, stop further placements with retained club access, upgrade-preserved creator ownership, club-scoped removal and deletion locks. Other domain endpoints in this test are metadata fixtures.
- Existing real two-group five-service private-photo decrypt/upload/chat/notification regression passed separately, with provider sends stubbed. Router Rust: 34 tests. Six focused frontend suites: 70 tests in ICP and 70 in Supabase. Candid drift: 17 contracts. No live writes, flags or deployments.

**Superseded by the owner-only opening batch below.** General activation and its refusal remain unchanged; the independent bounded path does not release them.

## Owner-only opening batch: 21 October 2026, 03:23 UTC

Built a separate manual protected-environment workflow for closed registration, exact live placement checks, explicit governor-signed owner opening and stop. Router memory 15 restricts admission to g2, the app owner and explicit test UUIDs while general accepting stays false. Actual consensus configuration readers check reciprocal authorities/worker grants; destination creation and placement check current shared identity eligibility, with post-await revision/receipt rechecks. Owner app routing includes only g2 plus existing shared clubs; Supabase/general gates remain unchanged. Unknown outcomes retain reservations; stop/upgrade preserve existing assignments and membership-controlled access.

Verification: 118 focused tests per backend mode, 39 router + 55 identity + 4 timer Rust tests, real owner opening/creation/readback/stop/upgrade rehearsal, real thirteen-service closed configuration/read-denial/business/upgrade test, two-group encrypted media/chat/removal/notification regression and 17-contract drift passed. Provider sends are stubbed; real sign-in/Android/push acceptance remains unverified. Public preview opens without page errors; preview builds report OK.

See `docs/group-2-owner-opening.md` for exact workflow prerequisites. Nothing deployed/opened. The owner must configure the GitHub reviewer restriction, separately release the reviewed modules/configuration, supply the exact live approval and run checks before opening. Local artifacts are not mainnet release fingerprints.

## Deferred unless a demonstrated opening dependency requires them

- Expanded account-wide erasure completion and global drain coordination.
- Provider-backed reconciliation of unknown push delivery outcomes; preserve the existing conservative outstanding-work behavior and normal notification authorization.
- Whole-system snapshot recovery, independent anchor service and a global disaster-recovery exercise.
- Exhaustive audits of infrastructure unrelated to club placement/access.
- Photo moves/re-encryption, PlayHQ sync, capacity fills, optional subnet/engine activation.

Existing safeguards stay intact. Deferred does not mean complete or safe to bypass. Group 2 stays closed; approved release, actual controller/configuration evidence and signed-in two-group checks remain required before test opening.