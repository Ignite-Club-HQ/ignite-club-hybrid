# Scaling stage two — notification batch

## Implemented locally

- Frontend and on-chain fan-out canonicalize principal-prefixed roster addresses, whitespace and duplicate principals. Invalid/anonymous identities fail before queue writes; non-principal account IDs require authoritative resolution, not guessed delivery addresses.
- Group chunk results report actual acknowledged newly queued rows rather than attempted recipients.
- `ICP_PUSH_QUEUE_IDS_JSON` is an explicit array of approved queue IDs, bounded to 32 and duplicate-checked before work. Empty configuration retains the singleton. Queues process sequentially; an outage does not stop other approved queues but fails the run. Existing workflow serialization remains mandatory.
- Devices remain caller-owned in the shared `NOTIFICATION_QUEUE_CANISTER_ID` directory, with no per-group copies. Grant the worker in both the directory and every source queue.
- `authorize_delivery` requires the source queue's current claim lease and complete key. Private notices check fresh club membership; non-direct/non-broadcast chat checks original-human visibility and club membership. State, configuration and fences are rechecked after authority replies. App/personal/invite/removal notices retain their separate scope.
- Authorization runs after token/OAuth lookup and before every device send. Definitive denial stops new sends; unavailable authority retries. Retry preserves the original body. Claim scans at most 200 rows using an advancing transient cursor.

## Evidence

- 27 focused tests across seven files pass: normalization/rejection, queue counts, queue validation/outage isolation, per-device revocation, source isolation, contract signatures and existing notification regressions.
- Both touched services compile with moc 1.16.1 and existing migrations; no new stable state. Seventeen active contracts pass drift checks.
- `frontend/scripts/test-notification-groups-replica.mjs` exercises real club, messaging and notification canisters in two groups plus a shared device queue: canonical retry dedupe; claimed photo/chat denial after removal from A; retained-member delivery in A and other-club delivery in B; device lookup; authority outage/retry, preserved bodies and lease/recovery guards. FCM transport is stubbed.

## Release boundaries

Nothing deployed or activated. Upgrade/wire the relevant queues and messaging contracts, verify every device path uses the shared directory, approve the exact queue set and serialize workers before release. Actual FCM/device delivery, signed-in grouped inbox/browser/Android acceptance and production upgrade compatibility remain part of the separately approved integrated release check.

This is not atomic revocation versus external FCM: a send authorized before revocation cannot be recalled. Whole-account/global-drain work stays paused; stage-one signed-in acceptance and activation/recovery gates remain open.