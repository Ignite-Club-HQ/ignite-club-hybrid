# Production Launch Plan: Lab to Live App

## Purpose

This is the orchestrating plan for turning this codebase from an isolated lab
proof into a running application that connects to:

1. A real Supabase project of your choosing (start), and
2. The public Internet Computer network (start), with
3. A later migration path to DFINITY Cloud Engine subnets for regional or
   confidential workloads (future).

This document is a **plan only**. Writing it does not change any runtime
behavior, does not add credentials, does not disable any isolation check, and
does not deploy anything. Every phase below ends with an explicit human
decision point before code changes that touch secrets, networks, or the
isolation guardrails are made.

## Non-goals for this document

- No production Supabase project is created, contacted, or configured here.
- No mainnet ICP canister is deployed here.
- No `check:isolation` assertion is loosened or removed here.
- No real user data, real credentials, or production identity is introduced.
- This plan does not touch the production repository referenced in the lab
  boundary rules; it defines how a **separate, explicitly authorized**
  production track is stood up from this codebase's ported source.

---

## 1. Where the codebase actually stands today

This is the concrete, verified current state, not aspiration:

### 1.1 Two hard-separated frontend tracks already exist

| Track | Entry point | Build command | Backend behavior |
| :--- | :--- | :--- | :--- |
| Lab | `src/main.tsx` → `src/lab/LabApp` | `npm run build` (Vite, `vite.config.ts`) | Network-guarded, fixture-only, Supabase client is a fail-closed stub, local ICP replica only |
| Product | `src/product-main.tsx` → `src/App.tsx` | `npm run build:product` (`vite.product.config.ts`) | Real application composition (`App.tsx`, `IcpAuthProvider`/`AuthProvider` selection), but still consumes the same fail-closed Supabase stub and has never been pointed at a real network |

Both tracks currently import the **same** `src/integrations/supabase/client.ts`,
which is a deliberate fail-closed stub (`disabled()` throws; fixture data is
returned only in ICP lab mode). Neither track has ever been connected to a
real Supabase project or ICP mainnet.

### 1.2 The isolation boundary is enforced by code, not just policy

`frontend/scripts/check-isolation.mjs` (run in `npm run dev`, `build`, and
`preview`) hard-asserts, among other things:

- No `.env*` file may exist anywhere in `frontend/`.
- No environment variable matching `SUPABASE|FIREBASE|STRIPE|RESEND|VAPID|...`
  may be present in `process.env` at build time.
- `src/main.tsx` must load `LabApp` and must never load `App`.
- `src/integrations/supabase/client.ts` must contain the fail-closed
  `new Proxy(disabled, ...)` stub, verbatim.
- Every file in the lab runtime allowlist (`lab-runtime-files.json`) must not
  reference `@supabase`, `@capacitor`, Firebase, `import.meta.env`,
  `process.env`, a `*.supabase.co` domain, or anything JWT-shaped.

This means: **as long as this repository stays governed by
`check:isolation`, it is structurally incapable of holding a real Supabase
connection or real credentials.** That is by design (see the lab boundary
rules), and this plan does not propose changing that for the lab track.

### 1.3 ICP networking is local-only today

- `icp.yaml` begins with `# Local synthetic lab only. Run through
  scripts/local-icp.mjs, never target mainnet.` and defines a `local` network
  and an `identity-bootstrap` network only — no `ic` (mainnet) network entry.
  There is no `dfx.json`; this repo uses a custom recipe-based local runner
  (`scripts/local-icp.mjs`), not the standard `dfx` mainnet deploy path.
- `vite.config.ts` hard-pins the dev proxy to
  `target: 'http://127.0.0.1:4943'` (local replica only).
- 13 logical canister roles exist as Rust/Motoko source under `backend/*`
  (see [ICP_CANISTER_TOPOLOGY.md](ICP_CANISTER_TOPOLOGY.md)) and are proven
  against the **local** replica only.

### 1.4 Production scaffolding exists but is only partially wired up

Several documents and one CI workflow already anticipate a production track,
but not all of that scaffolding is a working end-to-end path yet:

- `.github/workflows/prod-icp-upgrade.yml` and `prod-icp-upgrade-approved.yml`
  call `npm run check:prod-secrets` and `npm run deploy:staging`; those
  scripts now exist, but they are guard/staging-validation scripts, not a
  complete production deploy. The workflows also assume a mainnet-capable
  `icp deploy` CLI flow that this repo's actual tooling (`scripts/local-icp.mjs`,
  recipe-based `icp.yaml`) does not yet implement.
- [PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md](PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md)
  and
  [PRODUCTION_GITHUB_ENVIRONMENT_CHECKLIST.md](PRODUCTION_GITHUB_ENVIRONMENT_CHECKLIST.md)
  describe the GitHub environment/secret setup for a production ICP upgrade,
  assuming the workflow above already works end-to-end.
- [PRIVATE_STAGING_DEPLOYMENT_CHECKLIST.md](PRIVATE_STAGING_DEPLOYMENT_CHECKLIST.md)
  and
  [PRIVATE_STAGING_EXECUTION_RUNBOOK.md](PRIVATE_STAGING_EXECUTION_RUNBOOK.md)
  describe a private-staging path that still needs real hosting/provider
  wiring before it is an operational live deployment.
- [PRODUCTION_DEPLOYMENT_ACTION_TRACKER.md](PRODUCTION_DEPLOYMENT_ACTION_TRACKER.md)
  gates production on full RLS parity, secret custody, and worker
  infrastructure across all 13 domains — a much larger bar than "connect to a
  Supabase DB of my choosing and public ICP network at start."
- [RESIDENCY_DEPLOYMENT_DECISION_PACK.md](RESIDENCY_DEPLOYMENT_DECISION_PACK.md)
  already defines the future Cloud Engine target model (`deployment_class:
  public_subnet | cloud_engine`, SEV-SNP requirements) — this is the correct
  reference for the "later on to cloud engines" step.

**Conclusion:** the pieces for a full, domain-complete production rollout are
partially planned but not sequenced into a minimal first-light path, and the
scripts the existing CI workflows depend on are still shallow guard/staging
checks. This plan fills that gap: a minimal, honest sequence to get
*something real* running first, then grow it, while pointing back to the
existing detailed docs for the domain-by-domain parity work that follows.

---

## 2. Target architecture for the production track

A **new, separate production track** is created alongside the existing lab
track. It reuses the same ported domain source (Rust/Motoko canisters,
frontend product build, hybrid adapters) but is **not** governed by
`check:isolation`, `lab-runtime-files.json`, or the network guard — those
stay exactly as they are for the lab track.

```text
                 ┌───────────────────────────┐
lab track        │ src/main.tsx → LabApp      │  unchanged, stays isolated
(this repo,      │ fixtures + local ICP only  │  (existing check:isolation)
 as-is today)    └───────────────────────────┘

                 ┌───────────────────────────┐
product track    │ src/product-main.tsx →     │  exists today, currently
(exists, not     │ App.tsx                    │  still bound to the
 yet wired)      │ build:product              │  fail-closed Supabase stub
                 └───────────────────────────┘

                 ┌───────────────────────────┐
NEW: live track  │ real Supabase client,      │  new work: env-driven
(this plan)      │ real ICP agent host,       │  config, real credentials
                 │ env-driven config module   │  live only in CI/hosting
                 └───────────────────────────┘
```

Key architectural decisions this plan makes explicit:

1. **Environment-driven configuration, never hardcoded.** The live track
   reads `SUPABASE_URL` / `SUPABASE_ANON_KEY` (never the service-role key —
   that never belongs in a browser bundle) and an ICP network descriptor
   (`ICP_NETWORK`, `ICP_HOST`, canister ID map) from environment variables
   injected at build or runtime by the hosting provider/CI, not from files
   committed to the repo.
2. **The live track is a separate build target**, not a modification of
   `vite.config.ts` (lab) or a loosening of `check:isolation`. It gets its
   own Vite config (or an extension of `vite.product.config.ts`) with its own
   `envDir`/`envPrefix`, so the lab's "no environment variables at all" rule
   is untouched.
3. **ICP mainnet access uses the public IC network**, not a private subnet,
   at start (agent/API calls go to the dedicated API boundary-node endpoint
   `https://icp-api.io`; `icp0.io`/`ic0.app` are the HTTP asset-gateway
   domains used when a frontend is itself served from an IC asset canister,
   which this live track is not — see Phase 3). Cloud Engine / private
   subnet is a later migration once a residency profile is chosen (Phase 6).
4. **Supabase stays the source of truth for domains not yet ported**, and ICP
   canisters own the domains that have completed parity work. This preserves
   the existing hybrid architecture — the live track does not attempt a
   big-bang cutover.
5. **Secrets live in the hosting/CI secret store only** (GitHub Environment
   secrets, Netlify/Vercel environment variables, or a cloud secret manager),
   never in the repository, matching the existing
   [SECRET_INTEGRATION_AND_EXTERNAL_WORKER_PLAN.md](SECRET_INTEGRATION_AND_EXTERNAL_WORKER_PLAN.md)
   rule.

---

## 3. Phased plan

Each phase lists concrete deliverables and an explicit go/no-go decision
point. No phase after Phase 0 should begin without your sign-off, since each
one either touches real infrastructure or real (even if minimal) credentials.

### Phase 0 — Decide the production track boundary (no credentials yet)

**Goal:** decide *where* the live track's code and config will live, without
touching the lab's isolation guarantees.

**Updated context:** you already have an existing Supabase environment — the
same one this lab's schema, RLS policies, Edge Functions, and secrets were
originally sanitized/ported *from*. It already has the full table structure,
RLS, Edge Functions, and secrets configured. There is no new schema to design
or RLS to author from scratch; Phase 1 below is therefore a **connection and
verification** exercise, not a provisioning exercise. This is referred to
below as "your dev Supabase project" to distinguish it from a future,
separate real-user production project, and from the unrelated production
repository this lab workspace is intentionally isolated from (this plan never
touches that repository or its source; it only points at your own database
instance).

- Decide: does the live track live in this same repository as a third build
  target (`src/live-main.tsx` + `vite.live.config.ts`, analogous to the
  existing lab/product split), or in a separate deployment repository that
  imports/vendors the ported `frontend/src` and `backend/*` source?
  - Recommendation: start as a **third build target in this repo**. It is
    the smallest change, reuses the already-ported `App.tsx` composition and
    canister source directly, and keeps one history. Promote to a separate
    deployment repo later only if release cadence or access-control needs
    diverge.
- Confirm project identity: which Supabase project (project ref / URL) is
  "your dev db" for this work, and confirm it is the dev/staging tier (not a
  project currently serving real end users) so the live track's first
  connection carries a contained blast radius while the ICP side is still
  new and unproven.
- Decide the app-admin switching model for Supabase projects:
  - **Supported:** an app admin can switch the app between pre-approved
    Supabase target aliases (for example `dev`, `staging`, `production`) from
    an admin UI. Each alias resolves to public client configuration
    (`SUPABASE_URL` + anon key) supplied by a trusted config service or
    deployment environment, and every switch is RBAC-checked, audited, and
    fail-closed.
  - **Not supported:** an app admin should not paste arbitrary Supabase URLs,
    anon keys, service-role keys, database passwords, or Edge Function secrets
    into the browser UI. The browser can receive public anon-key config for an
    approved target, but secrets must remain in Supabase/worker/CI secret
    stores.
  - **Runtime impact:** switching targets should normally force a session
    boundary (sign out/re-authenticate, clear cached query state, reconnect
    realtime/storage clients) because Supabase Auth sessions, RLS claims, Edge
    Function URLs, Storage buckets, and Realtime channels are project-scoped.
  - **Initial recommendation:** implement a small `backend_target_registry`
    model with approved aliases first. Store only alias metadata and public
    client config in the app-admin-controlled registry; keep service keys and
    provider secrets outside the frontend entirely.
- Decide the app-admin switching model for ICP targets:
  - **Supported:** an app admin can switch an app, tenant, club, or placement
    profile between pre-approved ICP target aliases, such as
    `icp-public-mainnet`, `icp-au-cloud-engine`, or `icp-eu-cloud-engine`.
    Each alias resolves to public routing metadata: network kind, agent host or
    boundary-node URL, canister ID map, supported domain roles, residency
    profile, deployment class (`public_subnet` or `cloud_engine`), and health
    status.
  - **Not supported:** an app admin should not paste arbitrary replica URLs,
    boundary-node URLs, canister IDs, subnet IDs, root keys, deployment
    identities, controller principals, PEM files, cycle wallets, or Cloud
    Engine credentials into the browser UI. Deployment authority, controller
    identities, cycle management, and Cloud Engine provisioning remain CI /
    operator / platform responsibilities.
  - **Cloud Engine nuance:** selecting a Cloud Engine target in the UI is only
    a routing/placement decision to an already-provisioned and already-deployed
    Cloud Engine environment. Creating the Cloud Engine subnet, validating
    SEV-SNP/residency requirements, deploying or upgrading canisters, and
    migrating state are not browser-admin actions.
  - **State impact:** switching ICP targets may be read-only, new-tenant-only,
    or migration-backed depending on the domain. If the target has a different
    canister set or empty state, the UI must not imply existing data moved
    automatically; it should require explicit migration/restore evidence before
    moving an existing tenant/club.
  - **Runtime impact:** switching ICP targets should clear actor caches,
    recreate authenticated actors, re-check Internet Identity / delegation
    compatibility, reload placement metadata, and re-run health checks before
    enabling writes.
  - **Initial recommendation:** extend the same `backend_target_registry` to
    hold both Supabase and ICP target aliases, with separate provider-specific
    public config and shared RBAC, audit logging, residency policy, and
    fail-closed validation.
- Deliverable: a short ADR-style note (can be appended to this file) recording
  the decisions above, plus the project ref/URL you intend to connect to and
  the initial approved Supabase and ICP target alias lists. The Supabase anon
  key itself should never be written into this file or any committed file —
  see Phase 2.

**Exit gate:** you've confirmed which existing Supabase project to connect
to, confirmed the third-build-target approach, and decided whether Phase 2
must include the admin-managed approved-target switching UI from day one or
can start with one fixed approved Supabase alias plus one fixed approved ICP
alias.

### Phase 1 — Verify the existing schema/RLS/Edge Functions match what the frontend expects

**Goal:** confirm your existing dev Supabase project's schema, RLS, and Edge
Functions line up with what the ported frontend code and the domain
inventories in this repo assume — **no schema changes, no RLS changes, no new
migrations are performed in this phase.** The database is already built; the
job here is reconciliation, not construction.

- Diff the live project's actual schema against `src/integrations/supabase/types.ts`
  (the generated types this frontend already expects) — regenerate types from
  your project (`supabase gen types typescript`) and compare against what's
  committed, to catch drift since this lab's source was sanitized from your
  environment.
- Spot-check RLS policy shape for the first slice you intend to go live with
  against [RLS_DOMAIN_INVENTORY.md](RLS_DOMAIN_INVENTORY.md) and
  [AUTHORIZATION_RLS_PARITY.md](AUTHORIZATION_RLS_PARITY.md) — these
  documents describe what the policies were understood to be at the time of
  porting; use them as a checklist to confirm nothing has silently changed on
  the live project, not as a source to author new policies from.
- Confirm Supabase Auth configuration (providers enabled, redirect URLs,
  email templates) in your project's dashboard matches what the frontend's
  auth flows expect.
- Confirm which Edge Functions are already deployed and live in your project
  (list via `supabase functions list` or the dashboard) and cross-reference
  against [EDGE_FUNCTION_AND_TIMER_INVENTORY.md](EDGE_FUNCTION_AND_TIMER_INVENTORY.md)
  so Phase 4's slice picks functions that are already deployed and working,
  deferring any function that needs new secrets or code changes to Phase 6.
- Deliverable: a short reconciliation note listing any drift found between
  the committed type definitions/inventories and the live project's actual
  state, and which first-slice tables/functions are confirmed ready to use
  as-is.

**Exit gate:** you've confirmed (or corrected) that the live project's schema,
RLS, and Edge Functions for the first slice match what the frontend code
expects, with no changes made to the live database in this phase.

### Phase 2 — Wire the live track to real Supabase (env-driven, no lab impact)

**Goal:** get the frontend product composition talking to a real Supabase
project, without touching the lab's fail-closed stub or `check:isolation`.

- Add a new, live-track-only Supabase client module
  (`src/integrations/supabase/liveClient.ts`) that calls the real
  `@supabase/supabase-js` `createClient(url, anonKey)` using values read from
  `IGNITE_LIVE_*` environment variables, guarded so it only exists in the
  live build's dependency graph — never imported by `src/main.tsx` (lab) and
  never present in `lab-runtime-files.json`. **Status: initial implementation
  complete.**
- Add `vite.live.config.ts` (modeled on `vite.product.config.ts`) with a
  live-only `envPrefix` (`IGNITE_LIVE_`) so Vite can read injected
  environment variables at build time; add a guard analogous to
  `IGNITE_PRODUCT_BUILD` (`IGNITE_LIVE_BUILD=1`) so it can't be invoked by
  accident. **Status: initial implementation complete.**
- Wire the existing app composition to use the new live client instead of the
  stub when running the live build, by aliasing
  `@/integrations/supabase/client` to the live client only in
  `vite.live.config.ts`. **Status: initial implementation complete.**
- Add a `check:live-config` script (sibling to `check:isolation`) that
  asserts the live build has required public target config, uses HTTPS except
  localhost development URLs, and does not receive a Supabase service-role key
  as the browser anon key. **Status: initial implementation complete.**
- Deliverable: `npm run build:live` produces a bundle that, when given real
  env vars at build/hosting time, can sign in and read/write the Phase 1
  schema slice against your real Supabase project.

**Exit gate:** a local `npm run build:live` + `npm run preview` (with env
vars supplied only in your shell, never committed) round-trips a real sign-in
and a real read against your Supabase project; `check:isolation` (lab) still
passes unchanged.

### Phase 3 — ICP mainnet bootstrap (public network, minimal canister set)

**Goal:** get one or two already-proven canisters running on the public IC
mainnet, reachable from the live frontend track.

**Status: connection/auth code complete; canister deployment still pending
(requires your own cycles + identity — see below).**

- Deployment tooling is already resolved, no new tooling needed. This repo's
  `icp` CLI (`icp --version` → `1.5.0`, confirmed installed at
  `~/.local/bin/icp`) is the real DFINITY-maintained `icp-cli`, and it has a
  **built-in, protected `ic` environment** (network `ic`,
  `https://icp-api.io`) — see the `icp-cli` skill
  (skills.internetcomputer.org). No `dfx.json`, no new network block in
  `icp.yaml`, and no changes to `scripts/local-icp.mjs` are needed for
  mainnet: the existing `icp.yaml` canister recipes already work with
  `icp deploy -e ic <canister-name>` run from the repo root. (Earlier drafts
  of this plan assumed a `dfx`/custom-network path was required — that was
  wrong; `-e ic` already exists.) The previously-committed
  `.github/workflows/prod-icp-upgrade*.yml` files use `--network`/`--url`
  flags that **do not exist** on this CLI version and must be corrected to
  `-e ic` before they can run (tracked in Phase 5, not yet done).
- **Implemented (this session):** the live frontend track now has real
  mainnet ICP wiring, following the same alias-substitution pattern used for
  Supabase (see Phase 2) so `src/hooks/useAuth.tsx`'s `IcpAuthProvider`
  needed no changes:
  - `frontend/src/live/internetIdentityAuth.ts` — mainnet Internet Identity
    auth, aliased in over `@/lab/internetIdentityAuth` only for the live
    build (`vite.live.config.ts`). Uses the well-known mainnet II frontend
    canister `uqzsh-gqaaa-aaaaq-qaada-cai` at `https://id.ai/authorize`
    (**not** `rdmx6-jaaaa-aaaaa-aaadq-cai` / `identity.ic0.app` as an earlier
    draft of this plan said — corrected after reading the current
    `internet-identity` skill; `rdmx6-jaaaa-aaaaa-aaadq-cai` is the II
    *backend*/trusted-signer canister, not the `identityProvider` value).
    No root key is fetched or pinned — mainnet's root key ships baked into
    `@icp-sdk/core`, and `shouldFetchRootKey`/`fetchRootKey()` are never
    called against a real network.
  - `frontend/src/live/icpAgent.ts` — mainnet/Cloud Engine actor factory
    (`createLiveAgent`, `createLiveActor`, `connectLiveDomainActor`,
    `checkLiveCanisterHealth`), mirroring
    `frontend/src/lab/localActor.ts`'s shape but with no local-origin
    restriction and no local root key.
  - `frontend/src/live/identityAccess.ts` — live counterpart of
    `frontend/src/lab/localIdentityAccess.ts`; skips account provisioning
    (with a console warning, not a hard failure) if no `identity_access`
    canister ID is configured yet for the active target, so sign-in still
    works before any canister is deployed.
  - `frontend/src/live/targetRegistry.ts`'s default ICP host corrected to
    `https://icp-api.io` (the dedicated API boundary-node endpoint) —
    **not** `https://icp0.io` as originally written. `icp0.io`/`ic0.app` are
    HTTP asset-gateway domains keyed to a canister ID in the URL; they are
    not guaranteed to proxy `/api/v2` for a frontend that is not itself
    served from an IC asset canister. This project's live build is hosted
    off-chain (Vite static build, not deployed as an IC asset canister), so
    `icp-api.io` is correct.
  - `frontend/scripts/check-live-config.mjs` extended to validate
    `IGNITE_LIVE_ICP_HOST` (HTTPS-only, except localhost),
    `IGNITE_LIVE_ICP_CANISTER_IDS_JSON` (valid JSON object of
    principal-shaped strings), and to reject any `IGNITE_LIVE_*` value that
    looks like PEM private key material.
  - Verified: `typecheck:product` (still 101 diagnostics, 0 new),
    `typecheck:lab` (passes, unaffected), `check:isolation` (passes,
    unaffected), `check:live-config` (passes with real ICP env values),
    `build:live` (succeeds; confirmed the compiled live bundle contains
    `id.ai/authorize` and none of the lab's localhost-restriction strings —
    i.e. the alias swap genuinely took effect), `check:prod-secrets`
    (passes), placement-admin-settings lab test suite (10/10, unaffected),
    `git diff --check` (clean on touched files).
- **Not yet done (requires you, not just code) — detailed step-by-step:**

  There is **no NNS setup needed**: the NNS (Network Nervous System) is the
  existing governance/system-canister layer of the public IC mainnet — it
  already exists and you don't deploy or configure it. The only thing you
  need from "NNS" is optionally the **NNS dapp** at
  <https://nns.internetcomputer.org> if you already hold ICP tokens there
  and want to send them out to fund a deployment identity. Everything below
  uses the `icp` CLI directly against the built-in `ic` (mainnet)
  environment/network — no dfx, no NNS proposals, no canister of your own
  needs registering with the NNS.

  1. **Create a dedicated mainnet deployment identity** (never use the
     default/anonymous identity on mainnet — it is shared by everyone, so
     ICP sent to it is publicly spendable and canisters deployed under it
     are uncontrolled):
     ```bash
     icp identity new mainnet-deployer
     icp identity default mainnet-deployer
     ```
     `icp identity new` prints a seed phrase **once**. Store it in a
     password manager immediately — it is the only recovery path for this
     identity's funds and canister control. (Optionally pass
     `--output-seed <file>` to write it straight to a file you then move to
     secure storage, instead of relying on terminal scrollback.) Consider
     `--storage password` instead of the default `keyring` if this
     Codespace's keyring isn't durable across rebuilds.
     Separately, keep this identity distinct from any personal/example
     identity, per
     [PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md](PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md).

  2. **Get its account address**, which is what you'll send ICP tokens to:
     ```bash
     icp identity principal      # the identity's principal (for cycles/ledger ops that take a principal)
     icp identity account-id     # the identity's ledger account identifier (for exchange withdrawals)
     ```

  3. **Acquire ICP tokens** (real money — this is the one step that
     genuinely costs cash; nothing else in this list does):
     - **Simplest path: buy ICP on an exchange** that lists it (e.g.
       Coinbase, Kraken, Binance — availability varies by region/exchange,
       check what's available to you) and **withdraw to the account
       identifier from step 2** (`icp identity account-id`). Most exchanges
       ask for an "account identifier" (the classic 64-hex-char ICP ledger
       address) rather than a principal — use `icp identity account-id`,
       not `icp identity principal`, for exchange withdrawals.
     - **If you already hold ICP in the NNS dapp** (<https://nns.internetcomputer.org>,
       sign in with your existing Internet Identity there), you can send
       ICP directly from an NNS account to the `icp identity account-id`
       address above using the NNS dapp's normal "Send" flow — no exchange
       needed in that case.
     - Verify funds arrived:
       ```bash
       icp token balance -n ic
       ```

  4. **Convert ICP to cycles** (cycles, not ICP tokens, are what actually
     pay for canister compute/storage on mainnet; the conversion goes
     through the Cycles Minting Canister at the live XDR exchange rate —
     1T cycles ≈ 1 XDR ≈ US$1.30–1.40, pegged, not floating like ICP's own
     price):
     ```bash
     # Either specify the ICP amount to convert...
     icp cycles mint --icp 2 -n ic
     # ...or specify the cycles amount you want and let it work out the ICP cost:
     icp cycles mint --cycles 4T -n ic

     # Verify:
     icp cycles balance -n ic
     ```
     **Budget guidance** (official docs): plan roughly 1–2T cycles per
     canister as a starting balance; a simple backend canister with
     moderate traffic burns on the order of 0.1–0.5T cycles/month, more with
     heavier storage/call volume. For the initial `identity_access` +
     `club_domain` pair, minting **4T cycles total** is a reasonable start
     (leaves headroom for `icp deploy`'s own default 2T-cycles-per-canister
     creation cost — see next step).

  5. **Deploy the smallest canister pair to mainnet** (not all 13 — start
     small, expand later once this slice is verified working):
     ```bash
     icp deploy -e ic identity_access club_domain --identity mainnet-deployer
     ```
     By default this spends 2T cycles per *newly created* canister from your
     cycles balance (override with `--cycles <amount>` if you want a
     different starting balance per canister, e.g. `--cycles 1500000000000`).
     `icp-cli` commits the resulting mainnet canister ID mapping to
     `.icp/data/mappings/ic.ids.json` — **this file must be committed to
     git**, not gitignored (per the `icp-cli` skill's Pitfall 5; only
     `.icp/cache/` is ephemeral/gitignored). Commit it as its own change so
     the mainnet canister IDs are tracked history, not lost if the
     Codespace is rebuilt.

  6. **Confirm the canisters are alive and check their cycle balance**
     periodically so they don't freeze (a canister stops running, though it
     is not deleted, once its cycles drop below its freezing threshold):
     ```bash
     icp canister status identity_access -e ic
     icp canister status club_domain -e ic
     ```
     Top up either one later, from any identity, without needing to be its
     controller:
     ```bash
     icp canister top-up identity_access --amount 1T -e ic
     ```

  7. **Wire the deployed IDs into the live build.** Take the mainnet
     canister IDs printed by step 5 (also visible via
     `.icp/data/mappings/ic.ids.json` or `icp canister status`) and set:
     ```bash
     IGNITE_LIVE_ICP_CANISTER_IDS_JSON='{"identity_access":"<id-from-step-5>","club_domain":"<id-from-step-5>"}'
     ```
     as an environment variable for the next `build:live` run (alongside
     the existing `IGNITE_LIVE_ICP_HOST=https://icp-api.io` and the
     Supabase env vars from Phase 2).

- Deliverable once the above is done: a real Internet Identity sign-in
  against mainnet succeeds from the live build, and the one ported domain
  canister answers a real query call over the public network.

**Exit gate:** you can open the live build, sign in with a real Internet
Identity anchor (mainnet), and see real (if still synthetic-content) data
returned from the mainnet canister.

### Phase 4 — Minimal end-to-end slice validation

**Goal:** prove the live track works end-to-end for the smallest useful
feature slice before growing scope.

**Status: opt-in smoke-test script implemented and its Supabase half
validated against your real dev project; its ICP half is written but not
yet exercised since no mainnet canister is deployed (Phase 3).**

- Pick one Supabase-backed read/write flow (from the first slice confirmed
  ready in Phase 1) and
  one ICP-backed flow (from Phase 3's canisters) and validate both work
  together in the live build, side by side, using the existing hybrid
  routing logic — not a special-cased demo path.
- Add smoke tests (Playwright or a lightweight script) that run against the
  real Supabase project and real mainnet canisters, gated behind an opt-in
  script (not part of the default `npm test` suite, since it requires live
  network + real credentials). **Implemented:**
  `frontend/scripts/test-live-smoke.mjs` (run via `npm run test:live-smoke`).
  It refuses to run unless `IGNITE_LIVE_SMOKE_TEST=1` is explicitly set, and
  checks two things side by side:
  - **Supabase:** a read-only `select id from clubs limit 1` using the
    real anon key (RLS denying/returning zero rows still counts as a pass —
    only a thrown/network error fails it, since this script never writes to
    your real project autonomously).
  - **ICP:** an anonymous `whoami()` query call against the configured
    `club_domain` mainnet canister ID (from
    `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`); either `Ok` or `Err` from the
    canister counts as a pass (it proves the canister answered over the
    public network), only a transport/network error fails it. This half is
    automatically **skipped, not failed**, if no `club_domain` canister ID
    is configured yet.
  - Validated this session: ran with your real dev Supabase URL and real
    anon key (supplied only via environment variable, never written to any
    file) — the Supabase half passed with a genuine round-trip against
    `https://ecsdwrarzfexssxtrymj.supabase.co`; the ICP half correctly
    reported "skipped" since no canister is deployed yet.
- Deliverable: a documented, repeatable smoke-test procedure and its first
  passing run, recorded in this plan's changelog section.

**Exit gate:** the smoke test passes twice independently (once by you,
confirming reproducibility) with no secrets leaked into logs or committed
files. **Remaining to fully close this phase:** re-run
`npm run test:live-smoke` after the Phase 3 mainnet deploy so the ICP half
exercises a real canister instead of skipping, and pick/validate one
concrete Supabase **write** flow once Phase 1's reconciliation is done (this
script deliberately only reads, by design — see above).

### Phase 5 — Secrets, CI/CD, and hosting

**Goal:** make Phase 2-4 repeatable via CI instead of manual local steps.

- Implement the scripts the existing workflows already assume but that don't
  exist yet: `check:prod-secrets` (assert required env vars are present and
  well-formed, assert forbidden patterns like service-role keys are absent)
  and `deploy:staging` (build + deploy the live track to a staging Supabase
  project and/or staging hosting target). **Status: both scripts exist.**
- Set up the GitHub Environments (`production-approval`, `production`) per
  [PRODUCTION_GITHUB_ENVIRONMENT_CHECKLIST.md](PRODUCTION_GITHUB_ENVIRONMENT_CHECKLIST.md)
  and [PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md](PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md),
  adding the Supabase secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`) alongside
  the ICP one (`ICP_IDENTITY_PEM_BASE64` only — `ICP_NETWORK_URL` was removed,
  see below). **Status: not yet done** — this is a GitHub repo-settings
  action (creating the Environments and adding real secret values), not
  something committed code can do.
- **Status update — fixed a real bug in the existing workflows:**
  [.github/workflows/prod-icp-upgrade.yml](../.github/workflows/prod-icp-upgrade.yml)
  and
  [.github/workflows/prod-icp-upgrade-approved.yml](../.github/workflows/prod-icp-upgrade-approved.yml)
  previously called `icp deploy --network "$ICP_NETWORK" --identity
  "$ICP_IDENTITY" --url "$ICP_NETWORK_URL" --project-root "$GITHUB_WORKSPACE"`
  — none of `--network`, `--url`, or `--project-root` (missing the
  `-override` suffix) exist on this CLI version; these were leftover
  `dfx`-shaped flags. Corrected to:
  - `icp deploy -e ic <canisters> --identity <name> --mode "$ICP_MODE"
    --project-root-override "$GITHUB_WORKSPACE" -y` — the mainnet `ic`
    environment is built-in/protected and always resolves to
    `https://icp-api.io`, so no URL needs to be supplied at all;
    `ICP_NETWORK_URL` as a required secret was removed entirely.
  - The PEM secret is now properly imported as a named identity first
    (`icp identity import --from-pem <path> --storage plaintext
    production-deployer`) before being referenced by name in `--identity`,
    rather than passing a raw file path where the CLI expects an identity
    name.
  - The CLI is now installed via `npm install -g @icp-sdk/icp-cli
    @icp-sdk/ic-wasm` (the officially documented method, and consistent with
    the Node toolchain the workflow already sets up) instead of an
    unverified `curl | bash` install-script URL.
  - Both `<canisters>` arguments are now a workflow input (`canisters`,
    default `identity_access club_domain`) instead of deploying every
    canister in `icp.yaml` unconditionally, matching this phase's
    smallest-slice-first recommendation.
  - Added a post-deploy `icp canister status` smoke-check step.
  - **A second, deeper issue was found and documented (not silently worked
    around) while fixing this:** `icp.yaml`'s `identity_access` canister
    entry has `init_args: { path: .local-icp/identity-init.bin, format: bin
    }` — a **lab-only, gitignored** file produced by
    `frontend/scripts/local-icp.mjs` for the local network. It will not
    exist on a fresh CI checkout, so a first-time (`install`/`auto`) mainnet
    deploy of `identity_access` will fail at the deploy step until a
    mainnet-appropriate init argument is decided and wired in. The init
    argument in question is a single field, `Init = record { governor :
    principal }` (see `backend/identity_access/identity_access.did`) — i.e.
    **you must decide which principal is the initial "governor" (owner) of
    the mainnet `identity_access` canister** (most likely your own mainnet
    deployment identity's principal, or a separate governance identity you
    control) before its first mainnet install can succeed. This does not
    block `club_domain` (no init args) or block *upgrading* an
    already-installed `identity_access` (init args only apply at first
    install). This decision was deliberately left to you rather than
    defaulted, since it defines who controls the canister's internal access
    list on mainnet. Once decided, the recommended fix is to pass
    `--args '(record { governor = principal "<your-chosen-principal>" })'`
    on the `icp deploy` command for `identity_access`'s first install only
    (inline Candid text, not the lab's local binary path).
- Choose a static hosting target for the live frontend bundle and wire its
  environment-variable injection to the secret store, not the repo.
  **Status: not yet done — concrete instructions below (this is a genuine
  gap, distinct from the lab's existing staging setup).**

  The repo's root [netlify.toml](../netlify.toml) already deploys a site,
  but it builds the **lab** bundle (`npm run build` → `dist`, entry
  `index.html`) with a locked-down CSP
  (`connect-src 'self'`) that would silently block the live bundle's real
  network calls to Supabase and `https://icp-api.io`. The live bundle
  (`npm run build:live` → `dist-live`, entry `live-index.html`) needs its
  **own, separate** hosting site — do not repoint the existing staging site
  at the live build.

  1. **Create a second, separate Netlify site** (Netlify → "Add new site" →
     "Import an existing project", pointed at this same repo) dedicated to
     the live track. Do not reuse the existing staging site's ID.
  2. **Site build settings** (Netlify UI → Site configuration → Build &
     deploy):
     - Base directory: `frontend`
     - Build command: `npm ci --no-fund --no-audit && npm run build:live`
     - Publish directory: `frontend/dist-live`
  3. **Environment variables** (Netlify UI → Site configuration →
     Environment variables — never in a committed file):
     - `IGNITE_LIVE_BUILD=1`
     - `IGNITE_LIVE_SUPABASE_URL` (your real project URL)
     - `IGNITE_LIVE_SUPABASE_ANON_KEY` (the anon/public key only — never a
       service-role key; `check:live-config` rejects service-role-shaped
       keys and PEM material at build time as a backstop)
     - `IGNITE_LIVE_ICP_HOST=https://icp-api.io`
     - `IGNITE_LIVE_ICP_CANISTER_IDS_JSON` (once Phase 3's mainnet
       canisters are deployed — e.g.
       `{"identity_access":"<id>","club_domain":"<id>"}`; omit or leave
       empty until then, the live build tolerates unconfigured canister IDs)
  4. **Custom headers for this site** — the live site needs a **less**
     restrictive CSP than the lab's (it must be allowed to call your real
     Supabase project, `https://icp-api.io`, and `https://id.ai` for
     Internet Identity). Add a **site-specific** `frontend/netlify-live.toml`
     referenced by setting Netlify's "Netlify configuration file" build
     setting to that path (do not edit the root `netlify.toml`, which must
     keep protecting the lab's staging site), with a `connect-src` that
     lists your specific Supabase project host, `https://icp-api.io`, and
     `https://id.ai` explicitly (never `*`).
  5. **First deploy and smoke-test**: after the first successful Netlify
     build, run `IGNITE_LIVE_SMOKE_TEST=1 npm run test:live-smoke` locally
     (Phase 4) against the same env values to confirm they're correct
     *before* trusting the hosted URL, then open the Netlify-assigned URL
     (or a custom domain you attach later) in a browser and confirm sign-in
     with a real Internet Identity anchor works end-to-end (Phase 3's exit
     gate).
  - Vercel/Cloudflare Pages are equally viable alternatives to Netlify for
    this step; the same three inputs (base dir `frontend`, build command
    `npm run build:live`, publish dir `frontend/dist-live`) and
    environment-variable list apply regardless of provider.
  - **For a quick one-off browser test without setting up hosting at all**
    (e.g. to test a build against real credentials once, without creating a
    Netlify site yet): build locally
    (`IGNITE_LIVE_BUILD=1 IGNITE_LIVE_SUPABASE_URL=... IGNITE_LIVE_SUPABASE_ANON_KEY=... IGNITE_LIVE_ICP_HOST=https://icp-api.io npm run build:live`),
    then serve `dist-live/` with any static file server bound to
    `0.0.0.0` (e.g. `npx serve -l 4173 dist-live`) and, if running inside a
    GitHub Codespace, use the Codespace's port-forwarding (VS Code "Ports"
    tab) to reach it in a browser — this is not a substitute for the real
    hosting setup above and is meant only for a single manual check, not
    for repeat/shared access.
- Deliverable: pushing to a designated branch (or a manual
  `workflow_dispatch`) runs the live build against real staging credentials
  and deploys it, using the existing approval-gated workflow pattern.

**Exit gate:** a CI-driven staging deploy succeeds without any human copying
secrets by hand, and the production-approval gate is exercised at least once
in dry-run form.

### Phase 6 — Grow domain coverage (ongoing, not a blocker to going live)

**Goal:** expand from the minimal slice toward full parity, reusing the
existing, much larger domain-by-domain plans rather than duplicating them
here.

- Use [PRODUCTION_DEPLOYMENT_ACTION_TRACKER.md](PRODUCTION_DEPLOYMENT_ACTION_TRACKER.md)
  as the master checklist for secret custody, external workers, notification
  / timer production paths, and full RLS parity.
- Use [PARITY_IMPLEMENTATION_MATRIX.md](PARITY_IMPLEMENTATION_MATRIX.md) and
  [REMAINING_IMPLEMENTATION_GAPS_AND_PRODUCTION_MAPPING.md](REMAINING_IMPLEMENTATION_GAPS_AND_PRODUCTION_MAPPING.md)
  to sequence which of the remaining 11 canister roles get added to the live
  track next, and in what order.
- Each additional domain follows the same pattern as Phase 3/4: prove it
  locally first (already largely done per the lab work), then add it to the
  live track's mainnet deployment and Supabase schema, then smoke-test it.

**Exit gate:** N/A — this phase is continuous; each domain added has its own
exit gate matching Phase 4's pattern.

### Phase 7 (later) — Migrate to DFINITY Cloud Engine subnets

**Goal:** move from the public application subnet to a Cloud Engine (private
or SEV-SNP-protected) subnet where residency or confidentiality requires it.

- This is already scoped architecturally in
  [RESIDENCY_DEPLOYMENT_DECISION_PACK.md](RESIDENCY_DEPLOYMENT_DECISION_PACK.md)
  and [DFINITY_CONSTRAINTS.md](DFINITY_CONSTRAINTS.md) — no new design work is
  needed to start, only a decision on which residency profile applies and
  confirmation of Cloud Engine/SEV-SNP capacity in the target region.
- Concrete steps when this becomes relevant: choose a residency profile,
  confirm Cloud Engine capacity for that region, provision the Cloud Engine
  subnet, redeploy the mainnet canisters from Phase 3/6 onto it, and update
  the live track's canister-ID/network config to point at the new subnet.
- This phase is explicitly deferred until Phases 0-6 are live and a real
  residency/confidentiality driver exists — building it earlier would be
  speculative infrastructure spend.

### Phase 8 — Graduate this lab's code out to a real production repository

**Goal:** prepare a source handoff for independent review without
accessing the existing application repository or production Supabase.
Follow [PRODUCTION_HANDOFF_EXPORT_GUIDE.md](PRODUCTION_HANDOFF_EXPORT_GUIDE.md)
for the safe export command and the owner's separate GitHub steps.

1. Export the whole committed frontend **and ICP backend source**, retaining
   shared `src/lab/` dependencies, the guarded `build:live` entry, Rust/
   Motoko manifests and local Candid/migration sources. Exclude generated
   artifacts, local state, credentials, production-reference text and
   deploy workflows.
   Do not strip lab modules or remove build guards without proving
   the resulting application builds and behaves correctly.
2. The owner reviews the copy and, if desired, pushes it to a **new,
   empty, preferably private** repository for review. This is not the
   existing application repository and is not a production deployment.
3. Outside this lab, the owner compares the handoff against the actual
   application repo's latest `main`, reconciles new features and backend
   dependencies, tests the hybrid paths against an approved nonproduction
   target and arranges an independently reviewed cutover and rollback.
   The included `icp.yaml` is local-only and does not provision remote
   canisters. Provisioning, controllers, init args and ID mapping require a
   separate, explicitly authorized deployment plan. The reviewed dev
   Supabase URL and public anon key are supplied at live build time,
   never copied from the lab or embedded in source; dev schema/RLS and
   Edge Functions require their own parity check.

**Exit gate:** a reviewed source handoff exists. Production readiness
requires separate feature parity, RLS/Edge Function, credential and ICP
deployment checks; this phase alone does not establish any of them.

---

## 4. Immediate next action

### 4.1 Phase 0 decision record

The first live target choices are now:

| Provider | Approved alias | Public endpoint / host | Notes |
| :--- | :--- | :--- | :--- |
| Supabase | `dev` | `https://ecsdwrarzfexssxtrymj.supabase.co` | Existing dev Supabase environment. The anon key is still required at build/runtime, but must be supplied through an environment variable or hosting secret, not committed to this repository. |
| ICP | `icp-public-mainnet` | `https://icp-api.io` | Initial ICP target is public mainnet. Live auth/actor code is implemented (Phase 3); the canister ID map is still pending until you run `icp deploy -e ic` yourself. Until then this target can exist as an approved alias but should not be marked writable for ICP-backed domains. |

Phase 0 remains credential-free in the repository: the Supabase URL and ICP
mainnet gateway are public routing metadata, but anon keys, deployment
identities, controller credentials, PEMs, cycle wallets, and Cloud Engine
credentials stay outside committed files.

### 4.2 Immediate next action

Phase 0 is decided and Phase 3's connection code is implemented. The
recommended immediate next step is deployment (see Phase 3 for the exact
`icp deploy -e ic ...` command and prerequisites):

1. Supply the Supabase anon key through your local shell or hosting secret as
   `IGNITE_LIVE_SUPABASE_ANON_KEY`; do not commit it.
2. Build the live target with the known public metadata:

   ```bash
   cd frontend
   IGNITE_LIVE_SUPABASE_ALIAS=dev \
   IGNITE_LIVE_SUPABASE_URL=https://ecsdwrarzfexssxtrymj.supabase.co \
   IGNITE_LIVE_SUPABASE_ANON_KEY=<your-dev-anon-key> \
   IGNITE_LIVE_ICP_ALIAS=icp-public-mainnet \
   IGNITE_LIVE_ICP_HOST=https://icp-api.io \
   npm run build:live
   ```

3. Create a dedicated mainnet deployment identity and fund it with cycles
   (see Phase 3's step-by-step for the exact commands: create the identity,
   buy/send ICP to its account-id, convert ICP to cycles via
   `icp cycles mint`), then run (from the repo root, not `frontend/`):

   ```bash
   icp deploy -e ic identity_access club_domain --identity <your-deploy-identity>
   ```

   Commit the resulting `.icp/data/mappings/ic.ids.json` (mainnet canister ID
   mapping) — never gitignore it.

4. Provide the resulting public canister ID map as
   `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`, for example:

   ```bash
   IGNITE_LIVE_ICP_CANISTER_IDS_JSON='{"identity_access":"...","club_domain":"..."}'
   ```

5. Run Phase 1 reconciliation against your existing Supabase dev project:
   regenerate types, compare drift, confirm Auth/Edge Function readiness for
   the first slice.
6. Keep ICP writes disabled until public-mainnet canister IDs and health
   checks (`frontend/src/live/icpAgent.ts`'s `checkLiveCanisterHealth`) exist
   for the selected domain.

## 5. Changelog

- 2026-09-25: Initial plan written. No code, schema, or infrastructure
  changes made yet; Phase 0 decisions pending.
- 2026-09-25: Corrected Phase 0/1 to reflect that an existing dev Supabase
  project (the same environment this lab's schema/RLS/Edge Functions/secrets
  were originally sanitized from) already has the full schema, RLS, and Edge
  Functions in place. Phase 1 is now a connection/reconciliation exercise
  (verify live state matches what the ported frontend expects), not a
  from-scratch schema/RLS provisioning exercise.
- 2026-09-25: Clarified the Phase 0 Supabase-switching model: app-admin
  switching is allowed only between pre-approved target aliases with public
  client config supplied by trusted infrastructure. Arbitrary database URLs,
  anon keys, service-role keys, passwords, and provider secrets must not be
  entered through the browser UI.
- 2026-09-25: Clarified the matching Phase 0 ICP-switching model: app-admins
  can select pre-approved public-mainnet or Cloud Engine ICP target aliases,
  but cannot enter arbitrary replica URLs, canister IDs, root keys,
  deployment/controller credentials, cycle wallets, or Cloud Engine secrets in
  the browser. Cloud Engine provisioning, deployment, and state migration
  remain platform/operator workflows.
- 2026-09-25: Started implementation. Added the live build target
  (`build:live`), live Vite config, live-only Supabase client alias,
  approved-target registry scaffolding for Supabase and ICP aliases, live
  config guard, `live-index.html`, and the Supabase SDK dependency. Verified
  with a synthetic live build, the existing lab isolation guard, the existing
  production-secret guard, the product type diagnostic ratchet, and the
  existing product build.
- 2026-09-25: Hardened the existing placement-admin UI/controller so app
  admins approve only safe target aliases. The UI now labels the surface as
  an approved target registry, seeds examples for Supabase regional targets,
  ICP public mainnet, and ICP Cloud Engine, and rejects URL-shaped or
  credential-shaped aliases before they can become country policy.
- 2026-09-25: Recorded the initial live target choices: Supabase alias `dev`
  at `https://ecsdwrarzfexssxtrymj.supabase.co`, and ICP alias
  `icp-public-mainnet` at `https://icp-api.io`. The anon key and ICP canister
  ID map remain environment/secret inputs and are not committed.
- 2026-09-25: Validated `build:live` with the supplied public Supabase anon
  key via environment variable only. The key was not written to any committed
  file, and the generated `dist-live/` artifact was removed after validation.
- 2026-09-25: Clarified the ICP connection path: the live target registry can
  hold public-mainnet metadata today, but actual ICP connectivity still needs
  mainnet canister deployment plus live Internet Identity and actor-factory
  wiring. The current Internet Identity path remains local-lab-only.
- 2026-09-25: Implemented the live Internet Identity and actor/agent wiring
  for the mainnet/Cloud Engine track: `src/live/internetIdentityAuth.ts`
  (mainnet II frontend `uqzsh-gqaaa-aaaaq-qaada-cai` at
  `https://id.ai/authorize`, with a speculative Cloud Engine fallback using
  a configured `internet_identity_frontend` canister ID), `src/live/icpAgent.ts`
  (mainnet actor/agent factory with no local root-key pinning, since
  mainnet's root key ships baked into `@icp-sdk/core`), and
  `src/live/identityAccess.ts` (reuses the existing provider-agnostic
  `identityAccessClient.ts` and generated Candid bindings). `vite.live.config.ts`
  now aliases `@/lab/internetIdentityAuth` to the new live module, and
  `targetRegistry.ts`'s default ICP host was corrected from `https://icp0.io`
  to `https://icp-api.io` (an asset-gateway domain vs. the dedicated API
  boundary-node endpoint correct for an off-chain-hosted frontend).
  `check-live-config.mjs` now validates `IGNITE_LIVE_ICP_HOST`,
  `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`, and rejects any `IGNITE_LIVE_*` value
  containing PEM private-key content. These corrections (and the mainnet II
  canister ID/URL pair) came from reading the official `icp-cli` and
  `internet-identity` skills before writing ICP code, which superseded an
  earlier incorrect draft in this plan that cited `identity.ic0.app` and
  `rdmx6-jaaaa-aaaaa-aaadq-cai` as the frontend identityProvider (that
  canister ID is actually the II backend/trusted-signer, not the frontend).
  Validated via `typecheck:product` (0 new diagnostics), `typecheck:lab`,
  `check:isolation`, `check:live-config`, `build:live` (bundle inspected via
  grep to confirm mainnet II URL present and lab-only restriction strings
  absent), `check:prod-secrets`, and the placement-admin-settings lab test
  suite (10/10 passing). Mainnet canister deployment itself (deployment
  identity, funding it with cycles via `icp cycles mint`,
  `icp deploy -e ic identity_access club_domain`, and setting
  `IGNITE_LIVE_ICP_CANISTER_IDS_JSON` with the resulting IDs) remains an
  explicit user action, not automated by this change — see Phase 3 for the
  full step-by-step (identity creation, acquiring ICP, converting to
  cycles, deploying, committing the ID mapping).
- 2026-09-25: Added a detailed, referenceable step-by-step to Phase 3 for
  every remaining manual/financial action (creating a mainnet deployment
  identity, acquiring ICP tokens, converting to cycles via
  `icp cycles mint`, running `icp deploy -e ic`, monitoring/topping up
  cycle balances, and wiring the resulting canister IDs back into
  `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`), sourced from the installed `icp`
  CLI's own `--help` output and the current official ICP docs. Clarified
  that no NNS setup is needed (the NNS already exists on mainnet; the NNS
  dapp is only an optional funding-source UI if ICP is already held there),
  and corrected "cycles wallet" terminology throughout the plan to the
  current cycles-ledger model (the per-developer wallet-canister approach
  is deprecated).
- 2026-09-25: Fixed a real bug found while documenting deployment: both
  `.github/workflows/prod-icp-upgrade.yml` and
  `.github/workflows/prod-icp-upgrade-approved.yml` called `icp deploy`
  with `--network`/`--url`/`--project-root` (missing `-override`) flags
  that do not exist on the installed `icp-cli` — leftover `dfx`-shaped
  flags that would have failed at deploy time. Corrected both workflows to
  `icp deploy -e ic <canisters> --identity <name> --project-root-override
  "$GITHUB_WORKSPACE" -y`, added a proper `icp identity import --from-pem
  ... --storage plaintext` step (the PEM secret was previously passed as a
  raw file path where the CLI expects a named identity), switched the CLI
  install step to `npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm` (the
  officially documented method, using the Node toolchain already set up in
  the workflow) instead of an unverified `curl | bash` script URL, added a
  `canisters` workflow input (default `identity_access club_domain`) so
  the workflows deploy the documented smallest slice instead of every
  canister in `icp.yaml` unconditionally, removed the now-unnecessary
  `ICP_NETWORK_URL` secret requirement entirely, and added a post-deploy
  `icp canister status` smoke-check step. While fixing this, found and
  documented (without silently working around) a second, deeper issue:
  `identity_access`'s `icp.yaml` entry has `init_args` pointing at a
  lab-only, gitignored local bootstrap file
  (`.local-icp/identity-init.bin`) that will not exist on a fresh CI
  checkout — a first-time mainnet install of `identity_access` needs a
  real decision on which principal is its initial `governor` (owner)
  before that can succeed; this does not block `club_domain` or block
  upgrading an already-installed `identity_access`. Validated both
  workflow files parse as valid YAML.
- 2026-09-25: Implemented and validated the Phase 4 opt-in live smoke test:
  `frontend/scripts/test-live-smoke.mjs` (run via `npm run
  test:live-smoke`), gated behind `IGNITE_LIVE_SMOKE_TEST=1` and never part
  of the default `npm test`/`npm run test:all` suites. It performs a
  read-only Supabase query (`select id from clubs limit 1`) and an
  anonymous ICP `whoami()` query against the configured `club_domain`
  canister, treating either side's non-transport-error outcomes as a pass
  (RLS-denied/empty Supabase reads and `Err` ICP responses both still
  prove connectivity), and automatically skipping (not failing) the ICP
  half until a mainnet canister ID is configured. **Ran it for real this
  session** against the actual dev Supabase project
  (`https://ecsdwrarzfexssxtrymj.supabase.co`) using the real anon key
  supplied only via environment variable (never written to any file or
  logged) — the Supabase half passed with a genuine round-trip; the ICP
  half correctly reported "skipped" pending the Phase 3 mainnet deploy.
  Confirmed via `git status`/`grep` that no secret material was written to
  disk anywhere during this run.
- 2026-09-25: Corrected `docs/PRODUCTION_GITHUB_ENVIRONMENT_CHECKLIST.md`,
  `docs/PRODUCTION_GITHUB_SETUP_AND_APPROVAL.md`, and
  `docs/PRODUCTION_ICP_UPGRADE_RUNBOOK.md`, which still instructed setting
  an `ICP_NETWORK_URL`/`ICP_NETWORK` secret and gave `ic0.app` as an
  example value — stale from before this session's workflow fix. All three
  now say only `ICP_IDENTITY_PEM_BASE64` is required (the `ic` environment
  is built-in/protected and always resolves to `https://icp-api.io`), and
  all three now call out the `identity_access` governor-principal decision
  next to the secrets checklist, not only in this plan.
- 2026-09-25: Filled the previously-generic "choose a hosting target"
  Phase 5 bullet with a concrete, numbered Netlify setup (separate site
  from the existing lab staging site, build command, publish directory,
  environment variables, and a site-specific relaxed-CSP config file
  distinct from the root `netlify.toml` which must keep protecting the lab
  site), plus a documented quick-test path using a local static server and
  Codespace port-forwarding for a single manual check without provisioning
  hosting first.
- 2026-09-25: **Found and fixed a real, significant live-build bug**
  discovered while browser-testing the deployed live bundle: every page and
  shared data-layer module (100+ call sites) calls
  `resolveLocalAuthMode(search, true)`, hardcoding the isolated lab's
  "use fixture data / ICP-lab mode" branch, and `App.tsx`'s `useIcpAuth`
  (which decides between the real `AuthProvider` and the lab-only
  `IcpAuthProvider`) inherited the same hardcoded `true`. Since `App.tsx` is
  the live/product track's sole composition root (the lab entry point,
  `main.tsx`, never imports `App.tsx` at all — it uses `LabApp` instead),
  this meant the live build always forced Internet-Identity-only sign-in
  with no Supabase login option, and every page fetched synthetic fixture
  data instead of the real Supabase project, regardless of build target —
  exactly the "no Supabase option, everything blocked" symptom observed.
  Fixed using the same alias-substitution precedent already established for
  the Supabase client and Internet Identity auth module: added
  `frontend/src/live/localRuntimeMode.ts` (a live-only `resolveLocalAuthMode`
  that ignores the always-`true` `localLabMode` argument and instead
  defaults to `false` — real Supabase — unless a developer explicitly opts
  into `?backend=icp` for manual ICP-only testing) and aliased
  `@/lab/localRuntimeMode` to it in `vite.live.config.ts`. Also corrected
  one file, `src/lab/useHybridQuery.ts`, whose import used a relative path
  (`./localRuntimeMode`) instead of the `@/lab/...` alias form every other
  call site uses — relative imports cannot be intercepted by a Vite
  `resolve.alias` entry, so this one file would otherwise have silently kept
  the old broken behavior even after the fix. Validated: direct execution of
  the new module confirms `resolveLocalAuthMode('', true) === false` and
  `resolveLocalAuthMode('?backend=icp', true) === true`; `typecheck:product`
  (101 diagnostics, 0 new), `typecheck:lab` (passes, unaffected),
  `check:isolation` (passes, unaffected), `check:prod-secrets` and
  `check:live-config` (both pass), `build:live` (rebuilt successfully; the
  compiled bundle's minified source now contains the live-only
  `get("backend")==="icp"` check), and the `backend-provider-matrix`,
  `backend-router`, and `placement-admin-settings` lab test suites (19/19
  passing, run via the correct `vitest.lab.config.mjs` config) all pass
  unaffected.
- 2026-09-25: Restyled the ICP-mode (`?backend=icp`) branch of
  `frontend/src/pages/AuthPage.tsx` to reuse the same branding shell as the
  Supabase login screen (logo block, "Ignite" gradient heading, offline
  banner, `authShellStyle`/`authCardClassName` layout, and the `Card`/
  `CardHeader`/"Sign In"/`CardContent` structure). Only the Internet
  Identity button remains in the card body for this mode — no email/
  password fields or Google button — since mainnet `identity_access` is not
  deployed yet and a combined-choice screen would be misleading. This was a
  cosmetic-only change; the either/or `useIcpLab` branch and the
  `?backend=icp` opt-in mechanism are unchanged. Updated the matching test
  assertion in `frontend/src/pages/AuthPage.icp.test.tsx` (old copy string
  `Sign in with local Internet Identity` no longer exists). Validated:
  `typecheck:product` (101 diagnostics, 0 new), `AuthPage.icp.test.tsx` and
  `AuthPage.redirect.test.tsx` (9/9 passing via `vitest.legacy.config.mjs`),
  the `backend-provider-matrix`/`backend-router`/`placement-admin-settings`
  lab suites (19/19 passing, unaffected), `check:isolation` and
  `check:prod-secrets` (both pass), and a `build:live` rebuild (reusing the
  already-public Supabase anon key baked into the prior build's bundle,
  since anon keys are safe to expose client-side and are protected by RLS)
  confirmed the new copy compiled into `assets/AuthPage-*.js` and the
  running preview server picked up the new build without a restart.
- 2026-09-25: Fixed "Signer window should not be opened outside of click
  handler" errors when clicking "Continue with Internet Identity" (both lab
  and live tracks). Root cause: `frontend/src/hooks/useAuth.tsx`'s
  `IcpAuthProvider.signInWithIcp` did `await import("@/lab/internetIdentityAuth")`
  inside the click-invoked handler, and the underlying module then did
  further awaits (fetching local lab config / resolving the ICP target,
  dynamically importing `@icp-sdk/auth/client`, constructing `AuthClient`)
  before calling `client.signIn()`. The signer transport
  (`@icp-sdk/signer`'s `PostMessageTransport`) tracks "is this call happening
  inside a click event's dispatch" via a `window`-level capture/bubble click
  listener pair that resets synchronously once the click event finishes
  propagating — which happens before any pending microtask (including an
  `await import()` or an already-resolved `await somePromise`) gets to run.
  Any `await` before reaching `client.signIn()` therefore lets the bubble
  listener reset the flag first, so the eventual popup-window call is always
  seen as "outside a click handler," regardless of how fast the awaited work
  actually was. Fix: added `warmInternetIdentityAuthClient()` (lab and live
  `internetIdentityAuth.ts`) that eagerly fetches config/resolves the target
  and constructs the `AuthClient` ahead of time, plus a synchronous
  `getWarmedAuthClient()` fast-path used by `signInWithInternetIdentity` so
  that, once warmed, zero awaits happen before `client.signIn()`. Wired the
  warm-up to run in a `useEffect` on `IcpAuthProvider` mount (which happens
  at app root, well before the user can reach the sign-in button) and cached
  the resolved module in a ref so `signInWithIcp`'s click handler also skips
  the `import()` await on the common (warmed) path. Validated:
  `typecheck:product` (101/0 new), `typecheck:lab` (passes), the
  `icp-internet-identity-auth`/`adapter` lab tests (5/5), the
  `AuthPage.icp`/`AuthPage.redirect` tests (9/9), the
  `backend-provider-matrix`/`backend-router`/`placement-admin-settings` lab
  suites (19/19), `check:isolation`/`check:prod-secrets` (both pass), and a
  `build:live` rebuild confirming `warmInternetIdentityAuthClient` compiled
  into the live bundle's `internetIdentityAuth-*.js` chunk.

- Improved the "complete profile" error surfacing for the reported bug
  where an existing Supabase user is redirected to `/complete-profile` and
  then sees a generic "Failed to update profile" toast on save. Traced the
  redirect gate (`AppLayout.tsx`) and profile fetch (`useAuth.tsx`'s
  `fetchProfile`, which uses `.maybeSingle()`) — both are intentional,
  unchanged "first login" logic; a `null` profile with no fetch error means
  the SELECT succeeded but returned zero rows, which is consistent with
  either genuine RLS blocking the row or the row not existing under that
  `auth.uid()` in the real dev database, neither of which can be confirmed
  from this repo (this session has no access to the real dev Supabase
  project's data or deployed policies; the sanitized reference migrations'
  `profiles` RLS policies look standard). Also ruled out an
  `AuthPage.tsx` signup-vs-signin default-view mismatch as the cause.
  Concrete fix shipped in the meantime:
  `frontend/src/pages/CompleteProfilePage.tsx`'s `handleSubmit` now surfaces
  the actual Postgrest error's `message`/`hint`/`code` in the toast instead
  of a generic message, so the true cause is visible on the next reproduction
  without needing direct DB access. Next step is for the user to reproduce
  and share the browser console `Error fetching profile...` /
  `Profile update error:` log output (or the new toast's detail text) so the
  real error code can be matched against the deployed RLS policies.
  Validated: `typecheck:product` (101/0 new), `AuthPage.icp`/
  `AuthPage.redirect` tests (9/9), `check:isolation`/`check:prod-secrets`
  (both pass), rebuilt `dist-live` and confirmed the new error-detail string
  compiled into the `CompleteProfilePage-*.js` chunk, confirmed the running
  preview server picked up the new build hash automatically.

- Root cause confirmed for the "complete profile" bug (with the user's help
  reproducing after the error-surfacing fix above): the failure is a genuine
  `42501` RLS violation on the `profiles` table's `INSERT` path, not a
  frontend bug. `fetchProfile` correctly finds zero rows for this user in
  the connected dev Supabase project (no fetch error), so `CompleteProfilePage`
  correctly attempts an `INSERT` via the `upsert(..., { onConflict: 'id' })`
  call — and that insert is rejected by RLS. Two explanations, neither of
  which this session can confirm without direct DB access (out of bounds
  per repo isolation rules): either (a) the dev Supabase project this lab
  is currently pointed at is missing the standard
  `"Users can insert their own profile" ON profiles FOR INSERT WITH CHECK
  ((SELECT auth.uid()) = id)` policy (e.g. a partial/older migration
  snapshot), or (b) the user's existing profile genuinely lives in a
  different Supabase project (e.g. production) than the dev project
  currently configured for this app, making this dev DB's "new user" INSERT
  attempt correct-but-blocked. Gave the user two SQL Editor queries to run
  against their own project to distinguish the two cases and, if (a), the
  exact `CREATE POLICY` statement to add. This repo cannot execute SQL
  against any real Supabase project itself.

- Follow-up refinement to the RLS diagnosis above: the user pointed out that
  their Supabase login (username/password) succeeded, which confirms this
  IS the same Supabase project as their existing account (Supabase auth's
  `auth.users` and the app's `public.profiles` are separate tables in the
  same database — a successful login means the `auth.users` row is real in
  *this* project). This effectively rules out "wrong project" as the cause.
  Narrowed to two remaining explanations, both server-side: (1) the
  `public.profiles` row for this `auth.users` id was never created or no
  longer exists (e.g. deleted, or an old signup flow's insert silently
  failed), or (2) the `profiles` table's INSERT policy is missing/broken in
  this specific project. Gave the user three targeted SQL Editor queries:
  look up their `auth.users` id by email, check for a matching `profiles`
  row by that id, and list `pg_policies` for `profiles` to confirm the
  INSERT policy exists with the correct `WITH CHECK` clause.

- Further code-side check (no DB access needed): searched the sanitized
  `reference/backend/supabase/migrations/*.sql.md` files for a
  `handle_new_user`-style trigger on `auth.users` that would auto-create a
  `public.profiles` row at signup time. **None exists** — the only
  `INSERT INTO public.profiles` in the reference migrations is the one-time
  seed of the "Ignite Support" system user. This confirms, by design, that
  `CompleteProfilePage.tsx`'s client-side `upsert` is the SOLE mechanism
  that ever creates a `profiles` row for a real user — there is no
  server-side safety net. This means an existing user's profile row can
  only be missing in a project if either (a) they genuinely never finished
  that flow before (unlikely per the user's report), or (b) the row existed
  and was deleted/never migrated into this project, or (c) the INSERT is
  being blocked now by an RLS/grant regression that wasn't present when
  they first signed up. Added a 4th diagnostic query for the user
  (`information_schema.role_table_grants` for the `authenticated` role on
  `profiles`) since Postgres also raises `42501` for a missing table-level
  `GRANT INSERT`, not only a failed RLS `WITH CHECK` — a possibility not
  covered by the earlier `pg_policies` check alone.

- Further narrowing of the profile-RLS bug: the user's `pg_policies` query
  result for `profiles`' INSERT policy showed `with_check =
  (( SELECT ( SELECT auth.uid() AS uid) AS uid) = id)` — this is just
  Postgres's verbose rendering of the standard, correct `auth.uid() = id`
  check (the double-`SELECT` wrapping is the intentional RLS
  perf-optimization pattern from an earlier migration, not a bug). Combined
  with the user's earlier confirmation that a matching `profiles` row
  already exists, this rules out both "missing profile row" and "missing/
  broken INSERT policy" as the cause. Re-audited the live client wiring
  (`targetRegistry.ts`, `liveClient.ts`, `supabaseAuthRetry.ts`) end-to-end:
  confirmed a single Supabase project target, a single client singleton
  instance shared by every page (no split-brain client), and confirmed the
  auth-retry fetch wrapper does not strip or replace the `Authorization`
  header on non-401/403-JWT-shaped responses (a `42501` RLS body doesn't
  match its "isAuthShaped" substring check, so it's passed through
  untouched, not masked). With policy, code wiring, and existing-row all
  ruled out, the remaining explanation is that the id being checked by
  `auth.uid()` at request time does not equal the `profiles.id` the user
  looked up — most plausibly because the account's email has more than one
  `auth.users` row (e.g. an old/orphaned signup attempt vs. the current
  one), and the id used to look up the "existing" profile wasn't
  necessarily the id of the session that's actually logged in. Gave the
  user a way to check this directly instead of relying on the email
  lookup: decode the actual current session JWT from
  `localStorage['ignite-live-dev-auth']` (or the equivalent
  `ignite-live-<alias>-auth` key) via jwt.io and compare its `sub` claim
  character-for-character against the `profiles.id` found earlier, and/or
  re-run `select id, email from auth.users where email = '...'` to check
  for more than one row.

- Ruled out duplicate `auth.users` rows (user confirmed only one row for
  their login email). Re-audited the client wiring once more for a
  session/timing race (checked `fetchProfile` in `useAuth.tsx` and
  `handleSession`) — the profile fetch runs on the same `supabase` client
  singleton via the standard `onAuthStateChange` callback, which supabase-js
  only fires after its internal session store (and thus the Authorization
  header used by subsequent requests) is already updated; no header-timing
  bug found in this repo's code. With duplicate accounts, RLS policy syntax,
  and client wiring all ruled out, the last remaining explanation is that
  the specific `profiles.id` value the user checked does not literally
  equal the single `auth.users.id` found by email — e.g. if this dev
  project's `profiles` table was seeded/copied from a different environment
  (such as production) without a matching `auth.users` row, the visible
  "existing profile" row would carry a foreign UUID that this session's
  `auth.uid()` can never match, explaining both the failed SELECT (0 rows)
  and the failed INSERT (`42501`). Asked the user to directly compare the
  `id` from their single `auth.users` row against the `id` on the
  `profiles` row they found earlier, character-for-character.

- Reconciled the live lab Supabase integration against the sanitized
  production-derived backend reference and this repository's preserved
  pre-hybrid frontend behavior. Direct access to the production repository
  remains prohibited; no production repository, database, secrets, or
  deployment environment was contacted. Findings:
  - `CompleteProfilePage` is behaviorally aligned with the preserved source:
    both use `profiles.upsert(..., { onConflict: "id" })`, and the canonical
    reference RLS policies allow authenticated users to select, insert, and
    update only their own `profiles.id`.
  - Edge Function calls still use the configured Supabase client's
    authenticated session. Edge Function sources under `reference/backend`
    remain inert references and are not bundled or deployed by this lab.
  - The browser receives only the configured project URL and public anon key;
    service-role keys remain rejected by the guarded live configuration and
    production-secret checks.
  - Found one real hybrid compatibility regression:
    `installSupabaseAuthRetry()` was never invoked, and its target detection
    depended only on `VITE_SUPABASE_URL`, which is intentionally unavailable
    in guarded live builds (`IGNITE_LIVE_*` is the only exposed prefix).
    Wired the interceptor into `product-main.tsx` before render and made it
    resolve the URL from the active Supabase client, with a safe fallback for
    the fail-closed isolated product client.
  - Added an authoritative `supabase.auth.getUser()` check immediately before
    the profile upsert. The mutation now uses the server-validated user id and
    fails explicitly if the live session is missing or disagrees with React
    auth state, rather than sending an ambiguous write that surfaces only as
    RLS `42501`.
  - Added source-level regression guards for bootstrap installation, guarded
    live target discovery, and server-validated profile identity.
  Validation: focused guards (14/14), `typecheck:lab`, `typecheck:product`
  (101 existing diagnostics, zero new), guarded product build and bundle
  budgets, guarded live build, `check:prod-secrets`, and `check:isolation`
  all pass.

- Follow-up full hybrid/Supabase compatibility pass after the first targeted
  fix did not resolve the reported profile flow:
  - Compared the working tree against the local `main` branch, the complete
    transferred frontend, repository history, generated Supabase types, and
    the sanitized backend reference. The separate production repository was
    not accessed because this lab's isolation rules prohibit it.
  - Audited all 463 frontend Supabase imports: every one uses
    `@/integrations/supabase/client`, so the guarded live alias selects one
    shared client and no relative import bypasses the hybrid boundary.
  - Audited 55 static Edge Function invocations against 119 transferred
    function references. All base function names are represented; the only
    apparent unmatched strings are three `google-drive-import?...` action
    variants of the referenced `google-drive-import` function. Edge Function
    service-role secrets remain server-only reference requirements and do not
    enter the browser bundle.
  - Removed the two unnecessary live-client deviations from standard
    Supabase behavior: the custom `ignite-live-<alias>-auth` storage key and
    `x-ignite-backend-target` global header. The live alias remains in place,
    so hybrid routing is preserved, but the selected Supabase target now uses
    the SDK's normal project-derived auth storage and request headers, matching
    the conventional Supabase frontend contract.
  - Replaced profile `upsert` with an explicit existing-user `UPDATE` followed
    by a new-user `INSERT` only when no row was updated. PostgreSQL evaluates
    an upsert through the INSERT RLS path before conflict resolution; the old
    flow therefore forced an existing user through INSERT authorization even
    when the intended operation was only an update. The split flow now maps
    existing profiles to the canonical UPDATE policy and genuine first-login
    profiles to the INSERT policy while retaining server-validated
    `auth.getUser()` identity.
  - Extended regression guards to require default live-client behavior and
    update-before-insert ordering.
  Validation: focused auth/alignment suites (24/24), `typecheck:lab`, and
  `typecheck:product` (101 existing diagnostics, zero new) pass before the
  final guarded live rebuild.

- Added **Phase 8 — Graduate this lab's code out to a real production
  repository** to the phased plan. This documents the agreed path for
  moving the hybrid codebase into the actual production application without
  this lab ever accessing, cloning, or modifying the real production
  repository: curate a clean export (strip lab-only fixtures, fail-closed
  proxy client, isolation/secret-scanning guards, sanitized reference
  material, and internal planning docs), push that export to a brand-new
  repository the repository owner creates/controls, and let the repository
  owner perform the actual review, merge, and production credential/
  deployment cutover using their own access. This keeps the boundary
  one-directional: code can leave the lab outward, but nothing reaches back
  into production from inside it.

- Completed Phase 8 Step 1 (curate the export) concretely, rather than
  leaving it as a plan description:
  - Audited how deeply lab/live code is interleaved: `src/lab/localRuntimeMode.ts`
    is imported by 106 files and `src/lab/fixtureDataLayer.ts` by 56 files,
    almost entirely as inline branches inside otherwise-shared pages/hooks,
    not as isolated files. Concluded that deleting `src/lab/**` outright
    would break the build, since most files under it (local ICP service
    adapters, hybrid repositories, query-key helpers) are shared
    infrastructure, not lab-only fixtures.
  - Wrote [PRODUCTION_HANDOFF_EXPORT_GUIDE.md](PRODUCTION_HANDOFF_EXPORT_GUIDE.md),
    an exact, file-by-file include/exclude classification for every
    top-level and `frontend/`-level path, with the reasoning for each
    decision (e.g. why `src/lab/**` is kept wholesale while
    `src/lab/LabApp.tsx`/`src/main.tsx`/`index.html` — the true lab-only
    entry point — are excluded).
  - Added `scripts/export-production-candidate.sh`, a tested, idempotent
    rsync-based export script that materializes the curated tree at a
    local destination directory (never pushes anywhere) and renames
    `live-index.html` to `index.html` so the export has a natural
    default entry point. Verified by running it and confirming every
    excluded path is absent and every required path (including the live
    Vite config, the live Supabase client, and the renamed live entry
    HTML pointing at `product-main.tsx`) is present.
  - Creating the destination GitHub repository, reviewing the export,
    pushing it, and performing the actual production cutover remain
    entirely the repository owner's actions, per the isolation rule that
    this lab may only prepare code to leave outward, never reach into an
    existing repository (lab or production).

- Corrected Phase 8 handoff instructions before recommending the export:
  the initial script removed `check-live-config.mjs`, which `build:live`
  requires, and renamed `live-index.html` while Vite still used that
  name as its input. It also deleted an existing destination. The
  revised exporter preserves the intact hybrid frontend and live build
  tooling, refuses an existing destination, omits environment files,
  and labels the result a reviewable source handoff rather than a
  production-ready application. Feature parity with the separate
  application's current `main` has **not** been verified.

- Extended the Phase 8 handoff to include all tracked ICP canister
  source, Rust/Motoko manifests and local topology in addition to the
  frontend. The exporter takes a committed-HEAD snapshot and excludes
  local identities/state, dependency caches and private configuration.
  Documented that `icp.yaml` only configures local networks, not a
  mainnet deployment, and that connecting to the approved dev Supabase
  project is an explicit live-build configuration and separate RLS/
  Edge Function validation task, never an automatic consequence of
  copying source files.
