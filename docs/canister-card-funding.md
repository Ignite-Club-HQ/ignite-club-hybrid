# Card funding for canisters and new groups

GitHub Actions → **Fund canisters or new group by card**. It uses the existing `DEPLOYER_PEM` identity. No card details enter GitHub; you pay on the returned hosted Stripe page.

## Low-fuel canisters

Use a unique payment ID (for example `card-topup-001`), purpose `top-ups`, group `g1`, target `3`, and confirmation `CREATE CARD LINK`.

The run reads each mapped canister's actual execution balance and controller access. It selects only balances below 1T, plans enough to bring each toward the chosen target, includes the current cycles-ledger fee, and subtracts the deploy account's existing balance. The plan appears in the job summary before checkout. Saved complete new-group records can also be selected by group ID. Unreadable/missing group records stop the run.

Open **Create payment link, wait and apply approved top-ups (open this log)** and follow `PAY BY CARD:`. After delivery and sufficient balance are verified, the run deposits the saved amounts into the selected canisters and records before/after execution balances. If the deploy account already has enough cycles, no checkout is created and the explicitly approved top-ups proceed. A target is approximate because canisters continue consuming fuel during payment. Healthy canisters are not topped up. Run **Canister health report** afterwards; its existing report covers the primary deployment.

## Preparing a new group

Use purpose `new-group`, an unused group ID such as `g2`, a unique payment ID, and `CREATE CARD LINK`. Existing group install records are refused rather than guessing their remaining spend.

This targets **20.8T** in the deploy account: 13 services × (1.5T initial fuel + 0.1T creation fee), matching the closed installer's default. Existing account cycles are deducted from the purchase request. The target field is ignored for this purpose. Fees and card prices are quoted at checkout; delivered cycles may differ slightly.

Payment **does not install, register or open a group**. Once funding is verified, run **Install new group (closed)** separately using the same group ID. Installation remains a distinct paid approval. This is initial fuel, not an exact consumed-cost estimate or a guarantee of complete installation fuel.

## Interrupted payments or transfers

All card workflows share the `ignite-media-test-receipts` branch, payment records under `deploy/media-funding/`, and one deployment concurrency lock. Unique IDs cannot be repeated; unresolved orders and incomplete top-ups block another purchase across both workflows. Do not re-run after a missing reply or cancellation: a payment may still deliver and a deposit may already have happened. Consult the saved order/transfer record and reconcile manually before starting another request. Never repeat an unverified top-up; the CLI withdrawal does not provide deduplication.

The signing identity only exists in the owner's GitHub workflow. Local tests verify planning, no-replay fencing and failure handling; live checkout/delivery/deposits remain unverified until the owner runs and pays.
## Scheduled group fuel planning (existing balance only)

`.github/workflows/scheduled-group-fuel.yml` runs daily at 06:23 UTC or manually. It shares the deployment concurrency lock and receipt branch with card funding. `scripts/scheduled-fuel.mjs` reads the governor's full registered group list (all target aliases), all 13 domain services and each group's photo store, then each service's own public `cycles_balance` query. Missing inventory or unreadable balances fail closed; management settings are not interpreted as fuel. Shared canisters are counted once. This complements the capacity collector: low fuel is a funding concern, never permission to expand or move groups.

Balances strictly below 1T generate a plan to reach 3T, with the live ledger withdrawal fee included per transfer, and a GitHub issue listing canisters, amounts and total. The summary contains the full plan. The job never creates a card order, charges a card, installs groups or enables routing.

Set owner-controlled `FUEL_MONTHLY_CEILING_CYCLES` (secret takes precedence over repository variable) to an integer number of cycles. Default **0 means plan-only**. Positive values authorize deposits only if the entire plan plus fees fits both the deploy account's existing cycles-ledger balance and remaining UTC calendar-month ceiling. There is no partial-plan spending, balance minting or purchase fallback. This ceiling covers this scheduled job, not separately approved manual card workflows. Changing the ceiling does not reset prior reservations.

Receipts are stored at `deploy/scheduled-fuel/<GitHub run ID>.json` on the existing `ignite-media-test-receipts` branch. The branch must already exist. Every paid run reserves its full cost and saves/read-backs intent before any withdrawal. Unknown outcomes retain their reservation, block further scheduled deposits across months, and require manual reconciliation; re-running the same run ID is refused. Never delete or reset receipts to retry a transfer. Review ledger history before manually reconciling an interrupted receipt. Existing unresolved card payments also block the scheduled adapter. The common workflow concurrency lock serializes these jobs; preserve it for any future writer.

Files: `scripts/scheduled-fuel-policy.mjs`, `scripts/scheduled-fuel-policy.test.mjs`, `scripts/scheduled-fuel.mjs`, and `.github/workflows/scheduled-group-fuel.yml`. Offline planner tests: **5 passed, 0 failed**, including default-zero, exact thresholds, fee-inclusive ceilings, insufficient balance, invalid evidence, persisted intents and lost-reply/non-replay handling. The network adapter/workflow has not been executed against live services. GitHub issue duplication across separate daily runs is intentional; a missing service query or receipt branch fails the run rather than producing a misleading complete plan.
