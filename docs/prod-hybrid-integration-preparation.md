# Prod / hybrid integration preparation

## Status: review branch only — not ready to merge or run

The `integration-hybrid` branch joins both existing histories in a two-parent commit. The first parent is prod main `96642d0750e03d933b68957d61999de3ae983b9c`; the second is hybrid `6ed2ed9d268303fb5bde9b9783a1a9c2604e2b23`.

All prod-main files are retained byte-for-byte. Missing hybrid files are added, including the eight previously verified Supabase compatibility files. No existing file is deleted or overwritten. Secrets, external database connections, GitHub settings, and deployed services are not changed.

## Twelve conflicts deliberately retained from prod

The hybrid versions remain available in the second-parent history and on `hybrid`; none is silently selected over prod:

- `.gitignore`
- `AGENTS.md`
- `README.md`
- `codemagic.yaml`
- `netlify.toml`
- `package.json`
- `roadmap.md`
- `tsconfig.json`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/previewAuthStorage.ts`
- `src/integrations/supabase/types.ts`
- `supabase/config.toml`

**Runtime/build selection remains unresolved.** Prod keeps its root app/build configuration, while hybrid's app is under `frontend/`. This preparation branch does not activate the hybrid app. Existing native/hosting setup must be adapted deliberately after target compatibility is verified, not replaced blindly. Retained root instructions and the hybrid nested instructions need reconciliation before activating the split layout.

## Workflow review

The union contains all existing prod workflows plus missing hybrid workflows; there were no same-path workflow conflicts. Reviewed push filters do not match `integration-hybrid`. No pull request is opened, so PR triggers are not activated. Schedules run from the default branch, which remains untouched.

Before a main merge, automatic jobs must be prevented and explicitly reviewed. Hybrid introduces automatic frontend-canister deployment on qualifying main pushes, daily media retention, notification delivery and reporting schedules. Existing prod includes backup schedules and promotion on the `prod` branch. Keeping their files is not approval to run them. Existing invalid `deliver-private-name-approval.yml` also needs validation repair before use; past notices had zero jobs.

## Outstanding essential gates

1. Obtain the live target schema/configuration report described in `docs/supabase-prod-compatibility-2026-10-29.md`. This chat cannot query target `ecsdwrarzfexssxtrymj`.
2. Verify pending migration requirements and existing production services. Adding SQL files does not apply them, and the union's complete migration history must never be replayed automatically.
3. Resolve the retained build/runtime/native/hosting conflicts without replacing prod database settings or secrets.
4. Verify release environments, credentials and retained journals before any live job; no uncertain upgrade replay is permitted.
5. Run isolated target acceptance and both-mode regression checks on the resolved integration, then obtain main merge/job approval.

Preparing this branch proves history and file preservation only, not live database compatibility, deployability or workflow readiness.