# Account permission coverage — local evidence

This is the current bounded coverage map, not a claim that every endpoint or alternative is covered. The authoritative release blockers remain in `account-removal-release-gates.md`. Admission/routing remain off in production.

## Reused evidence

Runner: `frontend/scripts/test-account-service-admission-replica.mjs`, real compiled services on PocketIC. Delays use the test-only permission authority's observed held-call count, not an arbitrary tick. Key controls derive real vetKeys and decrypt real IBE ciphertext.

| Boundary / alternative | Positive evidence | Denial / interruption evidence | Status |
| --- | --- | --- | --- |
| Vault competition write | Same folder ID succeeds after rejected operation | Suspension and replaced authority during second competition lookup; no insertion | Verified locally |
| Blob upload subscription | Same upload path admits/aborts after rejected operation | Suspension during subscription lookup; no reservation | Verified locally |
| Vault ordinary folder/file single reads | Real folder and file read back | Suspension during held membership lookup | Verified locally |
| Vault folder list / file batch | Real rows, post-fence retry reads back | Suspension, changed fence; no private file returned | Verified locally |
| Vault resource location | Exact owning club returned for authorized folder | Suspension and replaced club authority during lookup | Verified locally |
| PII club-staff ciphertext batch | Real encrypted record returned | Suspension during held staff lookup | Verified locally |
| PII club-staff vetKey batch | Real derived key decrypts expected plaintext | Suspension and fence during second staff lookup **after** actual derivation; no key returned; admitted retry decrypts | Verified locally |
| Trusted vault → club relationship call | Actual unregistered infrastructure principal calls club service for admitted human | Human self-call shortcut refused | Verified locally for this pair only |
| Chat member/private page and digest | Real message read; admitted digest | Stranger, suspension, erasure, replacement, outage and upgrade | Existing local evidence |
| Notification recipient/device | Actual inbox/device registration | Ineligible recipients excluded at claim/device fetch; malformed recipient isolated | Existing local evidence; already-claimed drain open |
| Eight additional domains | Actual competition/league/media and 7-point balance | Selected suspended/erased/outage methods | Existing selected coverage, not exhaustive |

## Still open — do not mark A complete

- Enumerate/map all protected entry points and participant/admin/creator/guardian/staff/competition alternatives; selected service examples are not exhaustive.
- Interrupted multi-record key batches, guardian/competition alternatives and authority changes across all affected services.
- Trusted-service callback compatibility beyond the verified vault → club pair.
- Cross-service snapshots need generation-bound inventory/drain for removal completion; repeated admission is not atomic revocation (B).
- App read adoption, multi-group delivery, full integration and signed-in/device acceptance (C–F).

## Latest bounded validation

19 October 2026: changed vault/PII canisters and delayed fixture compile; expanded real twelve-service runner passes. Only those three artifacts were rebuilt; unchanged service builds reused. No interface changes or bindings regenerated. No deployment, live-data change, global-revocation claim or signed-in/native acceptance.