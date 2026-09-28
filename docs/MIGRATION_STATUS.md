# Ignite Club Hybrid migration status

## Provenance

- Destination repository: `Ignite-Club-HQ/ignite-club-hybrid`
- Original destination base: `main` at `620667d8f693`
- Destination main reconciled through `7c9cb68` (`Added ICP connection layer`)
- Migration branch: `migration/hybrid-source-2026-09-28`
- ICP Lab source snapshot: `fe266f1a8`

This branch replaces the destination's Lovable/TanStack starter with the
reviewed hybrid source. It incorporates destination `main` through the
latest ICP connection-layer commit. That starter's root ICP prototype is
superseded by the guarded application integration under `frontend/src/live/`;
the useful repository guidance and an updated roadmap are retained. The
starter's tracked `.env` is deleted on this branch, and no value from it is
committed elsewhere.

## Implemented

- Migrated the complete React frontend and all 13 Rust/Motoko ICP canister
  source directories, Candid contracts, migrations and root manifests.
- Made `npm run dev` and `npm run build` use the guarded live Vite target.
- Added placeholder-only `.env.example` variables and a root Netlify
  configuration pinned by CSP to the reviewed DEV Supabase hostname.
- Preserved the public DEV Supabase anon key outside Git; hosting/CI must
  supply it privately.
- Disabled the former public `?backend=icp` fixture escape hatch.
- Aliased fixture data, local actor services and synthetic identities to a
  fail-closed live module so those implementations do not enter the live
  bundle.
- Added CI for topology/Candid checks, lint, product type diagnostics,
  live runtime tests, a synthetic live build, bundle scanning and Rust
  workspace checking.

## Verified in the migration checkout

- ICP topology: 13 logical roles and 10 external boundaries.
- Candid drift: all 13 active contracts match generated declarations.
- Rust workspace: `cargo check --workspace` passes.
- Frontend lint and product type-diagnostic baseline pass.
- Live runtime tests pass and URL parameters cannot enable fixture mode.
- The default `npm run build` succeeds using synthetic public build
  configuration; no Supabase request was made during validation.
- The generated bundle contains no `localActor`, `fixtureDataLayer`,
  `syntheticIdentities`, public test seed or known secret markers.

`cargo test --workspace` was attempted first. Compilation succeeded until
the host linker crashed with a bus error and then the workspace exhausted
disk; the lower-resource `cargo check --workspace` completed successfully.
CI will run the locked workspace check again in a clean runner.

## Not complete

- No Supabase request was made. DEV schema, RLS, Edge Functions, auth
  redirects and allowed origins still require end-to-end verification.
- `icp.yaml` is local-only. No remote canister was created or upgraded,
  and no controller, cycle balance, init argument or deployed canister ID
  was configured.
- The live frontend currently uses Supabase for application domains.
  Internet Identity and the live actor foundation are present, but the
  twelve domain canisters beyond identity access are not yet connected to
  live page adapters. ICP mode must remain disabled until that work and
  authorization parity are complete.
- Feature parity with the separate existing application repository was
  not inspected from the lab and is not established by this migration.

Review and merge this branch only as a clean development baseline, not as
authorization to deploy to production.
