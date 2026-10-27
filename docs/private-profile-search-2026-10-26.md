# Private profiles and guardian search

## Owner decision

Full-app person search is reserved for linking another parent or guardian to
a child the caller already has a verified guardian relationship with. Other
searches must use their authorized club/relationship audience. Existing names
and other details must remain viewable in the app.

## Implemented locally

### Consolidated completion status — 27 October

Receiver-local fencing now exists in original PII: rehearsal-only identity-bound
prepare/read/complete endpoints retain exact operation, generation and inventory
digest, durable completion tombstones, concurrent holds and a monotonic release
epoch. Both dedicated private-name endpoints capture before their first await
and check the epoch in the final synchronous release segment. New attempts
refuse while any hold remains; reopening cannot admit a retained old reply.
Capacity exhaustion refuses, with no automatic timeout cleanup or eviction.

Fresh disposable real-SDK tests verify first and final held verifier replies for
ciphertext and keys, fence/reopen ABA, unauthorized callers, committed-but-lost
acknowledgement readback, exact idempotent retries, concurrent holds, and PII
upgrade preservation. The verifier is an explicit test fixture, not the real
cross-group identity resolver; these results certify the sink boundary only.
The Motoko policy/compiler checks and all 17 generated contracts pass.

An initial real identity-owned coordinator now implements rehearsal-only account
suspension: immutable all-group and supplemental original-PII inventory,
stable operation/generation journal (memories 26–27), one bounded sink step,
exact consensus acknowledgement readback, callback-safe progress merges, atomic
no-await suspension/commit, and completion readback before releasing the account
reservation. Unknown outcomes remain durable; completed tombstones are retained.
Direct suspension in the private-name rehearsal must use this coordinator.
Account/profile/history drift refuses commit while retaining fences, and subject
private references cannot point outside the captured original-PII targets.
Suspension advances the account version; retries never reset committed progress.

The wider writer connection is now implemented as a separate stop-the-world
rehearsal, not a production switch. Identity captures the complete registry and
supplemental original-PII inventory in stable memories 28–29. Every sink must
acknowledge its fence before any identity/club/chat/competition/league/PII writer
opens; all writers must seal with zero active work before any sink completes.
Owning methods retain existing permissions. PII management writes participate
as writers too. Topology mutation stays closed, authority timers do not run,
and the older suspension coordinator cannot overlap this rehearsal.

Eleven real local canister writers across two groups pass closed admission,
forged callers, authorized exact-window writes, seal/drain, delayed reopening,
and PII upgrade preservation. The separate real-SDK held first/final ciphertext
and key tests still pass. All 236 Rust tests, 93 focused frontend tests, 17
contracts and ICP guards pass. Production data remains unchanged.

Recovery is NOT complete: a callback trap can leave an anonymous durable active
count unresolved. It safely retains all locks, but can indefinitely prevent
reopening. Do not reset counts or expire them. Individually journaled leases and
verifiable terminal-outcome recovery, plus an actual identity-driven inventory
orchestration test with interrupted callbacks, are required before release.
The eleven-service test manually follows the phases; it is not that complete
orchestration acceptance. Protected conversion and signed-in checks remain
separate. No deployment, conversion or activation approval is implied.

Final local disclosure safeguards now snapshot caller rows, share and confirm
one pending original-authority lease, validate route bindings after closing
checks, and retire sibling batches after refusal. Synchronous session retirement
guards name preparation, hydration, relationship/chat reads and authority
resolution even when an old identity object remains unchanged. Sign-out,
principal replacement and account-cache cleanup invalidate mounted labels.
Chat names clear on background/pagehide, expire after 60 seconds in foreground
and require fresh authorization before redisclosure; that bound is not an
instantaneous remote-revocation guarantee. Generic profile-cache reads cannot
decrypt private references, and cleared batches settle neutrally without late
cache repopulation, old fallback disclosure or replacement-request deletion.

The remaining cross-service gap is precise: a remote authority can commit a
valid response, then revoke access while that response is still in transit.
Another closing read merely moves that window. A sound release-commit protocol
must durably fence every original PII sink before revocation is acknowledged,
advance generations to reject delayed/ABA responses, and cover every relevant
writer in identity, clubs, messaging, competitions, leagues and recovery.
No such coordinated protocol is implemented or certified here. Client-arrival
time revocation and recalling previously delivered IBE keys are impossible;
neither may be promised by a release check. Production remains disabled.

Local display safeguards passed 156 tests per sign-in mode and ICP isolation
guards in the prior batch. The pinned compiler/PocketIC tooling has now been
restored for the fresh receiver-boundary SDK tests described above; the full
real-authority multi-group suite is not newly certified by this fixture.
Live signed-in acceptance remains unverified.

Unanswered DM headers now reuse the page's already-known shared-club locator
through the exact owning club's independent name authorization. The chat's two
participants are checked before and after disclosure; club routing must retain
the same identity. A changed club clears mounted names immediately. Denial never
falls back to direct/global/cache names, and this reader does not scan clubs.
Without a shared authorized club or a peer-authored message, names remain neutral;
an arbitrary caller-created conversation cannot authorize person search.

The connection is rehearsal-only. Both sign-in methods pass 54 focused tests,
including club refusal, foreign subjects, identity/participant drift and mounted
club changes. All 17 contracts and ICP boundary guards pass. No live conversion,
deployment, configuration, email or reader grants changed.

**Production release remains blocked**, not merely awaiting a publish button:

- Final remote decision-to-delivery revocation fencing is not established;
  previously obtained keys cannot be recalled.
- No protected executable private-name release/backfill runner exists. The
  membership-lookup release is a different operation and does not authorize it.
- Production acceptance requires independently approved complete original-PII
  inventory/evidence and an Internet Identity session.

A future protected release must bind every shared/group participant service,
exact original PII key and account reference; journal unknown writes without
replaying them; verify encrypted readback before any plaintext deletion; retain
recovery authority until verification succeeds; and separate deployment from
conversion and authentication approval. Local readiness booleans cannot serve
as authenticated receipts. Do not enable rehearsal flags on production.

### Older announcement readers

The owning messaging service now resolves a reader's stored frontier against
the exact displayed announcement using server message sequences. A later
frontier covers earlier messages, but earlier frontiers never cover newer ones;
missing, ambiguous and legacy-zero frontier references do not imply other
messages were read. Exact reactions remain independently scoped. The new
reader endpoint caps selectors at 100 and responses at 2500 rows (larger sets
refuse explicitly rather than return a misleading partial list), returning exact-message rows,
with current conversation access, blocks and removal checks. Rehearsal badges
and drawers use it; production stays on its existing interface until release.
Original-PII authorization independently rechecks the same recorded evidence.

Unanswered DMs still require independent authorization; a caller-created chat
must not turn into global person search. Final remote delivery fencing,
protected release/backfill and approved signed-in acceptance remain unfinished.

### 23:30 batch — competition-admin names

Connected the standard ICP group-chat display and nested drawers to an exact
competition-admin audience. Messaging stores an immutable competition/member
mapping only during authorized thread opening; it never parses a browser chat
ID. New mappings start empty, so existing threads need an authorized reopen;
unmapped threads stay refused. Purges discard mappings and rekey updates members.

Owning competition checks current admins and the exact member, current remote
club generations, local snapshots, and admission around awaits. Removed admins
remain denied even if stale messaging participants still list them. Fixed the
existing role-list response shape mismatch and added rehearsal-only original-
human delegation for opening/listing admin threads instead of requesting a
manager-only role list as the messaging service. No production activation.

Real original-PII SDK acceptance exercises exact decryption, outsider/guessed
thread refusal, removed admin/block/ABA refusal and preservation across messaging
upgrade. Both sign-in mode tests cover exact authority dispatch and no generic
profile fallback. This batch closes the admin-name connection, not the remaining
release blockers: unanswered-DM and older broadcast reader parity, final remote
decision-to-delivery revocation fencing, protected backfill/release execution and
independently approved production evidence/signed-in acceptance remain open.

### 23:17 continuation — actual delayed delivery and announcement drawers

The disposable messaging relay now holds each of the four real service replies
used by original-PII key derivation. Viewer suspension, subject suspension and
original-name-reference drift at every position withhold all keys; each restored
exact DM decrypts using the real SDK. Blocks after opening replies invalidate
retained revisions. A block after the final remote decision is retained is NOT
certified as delivery-time revocation: final remote block/deletion fencing
remains a release blocker. Previously obtained keys cannot be recalled.

Broadcast keeps the fixed Announcements author label. Only server-recorded
readers/reactors of the exact displayed message qualify for personal names in
its drawers, through the registered messaging authority. Message IDs are
forwarded by reaction/read drawers and included in mounted state isolation.
Arbitrary
principals, fake resources, removed reactions, blocks and stale revisions are
denied. Reading a different announcement cannot authorize this drawer; newer
conversation receipts do not prove an older message's exact name audience.
This conservative restriction leaves older-reader name parity unresolved.
Reaction/read changes advance the retained audience revision; foreground
and private-name reads retain mounted-only state. DM reaction/read drawers now
select the direct reader instead of the group reader. All remains rehearsal-only.

Production cross-group signed-in behavior is unverified. Competition-admin
contracts, unanswered-DM parity, final remote fencing, protected executable
backfill/release and approved production evidence remain unfinished. Local
success does not approve deployment, conversion or persistent reader grants.

### 23:08 continuation — exact direct-message names

Added a rehearsal-only direct audience, delegated from the original PII through
identity to the registered messaging authority. Requests contain at most two
distinct subjects and must match an existing two-person DM with the requesting
participant. A caller-created conversation alone cannot disclose a peer name:
the peer must have authored its own message. Blocking denies fresh reads and
block/unblock changes invalidate retained authorization revisions.

The DM screen uses mounted private profiles for header/author/reply/reader
labels, ignores saved labels during rehearsal and omits names from its disk
message copies; inbox label writes exclude DMs. Opening/closing participant
checks bind identity/target/cancellation and memoized rows repaint on disclosure
or removal. Real disposable original-PII SDK acceptance covers successful DM
decryption, arbitrary-peer enumeration refusal, outsider/service impersonation,
blocking and healthy retries. Production remains unchanged.

Still unfinished: broadcast/competition-admin contracts, actual held-final
service audience races, protected executable backfill/release and independently
approved production evidence/signed-in acceptance. Empty/unanswered DMs retain
neutral private labels until independently authorized; this is not yet accepted
as production feature parity or an approved conversion.

### 22:52 continuation — team, club and club-admin chat displays

Connected team and club author/reply labels, club-admin author/reply/header
and empty-state labels, nested reaction lists and read-receipt displays to
mounted exact-chat private-name reads during rehearsal. Existing hosted mode
is unchanged. Rehearsal team/club message mapping no longer reads or embeds
generic cached profile labels, including first-body/older-page results; read
receipts also ignore cached prop labels. Club-admin's reported enrichment
branch is Supabase-only; its actual ICP mapping carries no profiles already.

The mounted author working set takes the first 100 current IDs, then sorts for
stability; the shared reader splits that set into 25-person authorization
batches under one opening/closing chat lease. A failed later batch discards
earlier names, and account/audience switches discard late replies. Mounted
read-receipt regression confirms stale supplied names never render. 104 focused
tests pass in each sign-in mode, 17 Candid contracts and ICP guards pass,
and preview build is clean. No real signed-in encrypted chat was exercised.

Still unfinished: direct-message/broadcast and competition-admin relationship
contracts, viewport-level long-history author paging, actual final-service
audience race acceptance, executable protected release/backfill and production
evidence. Reply targets outside loaded pages retain neutral private labels.
These are implementation/acceptance gaps, not merely an approval wait. No
live deployment, conversion, grant or activation occurred.

### 22:47 continuation — mounted group-chat names

Rehearsal group chats now resolve names independently of message retrieval.
The exact authorized messaging metadata locates a club or tagged league;
league ownership is confirmed through its owning domain before/after name
hydration. Competition official chats locate their resource through the
caller-authorized competition directory and exact official-chat mapping,
never a parsed conversation ID, name, public directory or organizer-club
membership. The original PII/identity relationship verifier still authorizes
each requested name; these location checks grant nothing. Closing chat
metadata rejects changed participants/scope, account/target drift retires reads,
and ambiguous or over-limit lookups refuse without generic-cache fallback.

Names live only in the mounted chat hook, clear on audience/account changes
and recheck on foreground. Rehearsal message results carry no author names;
author/reply/reaction presentation ignores old generic-cache labels. Existing
hosted behavior remains unchanged and the loopback rehearsal gate stays off.
Competition-admin/broadcast/DM scopes still require their distinct contracts;
this batch does not claim those are complete. Held tests here model frontend
ownership replies, not actual final-service revocation races. Protected executable
release/backfill, full production evidence and real signed-in acceptance remain
unfinished. No deployment, conversion, grants or activation was performed.

### 22:46 completion batch — relationship display connections

Added one relationship display reader that keeps the owning service context
separate from shared identity profile lookup. During disposable rehearsal it
passes exact club/family/league/competition selectors, obtains original-PII
evidence only when an encrypted reference actually needs it, and checks identity,
target and cancellation throughout opening and closing reads. Scoped names do
not enter the generic profile-ID cache. Hosted legacy reads remain unchanged;
this is not an activation switch.

Connected guardian management's exact child, league member list (therefore league
detail), linked-player parent/guardian labels, league administrators and pickable
club members, team adult roster labels and event player-report adult labels.
Some previously suspected caches are Supabase-only: team parent enrichment,
league detail's fallback joins, second-parent email lookup and the legacy
competition-admin chat page. They must remain unchanged. ICP competition-admin
threads use the regular group chat, whose metadata does not yet carry a verified
competition/league audience; inferring one from a conversation ID is prohibited.

Added an offline consistency checker for full expected group set, required
original Group 1, per-group original key comparison and exact subject-to-original
authority conversion receipts. Pending/unknown/missing/mismatched evidence
refuses. This checker does not authenticate receipts, run deployment/backfill,
authorize activation or establish real encrypted readback from supplied booleans.
Five held frontend closing-inventory cases withhold decrypted names after drift;
these are not actual service membership-revocation callback tests.

Still unfinished: verified competition/league chat audience metadata and all
remaining display paths, actual held-final-service audience tests, complete
production legacy inventory/evidence and a protected executable release/backfill
runner. Real signed-in acceptance also requires an Internet Identity session.
Separate approvals still precede any deployment, conversion, grants or activation.

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

### Completion request — scoped name-key audiences, 22:35 UTC

Implemented request-scoped `display_name` ciphertext/fresh-key endpoints on
the original PII service and an identity-delegated verifier. All five audience
selectors (club, exact-child family, competition, league, guardian search)
verify the configured PII caller against the complete pinned registry, the
owning service and the current subject/account/original reference. Browser
selectors do not create grants and cannot request personal emails/media.
Keys reauthorize the whole batch after every derivation has finished.

Club family authorization requires both people to be current guardians of the
same child. Competition excludes public visibility and stale mirrored admin
roles; organizer administration checks live club roles. Competition and league
bracket all human checks with trusted club membership generations, then bind
the complete bounded local permission snapshot plus remote evidence into their
two-observation token. League snapshots include only its own guardian rows.
These are point-in-time fresh-request checks, not recall of previously delivered
keys or atomic global revocation. Excessive evidence refuses, never truncates.

Scoped club/guardian searches now carry the audience to both ciphertext and
key reads. Refused, missing, timed-out or unverified private names fail search
instead of certifying an empty result; ordinary display-only reads stay neutral.
Shared profile hydration accepts family/competition/league scope and original
authority resolver. A central optional independently supplied evidence reader
is used by both search gateways; it has no automatic production source and
never derives approval from a reply, localStorage or membership.

Validation: 109 frontend checks in each sign-in mode, 143 identity Rust
checks, four Motoko service compilations, 17 matching Candid contracts and ICP
guards. New disposable fiduciary-subnet suite actually encrypts and decrypts
through an original Group 1 PII service while all five audiences belong to
Group 2. It verifies outsider/foreign child/authority, public competition,
stale mirrored admin, email isolation, guardian/subject removal, remote
generation invalidation and suspended subjects. Existing real SDK PII
preservation suite also passes. No live data, grants, keys or settings changed.

**Still not complete:** existing family/competition/league display callers must
all supply the new scope (the shared API now supports it); production evidence
must include original legacy Group 1 as well as every registered group; a
protected coordinated release/backfill runner, approved conversion, real signed-in
acceptance and held-final-callback tests for the new audiences remain required.
The new service gate remains local-rehearsal-only; no live deployment, conversion,
plaintext removal or search activation is authorized by this implementation.

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