# Map ICP Cloud Engines to specific countries

## Goal
Let an app admin register one or more ICP Cloud Engine deployments (for example "eu-engine", "au-engine") and assign countries to them. Members in those countries use their assigned engine instead of public mainnet. Everyone else stays as they are now (Supabase by default, or mainnet ICP where set up).

## What the admin will see (Placement Settings)
- A new **ICP deployments** card listing "Public mainnet" (always there) plus any Cloud Engines added.
- **Add Cloud Engine**: name, region label (for example "EU – Frankfurt"), connection address, and the set of canister IDs for that engine (paste the deploy output, same format as today's ID table). Enable/disable toggle.
- In **Country rules**, each country set to ICP gets a second picker: "Mainnet" or one of the Cloud Engines.
- A warning on save if a country is assigned to an engine that is disabled or is missing required canister IDs. In that case that country falls back to Supabase, never to mainnet, so data never ends up on the wrong network.

## Behaviour rules
- Order of decisions: club pin, then country rule, then default. A country's engine choice picks *which* ICP deployment.
- A club pinned to ICP uses its members' country engine. Club pins can optionally name an engine too.
- If a country is set to "Cloud Engine only" (a strict-residency flag) and the engine isn't available, members get Supabase or a clear "service unavailable in your region" screen. They never silently get mainnet.
- One account's data lives on one deployment. Moving a club or country between deployments is a data move, not a toggle, so the page warns about this before saving.

## Out of scope (you need to do these)
- **Creating the Cloud Engines themselves.** Each engine is a separate ICP deployment you create with DFINITY or node providers in that region. The app connects to engines; it can't create them.
- **Deploying the canisters to each engine.** Same canister code, deployed once per engine. I'll make the deploy script take a target name so one script works for mainnet and every engine.
- **Moving data.** Existing ICP data stays on mainnet. Clubs created after the change go to their country's engine.

## Technical details
- `targetRegistry.ts`: `getActiveIcpTarget()` becomes country/club aware. It resolves the target via `resolveTargetForCountry` (with the club pin added) and builds an `IcpTargetConfig` (`networkKind: "cloud_engine"`, host, canisterIds, residencyProfile) from runtime config rather than the single build-time alias.
- Runtime storage: extend `icp_canister_config` (app_settings plus club_domain app_config mirror, newest `savedAtMs` wins) to `{ targets: { [alias]: { host, canisterIds, region } } }`. The existing single-target shape stays readable as alias `icp-public-mainnet`.
- `backendRouting.ts`: add an optional `strict` flag per country, `clubTargetOverrides`, and a resolver that returns `null` (meaning unavailable) instead of falling back to mainnet for strict countries. Pure functions with unit tests.
- `createLiveAgent` cache key already includes the target, so switching engines needs no agent changes. Internet Identity works across engines, but each engine has its own vetKeys/pii_access_control, so encrypted data stays tied to its own engine.
- Deploy: `scripts/deploy-mainnet.sh` becomes `--target <alias>` with `deploy/<alias>/icp.yaml`. The GitHub workflow gets a target input. Post-install wiring runs for each engine.
- Record the routing rule in `frontend/AGENTS.md`.
