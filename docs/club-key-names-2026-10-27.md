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

The protected converter supports `row.clubs` and binds that exact list and scheme to the plan hash. Randomized encrypted bytes are journaled before writes and reused on resume; deriving randomness from a name would allow offline guessing. Copies are byte-verified before profile publication and unknown writes remain locked without replay. Its production runner intentionally does not infer or supply this list: it still needs an authenticated complete per-account club inventory adapter, exact all-original-PII destination evidence and a protected execution/recovery acceptance run before club-key conversion can be activated. The legacy production runner now explicitly refuses convert/recover before credentials or network access; its read-only check remains available but is not a club-key release plan.

`scripts/private-name-plan-artifact.mjs` implements the local immutable-plan foundation: randomized encrypted original/club bytes are prepared once, with exact deployment/operator/inventory/original-key bindings and no persisted plaintext or plaintext-derived hashes. Exclusive private file creation, fsync and pinned hash readback refuse overwrite of corrupt, interrupted or different artifacts. Recovery checks the entire supplied profile inventory, subject links, exact existing references and authorized decryption of still-readable source names before returning pending encrypted rows; already-converted rows retain the original approval plan. Unknown local work retains a non-expiring exclusive lock. These are offline injected-adapter helpers, not a protected CI transport or a production conversion executor. Evidence authenticity, current authority and encrypted-byte receipts still need independent integration.

Inventory investigation found public `list_clubs` queries and authenticated per-club account-role updates, but not an atomic complete account-membership snapshot across all registered groups. A public directory plus a second sweep cannot establish that proof. Do not treat read-only candidate enumeration or supplied inventory hashes as release evidence.

Before rollout: finish the verified inventory adapter and replica refresh orchestration, verify real signed-in loading/search, verify erasure/purge across original authorities, then obtain separate deployment and exact-plan names-conversion approval. Existing rehearsal flags remain required; fixtures cannot approve release. Restricted audiences still incur individual derivations until separately redesigned.

## Privacy and cost limitations

A device that receives a shared key can retain it indefinitely; a 30-day cache expiry or application permission check cannot revoke a copied key or previously received ciphertext. Future cryptographic revocation requires a new key generation and re-encryption. Rotation is not implemented in this local batch. Current checks stop new unauthorized application disclosures, not access to material already obtained.

Shared keys must therefore never cover restricted names or personal emails. Savings are prospective: one key per original PII/club/device cache lifetime for club-replica reads, not one universal derivation for every user or every audience. Actual costs and cold-load timing are unmeasured.