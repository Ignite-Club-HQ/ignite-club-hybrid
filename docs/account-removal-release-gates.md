# Account-removal release gates

## Verified locally in the current batch

- Account erasure now writes terminal denials for every current sign-in and an account-level erasure fence before removing records. The account fence rejects older unlinked identities and reconstructed account records; unrelated accounts stay intact.
- Rekey writes a terminal denial for the replaced sign-in before changing its index; dry runs write nothing, exact retries are no-ops, the replacement retains its account/profile and cannot relink the old identity. Version exhaustion and conflicting denial batches refuse without partial account changes.
- Legacy denial CBOR defaults only to the prior unlink policy; erased/rekeyed denial reasons and account fences remain in additive stable storage. A real local canister upgrade verifies deletion/rekey replay denial, surviving profile and bystander preservation, and closed production prototype gates. This is identity-local acceptance, not chat/file/global revocation.
- Final current batch: 38 Rust tests, real identity-local PocketIC upgrade rehearsal and 17-contract drift pass. Independent review prompted exact-destination rekey receipts and rejection of stale restored principal indexes; both have concrete regression tests. Erased-account history is capped at 10,000 and principal-denial history at 80,000; reaching either relevant limit refuses further removal rather than dropping history. Capacity monitoring/expansion must be completed before scaling activation; registration is not admission-controlled by remaining history capacity yet.

- Durable club receipts reject old linked-account snapshots even when sync starts after removal or after an upgrade.
- Contradictory same-version snapshots are refused. A strictly newer explicit relink remains possible without resurrecting deleted roles.
- Unlink intents freeze exact authority targets before the first external call; foreign acknowledgements and incomplete target sets cannot complete removal.
- Legacy pending records migrate using the prior implementation's persisted inventory, which could not change while recovery was pending. Invalid historical inventories reject upgrade.
- Consensus registry evidence validates revision, complete domain/placement sets, deployment, host, network, subnet approvals and required original authorities. Verified wiring is local-only and rechecks the registry between setters.
- Two-real-group PocketIC checks cover stopped authority, suspended sync, receiver and identity upgrades, recovery, surviving identities, newer relinks, old receipt replay and concurrent unlink requests.
- A separate bounded stable map retains principal unlink denials before external calls and after completion/upgrades. Registration, governor rekey and unrelated-account link challenges reject denied identities. A fresh newer challenge from the original surviving account can restore identity eligibility while retaining denial history; deleted domain roles remain absent.
- Local-only, configured-authority consensus eligibility reads accept one subject or 1–200 unique subjects, deny unknown/suspended/revoked identities, and expose account-scoped evidence only—not a resource permission or reusable access token. Missing configuration and non-authority callers fail.
- The latest batch passes 31 Rust tests, 17 focused frontend tests, both full backend-mode suites, 17-contract drift and the two-real-group recovery rehearsal. This is not hosted/native acceptance.

## Not released

The above is recovery correctness, **not authority-wide revocation**. Identity removal is still local-rehearsal-only, frontend membership paging does not call prototype sync, deploy scripts do not wire it, and new-group activation remains blocked.

## Remaining engineering

1. Verify historical restoration and version backup/restore evidence to include principal denials and erased-account fences: existing `export_state` alone is incomplete and must never be treated as an authorization-safe recovery snapshot. New erasures/rekeys now retain history, but completed removals predating these maps cannot be reconstructed from current account records. Keep account-scoped versions distinct from the future globally monotonic fencing generation.
2. Enforce principal eligibility before every resource-permission alternative across all club/group/media services. Eligibility denies or permits evaluating existing permissions; it never grants a role.
3. Handle ordinary query, composite-query and update boundaries explicitly. Consensus identity checks cannot be hidden inside a synchronous helper or called as an update from a composite query. Preserve equivalent single/batch/discovery behavior.
4. Revalidate after awaits and define a drain/ack barrier for already-authorized in-flight operations. A remote check followed by a local commit is not atomic global revocation.
5. Invalidate roles, creator/admin/claimant shortcuts, private-file owners/readers, queued authors/recipients, device delivery, pending uploads, invitation replay, imports and rekeys at the appropriate generation. Keep shared historical records and surviving identities intact.
6. Bind removal to a complete server-verified deployment inventory, including original/shared groups and additional media authorities; every target must acknowledge before completion. Frontend validation alone is not that proof.
7. Test a restarted but unacknowledged group **before retrying unlink**: private reads, writes, delegated access and key issuance must already deny. Cover authority outages, all alternative grants, delayed replies, lost acknowledgements, concurrent retries, upgrades and relinks.
8. Only after these pass: signed-in hosted and native acceptance, followed by separately approved deployment/activation.

Previously downloaded plaintext, already issued keys and delivered notifications cannot be recalled; tests must distinguish future access denial from retroactive cryptographic revocation.

Encrypted-media clubs remain immovable under the current owner policy. No routing activation or deployment is authorized by these results.

## Cross-service local admission batch (implemented, not released)

- Shared `AccountAdmission` checks exact subject binding, active version evidence, anonymous/management rejection and authority failure. Service readers use a separate bounded, additive stable identity reader inventory, not the club unlink receiver list. Its setter and ownership reads remain production-disabled.
- Chat has 40 compatible protected consensus reads; legacy private queries refuse in opt-in rehearsal mode. Human writes and scheduled `sendAs` admission precede local participant/admin alternatives. Vault has 12 protected consensus reads with live club membership, captured-record validation and a 200-candidate limit. No browser uses these prototype reads yet.
- PII reads/key requests gate account admission before owner/reader/governor alternatives and recheck after derivation. Notifications use subject-bound account lookup instead of remote `whoami`, enforce inbox/preferences ownership, recheck captured inbox records, and exclude ineligible recipients at claim/device-token fetch and scheduled authors at dispatch. Malformed recipient IDs are isolated and denied; oversized chat admission batches explicitly refuse rather than report a silent zero.
- Verification: 40 Rust tests, shared Motoko evidence assertions, four compiled service canisters and 17-contract binding drift pass. The real local service rehearsal seeds private chat/ciphertext/vault/inbox rows and covers erased/suspended/replaced subjects, direct reader/role shortcuts, worker recipient/device exclusion, malformed recipients, stopped identity authority and identity upgrade. Existing identity-local upgrade rehearsal remains a separate regression test.
- This batch is not exhaustive authorization or globally atomic revocation. Production service admission flags are unset, deployment scripts unchanged, scaling off. No mainnet/native/hosted user acceptance was performed.

### Remaining service and release work

- Messaging: eligibility must precede participant, signed-in broadcast, admin and scheduled-author alternatives in `canAccessConversation`, `canReadTeamMessages`, `sendAs` and their siblings. Existing ordinary private queries cannot call consensus identity updates; add compatible protected update reads and close alternate query paths before release. Reload membership, blocks, authority and fences after awaits.
- Private keys: gate owner/reader/governor, guardian, staff and competition alternatives before key issuance, and revalidate after derivation. Existing media epochs do not substitute for an identity-wide generation or drain barrier.
- Vault: gate all role and competition shortcuts, and require membership for unrestricted-folder reads; preserve equivalent single/batch/discovery access and reload captured records after awaits.
- Notifications: preserve worker/service identity distinctions; subject-bound lookup and claim/device checks are now implemented locally. Legacy account-ID recipient mapping, observable unavailable-versus-denied results, fair bounded worker paging, all delegated audience alternatives and already-claimed delivery drain remain unfinished.
- Completion still requires a complete server-verified service/media inventory, generation-bound admission fences and in-flight drain acknowledgements. Repeating eligibility checks or frontend preflight alone cannot make removal globally atomic. Authority outages must deny future private reads, writes and key issuance before removal retry; all unselected paths remain release blockers.
## Expanded permission batch — local evidence only

Eight additional domains use opt-in entry admission and additive `read_account_*` consensus reads: club, events, competition, mini-league, points, media metadata, blob storage and insights. Existing public ciphertext streaming remains public; governor configuration and distinct service cleanup retain separate authorization. No stable state or migration was added. Live UI calls and deploy flags are unchanged.

Concrete local tests install twelve actual compiled services and the identity authority. They verify real competition/league/media records, exactly 7 awarded points, suspended/erased subjects denied before private reads and writes, self-only helper rejection, stranger digest denial versus admitted conversation-member success, all eight new-domain denial paths during identity outage, and the previous private-chat/PII/vault/inbox/worker/rekey/upgrade checks. All twelve compile, 40 Rust identity tests and shared admission assertions pass, and all 17 active contracts pass drift validation.

### Focused interruption evidence

The existing twelve-service rehearsal uses a test-only delayed permission authority (`backend/shared/test/delayedPermissionAuthority.mo`). Tests observe its actual held-call count before changing identity status or authority; an arbitrary tick is not proof of a pause. Compile it with the pinned Motoko compiler/core package and set `DELAYED_PERMISSION_WASM` alongside existing service WASM variables. It is never deployed.

Three delayed callbacks pass: suspend the writer during the second competition check when creating a folder; replace the competition authority during that callback; suspend an uploader during subscription lookup. The fixture returns its old permitting snapshot after release. All three requests deny; admitted controls and exact folder-ID/upload-path retries succeed, confirming no denied insertion/reservation persisted. The shared vault competition helper now rechecks admission and authority after every reply; upload subscription handling rechecks admission before reservation. Both touched services compile, all 17 contracts pass drift, and the twelve-service suite passes.

This does **not** finish exhaustive item 1 acceptance: interrupted batch reads/key issuance, changed fences and trusted-service callback compatibility remain unverified. Repeated admission cannot make remote membership snapshots atomic. Global drain/generation inventory belongs to item 3; neither item is released or enabled. No hosted/native acceptance is claimed.

### Approved-plan A: additional focused read/key evidence

The reused delayed fixture now also exposes held consensus membership/staff lookups. The expanded real twelve-service runner verifies five vault single/list/batch/location reads deny suspension during a held relationship reply, replaced club authority hides location, and a new fence returns no file batch. It verifies PII ciphertext batches deny suspension, and suspending/fencing the requester during the **second** staff check (after actual vetKD derivation) returns no key. Positive controls decrypt actual IBE ciphertext before and after interruption. A real vault canister delegates the original human to club_domain successfully; a human cannot invoke the self-only predicate.

Concrete gaps fixed: vault membership reads and resource discovery now recheck admission/authority after remote replies and reload resource/fence state; file batches reject changed club authority. PII ciphertext/key batches recheck admission and epoch at completion, including after post-derivation relationship checks. Legacy membership lookup remains unchanged outside rehearsal; no contracts/state/migrations changed. Only the two changed services and fixture were rebuilt; the expanded existing runner passes.

`account-permission-coverage.md` maps this evidence and remaining alternatives. A remains open: this does not establish exhaustive endpoint/alternative coverage, interrupted multi-record issuance, every delegate pair or global inventory/drain. Older “unverified” statements above describe earlier batches; these selected new cases are now verified locally, not every sibling path. B–F remain separate, scaling off, no deployment or hosted/native acceptance.

### Approved-plan C/D: reused app and worker seams

`domains.connect` uses exact-signature `read_account_*` twins only in development on a loopback canister host. It validates Candid argument/result types and consensus annotations; missing/denied reads never retry through the legacy method. Remote and published actors stay identical, with focused tests enforcing both boundaries. The reused real vault actor verifies the adapter's single/batch results and suspension denial. This is not signed-in two-group UI acceptance or complete discovery adoption.

Local notification admission uses a transient rotating cursor and scans at most 200 candidates per poll, advancing across denied/malformed recipients. The real worker's stale copied Candid was corrected to canonical Nat32 attempts, string idempotency keys, notification acknowledgement/failure results and consensus device-token reads. All worker subset signatures match generated bindings; actual claim→acknowledge and token reads pass through that subset. No hosted delivery or provider call was exercised. Canonical account alias resolution, two-group devices/audiences and already-claimed drain remain unfinished.

### B: concrete protocol gap, not a credential blocker

Current memory 5 persists club-only unlink intents/receipts; memory 8 separately allows service admission readers. Neither is a complete revision-bound deployment/service/media inventory or generation-bound in-flight drain. Account versions are not fencing generations: status changes do not increment them, and erasure/rekey do not use an all-service fan-out barrier. Legacy `export_state` also excludes lifecycle, denial and inventory cells; it must not be treated as a history-complete removal recovery export.

The smallest next coherent implementation is a local-only server-verified full-inventory/fencing-generation protocol with durable intent and one real receiver's persistent fence, generation-bound operation tracking, post-await invalidation and retry-safe drain acknowledgement, followed by every remaining receiver. Preserve existing memory IDs/receipts; any new state requires additive storage and correctly ordered immutable migrations. Until every authority—including additional media, delegated work, key issuance and claimed delivery—participates, neither this vertical slice nor repeated eligibility checks can close B. No such new protocol/state was introduced in the current batch. E/F and remaining A/C/D work also remain open; nothing is deployed or enabled.
