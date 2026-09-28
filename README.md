# Ignite Club Hybrid

Hybrid Supabase/Internet Computer application source migrated from the
isolated Ignite ICP Lab.

## Layout

- `frontend/`: React application and provider-neutral/hybrid adapters.
- `backend/`: Rust and Motoko ICP canisters and Candid contracts.
- `icp.yaml`: local-only ICP topology; it is not a mainnet deployment recipe.
- `docs/PRODUCTION_HANDOFF_EXPORT_GUIDE.md`: configuration, validation,
  deployment boundaries and outstanding parity work.

The default `dev` and `build` scripts in `frontend/` use the guarded live
configuration. Lab-only runtime modules, fixture test suites, local ICP
orchestration, and lab build entry points are not included in this
repository. Copy `.env.example` into private CI/hosting configuration only
when ready; do not commit credentials or service-role keys.

## DEV Supabase

The live build is prepared for the `Ignite Club HQ DEV - Hybrid` Supabase
project. Configure these values in the private build/deployment environment:

- `IGNITE_LIVE_SUPABASE_URL`
- `IGNITE_LIVE_SUPABASE_ANON_KEY`
- `IGNITE_LIVE_ICP_HOST`
- `IGNITE_LIVE_ICP_CANISTER_IDS_JSON`

The Supabase URL is pinned in the root `netlify.toml` only for CSP
allowlisting; the anon key is deliberately not committed. The removed
Lovable starter `.env` is removed from this migration branch; do not restore
or transfer it. Review the project's RLS, Edge Functions,
OAuth redirects and allowed origins before treating a successful build as
a working application.

## Current migration status

This branch carries the product frontend and ICP canister source from
Ignite ICP Lab commit `fe266f1a8`, excluding lab-only runtime and test
components. The canister topology is local-only: remote canisters,
controllers, init arguments and IDs are not provisioned by this migration.
Read `docs/PRODUCTION_LAUNCH_PLAN.md` before deployment.

The live frontend currently uses Supabase for application data. The old
`?backend=icp` switch entered fixture/local-actor code rather than the
remote canisters, so it is disabled in this migration. Internet Identity,
live ICP actor infrastructure, Candid bindings and all canister source are
retained, but a real public ICP mode is not complete until domain pages use
the live adapters and deployed canister IDs. Do not claim ICP parity based
only on the presence of backend source.

The live build aliases fixture data, local actor services and synthetic
identities to a fail-closed module. CI verifies that those markers do not
enter `dist-live/`. The remaining `frontend/src/lab/` directory contains
shared hybrid repositories, query keys, and contract bindings; its name
does not mean the removed local fixtures or synthetic runtime were migrated.
