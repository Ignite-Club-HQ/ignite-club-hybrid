# Stage 2 — separate real-network photo-store rehearsal

Status: smoke scenario ran successfully on mainnet 20 October 2026 (dedicated test store created, funded, configured and smoke checks passed; receipt on the receipts branch). Mixed and tiny scenarios still to run with fresh IDs. No live expansion or group opening.

## Scope/access

Create a new dedicated unregistered test store, never group-1/group-2 storage. Synthetic data only; no live club/quota/router/PII wiring. Existing photos stay untouched.

Signing uses owner GitHub Actions `DEPLOYER_PEM`. No workspace deploy identity or accessible GitHub connection was available. Never paste the key into chat. Existing full mainnet deploy and closed-group installer workflows are unsuitable: they affect more than one test store.

## Run the dedicated workflow

### Pay directly by card

Run GitHub Actions → **Fund photo-store test by card**. Choose a unique payment ID (e.g. `card-smoke-001`), the planned test ID (e.g. `media-smoke-004`), scenario **smoke**, the same funding ceiling as the test (e.g. **5**), and type **CREATE CARD LINK**.

Open the running **Create payment link and wait for delivery** step: its log prints **PAY BY CARD** with the exact Stripe checkout URL. The URL and quoted amount/card fee also appear in the run summary and saved payment receipt. Pay on that hosted page only; never enter card details in GitHub or chat. The workflow waits up to one hour for delivery and reads the deploy-account balance afterwards. Start the test separately only when the balance is sufficient.

It imports the existing `DEPLOYER_PEM` into an isolated temporary CLI identity, verifies the known deploy principal, and requests only `test ceiling − existing account balance`; the test creation fee is already included, not added twice. Smoke/mixed/tiny have no measured exact consumption cost: this funds the ceiling you select, not a guessed per-scenario bill. CyclePay quotes current USD/card terms. Exchange-rate changes, cent rounding, minimum-order rules and delivery fees mean delivered cycles need not exactly match the requested shortfall; a verified sufficient balance is required. No canister is funded or created by this workflow.

Payment evidence is saved on **ignite-media-test-receipts** under `deploy/media-funding/<payment-id>.json` and as artifact `media-card-<payment-id>`. Intent is committed/read back before order creation. An existing ID or any unresolved earlier payment blocks another order. If interrupted, use the existing saved checkout link and reconcile order status as the same deploy identity; do not rerun/create a replacement payment. Unpaid orders may expire; refunds/review/unknown replies require explicit operator reconciliation of the receipt before any further purchase. Keep the receipts branch. Temporary key material is removed on exit and cleanup. This setup does not expose the repository secret or automatically start a paid test.

GitHub Actions → **Test larger photo store (isolated mainnet)** on the branch containing these changes. Start with **smoke**, unique id `media-smoke-001`, and an explicit whole-number funding ceiling from **2–20T cycles**. Default 5T is a proposed funding ceiling, not an estimated test cost. Type **TEST ISOLATED STORE** to authorize spending. The ceiling includes the 0.1T ledger fee; the remainder funds exactly one new unregistered store. No top-ups, deletion or live-group configuration occur.

After smoke passes, run **mixed** with a fresh id for a 5 GiB bounded fill/two churn rounds/upgrade, then **tiny** with another fresh id for a separate 512 MiB target. Each run creates one separate store. The workflow is manual and serialized with existing governor deployments.

Reports appear in the `media-stage-two-<id>` artifact and the dedicated **ignite-media-test-receipts** branch at `deploy/media-tests/<id>.json`. Actions must permit contents-write access. Every mutation phase is saved/read back before calls and each completed phase is saved immediately. Interrupted phases cannot auto-resume; reconcile the saved target and pending intent before any further paid creation. A lost reply can mean a committed operation. Keep the receipts branch.

The runner verifies exact sole controller/subnet/module/environment, excludes known live/group and prior test targets, and reads authenticated fuel before operation batches with a 1T floor plus 0.25T call reserve. The hard ceiling caps upfront funding, not lifetime upkeep or exact per-call consumption. Remaining fuel is retained, not test cost; idle storage incurs upkeep until separate operator cleanup. A low-fuel/incomplete run is not a pass. Upgrade preserves Wasm memory and refuses modules over the bounded direct-upgrade size. Production receives no local rehearsal flags; reservation timing differs from Stage 1.

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

Actual signing/funding/execution needs owner GitHub workflow and approved funding ceiling. The workflow has not run on mainnet; no real time/fuel figures are claimed. Complete existing-file/pending-upload reconciliation plus gallery/chat/vault acceptance remain live-expansion prerequisites even after this isolated rehearsal passes.