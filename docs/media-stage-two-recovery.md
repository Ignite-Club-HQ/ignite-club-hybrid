# Interrupted mixed-test recovery

## Prepared, not executed
This update is restricted to `media-mixed-001`, existing isolated store `2knbe-saaaa-aaaal-qxpua-cai`, with the original settings (mixed, funding ceiling 5). No live group, new store, top-up or card payment is involved. Mainnet recovery has not been run.

The workflow's explicit manual confirmation authorizes execution: after the update reaches the chosen branch, start **Test larger photo store (isolated mainnet)** with the same ID, mixed, 5, and `TEST ISOLATED STORE`. Do not use a new ID to bypass the interrupted receipt.

## Safety boundaries
- Original module: `8ea0289f54fb5224c1eb1e17da9242e909d34dd333cfb5f7643bbfaaebf76c9b`.
- Recovery module: `dfd4ab701b82e5e69ed4a4077d737d635ce33fc64faf766fecb4f9774da4a433`.
- The recovery fingerprint is the workflow's own pinned build (`icp build media_blob_store` from `deploy/mainnet`, icp-cli 1.7.0, moc 1.16.1). An earlier locally compiled copy differed only in its embedded interface description; program code is byte-identical.
- Bind original receipt, sole governor, exact subnet, environment and both module hashes; journal upgrade intent before an upgrade that keeps Wasm memory. No reinstall.
- Inventory is governor-only and refuses configured club services, nonlocal quotas, foreign pending owners/paths and inventories over 64 entries.
- Validate every pending numeric fill path and declared size before aborting any reservation. Save each exact upload ID before abort and receipt afterward. A lost reply stops; a later run rereads actual inventory rather than guessing IDs.
- Scan all 4,000 mixed paths; verify expected hashes, full byte total and object count. Preserve finalized objects, including holes and partial concurrent batches. Continue missing files only.
- Maintain the original fuel baseline. Unknown module/build, wrong settings, unexpected inventory or insufficient fuel stops safely.

## Local evidence
22 focused checks passed, including the reported 256-object / 773,636,096-byte inventory and an unfinished 8 MiB declaration.
An actual PocketIC upgrade from the exact original Wasm preserved finalized objects and an unfinished upload; governor-only inventory, abort/re-upload, hash/byte reconciliation and foreign-path refusal passed. No stable state was added or transformed.

Run the replica acceptance with the old Wasm at `/tmp/media-stage-two-before.wasm` (SHA above), new compiled Wasm under `backend/media_blob_store/.mops/.build`, and PocketIC 15.0.0:
`node frontend/scripts/test-media-stage-two-recovery-replica.mjs`.

This is not proof of successful mainnet recovery or completed mixed/tiny capacity testing. Retain workflow artifacts and durable receipts after execution.
## Recovery result (2026-10-20 run)
Recovery executed: upgrade verified, 4 unfinished uploads cleared, 256 objects reconciled, fill continued to 279 objects / 846,168,064 bytes. It then stopped with IC0207 (store out of spendable fuel during a 4-upload burst). The store still holds ~1.44T and accepts calls.
Cause: uploads cost 2,000 cycles per byte (~2.15T per GiB). A full mixed run (5 GiB fill + two churn rounds ≈ 10 GiB uploaded) needs ~20T+, far above the 5T ceiling. The runner now refuses up front when remaining uploads are unaffordable and counts the frozen reserve.
