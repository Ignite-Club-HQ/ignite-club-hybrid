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

## Deferred unless a demonstrated opening dependency requires them

- Expanded account-wide erasure completion and global drain coordination.
- Provider-backed reconciliation of unknown push delivery outcomes; preserve the existing conservative outstanding-work behavior and normal notification authorization.
- Whole-system snapshot recovery, independent anchor service and a global disaster-recovery exercise.
- Exhaustive audits of infrastructure unrelated to club placement/access.
- Photo moves/re-encryption, PlayHQ sync, capacity fills, optional subnet/engine activation.

Existing safeguards stay intact. Deferred does not mean complete or safe to bypass. Group 2 stays closed; approved release, actual controller/configuration evidence and signed-in two-group checks remain required before test opening.