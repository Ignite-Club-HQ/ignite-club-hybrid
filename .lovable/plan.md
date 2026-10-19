# Prevent full groups and assess safe club moves

## What this plan addresses

Sending new clubs elsewhere at 80% does not stop existing clubs adding photos and files. We need a way to give existing clubs room to grow and, if practical, relocate a club when a group can no longer expand.

**Moving clubs is included in this plan.** It was excluded earlier because you had stopped photo-move work to protect encrypted media. This plan revisits its feasibility; it does not yet authorize building or enabling encrypted-photo moves.

Increasing storage buys time, but is not unlimited. Moving a club can relieve a crowded group only if the move actually frees its source storage and preserves every photo, file and permission.

## Batch 1 — Establish the actual limits and move feasibility

- Check what the live stores actually run: capacity setting, storage format, used bytes, uploads in progress, quota mode and complete group/store inventory. Use your signed GitHub workflow where access is required; never request your private key in chat.
- Check combined Pro accounting across vault, gallery and chat, including shared-quota and multiple-store configurations. Investigate the identified shared-mode gap rather than assuming the previous single-store proof covers it.
- Review the existing move tooling and determine what is missing for photos, chat attachments, vault documents and their encryption keys.
- Compare moving a whole club with adding storage to its current group. Neither is assumed safe merely because copying files succeeds.
- Deliver a concrete feasibility result: supported approach, missing work, maintenance interruption, recovery requirements and whether source space can genuinely be reclaimed.

**Decision point:** present a separate implementation plan for safe photo-bearing club moves if feasible. If not, explain the blocker and the viable capacity alternative. Do not weaken the existing move refusal.

## Batch 2 — Prevent existing groups being overcommitted

- Make capacity readings reflect usable media space and pending uploads, not just overall canister memory. Keep processing, record limits and running fuel separate.
- Fix demonstrated combined-allowance gaps before distributing a club's uploads across multiple stores. Preserve the combined **5 GiB plus purchased/promotional storage** rule for Pro clubs; preserve free-club monthly caps and retention rules.
- Account for existing clubs' remaining allowances when deciding whether a group can accept another club. Show current usage and committed future capacity separately.
- Check available capacity before granting extra storage or upgrading a club to an allowance its group cannot support. Cover the actual paid/promo entitlement paths; do not imply that granting an allowance creates physical capacity.
- Identify existing overcommitment without reducing sold allowances or deleting media. Present any required restriction or commercial-policy change for your approval before implementation.
- Keep 70% preparation and 80% new-club rollover as the starting rules, adding a capacity-reservation check that can stop admission earlier. Notify you when an old group needs attention even after it stops accepting new clubs.

## Batch 3 — Prove larger storage within an existing group

- Rehearse the existing same-store stable-storage migration with recoverable checkpoints and verified file read-back, without relocating the club or changing its original keys.
- Test the optional 32 GiB ceiling, allocator/record limits, pending-upload pressure and failure recovery before proposing live activation.
- Report the actual tested usable limit. At the current 80% upload admission rule, a 32 GiB ceiling gives at most **25.6 GiB** of byte capacity before other constraints—not 32 GiB of sellable storage.
- If more stores within a group are needed, propose that separately after proving cross-store quota accounting and key/permission compatibility.

## Safe-move implementation proposal — included, but separately approved

If Batch 1 establishes a viable approach, the follow-up plan must cover:

1. Complete, bounded inventories of club records, gallery/chat/vault media, private files, references and pending operations.
2. Verified key continuity and member access after the move, including denied access for removed members and no exposure to unrelated clubs.
3. Pausing relevant mutations during the move; resumable copying with durable receipts; quota reservations on the destination.
4. Verified destination reads before changing the club's assignment; abort recovery before cutover and forward recovery afterwards.
5. Safe source cleanup only after verified cutover, proving storage is reclaimed rather than merely retaining another copy in the original group.
6. Browser and phone acceptance with real encrypted photos/files, interrupted operations, upgrades, notifications and removal checks.

No re-encryption implementation, automatic live move or bypass of current guards is authorized by this plan. Any necessary policy change must be explicit in the follow-up proposal.

## Live release and acceptance

- Run focused rule tests and one integrated local rehearsal per substantial batch, reusing existing evidence where applicable.
- You approve and run mainnet upgrades through your stored deploy workflow. Larger storage, opening another group and any future move activation remain separate approvals.
- Confirm old photos/files still open, uploads count against the correct club allowance, concurrent uploads cannot overrun capacity, and denied members remain denied.
- Existing scaling activation, removal-wiring, recovery, signed-in browser/phone and real push acceptance requirements remain in force.

## Technical details

- Keep group-specific photo-store routing; capacity changes must not rewire group 1 to another group's club authority.
- Distinguish retained combined-storage accounting from free monthly consumption quotas. Reservations, retries, deletes, overwrites and restored ledgers must agree.
- Bind operator evidence to the exact deployment, registry revision, canister inventory, settings and tested modules. Unknown or stale evidence blocks action.
- Keep encrypted-media moves fail-closed throughout this work. Local copy/key tests are not authorization for a mainnet move.
- Supabase-mode changes and new payment methods are outside this ICP capacity plan.

## Cost and approval boundary

Build credits are usage-based; no reliable total can be promised. Mainnet test canisters and network fuel are separate costs. Start with Batch 1 so you can review the true scope before committing to the larger implementation.

**Approval of this plan authorizes Batch 1's investigation only.** Present its findings and the implementation proposal before starting Batches 2–3 or safe-move implementation; it authorizes no live upgrades, storage activation, group opening or club moves.