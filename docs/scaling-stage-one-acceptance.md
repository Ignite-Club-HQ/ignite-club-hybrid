# Simplified scaling — stage-one evidence

## Implemented and verified locally (19 October 2026)

- Both Internet Identity branches in `withFeatureBackend` now pass through the same scope/activation dispatcher. Previously, a temporary Supabase placement result could send an II caller straight to the shared ICP target, bypassing group dispatch. Shipped gates remain off.
- Club-path blob uploads now verify the original human's membership against the configured club authority at begin, chunk and finalization. Begin rechecks after subscription lookup; shared quota reservation rechecks after its remote reply. Unknown authority/membership fails closed. Existing owner checks, account fences and quota journals remain intact; abort/settlement is not globally redefined.
- Real local two-group flow installs actual club, PII and blob canisters with **no global account-admission flags**. It encrypts/uploads/downloads/decrypts a private photo in each group, revokes only club A, denies fresh A keys/new uploads/chunks/pending finalization, preserves another member in A and the removed member's B photos/uploads.
- A test-only relay holds an actual club-membership reply before administrative removal. Its stale positive reply is released afterward; the real PII service refuses the fresh key after its subsequent membership check. No account erasure or identity fence is used.
- Clearing A's removed-member marker does not restore revoked roles. Real club-canister upgrade preserves denial. Stopped A authority denies fresh private access/uploads, while B still works.
- Ten focused routing/session/media suites pass **93 tests**, covering scope dispatch on both placement branches, denied/unavailable group propagation, entity/host ownership, paging, mixed-group reads, single-attempt writes and existing new-club/invite behavior. Upload service compiles with pinned moc 1.16.1; no Candid interface or migration changes.

## Still unverified / not complete

- This is real local canister and adapter evidence, **not a signed-in browser/native two-group app acceptance**. Production group routing remains disabled. The full app flow is an integration/release gate, not established by mocks or the photo fixture.
- No standalone voluntary leave-club flow was located in the existing ICP frontend/club contract. Team leaving is separate. Do not claim voluntary club leaving works, substitute account deletion, or invent a new flow as part of an authorization fix; its product scope needs an explicit decision if required for rollout.
- The held-key test and pending-upload test do not establish globally atomic revocation of every possible operation or recall already-issued keys/plaintext. Global account erasure remains paused.
- Existing cross-group account/admission prototypes stay local-only. The inspected group-session adapter uses existing registry/membership reads, not prototype identity admission; this does not waive other activation/recovery gates or prove every production dependency resolved.

## Reuse

Run `frontend/scripts/test-club-revocation-replica.mjs` with `CLUB_DOMAIN_WASM`, `PII_ACCESS_CONTROL_WASM`, `MEDIA_BLOB_STORE_WASM` and `CLUB_REVOCATION_RELAY_WASM`. The last is compiled from `backend/shared/test/clubRevocationRelay.mo` using the blob service's core package and pinned compiler. Never deploy the relay.

The focused Vitest files are `featureRouter`, `groupDispatch`, `groupSession`, `groupSessionWrite`, `groupSessionCrossGroup`, `featureScopes`, `groupDispatchNewClub`, `groupDispatchInvite`, `groupRehearsal` and `mediaDecrypt.groups`, using `vitest.legacy.config.mjs` under `frontend/`.

No live services, account-deletion behavior, photo-move guard, activation approval or production prototype flags were changed.