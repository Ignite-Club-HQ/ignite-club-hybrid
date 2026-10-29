# Move Hybrid into the prod repo as a `hybrid` branch

Source: `Ignite-Club-HQ/ignite-club-hybrid` (left unchanged)
Destination: `Ignite-Club-HQ/ignite-club_hq-prod`, new branch `hybrid`
Rule: copy only. Never change prod `main`, its secrets or settings, and don't switch on copied automation without a separate OK.

## What carries across, and how

| Item | How it moves | Who does it |
|---|---|---|
| Code + full history | Push hybrid's `main` to prod as the new branch `hybrid` | Script I prepare, you run |
| Workflows (`.github/workflows`) | Carried inside the `hybrid` branch | Automatic with the code |
| Secrets | GitHub never shows saved secret values, so they can't be copied. You re-enter only the missing ones. | You, from a checklist I generate |
| Variables | Names and values can be read and copied if missing | Script, add-only |
| Environments (incl. review gate) | Recreate any missing ones with the same reviewers and branch rules | Script, add-only |
| Branch protection | Add protection for `hybrid` only | Script |
| Lovable sync | Stays on the hybrid repo. Lovable can't re-link to an existing repo, so prod `hybrid` is a copy, not the live sync target. | Decision for you (below) |

## Important GitHub limitation
Workflows you start by hand (Upgrade backend, Deploy web app, etc.) only appear in the Actions tab when the workflow file also exists on prod's **default branch** (`main`). There are two options:
- **A (safest):** keep running releases from the hybrid repo until cutover. The prod `hybrid` branch is a mirror.
- **B:** add small launcher workflow files to prod `main` that run the `hybrid` branch code. This changes prod `main`, so it needs your explicit approval.

## Steps
1. **Inventory (read-only):** list workflows, secret names, variables, environments and protections in both repos, then produce a "missing in prod" report. Nothing changes.
2. **Name clash check:** flag any workflow file or secret name that exists in both repos with different meaning. Nothing gets overwritten.
3. **Push branch:** push hybrid `main` to prod as `hybrid`, refusing if `hybrid` already exists there.
4. **Disarm automation:** in the `hybrid` branch, scheduled and push triggers stay off until you approve. Manual triggers only.
5. **Add missing variables and environments** (add-only), plus protection for `hybrid`.
6. **Secrets checklist:** I list each missing secret name and where its value comes from (Resend, deploy identity, Supabase, etc.). You paste the values in prod → Settings → Secrets.
7. **Verify:** run one harmless check workflow (the isolated test) on prod `hybrid`. Mainnet upgrade workflows stay unrun until you approve.
8. **Keep in sync (optional):** a manual "Sync hybrid mirror" job in the hybrid repo pushes new commits to prod `hybrid`. It fast-forwards only and never force-pushes.

## What I need from you
- A GitHub token with `repo` + `workflow` + admin read on both repos, saved as a secret (never pasted in chat).
- Your choice of option A or B.
- Whether ongoing mirroring (step 8) is wanted.

## Technical details
- The scripts go in `scripts/migrate-to-prod-branch.mjs`: GitHub REST via fetch, dry-run by default, `--apply` required to make changes.
- Pushing uses `git push <prod> refs/heads/main:refs/heads/hybrid` from a temporary clone in /tmp. It never touches this project's own git.
- Secret values are never read or logged. Only names are compared.
