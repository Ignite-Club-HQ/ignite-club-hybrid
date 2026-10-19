# Scaling activation boundary — focused review

19 October 2026. Read-only application/backend review; documentation updated, no runtime changes, deployments or activation.

## Decision

**Closed preparation is separable; accepting/routing new clubs is not yet proven separable.** Installation, configuration and closed registration can proceed through the existing stopping point. Removing the authority callback or changing routing gates would not solve the underlying dependency. Keep account-wide expansion paused and every production gate closed.

## Concrete dependency

- `frontend/src/live/groupProvisionRouter.ts:66–69` refuses production enable and requires authority composition even locally. `groupActivation.ts` independently ships off and requires approved revision, all routed domains, rehearsal, recovery and mainnet evidence.
- `backend/identity_access/src/lib.rs:736–760` independently restricts authority publication to the local rehearsal environment, rejects unfinished removals/unlinks and prevents dropping existing authorities. A frontend-only change cannot release this lifecycle safely.
- Real self-deletion remains reachable from `frontend/src/pages/AccountPage.tsx`. `accountData.ts:94–145` changes to registered-group discovery when routing activates, revokes memberships, purges personal content and then erases shared identity. Deferring new deletion development does not remove this existing feature from the activated path.
- `groupSession.ts:196–205` reads the verified registry's groups rather than only current memberships, and rejects pre-read revision drift/unavailable participants. This is useful discovery behavior, not all-service removal/recovery evidence.
- Real administrator deletion remains reachable from `ManageUsersPage.tsx`. `adminAccountDeletion.ts` revokes membership on only the supplied target before shared identity erasure; it does not itself enumerate grouped club authorities. Shared backend authority behavior must be verified before any claim that this covers new groups.
- Identity erasure explicitly records identity-local denial, not a remote drain receipt (`backend/identity_access/src/lib.rs:1695–1706`). Club-only photo/chat denial tests do not establish account-wide linked-principal revocation.

## Evidence reused

24 existing activation/router/authority tests pass; 14 existing self/admin-deletion tests pass. These are mocked frontend regressions, not a real cross-group deletion rehearsal. Prior two-group photo/upload/chat/notification evidence remains valid for ordinary club removal, with other-club access preserved. No broad tests or canister rebuilds were repeated.

## Smallest next step

**Bounded follow-up completed:** `docs/scaling-activation-boundary-rehearsal.md` records five passing local contract cases and two reproduced release blockers: admin deletion leaves new-group linked roles; mid-removal registry drift does not stop shared erasure. Registry/purge limits are explicit. No runtime fixes or activation authorized.

One **local contract rehearsal**, using the existing fixtures and a legacy group plus one new group, focused only on the existing shared-account boundary:

1. Exercise real self-deletion and administrator deletion through their current entry points; verify discovery includes both groups and linked principals, and distinguish denied fresh access from cached/downloaded material.
2. Check one unavailable participant and one registry change: shared identity must not be erased while required club revocation is unresolved. Verify retry does not restore removed-club access.
3. Exercise existing link/unlink behavior against the same authority inventory; do not introduce admission flags, receiver expansion or a new global drain mechanism.
4. Produce a pass/fail boundary report. A demonstrated gap gets one bounded proposal; no automatic expansion into broader deletion/recovery work.

This rehearsal is evidence gathering, not permission to publish the local authority protocol. Full-service setup may continue **closed** in parallel. Production inventory/control, semantic health, permission-preserving recovery, live/native/push acceptance and explicit release approval still remain necessary.

## Separation conditions

Release separation requires proof that shared identity/link/deletion operations preserve their existing guarantees for every newly routed group, including legacy authorities, failures and retries, without depending on deferred prototypes. If that cannot be demonstrated with bounded existing mechanisms, activation remains blocked and the narrow dependency is presented for a separate decision. Do not disable account deletion or weaken backend, activation, admission, recovery or encrypted-media-move guards to manufacture independence.