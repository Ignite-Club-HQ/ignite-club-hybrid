# Scaling stage four — combined local acceptance

## Scope and evidence

`frontend/scripts/test-scaling-integrated-replica.mjs` runs two clubs with five real services per group (club, PII, encrypted blob storage, messaging and notification queue), plus one shared device directory. All actions use the same group instances and people; no account-admission prototype flags or live traffic.

The rehearsal passed the following checks:
- Encrypt/upload/download/decrypt actual photo bytes before removal.
- Remove one person from club A; deny fresh photo keys, pending chunks/finalization and new uploads there.
- Preserve photo access and uploads for retained members and the removed person's club B.
- Authorize photo/chat notifications against those same club memberships, using shared caller-owned devices; exactly six permitted stub sends and none to the removed club/person pairing.
- Preserve duplicate handling, original retry bodies, outage denial, claim/lease guards and queue recovery.
- Upgrade all five services in both groups with memory preservation; original photo ciphertext remains decryptable for authorized members, removal remains enforced, device tokens and queue deduplication survive.

**Chat gap closed locally (19 October 2026):** messaging now checks the original human's current club membership through the configured club authority, in addition to stored conversation permissions. Private legacy reads are consensus updates with refreshed bindings; no new persistent state or account-admission flag is added. The combined rehearsal passes before and after same-service upgrades: removed-club send, history/page/open/search, protected history, edits, reactions, source/target forwards, new schedules, existing schedule replay, trusted delegated delivery, club-admin thread reopening and conversation recreation are denied. Recent conversations omit the revoked club. Retained members still read historical messages; denied sends leave no message rows. Real DMs, competition-admin audiences and the removed person's other club still send and read back. Authority outage denies both retained-member sends and reads. Historical messages are not deleted.

Local creation/reply-loss/directory-upgrade acceptance runs separately through `test-provision-groups-replica.mjs`; its install probes are not full production domain provisioning. Focused provisioning/routing tests: 74 passed. App club/chat/notification regression tests: 56 passed, one pre-existing skipped test.

## Demonstrated fix

A definite closed-group registration refusal previously made the executor record terminal failure. It now preserves the checked record for revision-checked retry without recreation or reinstallation. A lost committed reply remains unresolved and cannot retry without exact reconciliation. Two executor-level tests distinguish these outcomes.

## Reproduction

Run from the project root, supplying existing local WASMs and a PocketIC binary:

```sh
POCKET_IC_BIN=/path/to/pocket-ic \
CLUB_DOMAIN_WASM="$PWD/backend/club_domain/main.wasm" \
PII_ACCESS_CONTROL_WASM="$PWD/backend/pii_access_control/main.wasm" \
MEDIA_BLOB_STORE_WASM="$PWD/backend/media_blob_store/main.wasm" \
MESSAGING_DOMAIN_WASM="$PWD/backend/messaging_domain/main.wasm" \
NOTIFICATION_QUEUE_WASM="$PWD/backend/notification_queue/main.wasm" \
bun frontend/scripts/test-scaling-integrated-replica.mjs
```

## Still blocked / not established

This is an integrated **local service slice**, not a signed-in app/browser/native run or complete new-group provisioning/placement composition. Same-module upgrades establish preservation under local upgrades, not compatibility with live deployed modules or historical snapshot restore. FCM delivery is stubbed; cached plaintext/previously issued keys cannot be revoked.

The combined local rehearsal now passes, including direct chat access. Full domain installation/configuration/health and authenticated durable operator management composition remain engineering dependencies. Production group activation still depends on local-only account-authority wiring; this batch neither enables that prototype nor establishes it is outside the released path. Resolve this dependency before requesting live activation, without resuming unrelated whole-account deletion scope.

Release additionally needs separately approved inventory/controller/funding/key/upgrade checks, browser/Android acceptance and real push delivery. Any actual restore still requires complete authenticated inventory, exclusive fencing and semantic permission/ownership/quota evidence. Scaling remains off; nothing deployed; existing clubs stay put; encrypted-media moves remain prohibited.