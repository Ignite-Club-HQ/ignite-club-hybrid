# Private profiles and guardian search

## Owner decision

Full-app person search is reserved for linking another parent or guardian to
a child the caller already has a verified guardian relationship with. Other
searches must use their authorized club/relationship audience. Existing names
and other details must remain viewable in the app.

## Implemented locally

- Added rehearsal-gated `read_club_profiles`: exact registered source/club,
  at most 25 deduplicated active principals, two atomic consensus membership
  batches at one exact durable revision, and account/configuration rechecks
  after awaits. `club_domain.read_profile_membership_batch` admits subjects
  before evaluating all local memberships without another await, rechecks
  revision/authority/fences after admission and refuses deleted/foreign clubs.
  No new stored state, grants, name index or decryption path.
- Added `searchScopedProfileCandidates`, which matches authorized returned
  names on the device after private-reference hydration, with no global
  fallback. Added `read_profile_candidates` and cancellable
  `searchScopedClubProfiles`: each authority page scans at most 100 source
  rows and emits at most 25 role/parent/guardian principals; cursors pin one
  durable revision, results deduplicate across pages, and final confirmation
  follows all name/decryption awaits. A 100-page work ceiling refuses incomplete
  traversal rather than presenting an empty completed search. No new storage.
- Membership-state audit found a missing epoch bump in the empty owner-test
  identity setter; it now invalidates suspended reads like other membership
  authority changes. The remaining direct membership-bearing assignments have
  synchronous revision bumps in their update paths.
- Ordinary pickers are intentionally unchanged: interrupted full
  identity-to-club callbacks and private-name audience/decryption acceptance
  remain required, as do competition/mini-league relationship scopes. Never set
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

### Original-authority transport connection — 21:56 continuation

Added `readLiveAccountAuthoritySnapshot`, returning the complete validated
consensus registry instead of dropping placement/PII rows. It copies approved
bindings and pins identity object, principal and full target before/after actor
connection, module loading and every registry page. The live resolver composes
this transport with opening/closing inventory checks. Runtime target alias and
on-chain deployment alias are independently bound rather than rewritten.

Scoped hydration now accepts the resolver across every candidate page; both
member and exact-child guardian gateways can create it from explicitly supplied
approved evidence. Tests exercise real composition with the router transport
mocked: foreign-group routing, closing readback, revision refusal, omitted
placement refusal, same-principal identity replacement, target substitution and
different aliases; gateway tests verify evidence/cancellation propagation and
no readable fallback. 103 checks pass in each backend mode, all 17 contracts
match, ICP guards pass and preview build is clean.

This removes the missing transport/gateway connection, not release prerequisites:
screens do not yet receive independently approved deployment/legacy-inventory
evidence; guardian/family/competition/league name-key audiences remain unfinished.
No registry approval is inferred from its own reply, private reference or cache.
No live flags, grants, ciphertext, readable names or sign-ins were changed.
Real signed-in cross-group encrypted search is not verified.

### Final checks requested at 21:48 UTC

Both-mode focused acceptance passed (145 email-mode / 129 ICP), along with
140 identity regression tests, all 17 contracts, ICP boundary guards and real
disposable transport and SDK-encryption replicas. Independent review identified
two additional gaps: scoped traversal did not pin the caller/target across every
page, and legacy guardian search retained profile bindings across its final
relationship await. The traversal now refuses identity/principal/target drift
after every await; legacy disclosure rejects any account/profile revision
change. Two concrete frontend drift tests and one Rust revision test were added;
28 focused tests passed in each mode, all 141 Rust tests passed and the rebuilt
transport/held-reply replica passed. Preview build is clean.

This is NOT production encrypted-search acceptance. Exact-child permission
does not yet authorize unrelated adults' name keys; ordinary/family/competition/
league audiences and verified original-PII resolver callers remain incomplete.
Hosted search still deliberately uses its transitional readable-name path;
providing a club parameter there is not server-enforced club filtering. No
production encrypted switch, conversion or grants were activated. Real signed-in
encrypted search and final-delivery freshness remain unverified. Previously
acquired decryption keys cannot be recalled; revocation tests prove only fresh
authorized requests.

### Coordinated search connections — 26 October, 21:33 request

- Connected team member (single/bulk/second-parent), club-admin,
  mini-league parent and competition organizer-club pickers to the shared
  exact-club search gateway. Query cancellation reaches scoped search and
  search keys include account/club/relationship where available. The second
  league-parent dialog now dispatches ICP search instead of calling Supabase.
- Explicit loopback-only rehearsal selects the encrypted scoped reader;
  existing production search remains an explicit transitional path. A refused
  scoped request never falls back to unrestricted search. Hosted builds cannot
  activate this rehearsal flag. No live privacy cutover was performed.
- Added identity `read_guardian_profile_candidates` and
  `read_guardian_profiles`, generated both contract copies, and connected the
  existing other-parent screen through bounded device-side matching. Each
  stable B-tree range reads at most 100 profiles and emits at most 25 candidates;
  no full profile materialization or new readable name index. Memory 25 pins
  account/profile writes. Cursors bind the viewer/aliases/exact child/source/
  configuration/revision and expiry; every page/readback repeats live guardian
  verification. The frontend rechecks original bindings after decryption and
  all retained matches after the final page; cancellation/20-second read waits
  and a 100-page work limit refuse incomplete traversal.
- App-admin assignment and DM restriction search now use the existing
  service-authorized admin directory, not ordinary `search_profiles`.
  Administrative powers remain separate from the sole ordinary guardian
  full-search screen.
- Real disposable identity/router/two-club tests verify guardian/non-guardian/
  anonymous/foreign-source behavior, 100-scan/25-row bounds, ordered pages,
  child-bound cursors, profile-revision drift and removed-guardian readback,
  alongside the previous club audience/outage/upgrade checks. These are actual
  service calls, not browser booleans. Rust storage tests verify a 130-profile
  directory partitions 100/30 and mutation revision updates.

The search connections are built, but encrypted guardian-wide key access is
NOT complete: existing PII owner/explicit/club grants do not authorize a
verified guardian to decrypt every candidate's adult name. Original-PII live
resolution, family/competition/league audiences, real signed-in encrypted
search acceptance and approved conversion/release remain blocked. No broad
reader grants, canister deployment or live names/emails conversion occurred.

### Completion batch: 26 October, strict saves and whole-search guards

- Owner name preparation and optional contact-email saving now share strict
  encryption/registration/decrypted-readback handling. Contact emails retain
  the existing `contact_email` identity, not a new incompatible field. An
  explicit empty edit writes encrypted empty content; a missing initial email
  read never automatically clears storage. Email delivery remains optional.
- Edit Profile no longer reports a silently failed private copy as success.
  A partial public-profile save is disclosed without automatically replaying
  an unknown private write. Adult profile plaintext remains transitional;
  this is not private-reference publication or backfill.
- Identity profile validation accepts canonical original-authority private
  references longer than the old 80-byte plaintext limit only for a current
  account alias. Foreign/anonymous/malformed/future references are refused.
- Private display rejects another returned principal's reference and foreign,
  wrong-field or duplicate encrypted records. Search revalidates all retained
  match bindings after the last page without deriving private keys twice.
  Earlier suspended/relinked subjects cannot survive later-page decryption
  just because the club revision did not change.
- Real held identity-to-club replies verify caller link changes at both
  boundaries and subject link changes at the final boundary. Ordinary
  configuration replacement is itself refused by the existing fenced-recovery
  rule; rejected changes preserve authorized reads. Actual replacement drift
  is not newly verified or bypassed.
- Real SDK PII tests verify owner-only contact-email decryption, unrelated
  and club-role refusal, name-grant/email separation and encrypted empty
  clearing. No messages were sent and no mainnet data/settings were changed.

Remaining blockers are implementation, not merely approvals: original-PII
location contracts across groups; family-only/competition/league adult-name
audiences; encrypted guardian-only full search; ordinary picker replacement;
complete approved backfill/recovery and release acceptance. Previously
evaluated remote final replies do not prove atomic delivery-time revocation.
The real preview redirects `/edit-profile` to `/auth`; authenticated profile
saving remains UNVERIFIED without the owner's Internet Identity session.

### Continued original-authority preparation

- Added an explicit, disconnected `createPrivateProfileAuthorityResolver`
  composition. Its transport must supply a complete consensus registry under
  the exact approved deployment/revision/host/network/subnet binding. It rejects
  missing/foreign/duplicate PII authorities, preserves the immutable referenced
  key service and authenticated identity, and compares the full inventory again
  after decryption. It never enables groups, creates grants, or changes keys.
- Private-name hydration can opt into that resolver in rehearsal, groups by
  original authority without mixing same-subject names, and bounds all groups
  together to two concurrent ciphertext requests of at most 100 subjects each.
  Both original-location discovery and closing confirmation are bounded;
  refusal or stalled confirmation withholds decrypted names. Existing production
  readers remain on their configured authority, with legacy zero-network names.
- Found and removed reliance on retained media/session keys in private-profile
  reads: owner name/email readback and private-name hydration now request fresh
  gated keys without loading or storing cached keys. Other child/media paths
  retain their existing policy. Relay batches deduplicate and cap at 25; truncated
  replies refuse. Account/target/cancellation guards recheck each await;
  timed-out ciphertext replies cannot start late key derivation or display names.
- Owner writes reject authority/identity drift before registration and again
  after acknowledgement/readback, without replaying uncertain writes.

This is tested preparation, not the completed live cross-group location
contract: the production resolver wiring and release evidence remain blocked,
along with family/competition/league audiences, encrypted guardian search,
picker replacement and approved backfill. No deployment, conversion or new
grants occurred; real signed-in cross-group name display remains unverified.

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

Local verification: 135 identity Rust tests pass, including five new club
candidate rules; focused profile/search/invitation checks pass in both modes
(45 Supabase, 29 ICP; mode skips), with the latest 30 private-name checks
rerun in each mode. Motoko profile membership tests and build pass. The new
disposable two-club suite passes service-only delegation, nonmember/foreign
club rejection, candidate ceiling, family membership, removal/explicit
re-grant ABA revision rejection, upgrade preservation and closed release gate,
plus bounded multi-page traversal of 252 real role holders, family candidates,
malformed/stale cursor refusal and removed requester denial.
The additional `test-private-profile-transport-replica.mjs` passes real
router-pinned shared identity to both clubs: anonymous/nonmember/unregistered
authority/foreign-club denial, duplicate and size rules, suspended callers and
subjects, club-local removal without blocking the other club, opaque-reference
preservation, source outage/recovery and identity upgrade. Profile reads now
reuse the existing membership viewer guard for pending deletion/link drift
before and after each await. The full 135 Rust checks pass after this change.
The deterministic test-only `profileMembershipBatchRelay.mo` now forwards
actual real-club replies and holds either first or second reply until explicitly
released. The transport suite verifies observed pending replies before caller
suspension at both boundaries, subject suspension during the final reply and
club removal between batches; all suppress disclosure and authorized retries
succeed. Relay inventory is explicitly test-only, not deployment evidence.
The direct two-real-source suite also passes independently without the relay.
The new `test-private-profile-pii-replica.mjs` installs real PII and club
services on a disposable PocketIC fiduciary subnet using `key_1`. Actual SDK
IBE encryption, authorized encrypted-key delivery, verification and name
decryption pass for owners, explicit readers, and both admin and ordinary
club role holders. The historical `read_has_club_staff_role` method accepts
any exact-club role; the test checks that actual implementation rather than
assuming its name implies staff-only access. Unrelated and anonymous callers
receive no fresh ciphertext/key; overwrite/self-grant attempts fail. Different
fields/subjects cannot decrypt with the owner-name key. The 100-ciphertext and
25-key ceilings, explicit/club revocation, club removal/re-grant, stopped
authority denial/recovery and original-key upgrade persistence also pass.

The optional test-only `privateProfileClubRelay.mo` forwards real club decisions
and holds an observed opening or final authorization reply. The real PII suite
now verifies club-grant revocation and authority changes at both replies,
explicit-reader revocation at the final reply, and membership removal between
the opening and final checks. These cases withhold encrypted keys; healthy
retries decrypt through the original authority. Run with
`PRIVATE_PROFILE_CLUB_RELAY_WASM=<compiled local relay>` to include them.
Removal after an already evaluated final club reply without a PII epoch change
is still unverified; this evidence does not imply atomic delivery-time freshness.

Scoped candidate matching now repeats identity-to-club authorization after
private-name hydration and compares exact principal/account/original reference
sets before returning decrypted matches. Focused tests reject membership
refusal, removed subjects, relinked accounts, changed references, duplicate or
foreign confirmation rows and cancellation. All 37 private-name frontend tests
pass in both modes. This helper remains disconnected from ordinary pickers.

These tests use fresh requests: previously delivered plaintext or keys cannot
be recalled. They do not establish family-only, competition/league or global
guardian-search name audiences, or location discovery across original authorities. No grants are
created outside the disposable replica and no profile references are published.
Run after compiling the two services' `.mops/.build` Wasm files:
`POCKET_IC_BIN=<local binary> node frontend/scripts/test-private-profile-pii-replica.mjs`.
Optional `PRIVATE_PROFILE_PII_WASM` and `PRIVATE_PROFILE_CLUB_WASM` select
local artifacts. The script refuses errors instead of skipping crypto coverage.

Identity account-link/configuration drift under a held membership reply, final-club-reply
delivery-time revocation, and complete picker integration remain unverified.
No live acceptance or release authorization.
All 17 generated Candid contracts pass drift checking. These checks do not
prove a mainnet guardian search or a completed encrypted-name conversion.