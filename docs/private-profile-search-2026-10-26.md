# Private profiles and guardian search

## Owner decision

Full-app person search is reserved for linking another parent or guardian to
a child the caller already has a verified guardian relationship with. Other
searches must use their authorized club/relationship audience. Existing names
and other details must remain viewable in the app.

## Implemented locally

- Added rehearsal-gated `read_club_profiles`: exact registered source/club,
  at most 25 deduplicated active principals, repeated consensus membership
  checks for caller and subjects, and account/configuration rechecks after
  awaits. No new stored state, grants, name index or decryption path.
- Added `searchScopedProfileCandidates`, which matches authorized returned
  names on the device after private-reference hydration, with no global
  fallback. Ordinary pickers are intentionally unchanged: sequential boolean
  checks cannot establish atomic multi-member freshness or acceptable cold
  search performance. A revision-bound authoritative batch and candidate
  paging plus disposable-canister revocation tests remain required. Never set
  `IGNITE_PRIVATE_PROFILE_READS_REHEARSAL=1` in a production release.
- Added dormant, original-authority-bound adult-name reference hydration to the
  shared ID-based profile reader and own-profile reader. Legacy names incur no
  additional requests. Private references decrypt in bounded deduplicated
  batches through existing authorization-gated PII APIs; unavailable or foreign
  authorities yield a neutral name, never a ciphertext/reference display.
- Added strict owner-only encrypted-name preparation with decrypted readback.
  It is intentionally not invoked by profile saves: publishing references,
  changing search, granting member audiences, and deleting plaintext remain
  blocked on their coordinated contracts and separate approvals. No new
  decrypted-name persistence or automatic data conversion is introduced.
- `search_guardian_profiles` is a consensus update on shared identity access.
  It accepts an exact child ID and the owning club authority, which must occur
  in the configured membership source inventory. It calls that authority's
  `read_has_child_guardian` before disclosure and rechecks the relationship,
  identity/account state and source configuration after awaits.
- The other-parent sheet dispatches by the child's known team, supplies the
  specific child, and isolates search caches by account and child. Results
  carry principal IDs, not account UUIDs, for the existing linking mutation.
- No changes to deployed services, stored names, emails, sign-ins, Supabase,
  or production settings have been made.

## Not complete / do not enable a privacy cutover

This is the purpose-bound guardian-search foundation, **not** a completed
private-name migration. Existing `search_profiles` and `get_profiles_by_ids`
still expose their historical data. Removing them now would break current
member/admin pickers and display-name hydration. Existing display names still
reside in the identity profile store as plaintext.

Remaining implementation:

1. Replace general searches with server-authorized club/relationship candidate
   reads and bounded client-side decrypted name matching, including group
   members and existing competition/mini-league relationships. Preserve
   authorized administrative management without treating an admin screen as
   a second ordinary full-directory search.
2. Add encrypted adult-name hydration and strict owner saves through the
   original PII authority. Keep existing UI details and bounded account-scoped
   caches; avoid per-name sequential key retrieval.
3. Complete the encrypted full guardian-search design: encrypted names cannot
   be substring-searched by the current canister, which holds no decryption
   key. Do not retain a readable search-name sidecar and call it private.
4. Add bounded search traversal and real disposable-canister authorization,
   stale-relationship and name-decryption checks before release.
5. Build an explicitly approved, complete backfill with original-key binding,
   readback and recovery before deleting plaintext. Do not erase names merely
   because supplemental best-effort PII writes exist.

## Release prerequisites

The new guardian API needs a separately approved shared identity service
upgrade and a verified configured source inventory including the child's
owning group. An older service or absent inventory refuses this new search;
it must not fall back to the old unrestricted endpoint. Do not release the
changed sheet alone before its matching service is ready. Live signed-in
Internet Identity acceptance is not available in the local browser session.

Local verification: 134 identity Rust tests pass, including four new club
candidate rules; focused profile/search/invitation checks pass in both modes
(45 Supabase, 29 ICP; mode skips).
All 17 generated Candid contracts pass drift checking. These checks do not
prove a mainnet guardian search or a completed encrypted-name conversion.