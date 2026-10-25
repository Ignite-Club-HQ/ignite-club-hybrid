# Team invitations — ICP audit, 25 October 2026

## Verdict

**Not fully on-chain and not ready to certify as complete.** Core invitation records, roles, guardian links and several acceptance paths exist on ICP, but reachable Supabase calls, broken sharing/handoff paths, and invitation authorization/retry defects remain.

This is an audit, not a repair or release. No application/canister code changed, no mainnet mutation occurred, and no email sender was activated. The owner deferred connecting the existing Resend provider; retain that decision. External email delivery will always be external, but invitation authorization, queuing and receipts should stay on ICP rather than depend on Supabase application services.

## Scope and evidence

Three independent read-only reviews covered creation/sharing, acceptance/routing, and backend authority. Reviewed team/parent/guardian/admin invitations; Home and team roster entry points; pending edit/move/revoke/resend; shell-team claims; team-linked mini-league/season invites; short links; authentication/PWA handoff; role requests; PII and email queues.

Source evidence refers to this checkout, not verified live Wasm. The latest owner-reported competition release does not prove every invite path described here is deployed or functioning. No signed-in Internet Identity or native two-group acceptance was exercised.

## 1. Confirmed reachable off-chain dependencies

| Finding | Evidence | Required closure |
|---|---|---|
| ICP invite creation invokes Supabase `send-email` with browser-supplied recipient/template | `frontend/src/hooks/useAddPendingTeamMemberMutation.ts:161–193` | Remove this ICP application dependency; use authorized encrypted ICP jobs when delivery is resumed. Manual sharing must work while Resend is deferred. |
| ICP bulk resend invokes the same Supabase sender | `frontend/src/components/PendingInvitesList.tsx:67–140` | Route resend through an explicit authorized ICP operation and report queued vs delivered accurately. |
| Accepted ICP pending invites still request Supabase welcome delivery | `frontend/src/features/membership/acceptIcpInviteAndWelcome.ts:9–21` | Keep membership independent; migrate welcome jobs/receipts onto ICP, retaining external Resend transport only. |
| Invite completion sweeper reads Supabase roles for ICP users | `frontend/src/hooks/useInviteFlowSweeper.ts:26–50`; mounted in `components/layout/AppLayout.tsx:48` | Use exact on-chain invitation/destination completion, not membership in any unrelated club. |
| Successful team-member additions query Supabase pending count | `frontend/src/components/AddTeamMemberSheet.tsx:163–191` | Count authorized owning-group pending invites. |
| Mini-league team-invite support reads Supabase branding, children, parents and roles | `frontend/src/components/AddMiniLeagueMemberSheet.tsx:161–275` | Use authorized ICP league/club/guardian/profile reads and the exact league scope. |
| Ordinary parent join checks photo consent through Supabase before routed execution | `frontend/src/pages/JoinTeamPage.tsx:1569–1583` | Use ICP consent/preferences; assess together with reusable-link decoding below. |

Do not mistake the presence of a `withFeatureBackend` call elsewhere in a file for isolation of every call in it.

## 2. Broken links, handoff and owning-group routing

1. **Invalid share origins:** `components/invite/TeamJoinLinkCard.tsx:29,315` builds copied/shared/QR links under `https://reference.invalid`. `components/PendingInviteCard.tsx:190–193` substitutes that address without a usable token path. The app-download/deep-link destinations in `NativeOnlyGate.tsx:8–11,43–64` also contain placeholders. Do not invent store addresses; use verified existing destinations.
2. **Short-path mismatch:** `hooks/useAddPendingTeamMemberMutation.ts:155–156` generates `/i/<code>`, while `App.tsx:540` registers `/j/:code`. The browser audit reproduced `/i/AUDITINVALID` as a 404.
3. **Short-code Group 2 failure:** `pages/ShortInviteRedirect.tsx:30–40` connects directly to the active target; `live/features/club.ts:730–732` reads just that club service. It bypasses complete group-aware token discovery. Resolve anonymously across approved sources, reject ambiguity and preserve transport failures for retry.
4. **Reusable-link API mismatch:** `TeamJoinLinkCard` creates `TeamInviteLink` tokens (`live/features/club.ts:586–620`), but ordinary `/join/:token` reads and accepts legacy `TeamInvite` IDs through `live/features/membership.ts:200–207` and `JoinTeamPage.tsx:350–410`. Wire preview and acceptance to the actual token family, with no guessed authority.
5. **New-team admin link discarded:** `CreateTeamPage.tsx:653–677` creates and passes an ICP link; `TeamDetailPage.tsx:175,2053–2068` drops it; `TeamAdminInviteDialog.tsx:12–19,44–58` says sent without providing copy/share. With delivery deferred, preserve the acknowledged link and say created, not delivered.
6. **Other-parent existing-account link reaches shared Group 1:** `InviteOtherParentSheet.tsx:137–143` uses `writeOnce({shared:'person'})` for club-owned guardian mutations. Scope by the child's authoritative club/team; shared identity discovery is not a club write authority.
7. **Browser/PWA gate:** all ordinary join routes are native-only (`App.tsx:538–541`, `NativeOnlyGate.tsx:31–38`). Browser checks confirmed `/join/p/...` and `/j/...` show the app-download screen, not acceptance. This may be intentional product policy, not an off-chain data gap; its placeholder destinations and PWA restore contradiction still need resolution. Browser local storage cannot transfer state into a newly installed native app.
8. **Storage/handoff recovery:** `ClaimTeamPage.tsx:32` and `PWAPendingInviteHandler.tsx:20,32` use unguarded storage; claim state is not reset by token changes and has no error retry (`ClaimTeamPage.tsx:24–63,93–100`).

## 3. Essential authorization and privacy defects

These are on-chain correctness/security gaps, not missing off-chain replacements. Address them in the same invite closure batch; do not expand into unrelated historical recovery.

### A. Legacy invitations and reusable links permit over-broad roles

`backend/club_domain/src/main.mo:613–647` lets local coaches/team admins pass `canCreateTeamRosterInvite` without role restriction. `create_team_invite` and `create_team_invite_link` require only a nonempty role (`3745–3764`, `3938–3957`). Their acceptance writes that role into the ACL (`3789–3805`, `4034–4049`). The `isAdmin` helper treats a `club_admin` role as club-admin authority regardless of its team field (`604–605`).

**Concrete risk:** an authorized coach can request a `club_admin` bearer invite via the API even though normal UI role options are narrower. Restrict roles and elevation authority in the canister for every creator; hiding a UI option cannot enforce this.

Legacy `TeamInvite` IDs use team/array-count/time-derived values (`3756`), and acceptance is bearer-by-ID, not verified-email-bound. Use cryptographically random credentials and document bearer-vs-recipient identity explicitly. Do not claim that sending to an email verifies its accepter.

### B. Invalid scope and stale authorization

`canManageTeam` does not verify team ownership and its coach branch does not exclude removed members (`613–624`). Legacy/team-link acceptance omits current issuer, team existence/ownership and transfer-fence checks. Ordinary pending creation does not repeat manager authority after randomness (`4073–4127`); guardian creation is better protected.

`request_role` accepts arbitrary nonempty roles and team/club scope (`3512–3534`); approval inserts stored grants without applicant exclusion/current eligibility, lifecycle, canonical scope or duplicate checks (`3543–3568`). Repeat authorization and exact role/scope checks immediately before committing grants.

### C. Rotation can overwrite a concurrent revocation

`rotate_team_invite_link` captures the link, awaits authorization/randomness, then writes the captured record (`3983–3994`). A concurrent revoke can be overwritten. Link IDs calculated before randomness can also collide under concurrent creation (`3947–3956`). Reload current state and reject stale/revoked revisions after the final await; use independent unique IDs.

### D. Pending invitation privacy/index defects

`createLivePendingInvite` passes plaintext email to `create_pending_invite` (`frontend/src/live/features/club.ts:646–654`), which stores it (`main.mo:4118–4127`); anonymous `get_pending_invite` returns that record (`4196–4204`). Encrypting a duplicate PII record/envelope does not remove plaintext from the original invitation.

Short codes are 32-bit public lookup credentials, without collision checking (`4142–4167`). The email-hash setter verifies access to a caller-supplied club but not the invitation's actual owner (`4175–4184`). Redact previews, protect recipient information, strengthen/collision-check codes and bind hash updates to the invitation's exact scope.

### E. Mini-league parity

`backend/mini_league_domain/src/main.mo:954–977,988–1044,1542–1576`: named claims have useful claimant binding, but issuer/removal/fence policies are inconsistent across reusable/named paths; player names are stored directly and exposed in token preview. Verify current authorization and use authorized encrypted child-name references where required. Legacy mini-league invite shapes are explicitly blocked in ICP (`JoinTeamPage.tsx:1515–1521`); modern named/admin/parent contracts exist and must not be conflated with that legacy gap.

## 4. Retry, email and parity gaps

- Pending acceptance rejects every already accepted invite (`main.mo:4260`), despite frontend idempotency comments; shell claims similarly reject already claimed shells (`3884–3905`). A lost successful reply can strand the user. Reconcile exact same-caller receipts and current grants without replaying revoked permissions.
- Competition-authorized pending invite creation is allowed (`4096–4102`), but acceptance and email claims require local manager rights (`225–231,4259`). A foreign competition manager can create an unusable invite. Use one consistent, narrowly verified authorization basis rather than granting broad club rights.
- `resend_pending_invite` changes state to `resent` (`4216`), while queue/claim require `pending` (`216–231`); resend can also replace accepted status. Define a separate resend receipt/operation; retain accepted membership and unknown delivery locks.
- Season invite creation commits before encryption/queueing (`SeasonInviteStep.tsx:190–205`). Missing deferred email keys can make the UI report failure after the invite exists, with no returned manual link. Return created link independently of mail availability.
- `ReconcilePendingInvitesButton.tsx:46–55` only refreshes ICP rows; its dialog still promises membership/email reconciliation. A refresh is not equivalent feature behavior, though it correctly avoids Supabase.
- ICP joined/uses/expiry/pending counts are fabricated as zero/null in `TeamJoinLinkCard.tsx:159–170,180–195`. Decide equivalent semantics and provide authoritative counts rather than suggesting parity.
- Sensitive coach/admin links auto-create when their role is selected (`TeamJoinLinkCard.tsx:275–288`), contrary to explicit-confirmation intent; cached manager detection matches any club (`123–126`). Home also omits team type and over-broadly infers team manager rights (`HomeInviteFlow.tsx:432–434,602–609`). Restrict affordances to the exact team/club; canister authorization remains decisive.

## 5. Already on-chain / not findings

- Hardened legacy parent tokens use secure randomness, verify exact child/team/club and current issuer, and prevent revoked guardian replay. `frontend/scripts/test-parent-invites-replica.mjs` contains real isolated-two-authority tests; inspected, not rerun in this audit.
- Group-aware long-token ownership dispatch exists; mutation dispatch refuses ambiguity and does not automatically replay unknown writes.
- Pending edits/moves/revokes have live ICP wrappers. Individual pending-card email reminder actions are hidden for ICP, so their disabled Supabase reads are not leakage.
- ICP Home target discovery uses routed on-chain grants/teams/leagues; later Supabase branches are isolated. Theme selector scoping is not a substitute for correct invite-token/child authority routing.
- Season invitation queue and shared EmailOutbox exist; worker/attempt-bound completion, provider idempotency, and unknown-outcome locks are meaningful protections. Do not remove them for retry convenience.
- Copy/share/QR generation, local cache/handoff, Internet Identity and external Resend delivery are client/identity/transport boundaries, not evidence that membership records live off-chain.
- An email already claimed by a trusted worker cannot be atomically recalled from an external provider. Keep this delivery boundary explicit.

## 6. Verification performed

- Consolidated **23 existing frontend test files**, both modes, reduced concurrency: **Supabase 160 passed / 13 skipped; ICP 127 passed / 46 skipped** (173 cases per mode). Coverage includes join routing, token/pending repositories, parent acceptance, group dispatch, email dedupe, short redirects, season invitation form, role decision wiring, child guards and signup handoff.
- Initial high-concurrency run had one short-redirect timing failure; isolated rerun and final consolidated run passed without edits. Do not report that as a repaired production defect.
- Existing external worker tests: **3 passed**, no mail sent.
- Existing ICP guard scan: passed. The scanner accepts a guard anywhere in a file and does not generally inspect membership table/RPC calls; it cannot certify branch-level isolation.
- Two parent security guard files (`parentInviteAtomicAcceptance.guard.test.ts`, `parentInviteProvisioningSecurity.guard.test.ts`) are explicitly excluded by current Vitest configuration and were **not executed**, despite appearing in an initial filter list.
- Public browser checks: generated `/i/...` showed 404; long `/join/p/...` and registered `/j/...` showed native-only download gate; no page runtime errors. Screenshots inspected.
- Preview build log was OK. No app changes or manual build/typecheck. Canister security findings were source-reviewed, **not** reproduced in a new real-canister exploit test. No signed-in/native acceptance, live module/wiring inspection or real delivery check.

## 7. Smallest necessary closure batch

1. Repair exact role/team/club authority, stale/revoked-state checks and random credentials; add real-canister positive/negative and interleaving tests.
2. Repair valid share origins, `/i` vs `/j`, reusable-token decoding, both-group short-code discovery, lost admin links and guardian write scope.
3. Route the remaining membership/consent/count/mini-league reads to ICP; make pending/shell receipt recovery and exact invite sweeper safe.
4. Preserve manual sharing while Resend is deferred; separate invitation creation from encrypted email queue availability and implement authorized resend semantics. Do not activate delivery in this batch without owner approval.
5. Run focused dual-mode tests and real local two-group invite acceptance/revocation tests; release only affected canisters through an exact protected scope plus matching app, then perform signed-in/native checks in both groups.

This report identifies work still necessary; it does not authorize an upgrade, declare deployed security exposure verified, or certify all invites fixed.