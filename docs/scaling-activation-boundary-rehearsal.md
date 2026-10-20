# Scaling activation boundary — local contract evidence

19 October 2026, updated after the approved bounded fixes. **Demonstrated entrypoint gaps: PASS locally — production activation stays blocked.** No live changes.

## Method

`frontend/src/live/accountDeletion.boundary.test.ts` invokes the updated self/admin deletion entrypoints against real PocketIC identity and two unchanged club canisters (legacy plus new). Both principals of a real linked account have roles in both groups. Actual `openGroupSession` validates a fixture registry and reads real indexed memberships.

Connector seams wrap real actors; the registry transport is a deterministic fixture, not a deployed directory. Other service IDs and purge calls are explicitly stubbed. Outages stop a real club canister and inject an immediate connector failure instead of awaiting a stopped-canister timeout. This is not browser/native, complete inventory, production transport, photo/chat access or content-purge acceptance. Previously issued keys and downloaded plaintext cannot be revoked and are not claimed inaccessible.

Identity uses its existing local-only authority flag. Club services are installed **without admission flags**; their existing setter is wired by temporarily setting its local environment flag, then removing it before business calls. Transient admission remains off. This fixture-only wiring is not production activation, receiver expansion or approval to publish the prototype. Only frontend deletion/session orchestration changed; backend contracts, deployments and activation guards are unchanged.

## Results

| Boundary | Result |
| --- | --- |
| Self deletion revokes both linked principals in both groups before shared erasure | PASS |
| Discovery outage preserves identity/memberships; resumed deletion revokes both groups | PASS |
| Registry drift during discovery prevents destructive actions | PASS |
| Outage after first revocation preserves identity; retry includes the now-empty group and does not restore roles | PASS |
| Interrupted unlink denies registration, completes on retry, preserves survivor roles; explicit relink alone restores no roles | PASS |
| Registry changes after first self revocation stop shared erasure | PASS — identity remains, first-group revocation persists, no purge or new-group revocation follows |
| Administrator deletion revokes new-group linked roles before shared erasure | PASS — both principals lose roles in both groups before shared erasure; registration remains denied |
| Registry changes after first admin revocation stop shared erasure | PASS — shared identity remains and previously revoked roles are not restored |

Both previous expected failures are now ordinary passing assertions. Eight real local contract cases and 52 focused unit/regression cases pass (60 total, no expected failures). Additional checks cover complete admin inventory, authority outage/retry, missing authorities, same-revision authority substitution, registry drift during discovery replies and during personal-content purge. Existing purge-failure logs are intentional fixtures.

Successful self-deletion checks prove fresh role and identity-registration denial in this service slice, not all-domain drain, key revocation, recovery safety or cached material removal. Ordinary club-removal photo/chat evidence remains separate and unchanged.

## Implemented bounded fix and remaining contract limitation

Both entrypoints now use `accountDeletionInventory`: legacy plus every registered group, deduplicated per authority, with session lifetime extending through deletion. Admin revokes the selected account through every club authority's existing `erase_account_membership`, not browser-supplied principal lists. Required authorities are validated before mutations. Full registry contents/revision and caller identity are checked before and after membership calls and before shared erasure; self deletion also checks around content purges. Registry-check failure propagates rather than becoming a tolerated purge failure. Retries rediscover all groups, including groups with no remaining membership.

Follow-up: the final timing race is addressed by an additive **local-only** identity ticket/router reservation protocol with five real router/identity/club contract cases. See `scaling-deletion-timing-acceptance.md` for the contract and non-expiring lock implications. The older boundary suite uses explicit compatibility seams; only the new timing suite exercises the real reservation protocol. Unsynchronized aliases, all-service admission/drain and production acceptance remain outside these proofs and block activation. No live changes or global-drain rollout occurred.

## Reproduce

Reuse the unchanged identity/club artifacts (or compile the identity crate for `wasm32-unknown-unknown` under its target directory). From `frontend/`:

```sh
POCKET_IC_BIN=/path/to/pocket-ic \
IDENTITY_ACCESS_WASM=/absolute/path/backend/identity_access/target/wasm32-unknown-unknown/release/identity_access.wasm \
CLUB_DOMAIN_WASM=/absolute/path/backend/club_domain/main.wasm \
bunx vitest run --config vitest.legacy.config.mjs \
  src/live/accountDeletion.boundary.test.ts \
  src/live/accountData.erase.test.ts src/live/accountData.groups.test.ts \
  src/live/adminAccountDeletion.test.ts src/live/groupSession.test.ts \
  src/live/groupSessionWrite.test.ts src/live/groupSessionCrossGroup.test.ts
```

PocketIC 14.0.0; executable must be named `pocket-ic`. Opt-in contract tests skip without local binary/artifact environment values. Existing club WASM reused; identity compiled from current source. No canisters deployed.

Production inventory/control, full-service setup, semantic/recovery checks, funding, browser/Android acceptance, real push delivery and release approval remain open prerequisites. Scaling remains off.