# Stage 2 — separate real-network photo-store rehearsal

Status: requirements prepared; NOT deployed or run. Owner agreed to the next testing stage on 20 October 2026. No live expansion or group opening.

## Scope/access

Create a new dedicated unregistered test store, never group-1/group-2 storage. Synthetic data only; no live club/quota/router/PII wiring. Existing photos stay untouched.

Signing uses owner GitHub Actions `DEPLOYER_PEM`. No workspace deploy identity or accessible GitHub connection was available. Never paste the key into chat. Existing full mainnet deploy and closed-group installer workflows are unsuitable: they affect more than one test store. A separate durable runner/workflow and focused safety tests still need implementation; no runnable Stage-2 workflow exists yet.

## Required safeguards

- Pin `@icp-sdk/icp-cli@1.7.0`, network `ic`; authenticate exact controller/governor, subnet, target and module. Bind durable mutation intents/receipts to the newly created store. Unknown creation/install replies stop for reconciliation, never recreate/reinstall.
- Never forward `*_LOCAL_REHEARSAL` flags. Stage 1 used `IGNITE_MEDIA_SLOT_LOCAL_REHEARSAL=1` to reserve physical slots at upload start; production without it allocates at finalization. Tested concurrent reservations are not production evidence.
- Only the test store receives verified governor config, `IGNITE_MEDIA_LARGE_CAPACITY=1`, empty-store stable-write enablement and a 5 GiB bounded ceiling. No growth/admission/shared-ledger prototype release or customer allowance/count changes.
- Approve exact paid scope/cycle budget before creation. Measure real fuel with a hard spend bound/floor. Simulator cycles do not price the run.

## Acceptance sequence

1. Authenticated baseline, then synthetic owner-path smoke uploads/readback/hash, unauthorized delete rejection and interruption recovery under production configuration only.
2. Mixed fill towards 5 GiB configured capacity: four concurrent requests, observed refusal with reasons, exact totals, streamed SHA-256/length samples and two same-size delete/re-upload rounds. Record real times/fuel.
3. Upgrade only the test store preserving Wasm memory during a multi-chunk unfinished upload. Resume/hash-check and re-read samples/totals.
4. Tiny stress at 512 MiB on a separate approved fresh target, never automatic reinstall. Distinguish physical refusal from record-cap refusal.
5. Persist complete scenario receipts immediately; retain stopped/failed results without merging different builds/environments. No registration/routing/opening/live expansion. Paid store cleanup/retention is an operator decision.

## Open blockers

Standalone durable runner/workflow and safety tests unfinished. Actual signing/funding/execution needs owner GitHub workflow and approved budget. Complete existing-file/pending-upload reconciliation plus gallery/chat/vault acceptance remain live-expansion prerequisites even after this isolated rehearsal passes.