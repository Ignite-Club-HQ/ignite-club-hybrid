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