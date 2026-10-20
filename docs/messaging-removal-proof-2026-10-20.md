# Messaging removal proof — local only

## Status

This completes a tested **messaging receiver slice**, not all Group 2 blockers.
No live service, release flag, placement, funding or group opening was changed.

## Changes

- Additive immutable migration `20261105_000000` introduces persistent receiver
  intents, subject fences and operation counters. Exact retries preserve fences;
  changed generation/subject/digest requests and unauthorized callers refuse.
- Human operations and scheduled/delegated authors retain original-human holds.
  Detached notification callbacks, message websocket callbacks and local photo
  reminder callbacks track their authors; a running reminder sweep is pending.
- Local admission rechecks fences after remote replies; selected accumulating
  batches/delegated summaries check their human again before returning.
- Deliberately disabled legacy reads reject **before** holds/awaits, preventing
  the identified trap-after-await counter leak.
- Snapshot imports stage/validate the full page before mutating and reject
  fenced participants/authors. Rekey/merge cannot migrate denied identities.
- Preparation cancels unfinished local messaging schedules only, preserving
  historical messages. Notification_queue schedules/leases are not certified.
- Canonical messaging Candid and both binding trees refreshed.

## Executed tests

`frontend/scripts/test-messaging-removal-replica.mjs` uses real PocketIC canisters
and `backend/shared/test/messagingRemovalRelay.mo`, a test-only authority/queue.
Eligibility deliberately stays Eligible even after removal: resource denial
must come from persistent fences, not deletion of the authority's role rows.

Verified:

1. A real pre-receiver actor upgrades while preserving conversation, message
   and schedule state. Repeated rejected legacy reads leave no stuck holds.
2. An **observed held membership callback** remains outstanding during fencing.
   Exact retries preserve it; unauthorized/conflicting requests fail. Releasing
   the callback denies the send; drain reaches zero only after it settles.
3. Fresh reads/sends/reactions/replay, delegated summaries, rekey/merge and imports
   reject the fenced human. No denied message appears.
4. A survivor reads the retained history and posts a real new message.
5. A second upgrade retains denial before coordinator retries.
6. Actual management stop/snapshot/load/start preserves messaging denial and
   settled drain. **Identity was not rolled back:** not full history recovery.
7. An observed detached queue call remains outstanding **after send returns**.
   Original-author drain becomes zero only after its held queue reply settles.
   The queue is a fixture, not FCM delivery proof.
8. Clearing rehearsal settings and upgrading leaves preparation unavailable in
   ordinary deployment. No production activation option was added.

Shared `removalReceiver.test.mo` passes. Existing frontend account-read, group
authority and registry suites pass **18 tests per backend mode**. Messaging
compiles with pinned Motoko; all **17 active contracts** pass drift checks.

## Reproduction

Set explicit local artifact paths; the runner refuses missing inputs:

```text
POCKET_IC_BIN
IDENTITY_ACCESS_WASM
MESSAGING_BEFORE_WASM
MESSAGING_DOMAIN_WASM
MESSAGING_REMOVAL_RELAY_WASM
```

Then run `node frontend/scripts/test-messaging-removal-replica.mjs` from the
project root. Compile the relay with the pinned compiler and messaging packages;
compile the actor with its immutable enhanced-migration chain.

The runner checks the real pre-receiver module SHA-256:
`96d673b043f531376c12a6e902b8f5b5de2aa27d551150b8cb96d262924d8a75`.
Artifacts stayed in `/tmp`, not repository deliverables. A future rerun must
supply that same retained/rebuilt pre-module; testing the updated module twice
is not an old-schema proof. This is **not** a measured mainnet baseline or
release approval. No live module comparison was performed.

## Remaining blockers — unfinished engineering

- Receiver integration on events, notification_queue, competition, mini-league,
  club points, media metadata and insights. Reconcile any inventoried original,
  shared, timer/worker/secret services; twelve domains alone do not prove coverage.
- Exhaustive original-human permission/callback paths, interrupted multi-record
  batches, changed authorities and trap/error continuations. Unexpected callback
  traps can conservatively strand a hold; never reset/expire it to certify zero.
  The selected tests above are not exhaustive endpoint proof.
- Actual notification claims/leases, scheduled dispatch and worker delivery;
  quota journals must settle or remain blocking, not be assumed pending-zero.
- Authenticated all-target completion/personal purge bound to exact immutable
  inventory. No completion/unfence endpoint was added here.
- Coordinated stopped full-inventory recovery preserving identity denials,
  receiver generations/counters/receipts and pending work. Reloading a receiver
  cannot authorize restoring an older identity snapshot.
- Integrated complete-service two-group failure/recovery rehearsal, then
  separately approved upgrades and signed-in browser/Android/FCM acceptance.

These local engineering gaps do not require credentials to continue; they are
not completed by deferral or by an approval. Closed installation and opening
remain distinct. Do not weaken gates to create an apparent success. Existing
encrypted-media clubs remain in place, history stays, and previously obtained
keys/downloads cannot be revoked retroactively.