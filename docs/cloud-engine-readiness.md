# Cloud Engine readiness — 20 October 2026

Placement Settings already supports engine addresses, service IDs and country links. Now it also saves planned deployment/subnet/group/proxy links, shows missing complete-service mappings and blocks activation. These are planning records, not authoritative group registration. No live settings changed.

## Required before activation
- Select an actual engine and obtain console configuration, API host, subnet, controllers, capacity and rental terms. Verify Internet Identity and certificate trust.
- Build an engine-specific closed installer. Existing paid cycles-ledger installation and positive-cycle health checks are MAINNET ONLY. Engine canisters hold **zero cycles** by design; monitor module/running/interfaces, capacity and rental/service status, not low cycles. Do not use card top-ups on engines.
- Verify full domains, dedicated photo store, shared identity/control services, worker/authority links, actual controller/subnet/module receipts and authoritative group placement revisions. Pasted IDs do not prove deployment readiness.
- Audit cross-subnet calls in both directions: bounded-wait and no attached cycles. Handle unknown outcomes with durable reconciliation, never blind replay. Same-engine calls are exempt from this cross-subnet restriction.
- Obtain the real console proxy ID; verify vetKD through bounded, cycle-free proxy calls. Chain-key helpers attaching cycles cannot run unchanged. Derived keys belong to the proxy: existing encrypted clubs stay put, and proxy changes must not silently change encryption identity.
- Verify real-engine gallery/chat/vault readback, uploads, pending-upload recovery, permissions/removal, notifications/timers, HTTP outcalls, capacity and signed-in browser/native continuity. HTTP outcalls use ordinary cost-aware wrappers, not the proxy.
- Complete existing all-service group/account release gates and receive explicit owner opening approval. Current country settings choose session deployments, not immutable club placements; implement and verify assignment-aware new-club routing before changing populated countries. Existing clubs retain their original group.

Group protocols already bind revision, host, network and subnet placements, but real-engine provisioning and acceptance remain unfinished. Extra subnets and engine/group opening stay disabled. No engine created or club moved.

Inactive engine pins retain the existing Supabase fallback, never mainnet. This is not a legal residency guarantee; do not pin production countries until fallback requirements are approved.

Authoritative guidance: ICP skills cloud-engine-canisters and deploy-to-cloud-engine, fetched 20 October 2026. Correction to earlier advice: engine operations have a zero-cycle schedule, not merely a different fuel price; rental terms are separate and engine-specific.

## Engine-independent preparation batch — 20 October 2026

- `frontend/src/live/engineClubPlacement.ts`: offline country/deployment planner preserves existing authoritative assignments despite country-link changes. New-club proposals reuse whole-group validation and 70%/80% fill-first policy. Missing links, closed capacity, incomplete groups and engines block without mainnet fallback. Proposals never write assignments; production backend/sign-in/dispatch are unchanged.
- `frontend/src/live/engineClosedInstall.ts`: injected zero-cycle protocol installs twelve domains and a dedicated photo store, checkpoints reciprocal configuration, verifies sole controller/subnet/module/interface/capacity/serving evidence and stops at `checked`, before registration. Exact host/operator/subnet/proxy/shared-service/module binding persists. Unknown mutations refuse replay; live/shared IDs and foreign modules refuse. This is protocol code, not a console/CLI transport or deploy workflow.
- `frontend/src/live/engineAcceptance.ts`: sequential nineteen-check collector covers gallery/chat/vault, upload recovery, removal/other-club access, delivery/timers, direct HTTP outcalls, both cross-subnet directions, proxy/key continuity, billing and browser/native identity. Missing, failed, stale or foreign evidence stays missing. Every report has `activationAuthorized: false`.
- `frontend/src/live/engineIndependent.test.ts`: deterministic create/install/configure/check/resume rehearsal and safety regressions. Fixtures prove protocol behavior, not real Wasm compatibility, certificates, encryption, proxy authorization or delivery.

### Remaining real-engine prerequisites

1. Owner-provided console origin/subnet/proxy and console-authorized identity, not assumed to match the mainnet deploy identity. Sandbox loopback sign-in cannot complete on the owner's computer; use a local console-linked CLI or documented short-lived delegation when deploying.
2. Engine transport and durable read-back journal storage, including exact unknown-create reconciliation. Creation is not assumed to deduplicate.
3. Engine-compatible modules: bounded cycle-free calls in both directions and caller-isolated console-proxy vetKD. Setting `PROXY_CANISTER_ID` does not implement calls. No proxy calls or guessed IDs were added.
4. Real-service probes, console trust/billing readings, signed-in browsers/native devices and actual notification delivery. Mock results are not release evidence.
5. Authority-side immutable new-club placement and existing multi-group release prerequisites, then explicit owner opening approval. No production routing/engine flag was added.

Billing safety: authoritative guidance warns exhausted engine balance can cause **engine deletion with its data**, while failed automatic top-ups can halt it. Urgent rental-runway alerts and tested backup/recovery require real console acceptance before customer placement. Zero canister cycles is normal. Existing photo-bearing clubs stay put. No engine or club was created/moved; no live settings were changed.

## Engine-free hardening — 20 October 2026, 09:12 UTC

- Acceptance now requires versioned fixture/engine-capture records, exact thirteen-canister inventory, receipt locators and bounded unique assertions with matching expected/observed values. Canonical non-anonymous principals and immutable snapshots prevent inventory drift. Fixtures cannot stand in for engine captures. **Suppliers can still fabricate structured captures**: independent verification and activation always remain false, even for complete real-engine reports. Never include secrets or personal data in evidence.
- Installation snapshots manifest/journal data and rejects malformed module/capacity/status evidence. Interruption tests cover intent-save failure, committed mutation/lost reply and failed acknowledgement persistence across domain installation, dedicated photo-store creation/installation and midway configuration. Unresolved durable intents forbid replay; earlier configuration acknowledgements survive. No automatic reconciliation or pending-intent clearing was added. Configuration acknowledgements still require independent setting readback before release.
- `engineOperationalSafety.ts` rehearses explicitly supplied rental/backup policies offline: warning/urgent paid-through runway, failed/unknown automatic payment, stale/foreign readings, halted service, stale/foreign backups, restore-drill freshness and recoverable encryption keys. Test thresholds are fixtures, not production defaults or customer guarantees. It reads no console, sends no alerts and authorizes no admission.

### Prepared operator runbook — not an executable installation connection

1. Obtain actual console origin, subnet/API trust, operator identity, proxy/shared IDs and module hashes. Agree rental policy and alert recipients. Never assume the mainnet deploy identity administers the engine.
2. Connect on the owner's computer for local console sign-in; a remote sandbox needs the documented short-lived delegation first. Do not guess CLI flags or reuse mainnet paid-create commands. The executable console connection remains outstanding and cannot be verified without the engine.
3. Persist/read back every bound intent before mutation; exclude all live/shared IDs. Install only blank group-owned services, then verify zero cycles, controller, subnet, modules, interfaces and capacity.
4. Stop on lost replies or journal failures. Reconcile the exact bound create/module/setting receipt through authenticated readback; do not clear pending markers or invent a new operation. Failed disks retain the old durable intent.
5. Stop checked and unregistered. Independently verify all nineteen real checks, including device notifications, both bounded/cycle-free cross-subnet directions and proxy-bound encrypted readback.
6. Verify actual rental alerts and encrypted backup/restore under the original proxy/key identity. Ciphertext backups alone do not prove readable recovery; proxy replacement can change keys. Existing photo-bearing clubs stay put.
7. Complete existing authority/account/group gates and obtain owner opening approval. Country links and offline policy results cannot bypass these requirements.

Validation: 113 focused checks passed in each backend mode; the optional full-service replica test was not enabled. No real engine connection, independent acceptance, delivered alerts or actual encrypted restore is claimed. No live operation or placement change occurred.