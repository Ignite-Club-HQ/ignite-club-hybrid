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
4. `competition-vault` is now provisioned privately with a 10 MiB file limit. Private reads/deletes use exact current competition staff permissions; the old broader participant helper is absent from this live database, so participant access is not inferred from public competition visibility. Competition staff and participant acceptance remain required before cutover.
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

## 08:49 owner-authorized Supabase retry

- Retried deployment twice; both attempts returned the deployment tool's internal error and deployed no function.
- The deployed `?job=media-upload` endpoint still parses a raw test body as legacy payment JSON (400), rather than rejecting the deliberately invalid token as the new receiver would (401). The new handler is therefore not live.
- Function-local `deno.json` now isolates npm resolution from the preview's root/ frontend dependency tree. Deno dependency resolution and `deno check` succeed; this removes a local resolution problem but did not resolve the remote deployment failure.
- Measured receiver, shared allowance and Vault regressions: 32 passed, 5 existing mode-specific skips. Preview reports build OK.
- `SUPABASE_ACCESS_TOKEN` is absent and authentication is external/unmanaged, so an alternate authorized deployment and signed-in upload acceptance cannot be performed here. Service-role database access is not a Management API deployment credential and is not a real-user upload test.
- Storage write policies and `MEASURED_MEDIA_UPLOAD_ENABLED` remain unchanged. Do not cut over until the receiver is deployed and authenticated readback passes; restricting writes now would break working uploads.

## 04:23 continuation

- Another existing-function deployment attempt failed with the same internal error; the receiver remains undeployed and the release switch remains false.
- Fixed authoritative Supabase legacy Starter/Standard storage to preserve 5 GiB like the frontend; new `usd_v2` paid clubs remain 3 GiB, Unlimited promos remain 5 GiB.
- Reject null byte counts/scopes; validate exact team, mini-league and competition ownership and current staff authorization. Competition staff authorization does not use a generic club-admin bypass.
- Finalization now rechecks current allowance plus other pending uploads. Existing bytes are retained if an entitlement expires mid-upload.
- Added an isolated PostgreSQL regression suite using the **actual migration SQL**, not a rewritten quota model. It covers Free pending/concurrent admission, team isolation, legacy/new amounts, null-size and wrong-team refusals, staff revocation, competition authority, expiry preservation, finalize rechecks, no double accounting, unknown-upload retention and RPC privileges.
- Run with `nix shell nixpkgs#postgresql --command python3 scripts/measured-media-sql.test.py`; it never connects to production and creates/stops its own temporary database.

## 07:36 ICP app release preparation

- Added **Upgrade subscriptions (both ICP groups)**, a separate check/upgrade workflow targeting only both existing club/media pairs; neither the broad all-service deploy nor the closed thirteen-service Group 2 runner is used.
- Preserves routing state, settings, original photo keys and Motoko memory; journals exact intents/readbacks and refuses ambiguous replay or a different active release. Refreshes the governor-verified routing snapshot automatically after successful upgrades.
- 34 focused upgrade/key/journal tests and 27 plan/media regressions pass. YAML and runner imports/request validation pass; ICP guards and preview build OK. Anonymous certified reads confirm Group 1's pinned club/media subnet.
- Exact workflow inputs and live acceptance checklist: `docs/subscription-icp-upgrade.md`.
- Live execution still requires GitHub-held signing access. No upgrade, signed-in live acceptance or publication occurred in this sandbox. New purchases remain disabled.
## 09:27 cutover (22 Oct 2026)

- Receiver deployed via direct CLI; restrictive INSERT/UPDATE policies on `storage.objects` now refuse direct anon/authenticated writes to `clubs/*` in `photos`, `chat-attachments` and `competition-vault`. `MEASURED_MEDIA_UPLOAD_ENABLED = true`.
- Live signed-in acceptance with a temporary user/club (removed afterwards; club soft-deleted because vault folders block hard delete): measured upload 200 with exact bytes, readback 200, direct browser write refused by RLS, reuse of a path refused, wrong-club path refused. Oversized (10 MiB + 1) live request timed out from the sandbox; bucket 10 MiB limit and unit tests cover it.
- Older installed app versions that upload club media directly will be refused until updated. Purchases remain disabled.
