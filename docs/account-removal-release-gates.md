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

## Next cross-service batch (not implemented)

- Messaging: eligibility must precede participant, signed-in broadcast, admin and scheduled-author alternatives in `canAccessConversation`, `canReadTeamMessages`, `sendAs` and their siblings. Existing ordinary private queries cannot call consensus identity updates; add compatible protected update reads and close alternate query paths before release. Reload membership, blocks, authority and fences after awaits.
- Private keys: gate owner/reader/governor, guardian, staff and competition alternatives before key issuance, and revalidate after derivation. Existing media epochs do not substitute for an identity-wide generation or drain barrier.
- Vault: gate all role and competition shortcuts, and require membership for unrestricted-folder reads; preserve equivalent single/batch/discovery access and reload captured records after awaits.
- Notifications: distinguish worker/service callers from human authors and recipients. `callerAccountId(caller)` currently calls remote `whoami` as the queue canister, not the supplied human; fix with an authoritative subject-bound read. Gate scheduled authors and claim-time recipients/device delivery, not just enqueue.
- Completion still requires a complete server-verified service/media inventory, generation-bound admission fences and in-flight drain acknowledgements. Repeating eligibility checks or frontend preflight alone cannot make removal globally atomic. Authority outages must deny future private reads, writes and key issuance before removal retry; all unselected paths remain release blockers.