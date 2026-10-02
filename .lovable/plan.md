# Wire sensitive data into the PII canister

## Problem

`pii_access_control` is built (encrypted field storage, per-field reader grants, verified guardian relationships, audit trail) but **nothing writes to it**: `registerLivePii` has zero call sites. Child names, profile display names, and invite emails arrive in ICP mode and are either dropped or stored as plaintext in other canisters. Separately, `createLiveChildForParentOnTeam` passes its arguments in the wrong order, so a child's name lands in the canister's `team_id` slot.

## Key design decision

No canister changes are needed. The PII canister's existing authorization covers every flow:

- `register_pii` requires the caller to be the record's **domain owner**. When an admin creates a child or an invite, the admin (the club, as data controller) is registered as the owner. When a user saves their own profile, they are the owner.
- `grant_pii_read` lets the owner give a parent read access to their child's name.
- `add_guardian_relationship` self-registers when the parent accepts an invite (already wired in `acceptParentInvite.ts`).

Conventions (unchanged from existing reads): child name → `pii_id = child id`, `field_id = "name"`. New: invite email → `pii_id = invite id`, `field_id = "email"`; profile display name → `pii_id = user principal text`, `field_id = "display_name"`.

All PII writes are **best-effort**: a failure is logged, never blocks the main flow, and never surfaces a degraded-UI state.

## Changes

1. **Fix the argument-order bug** (`frontend/src/live/features/club.ts`)
   - `createLiveChildForParentOnTeam(ctx, clubId, teamId, parent)` — match the canister signature `(club_id, team_id, parent)`; drop the name argument (names no longer go to club_domain at all).
   - Update both call sites: `AddPlayerToParentSheet.tsx` (add a `clubId` prop, supplied by `TeamDetailPage` from `team.club_id`) and `useAddExistingTeamMemberMutation.ts` (already has `clubId`).

2. **Child names → PII canister** at every ICP child-creation point:
   - `AddPlayerToParentSheet.tsx`, `useAddExistingTeamMemberMutation.ts`, `AddSecondParentDialog.tsx` (`ensureChildId` ICP branch): after the child is created, register the name with the caller as owner and grant read to the parent principal.

3. **Guardian read grants** wherever a guardian link is created in ICP mode:
   - `useAddExistingTeamMemberMutation.ts` (existing-child link path), `AddSecondParentDialog.tsx` (link-existing path), `ManageGuardiansDialog.tsx` (add-guardian path): after `linkLiveGuardian`, grant the new guardian read on the child's `name` field (best-effort; succeeds when the caller owns the record or is a verified guardian).

4. **Invite emails → PII canister**: inside `createLivePendingInvite` (`club.ts`), after the invite is created, register the invitee email as `pii_id = invite id`, `field_id = "email"`, owner = the inviting caller. Covers all invite call sites at once.

5. **Profile display names → PII canister**: `EditProfilePage.tsx` ICP branch — after `saveIcpIdentityProfile`, register the display name with the user as their own owner. (identity_access keeps its own copy for now; moving reads off it is a separate step.)

## Verification

- Typecheck clean; candid drift check stays 17/17 (no .did changes).
- Update/add unit tests for the changed call sites (`AddPlayerToParentSheet.test.tsx` and any affected mutation tests); run the touched test files.
- Update `roadmap.md` and `frontend/AGENTS.md` with the PII wiring rule and the pii_id/field_id conventions.
