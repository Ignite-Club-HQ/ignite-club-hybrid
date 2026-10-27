# Club-key adult names

Local implementation only. No production conversion, rollout, permissions or email policy changed.

- Adult names have an original person-key record for family, guardian search, competition, league, direct and broadcast audiences.
- Optional club replicas encrypt to `clubnames:<club_id> + U+001F + display_name` under the original PII canister's unchanged `ignite-pii-v1` context. SDK IBE randomness is independent for each encrypted value.
- The replica is stored as `club_display_name:<club_id>` with `vetkey-club-names-v1:<club_id>` metadata. Generic record writes, reads, key derivation and snapshot imports reject this reserved namespace. Snapshot export excludes these replicas.
- Existing exact-club identity authorization selects the replica only after it validates caller, subject, registered authority, current profile reference and original PII owner. Other audiences retain the original ciphertext.
- The shared-key endpoint checks the complete exact candidate batch before and after one paid derivation and retains release-fence/account/authorization epoch guards. No key is issued for other scope kinds.
- Client reads authorize every displayed batch and repeat the ciphertext/authorization read after decryption, even with a cached key. Cached keys are isolated by account, original PII, host and club; concurrent loads share one request. No decrypted names are persisted.
- Changing or deleting the original adult name invalidates all its club replicas. Club purges remove local replicas. Encrypted photos, documents, children and personal emails are unchanged.

## Preparation and release

`preparePrivateOwnClubName` is an explicit rehearsal-only helper; it does not publish a profile reference. The backend requires an original person-key name record first. No ordinary profile save automatically writes replicas.

The protected converter supports `row.clubs` and binds that exact list and scheme to the plan hash. Copies are byte-verified before profile publication and unknown writes remain locked without replay. Its production runner intentionally does not infer or supply this list: it still needs an authenticated complete per-account club inventory adapter, exact all-original-PII destination evidence and a protected execution/recovery acceptance run before club-key conversion can be activated. The legacy production conversion workflow must not be used to claim a club-key rollout.

Before rollout: finish the verified inventory adapter and replica refresh orchestration, verify real signed-in loading/search, verify erasure/purge across original authorities, then obtain separate deployment and exact-plan names-conversion approval. Existing rehearsal flags remain required; fixtures cannot approve release. Restricted audiences still incur individual derivations until separately redesigned.

## Privacy and cost limitations

A device that receives a shared key can retain it indefinitely; a 30-day cache expiry or application permission check cannot revoke a copied key or previously received ciphertext. Future cryptographic revocation requires a new key generation and re-encryption. Rotation is not implemented in this local batch. Current checks stop new unauthorized application disclosures, not access to material already obtained.

Shared keys must therefore never cover restricted names or personal emails. Savings are prospective: one key per original PII/club/device cache lifetime for club-replica reads, not one universal derivation for every user or every audience. Actual costs and cold-load timing are unmeasured.