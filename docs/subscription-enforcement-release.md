# USD subscription enforcement release

## What is ready

- Existing ICP club/media rules locally enforce 250 MiB Free, 1 GiB Single Team, 3 GiB new paid clubs, purchased seats and legacy grants.
- Supabase service-only `reserve_measured_media` and `settle_measured_media` are deployed in the database. Reservations serialize the whole club, include pending uploads and finalized physical objects, validate team/club membership and preserve existing files.
- The existing external HTTP service has an isolated `?job=media-upload` handler. It validates Supabase authentication, receives a bounded raw body, counts actual bytes (not declared size), reserves measured space and uploads with `upsert=false`.
- Gallery, both immediate chat paths, scheduled chat, gallery copies and Vault pass their exact bucket/path/file/team to this handler.
- New purchase products remain disabled. Promo access is not modified.

## Blocking this release

1. Deploying `verify-iap-receipt-icp` failed twice with an internal deployment error on 22 October 2026. No function deployment succeeded. The measured upload release switch therefore stays **false**, so the current upload path keeps working. This is not authoritative aggregate enforcement yet.
2. Complete an authenticated service upload/readback with a real Supabase user, including simultaneous uploads near quota, wrong-team denial, staff-only Vault, lost Storage reply and preserved old files. The external unmanaged session is unavailable in this sandbox.
3. Only then apply restrictive INSERT **and** UPDATE policies to `storage.objects`, rejecting browser writes to `clubs/*` paths in `photos`, `chat-attachments` and `competition-vault`; cover both authenticated and anon roles. Keep reads, deletes, personal paths and exempt branding buckets unchanged. Use the migration tool, not ad-hoc SQL. Enable the measured release switch in the same coordinated release. Older app versions will need updating before this cutover.
4. The live bucket inventory has `photos` and `chat-attachments`, both private. `competition-vault` is absent: provision via the Storage API and preserve competition-specific access rules before competition Vault acceptance. Do not create buckets with SQL.
5. Reservations have no automatic expiry: a lost upload response may have committed the object. Reconcile by reading the exact object and reservation; complete only when its size matches, abort only with confirmed absence and no in-flight write. Never repeat an unknown upload or delete an uncertain object automatically. Aborted/terminal paths remain non-reusable.
6. Upgrade the existing Group 1 and Group 2 club/media canisters through the governor-signed workflows, preserving settings, encryption-key evidence and memory. No signing identity/GitHub token is available in this sandbox. Verify exact new paid identifiers, legacy promo terms and encrypted upload/readback in each group.
7. Website purchase/verification code is not checked into this project. Configure provider products and authenticated entity-scoped purchase intents, verified/idempotent purchase and renewal settlement, cancellation/refund ordering, extra-seat quantity and promo-preserving entitlement updates. Do not use global ICP Pro or URL success as fulfillment.
8. Existing Apple session-free attestation is legacy/global, not ready for new scoped plans; receipt ownership/account binding and active/refund checks must be verified before activation. Google/non-ICP receipt verifiers are referenced but absent from this checkout. Keep purchases disabled until those service implementations and products are available and tested.

## Verified in this batch

- 68 targeted tests passed; 11 existing backend-specific tests skipped.
- Seven real Request/body handler tests cover actual size, exact 10 MiB, 10 MiB + 1 refusal, authentication refusal, quota refusal, wrong-club paths and unknown-commit reservation preservation.
- Changed upload code lint and ICP guard scanner pass; preview reports build OK.
- Database migrations applied with no new security warnings after service-only privilege hardening. Existing 757 security findings are unrelated to this change and remain unreviewed.

Local tests are not signed-in production upload or purchase acceptance.