# Group 2 opening check — 21 October 2026

## Result

Group 2 remains closed. The owner requested opening tests at 02:14 UTC. Focused local evidence passes, but it does not meet the existing production activation boundary. No canisters, registry entries, flags, permissions or routing were changed.

## Checks executed

- Seven focused Vitest files passed: groupOpeningSafety, groupScaling, groupProvisionRouter, groupProvisionConfiguration, groupSessionCrossGroup, accountGroupAuthorities and groupDispatchNewClub. **51 tests passed in ICP mode and 51 in Supabase mode.** Configuration: `vitest.legacy.config.mjs`, serialized files, `IGNITE_BACKEND_MODE` set separately for each run.
- `frontend/scripts/test-scaling-integrated-replica.mjs` passed using existing compiled local artifacts and PocketIC. Two groups, five services per group and a shared device directory verified actual encrypted-photo decryption, fresh-key denial, pending/new upload denial, chat denial, retained-member/other-club access, notification authorization, retries/outages and memory-preserving upgrades. Push sends were stubbed; this is not FCM/device or mainnet acceptance. Existing compiled artifacts were reused; this was not a new release build or module-hash match against live g2.
- Fresh anonymous HTTPS reads of `cycles_balance` and `memory_stats` succeeded on all **13 live g2 canisters** from the provision inventory. The mainnet root key remained pinned; no root-key fetch was used. Balances were approximately **0.98–1.00T each**, all slightly below the existing 1T warning threshold. This indicates low-fuel warnings, not frozen or nonresponding services. Controller/settings/environment verification was not performed without the operator identity.
- The latest available preview build entry was `build OK` at 02:15:07 UTC.

## Why opening still fails

1. `groupProvisionRouter.test.ts` confirms production `enableGroup` deliberately refuses with the revocation-verification boundary, even with a wiring callback or the local test argument.
2. `accountGroupAuthorities.test.ts` confirms verified authority wiring rejects production before reading or mutating authorities.
3. Opening needs removal wiring for the exact approved registry revision, alongside operator approval, recovery, full rehearsal and mainnet evidence. Current removal wiring depends on local-rehearsal admission settings; those must not be enabled on mainnet.
4. Full receiver/drain completion and history-preserving coordinated recovery remain unfinished engineering. Five-service local success cannot prove all-service revocation or recovery. No release flag was introduced and no safeguards were relaxed.
5. Live controller/module/configuration attestation and a signed-in two-group browser/native/real-push flow still require the GitHub-held deploy identity and device sessions. The recorded Group 1 worker grant prerequisite is also outstanding.

## Next bounded release dependency

Finish the production account/removal boundary and its complete-inventory, interrupted-operation and recovery proof in one integrated batch; preserve club-only removal and other-club access. Then perform an explicitly approved, exact-inventory upgrade and signed-in acceptance before opening. Existing photo-bearing clubs stay put. No PlayHQ sync, encrypted-media moves, Cloud Engine activation, full-capacity fill or paid stress testing is part of this check.