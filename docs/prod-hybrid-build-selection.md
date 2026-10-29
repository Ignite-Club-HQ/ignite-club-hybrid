# Guarded hybrid app selection — preparation only

The existing prod root app, package commands, Netlify configuration, Codemagic workflows, Capacitor identity, Supabase configuration and secrets remain unchanged. The optional `scripts/prod-hybrid-build.mjs` builds the hybrid app under `frontend/` into root `dist/`, where the retained production web/native setup expects bundled assets. Nothing invokes it automatically.

## Essential target discrepancy

The screenshot and saved root development configuration identify `ecsdwrarzfexssxtrymj`. Retained Netlify production and Codemagic production settings instead explicitly select `yabcfiuntwqjwvschnji`. This is a dev/production split, not permission to replace either setting. Obtain read-only compatibility reports for the database actually used by each intended release; checking DEV alone cannot certify production.

## Prepared invocation, not activation

After the live target is independently verified, provide `IGNITE_BUILD_TARGET=hybrid` and `IGNITE_EXPECTED_SUPABASE_URL` matching that release's existing configured URL, then invoke `node scripts/prod-hybrid-build.mjs` instead of the old web-build step. The adapter consumes the retained public URL/key environment variables; it does not load `.env`, insert hybrid database defaults, read private secrets or rewrite configuration. Missing/conflicting values, private keys and wrong-project anon JWTs refuse before installation. Opaque publishable keys still require hosted target acceptance because their project cannot be decoded.

Root `npm run build` remains unchanged; changing it later requires a reviewed activation patch. Retained phone workflows must run frontend dependency installation through the shared installer and keep their root native project, signing, Firebase settings and app ID (`app.lovable.igniteteamhub`). Do not substitute hybrid's separate Capacitor identity (`com.igniteclubhq.app`) or scaffold over production's native projects.

## Still blocked before native activation

The production native dependency/plugin graph differs from `frontend/`. Audit installed native plugins against hybrid frontend imports before shipping. Internet Identity currently returns via `com.igniteclubhq.app://ii-callback`; register that callback in the retained native shell without changing the existing application ID, alongside existing OAuth links, then verify signed-in Android/iOS returns. Preserve keyboard and status-bar handling. No native workflow is activated by this preparation.

Retained hosting must also serve hybrid's `/api/fetch-link-preview` and `/api/register-club-backend` handlers before its catch-all while preserving `/share`, security headers and public deep-link assets. Validate these external handlers against the existing host; a static app shell alone cannot prove those services work.

## Checks and remaining release gates

Run `node --test scripts/prod-hybrid-build.test.mjs` for the guarded target/output policy. These tests perform no install/build/deployment/database write. Actual integrated web/native builds, both-mode regression checks and signed-in isolated target acceptance remain required. Prevent Actions and hosting/Codemagic auto-deploy before any eventual main merge; re-enable only reviewed jobs after explicit authorization. Retain unresolved upgrade journals; do not replay upgrades.