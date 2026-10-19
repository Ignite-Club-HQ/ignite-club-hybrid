# Scaling activation boundary — local contract evidence

19 October 2026. **Boundary verdict: FAIL — activation stays blocked.** No live changes.

## Method

`frontend/src/live/accountDeletion.boundary.test.ts` invokes the current self/admin deletion entrypoints, unchanged, against real PocketIC identity and two club canisters (legacy plus new). Both principals of a real linked account have roles in both groups. Actual `openGroupSession` validates a fixture registry and reads real indexed memberships.

Connector seams wrap real actors; the registry transport is a deterministic fixture, not a deployed directory. Other service IDs and purge calls are explicitly stubbed. Outages stop a real club canister and inject an immediate connector failure instead of awaiting a stopped-canister timeout. This is not browser/native, complete inventory, production transport, photo/chat access or content-purge acceptance. Previously issued keys and downloaded plaintext cannot be revoked and are not claimed inaccessible.

Identity uses its existing local-only authority flag. Club services are installed **without admission flags**; their existing setter is wired by temporarily setting its local environment flag, then removing it before business calls. Transient admission remains off. This fixture-only wiring is not production activation, receiver expansion or approval to publish the prototype. No runtime source, deployment or guard changed.

## Results

| Boundary | Result |
| --- | --- |
| Self deletion revokes both linked principals in both groups before shared erasure | PASS |
| Discovery outage preserves identity/memberships; resumed deletion revokes both groups | PASS |
| Registry drift during discovery prevents destructive actions | PASS |
| Outage after first revocation preserves identity; retry includes the now-empty group and does not restore roles | PASS |
| Interrupted unlink denies registration, completes on retry, preserves survivor roles; explicit relink alone restores no roles | PASS |
| Registry changes after first revocation stop shared erasure | **FAIL** — session closes before writes; erasure proceeds without a subsequent registry check |
| Administrator deletion revokes new-group linked roles before shared erasure | **FAIL** — legacy roles are revoked and shared identity erased, but both principals' new-group role grants remain readable |

The failed boundaries are `it.fails` assertions of **required safe behavior**, not tests endorsing unsafe behavior. Convert them to ordinary passing assertions when fixed. Five local cases pass and two reproduce expected failures; 25 existing deletion/session regressions pass (32 checks total). Existing purge-failure logs are intentional fixtures.

Successful self-deletion checks prove fresh role and identity-registration denial in this service slice, not all-domain drain, key revocation, recovery safety or cached material removal. Ordinary club-removal photo/chat evidence remains separate and unchanged.

## One bounded proposal — separate decision required

Give both existing deletion entrypoints the same complete legacy-plus-registered club authority inventory, valid through the destructive sequence. Admin deletion must revoke the selected account on every required authority, not just the selected target; missing/refused authorities or a changed registry must prevent shared erasure. Reuse current bounded discovery/revocation mechanisms and turn these two expected failures into passing tests.

A browser-only revision reread cannot prove an atomic inventory/erasure binding. Check whether the existing backend contract can enforce it; otherwise stop for a separate narrow contract decision. Do not implicitly restart global drain, disable deletion or weaken guards. This evidence task includes no runtime fix.

## Reproduce

Compile the unchanged identity crate for `wasm32-unknown-unknown`, with output under `backend/identity_access/target`. From `frontend/`:

```sh
POCKET_IC_BIN=/path/to/pocket-ic \
IDENTITY_ACCESS_WASM=/absolute/path/backend/identity_access/target/wasm32-unknown-unknown/release/identity_access.wasm \
CLUB_DOMAIN_WASM=/absolute/path/backend/club_domain/main.wasm \
bunx vitest run --config vitest.legacy.config.mjs \
  src/live/accountDeletion.boundary.test.ts \
  src/live/accountData.erase.test.ts src/live/accountData.groups.test.ts \
  src/live/adminAccountDeletion.test.ts src/live/groupSession.test.ts
```

PocketIC 14.0.0; executable must be named `pocket-ic`. Opt-in contract tests skip without local binary/artifact environment values. Existing club WASM reused; identity compiled from current source. No canisters deployed.

Production inventory/control, full-service setup, semantic/recovery checks, funding, browser/Android acceptance, real push delivery and release approval remain open prerequisites. Scaling remains off.