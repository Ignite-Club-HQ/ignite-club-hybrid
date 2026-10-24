# File Vault ICP audit — 24 October 2026

## Status

Vault is **not fully closed**. Two independent source audits traced the app paths through live wrappers and canister implementations. Existing upload, document opening, ZIP decryption, trash and chat-card routing have ICP implementations; this is not a wholesale missing Vault implementation. No production canister upgrade or app publication was performed.

## Repairs made in this audit

- Folder renames preserve restricted roles, ordering, description and colour. Explicit role changes remain supported.
- Mini-league folder/link writes send their actual club rather than an empty placeholder.
- Move destinations read on-chain folders, use account/backend/scoped query keys and preserve request errors with retry.
- Unsupported virtual-team and team-to-club-root ICP moves are withheld rather than falsely acknowledged; a destination-scope canister operation is still required.
- Large-file deletion matches ICP image IDs to the canister's file acknowledgements.
- Export thumbnails use the authorized/decrypted photo resolver; ordinary Vault photos no longer fall back to raw ciphertext URLs.
- ICP storage grants no longer expose Supabase recurring-downgrade controls; mutations also reject before an off-chain write.

## Remaining implementation gaps

### Authorization and inventory

1. `backend/vault_domain/src/main.mo`: legacy read endpoints authenticate but do not establish authoritative club membership when account admission is disabled. Protected read twins do not make direct legacy calls secure.
2. Pins validate the supplied club but not the actual chat's canonical club, caller participation or management authority. Team roots also need authoritative scope checks. Both read variants require conversation authorization.
3. Folder restrictions use local Vault grants rather than current authoritative scoped roles. Ancestor restrictions and destination/write restrictions need one consistent canister predicate.
4. Protected lists trap above 200 candidates without a bounded paging contract consumed by Vault, trash, export and large-file management.

### File lifecycle

5. Single-item permanent deletion removes metadata only. Bulk deletion attempts best-effort blob cleanup after deleting metadata and loses cleanup evidence on failure. Implement durable source-bound cleanup receipts; retain unknown outcomes and never blindly replay or refund.
6. Upload finalizes encrypted bytes before metadata registration without durable registration/reconciliation evidence. Pin a stable file ID and distinguish definite rejection from unknown commit before compensation.
7. Chat mirrors register original attachment URLs with zero bytes and no blob provenance, including unrestricted admin-chat folders. Preserve conversation authority and explicitly implement private independent copies or authorized non-owning references.
8. Gallery-copy IDs derive from current file count and can collide after deletion; source mappings retain removed IDs. Use migration-backed monotonic allocation plus collision checks and transactionally consistent mappings.
9. Restore and metadata backup paths can revive rows with deleted folders, expired/missing bytes or incomplete source mappings. Confirm actual availability and valid authorized destinations; do not describe metadata-only backups as complete file recovery.
10. Blob retention does not reconcile Vault metadata, so expired objects can still look available. Account erasure also needs coordinated handling of blob cleanup, retained shared records, local grants and pins without expanding the separately gated global lifecycle work.

### App parity

11. Add an atomic authorized destination-scope operation for team roots/club roots and preserve complete competition/mini-league scope when moving.
12. Competition folder deep links currently use the ordinary folder getter and discard competition context. Route authorized discovery/read and parent traversal through competition-specific reads, then construct the competition Vault view.
13. Storage display combines Vault-only categories with all-media/pending totals and can silently omit failed store reads. Use authoritative scoped allowances and distinguish unknown/incomplete usage from zero; personal global IAP must not grant paid club capacity.

## External capabilities

Google Drive OAuth import, linked-folder sync and title resolution remain Supabase-only and hidden in ICP. This is an actual missing integration capability, not an on-chain equivalent. Saving an external Google document link is already supported with on-chain metadata; its destination remains Google. Closing import/sync requires an authorized Google transport and encrypted token handling, not a fabricated Vault endpoint. Payments remain the approved external boundary; device encryption/cache and ZIP assembly are client processing, not off-chain data persistence.

## Verification and release requirements

- Focused dual-mode unit tests exercise the repaired app paths; regression coverage includes preservation of committee restrictions, exact move scope, errors and ICP image deletion acknowledgement.
- These unit tests do not prove the remaining actor authorization/lifecycle issues solved. Add disposable real-canister tests for outsiders/revocation/ancestors/pins, >200 records, expired/missing objects, interrupted cleanup and populated upgrade preservation before claiming completion.
- Existing and future canister changes require separately authorized exact protected upgrades in both groups, reciprocal authority verification, compatible web/native release and signed-in Internet Identity acceptance. No signed-in II session is available in this sandbox; private Vault UI acceptance is unverified.