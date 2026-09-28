# Hybrid app source handoff

> This guide documents the export from the isolated source lab. The export
> has already been migrated into this repository; the exporter script and
> lab-only runtime/test components are intentionally not present here.
> Do not follow the export commands below from this destination checkout.

This is a **reviewable source copy**, not a certified production release.
It includes the hybrid frontend **and** this lab's ICP canister backend.
It does not connect to any database, deploy canisters, export data, or
compare against the other application's current `main`. That comparison
must happen separately in an authorized environment before cutover.

## Create a local copy

From this lab checkout's root:

```bash
bash scripts/export-production-candidate.sh "$HOME/ignite-hybrid-handoff"
```

Choose a **new, nonexistent, absolute directory outside this repo**.
The script refuses an existing path. It exports **tracked files at
committed HEAD**, not uncommitted or untracked work, and prints the commit
it used. Commit intentional changes in this lab before exporting them.
The handoff directory contains:

| Path | Purpose |
| --- | --- |
| `frontend/` | Entire checked-in UI, hybrid adapters, live Vite build, tests, lockfile and public assets |
| `backend/` | All 13 local ICP canister source directories (Rust/Motoko, Candid, migration sources and canister-level manifests) |
| `Cargo.toml`, `Cargo.lock` | Rust canister workspace and lockfile |
| `mops.toml`, `mops.lock` | Motoko dependencies and lockfile |
| `icp.yaml`, `icp-domain-topology.json` | **Local-only** canister topology and domain inventory; not mainnet deployment configuration |
| `docs/RLS_DOMAIN_INVENTORY.md` | Sanitized domain/RLS research required by the topology validation script; not proof of dev database parity |
| `docs/PRODUCTION_HANDOFF_EXPORT_GUIDE.md` | This handoff/configuration runbook |
| `README.md`, `.env.example` | Generated hybrid-repo overview and placeholder-only public configuration |
| `.gitignore` | Ignore local state, builds, keys and env files |

The script excludes Git history, reference-only Supabase backend text,
other planning documents, CI deploy workflows, `node_modules`, bundles,
`.mops` caches, `.icp`/`.local-icp` state, private keys and `.env*`.
It does **not** copy live canister IDs, controllers, identity files,
cycles, Supabase user data, Edge Function secrets, or a runnable
Supabase server backend. The sanitized `reference/backend/` contains
inert historic SQL and Edge Function text; it is deliberately not
executable migration/deployment material.

The remaining `frontend/src/lab/` directory contains shared hybrid
repositories, query keys, bindings, and types; it does not contain the
removed fixture data, synthetic identities, or local actor services.
The live Vite aliases swap
`@/integrations/supabase/client`, Internet Identity auth, and runtime
mode for their `frontend/src/live/` equivalents, and alias any remaining
local-only service import to a fail-closed module. The intended live
build is `npm run build` (or `npm run build:live`) from `frontend/`;
`dev` also uses the guarded live configuration. Lab build and local ICP
orchestration commands are not part of this destination. Preserve
`frontend/live-index.html`,
`frontend/vite.live.config.ts` and
`frontend/scripts/check-live-config.mjs`.

## Connect a *reviewed deployment* to the approved dev Supabase project

The export alone makes **no** Supabase connection. In the new repo's
deployment/build environment, configure the **public** URL and anon
key of the approved **dev** project, never the production project:

```text
IGNITE_LIVE_SUPABASE_URL=<approved-dev-project-https-url>
IGNITE_LIVE_SUPABASE_ANON_KEY=<approved-dev-public-anon-key>
IGNITE_LIVE_ICP_HOST=<approved-ICP-gateway-https-url>
IGNITE_LIVE_ICP_CANISTER_IDS_JSON=<JSON-object-of-approved-deployed-canister-IDs>
```

Use private CI/hosting environment settings; do **not** commit a `.env`
file or any service-role key. Browser-facing anon keys are public,
but the project URL and key must be reviewed to avoid pointing this
handoff at the wrong project. `frontend/src/live/targetRegistry.ts`
also supports target aliases and JSON registries for multiple
environments. Verify the active alias/URL before sign-in.
The dev project's actual schema, RLS, Edge Functions, OAuth redirect
URLs, allowed origins and any server-side secrets must be reviewed
and configured independently; copying ICP code does none of that.
No production Supabase access is required or permitted here.

The root `netlify.toml` builds `frontend/dist-live` and pins the CSP to
the reviewed DEV Supabase hostname. Review the remaining allowed origins
and keep previews private. Public values still come from private hosting
configuration; the CSP hostname is not an authentication credential.

## ICP backend is source, not a deployed service

`icp.yaml` explicitly names **local** networks only and has
local init-argument paths under `.local-icp/` that the export
intentionally omits. Do not run it as a mainnet deploy recipe.
To use ICP outside the local synthetic lab, authorize a separate
deployment plan: provision the intended canisters and identities in
an approved environment, validate init arguments/controllers,
generate or verify bindings/Candid, record canister IDs, then supply
them to the live frontend configuration. Do not repurpose local
test identities or copy local state into the new repo. An empty
canister-ID mapping does **not** constitute a working ICP backend.
See [PRODUCTION_LAUNCH_PLAN.md](PRODUCTION_LAUNCH_PLAN.md) Phase 3
for outstanding ICP deployment gates.

## Validate before creating/pushing the new repository

1. Inspect the local copy for unwanted files and source drift. For the
   frontend, use an approved nonproduction **public** config and run
   `cd frontend && npm ci && npm run build`; deployable output
   is `frontend/dist-live/`, **not** `frontend/dist/`. The build
   embeds the selected public target, so rebuild for another target.
2. Run `cd frontend && npm run check:step1` in the export to verify
   topology and Candid binding drift. Follow the dedicated lab
   validation guidance for deeper backend checks; do not run old
   source tests importing production modules
   and do not run any deployment scripts merely to validate a copy.
   Verify Rust/Motoko Candid against the frontend bindings, and test
   the approved dev Supabase auth/profile flow with synthetic accounts.
3. In an authorized environment, compare **both** trees with the
   existing application's current `main` and reconcile newer
   features, schema/RLS, Edge Functions and data ownership. A file
   export alone cannot prove parity. Review cutover and rollback.

If you choose a **new, empty, preferably private** GitHub repository,
review the exported files before pushing, then from the handoff root:

```bash
git init -b main
git add -A
git diff --cached --stat
git commit -m "Import hybrid frontend and ICP canisters for review"
git remote add origin <URL-of-new-empty-repository>
git push -u origin main
```

Replace the placeholder with your **new repo** URL. Never use the
existing application repository as that remote, force-push its
history, or treat this handoff as a production cutover.
