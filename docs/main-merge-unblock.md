# Main merge safeguards

Repository: Ignite-Club-HQ/ignite-club_hq-prod. Review branch only; no main/prod merge, jobs or database operations.

## Prepared

- All 61 workflows / 62 jobs have destination-scoped locks. Main and its pull requests cannot execute jobs by default. Integration preparation cannot execute jobs. Production branch and source-repository job behavior is preserved.
- Main execution requires manual dispatch plus repository variables `IGNITE_MAIN_WORKFLOWS_ENABLED=true` and the individual workflow's `IGNITE_MAIN_<FILENAME>_ENABLED=true`. Automatic main pushes/schedules remain blocked even after these switches are enabled. Do not set switches until separate activation approval.
- Production-targeting and unverified database maintenance jobs are permanently blocked on main, regardless of switches. Existing production configuration and branch remain unchanged.
- Frontend deployment requires the exact DEV URL and matching public key, with no wrong-project fallback on destination main. DEV public values use new variables; existing secrets are not replaced.
- Name-approval workflow temporary paths are initialized in a step because runner context is not available in job-level env.
- 23 local safety tests pass; all 61 workflows pass actionlint expression/YAML validation (shell lint disabled). These checks do not certify live service compatibility.

## Still essential before merge

1. A read-only live DEV report for `ecsdwrarzfexssxtrymj`: columns, relevant RPC signatures/grants, RLS, Storage, Realtime, hosted auth and required HTTP functions. This project's SQL connection is not that DEV database; never probe the production database instead. Use the request in `docs/main-dev-merge-verification-2026-10-29.md` from the DEV-connected Lovable project.
2. Confirm Netlify/Codemagic main-branch automatic deployments are disabled or independently DEV-only. Do not modify production settings. GitHub job guards do not stop external providers.
3. Select and verify the hybrid web/native build on DEV, preserving app identity and callbacks; the optional build adapter is preparation, not activation. Root still selects the retained app until reviewed activation.

No database migration or live canister release is authorized by this preparation. An unresolved existing release must not be replayed.