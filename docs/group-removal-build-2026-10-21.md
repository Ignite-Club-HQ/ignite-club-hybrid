# Group 2 removal/recovery engineering batch

## Implemented, not deployed

- Additive migration-backed receiver maps on events, competition, mini-league, points, media metadata, insights and notifications. Human update entrypoints now acquire/release persistent holds and recheck local fences after replies. Existing ordinary club removal remains separate and club-scoped.
- Events autonomous reminder/photo/fixture actions carry creator/updater holds. The existing fixture helper checks its original subject immediately after its HTTP result, before fixture mutations; no new PlayHQ sync feature was added.
- Mini-league guardian linking also fences the target guardian; protected self-delegation readers acquire original-human holds. Points awards use a private implementation retaining the human caller and user-target holds rather than a shared self-call.
- Notification issued worker leases/Processing rows count as unresolved work, survive upgrade and cannot be reset by `recover()` in rehearsal. Inbox deletion/clear and snapshot replacement/purge cannot remove those obligations. Local pending schedules cancel at prepare; a running scheduled send carries an author hold and cannot roll forward recurrence after fencing. Settlement remains worker/lease-authenticated.
- All twelve human-data receivers expose exact-bound zero-work seals. Identity can directly verify seals across its frozen targets, but **there is no account erasure/completion or opening authorization** from this method; missing infrastructure receivers still stop it.
- Identity bounded history pages now include removal generation, account barriers, subject fences and observational receipts. Service snapshot imports conservatively reject fenced principal bytes/text before replacing data. False-positive import rejection is possible and intentional; this is not a cryptographic decoded semantic proof.
- Added a complete-inventory offline recovery coordinator core: exclusive controller fence adapter, stop writers then authority, independent external anti-rollback anchor, decoded-history adapter, intent/readback journal, snapshot/load/start intents, approved authority-first resume, refencing on partial start. Added a read-only release preflight that never grants opening.
- Regenerated all affected Candid contracts and both frontend binding trees.

## Executed verification

- Built all twelve real Motoko human-data service actors plus migration coordinator; built missing Rust identity, router and timer actors locally. These direct compiler artifacts are **not mainnet recipe fingerprints**.
- Real seven-service observed held-admission test: events, competition, league, points, media, insights and queue each positively read first, then held the actual eligibility callback, prepared while held, refused sealing, denied the late Eligible reply, sealed only after settlement, retained fences through memory-preserving upgrade and allowed a separate survivor.
- Twelve-service admission/PII/photo/queue regression: real private rows, observed delayed permission callbacks, derived-key decrypt positives, two encrypted stores, suspension/removal, stale authority, exact queue lease, denied inbox deletion/clear, lease preservation through upgrade/recover and authenticated settlement, receiver upgrades, outages and survivor/rekey checks passed.
- Complete closed-group real-service configuration acceptance passed: all twelve routed services plus its own blob store, actual business rows, photo encryption/decryption, worker authorization, upgrades and club-only removal. The test now asserts the actual structured membership-denial reply rather than expecting a transport rejection.
- Existing actual two-group five-service integration passed: removed-club photo/key/upload/chat denial, retained-member and other-club access, upgrade preservation, queues and six stubbed provider sends. FCM/device delivery is not covered.
- Identity Rust suite: 55 passed, including exact barrier/subject/receipt pagination and nonzero seal refusal. Receiver Motoko assertions passed. Real identity history pagination/upgrade rehearsal passed.
- Recovery/release Node safeguards: 14 passed; these use local adapters, not mainnet management or independent production authority.
- Six focused routing/opening/authority/configuration frontend suites: 42 passed in ICP and 42 in Supabase. Candid drift: 17 contracts passed. Preview build log remains OK.

## Remaining engineering — not credential-only blockers

1. **Receiver completeness:** timer_jobs, shared workload identity, registry/router and supplemental infrastructure do not yet implement a proved receiver or authenticated no-human-work classification. Human-domain callback coverage still needs exhaustive review of nested targets, `async*` helpers, role/grant alternatives and snapshots; entry instrumentation is not an all-path proof.
2. **Final completion:** seal verification is observational only. Atomic account completion/retirement, immutable terminal records, exact registry lock/revision integration and lost-completion reply handling remain unimplemented. Do not delete/unfence or accept cached zero receipts.
3. **External settlement:** unknown provider outcomes remain Processing forever until authenticated settlement. No provider-backed durable reconciliation/attempt epoch was added; do not reset/expire this evidence to unblock opening.
4. **Recovery transport:** the new core requires actual authenticated adapters proving whole decoded ledgers/history and an anti-rollback anchor outside the restored set, plus cross-service recovery epochs. No production transport, authority-history merge/import, coordinated full-service old-snapshot restore or independent anchor service was implemented.
5. **Production release:** production account authority setup and opening still deliberately refuse. The preflight reports prerequisites but is not connected to a mutation path and cannot grant opening. No rehearsal flag was released or enabled on mainnet.
6. **Consolidated proof:** seven held admission callbacks, twelve-domain upgrades, full closed provisioning and five-service two-group integration passed separately. A single complete-inventory interrupted-operation/old-module/coordinated-restore test covering infrastructure, every ledger and delayed worker provider settlement remains unfinished.

## Live prerequisites after engineering is complete

Separately approved exact-inventory workflow upgrades, live code/configuration/controller attestation, both-group worker grants/queue configuration, and real signed-in browser/Android/FCM acceptance remain necessary. Nothing was deployed, opened, charged or moved; g2 stays closed. No encrypted-media moves, new PlayHQ sync, Cloud Engine activation or capacity stress run was performed.