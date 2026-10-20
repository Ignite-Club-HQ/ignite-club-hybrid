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