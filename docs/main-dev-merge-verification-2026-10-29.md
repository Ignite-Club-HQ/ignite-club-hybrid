# Main / DEV-only merge verification — 29 October 2026

## Scope

Repository: `Ignite-Club-HQ/ignite-club_hq-prod`. Final merge destination: `main` only. Authorized database: Ignite Club HQ DEV `ecsdwrarzfexssxtrymj` only. The `prod` branch and production database remain off-limits. This pass made no remote writes, merges, job dispatches, database calls or provider-setting changes.

## Verified

- Live GitHub comparison: main is the merge base (`96642d0750e03d933b68957d61999de3ae983b9c`); integration-hybrid is ahead with zero behind commits. The unrelated-history obstacle is resolved. Comparison file output is capped at 300, so it is not a fresh whole-file-preservation audit.
- Review branch remains at `6976452b67512b46a18312675cb710728c8f4825` in the live comparison.
- Saved integration inventory contains 61 workflow files (13 retained plus 48 copied); this is not proof that all are accepted or visible in Actions.
- Live Actions API recognizes 16 workflow records, all active, including historical/invalid notices. That count is not the number of valid files on main.
- Both review-branch validation notices (40805217536 and 40805777157) have zero jobs on fresh job-list reads. No successful deployment run is present in the review branch's current run list.
- Local main-only / DEV-only policy and optional-build tests: 18 passed. These newer restrictions are not yet copied to the integration branch and do not guard existing workflows by themselves.

## Essential failures / unverified gates

1. **No-jobs condition fails today.** Main pushes trigger CI, frontend tests and path-matched frontend-canister deployment. Scheduled delivery/retention/reporting and backup workflows can also execute from the default branch. For the requested zero jobs until enabled, every applicable main job needs a default-off main-scoped guard, not merely the deployment job. Workflow runs can still appear as skipped/validation notices; distinguish those from executed jobs. Do not disable Actions repository-wide because that would change prod behavior.
2. **Copied deployment has the wrong fallback.** The frontend-canister workflow can use `cdrxmelhysdqrccttsjg` instead of the authorized DEV database. It does not call the local main/DEV-only guard. Future main releases must require the exact DEV URL and corresponding public key with no other-project fallback before work begins.
3. **Production promotion is not a main-push trigger.** The saved promotion workflow targets prod pushes/PRs and manual dispatch; do not run, alter or re-target it. This is source verification only, not permission to probe its production database.
4. **DEV live compatibility remains unverified.** This chat's SQL tools are bound to cdrxmelhysdqrccttsjg, not DEV. No calls were made to either DEV or production. Saved types and migrations cannot prove live requirements. The DEV-connected project must supply the read-only report below.
5. **The app is not yet selected end-to-end.** Retained root commands still build the old root app; hybrid is under frontend. Optional guarded selection does not prove native plugin/callback compatibility, hosted endpoints or installed artifact targeting. Do not change production native identity/settings to bypass this.
6. **External automatic deployment remains unverified.** Netlify and Codemagic hosted branch settings are not established by their saved YAML. Before a main merge, verify main cannot silently invoke a production hosting/native deployment; production settings must remain untouched.
7. **Workflow acceptance needs repair/validation.** Existing deliver-private-name-approval workflow produces invalid-workflow notices. Parsing saved YAML alone does not establish GitHub expression/context acceptance. Validate every changed workflow before the eventual merge.

## Exact request for the DEV-connected Lovable project

> Confirm this project is connected to Ignite Club HQ DEV at ecsdwrarzfexssxtrymj. If not, stop. Read-only: compare the live DEV database with docs/supabase-prod-compatibility-2026-10-29.md on integration-hybrid in Ignite-Club-HQ/ignite-club_hq-prod. Report only active-code requirements: relevant columns/foreign keys, function signatures/definitions and EXECUTE grants, table grants/RLS, Storage buckets/policies, Realtime publications and hosted sign-in settings. Do not export records, credentials or secrets; do not query production, change any database, switch branches or run jobs. Identify absent/incompatible requirements and propose only essential additive changes for separate approval.

## Next safe work

Prepare default-off main job guards and copy the tested DEV-only restrictions onto integration-hybrid; preserve prod behavior and repair workflow validation. Obtain DEV schema/config evidence and external main-deployment checks in parallel. No main merge or enabling jobs until those conditions are verified.