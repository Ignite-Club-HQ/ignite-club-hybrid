# ICP email and season release

## Local implementation

- Club canister copies a season's teams and optionally current coaches/team admins in one capacity-checked commit. An operation receipt prevents duplicate creation. Player rollover validates the whole selected batch, uses the cloned-team mapping and does not overwrite a different target assignment.
- Season pages and new-member invitations use authorized ICP reads. Invitations and verification-code email payloads are encrypted to the delivery worker's RSA public key before entering the on-chain queue.
- EOI initial invitations, requested reminders and competition welcome jobs use competition canister claims and receipts. Pending club invitation emails use club canister claims and receipts. Worker-only claim methods replace Supabase delivery bookkeeping; provider receipt IDs and outcomes remain on ICP.
- `scripts/icp-email-delivery.mjs` sends through Resend. It does not connect to Supabase. It records `sent`, `failed` or `unknown`; interrupted/unknown provider commits are never automatically expired or replayed. Processing jobs left by a lost worker require original provider evidence and deliberate reconciliation, not a guessed retry.
- The manual **Deliver ICP email jobs** workflow has no schedule. It will not send until explicitly run and correctly configured.

## Required before live use

1. Upgrade only the approved existing Group 1/2 club and competition canisters with stable-memory preservation and existing authority bindings. The current request does not authorize deployment or broad upgrades.
2. Configure a dedicated delivery identity, grant its principal through `set_email_workers` on every exact club/competition queue and retain that identity in GitHub `ICP_EMAIL_WORKER_SEED`. Never grant a browser identity as the delivery worker.
3. Generate an RSA-OAEP SHA-256 worker keypair outside the browser. Keep its PEM private key in GitHub `ICP_EMAIL_PRIVATE_KEY` only; put its public JWK in each club canister's app config `email_worker_public_key`. Encryption uses an AES-GCM envelope so verification codes and recipient/content payloads do not appear in public metadata.
4. Add the existing Resend credential as `RESEND_API_KEY`, a Resend-verified sender as `ICP_EMAIL_FROM`, the actual app origin as `ICP_EMAIL_APP_URL`, and exact queue entries as `ICP_EMAIL_TARGETS_JSON` (array of `{ "domain": "club_domain" | "competition_domain", "canisterId": "..." }`, both groups). Do not log these credentials or private payloads.
5. Run signed-in official invitation/code claim, member welcome, public EOI/claim, new-season invite, clone/staff and bulk-rollover acceptance on both groups; read back queue receipts and actual provider delivery. Local tests do not establish hosted credentials, a verified sender, current modules or receipt delivery.

## Evidence limitations

Legacy EOI/welcome addresses remain in their original canister records; this change does not retroactively encrypt those existing records. Only the configured worker can read new delivery claims, but ICP node-operator visibility of legacy plaintext is not fixed by an API permission. New official/club email envelopes are encrypted. Public EOI requires an active owning-club season with published form config, caps new registration emails at three per normalized recipient per day, and rechecks duplicates after randomness. New encrypted invitation queues cap admission at 100 jobs per queue per day. Queues fail closed at 10,000 retained jobs; historical compaction is not implemented, so this is not an unlimited production delivery service. Existing unknown outcomes stay locked; automatic retry, historical erasure reconciliation and other competition report/recovery gaps are not claimed complete here.