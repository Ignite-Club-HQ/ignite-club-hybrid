# Implementation Plan — Merge "Ignite Club HQ Hybrid" into the other repo

Status: not started. Written 2026-10-09. Nothing in this plan has been done yet.
Purpose: a ready-to-run checklist for moving this project's code and its GitHub
Actions automation into the main repository, so everything runs from one place.

---

## 1. Goal and scope

One repo containing both apps, with this project's frontend, blockchain backend,
canister deploy config, and ICP admin workflows living alongside the existing
app. Nothing about the running system changes: same Supabase project
(`cdrxmelhysdqrccttsjg`), same deployed canisters, same canister IDs, same
deployer identity.

Out of scope: rewriting app code, changing canister controllers, re-running
Supabase migrations.

## 2. What this project consists of (copy inventory)

**Copy these, keeping the same top-level folder names:**

| Path | What it is |
| --- | --- |
| `frontend/` | The Vite SPA (the live web app). Own `package.json`, `package-lock.json`, `bun.lock`, `src/`, `public/`, `live-index.html`, `netlify/`, `scripts/` (12 check/build scripts incl. `prepare-canister-dist.mjs`, `check-topology.mjs`), `AGENTS.md`, baseline JSON files. |
| `backend/` | 19 Motoko canisters (`club_domain`, `messaging_domain`, `identity_access`, `events_domain`, `media_blob_store`, `media_metadata`, `notification_queue`, `vault_domain`, `pii_access_control`, `migration_coordinator`, `shard_router`, `timer_jobs`, `placement_registry`, `secret_workload_identity`, plus competition/mini-league/points/insights domains), each with `canister.yaml` and `.did`. |
| `scripts/` | `deploy-mainnet.sh`, `grant-app-admin.sh`, `grant-push-worker.sh`, `push-worker-principal.mjs`, `icp-push-deliver.mjs`, `move-account.mjs`, `erase-duplicate-profiles.mjs`, `delete-clubs-except.mjs`, `set-all-clubs-pro.mjs`, `backfill-club-home-countries.mjs`, `sync-canister-ids.mjs`, `static/`. |
| `deploy/` | `deploy/mainnet/icp.yaml` + `deploy/mainnet/.icp/data/mappings/ic.ids.json` and `deploy/frontend/icp.yaml` + `deploy/frontend/.icp/data/mappings/ic.ids.json`. The two ID tables are committed on purpose. |
| `supabase/` | `functions/verify-iap-receipt-icp/index.ts` (+ `_shared/cors.ts`), `config.toml`, 5 migration SQL files. |
| `.github/workflows/` | 11 files — see §4. |
| Root files | `mops.toml`, `mops.lock`, `Cargo.toml`, `Cargo.lock`, `icp.yaml`, `icp-domain-topology.json`, `netlify.toml`, `codemagic.yaml`, `tsconfig.json`, `.env.example`, `.gitignore` (merge, don't overwrite), `AGENTS.md`, `README.md`, `docs/` (runbook/audit files incl. `codemagic-android-plan.md`), `roadmap.md`. |

**Do NOT copy (Lovable-editor scaffolding, meaningless elsewhere):**
`lovable.toml`, `.lovable/`, `.workspace/`, `.git`, `node_modules/`,
`frontend/node_modules/`, `frontend/dist*/`, `.mops/`, `target/`,
`tsconfig.tsbuildinfo`, `scripts/ensure-frontend-deps.mjs`,
`scripts/dev-preview.mjs`, `scripts/build-preview.mjs`, `scripts/typecheck-noop.ts`,
root `package.json` (dependency-free shim that only exists so Lovable can build),
and the stray `final_fix.py`, `fix_header_v3.py`, `fix_leaks.py`, `fix_ui_mess.py`.

**One exception:** `scripts/ensure-frontend-deps.mjs` is on the do-not-copy list
because it exists for Lovable's editor, but all four Codemagic jobs call it as
their first step. Either copy that single file across or rewrite the install
step — see §8.

## 3. Recommended structure — keep the folder names identical

The workflows hardcode these paths:

- `working-directory: frontend` and `working-directory: deploy/frontend`
- `cache-dependency-path: frontend/package-lock.json`
- `DEPLOY_DIR="$GITHUB_WORKSPACE/deploy/mainnet"`
- `IDS="deploy/mainnet/.icp/data/mappings/ic.ids.json"` and the `deploy/frontend` equivalent
- `grep -rl "$SENTINEL" backend deploy/mainnet scripts`
- `cp scripts/<name>.mjs /tmp/icp-run/`
- from inside `frontend/`: `node ../scripts/sync-canister-ids.mjs`, `cp -r dist-canister ../deploy/frontend/dist`

If the folders keep their names at the top level of the other repo, **zero
workflow edits are needed**. Nesting everything under `ignite/` (or renaming
anything) means editing every line above plus the `paths:` trigger filters —
about 15 spots across 6 workflows. Recommend the flat copy.

## 4. Workflow migration, one by one

| Workflow | Trigger | Needs in the other repo |
| --- | --- | --- |
| `deploy-icp-mainnet.yml` | manual | `DEPLOYER_PEM`; write access to commit ID table |
| `deploy-frontend-canister.yml` | push to main touching `frontend/**`, `deploy/frontend/**`; manual | `DEPLOYER_PEM`, vars `IGNITE_LIVE_SUPABASE_URL` / `IGNITE_LIVE_SUPABASE_ANON_KEY`; write access; `.asset-history/` cache dir |
| `topup-canister-cycles.yml` | manual | `DEPLOYER_PEM` |
| `grant-app-admin.yml` | manual | `DEPLOYER_PEM` |
| `set-clubs-pro.yml` | manual | `DEPLOYER_PEM` |
| `backfill-club-home-countries.yml` | manual | `DEPLOYER_PEM` |
| `move-account.yml` | manual | `DEPLOYER_PEM` |
| `erase-duplicate-profiles.yml` | manual | `DEPLOYER_PEM` |
| `delete-clubs-except.yml` | manual | `DEPLOYER_PEM` |
| `icp-push-deliver.yml` | **cron every 5 min** | `ICP_PUSH_WORKER_SEED`, `FCM_SERVICE_ACCOUNT_JSON` |
| `ci.yml` ("Hybrid source checks") | PR + push to `main` and `migration/**` | none — but its name will clash with an existing CI workflow; rename to `hybrid-checks.yml` and merge the job, or keep separate |

Secrets/vars to add in the other repo (Settings → Secrets and variables → Actions):
`DEPLOYER_PEM`, `ICP_PUSH_WORKER_SEED`, `FCM_SERVICE_ACCOUNT_JSON`, and the two
repository variables. Values are the same as here — copy them across, never
paste them into chat.

**Duplicate-run hazards (the two things most likely to break something):**
1. `icp-push-deliver.yml` runs on a timer. If both repos keep it enabled, two
   workers claim from the same `notification_queue` canister. Keep exactly one
   enabled (the other repo), and disable/delete it here first.
2. `deploy-frontend-canister.yml` fires on any push to main touching the
   frontend. With it in both repos, one push deploys the site twice and the two
   runs compete to commit `deploy/frontend/.icp/data/mappings/ic.ids.json`.
   Keep the trigger in one repo only.

## 5. The single biggest risk: the canister ID tables

`deploy/mainnet/.icp/data/mappings/ic.ids.json` and
`deploy/frontend/.icp/data/mappings/ic.ids.json` tell the deploy workflows which
canisters already exist. They are gitignored by the `.icp/` rule and re-allowed
by explicit exceptions in `.gitignore`. If those two files do not land in the
other repo byte-for-byte, the next deploy will **create brand-new canisters**
(~0.5T cycles each) and the deployed app will read empty canisters while the
real data sits in the old ones.

So: copy both files, confirm the `.gitignore` allow-rules came with them, and
check the canister IDs still read `mzzzv-taaaa…` (club_domain),
`mx3u5-iqaaa…` (messaging), `m6y7b-6yaaa…` (events_domain),
`mq2sj-fiaaa…` (identity_access), `jfcdq-yiaa…` (notification_queue),
`proe7-kqaaa…` (frontend assets) before running any deploy from the new repo.

## 6. Merge procedure

**Step 0 — clear the runway first.** Finish the pending items before merging so
the copy is a clean snapshot: the web-app update on main (several fixes waiting
on it), the move-account merge, and the Supabase edge-function secrets +
`verify-iap-receipt-icp` redeploy. Merging mid-flight just means porting the
same fixes twice.

**Step 1 — tag both repos.** In each repo, tag the current main commit
(`merge-baseline-2026-10-XX`). Rollback is then just "go back to the tag".

**Step 2 — export this code.** Download/export the project code from Lovable (or
clone this repo's git remote). The merge commit itself has to be made in the
other repo by you — this chat cannot push to GitHub.

**Step 3 — copy in one commit.** Place the §2 folders at the other repo's top
level with the names unchanged. Copy root files individually; for `.gitignore`,
`.env.example`, `README.md`, `AGENTS.md`, `netlify.toml`, `supabase/config.toml`,
`mops.toml`, `Cargo.toml`, `tsconfig.json` and any existing `package.json`,
merge by hand rather than overwriting. Keep this repo's `AGENTS.md` rules
(canister ID table, governor sentinel, `ensure-frontend-deps` install rule,
retired-URL redirects) — they are the non-obvious ones.

**Step 4 — bring the workflows** from §4, renaming `ci.yml` to avoid the name
clash, and adding the secrets/vars.

**Step 5 — retire the duplicate triggers here:** disable `icp-push-deliver.yml`
and the frontend-canister push trigger in this repo.

**Step 6 — verify from the new repo, in this order (cheap to expensive):**
1. CI checks pass (frontend `check:step1`, candid drift, topology, ICP guards).
2. `grant-app-admin.yml` dry run (a read-only canister call) — proves the
   deployer key and ID table work from the new location.
3. `topup-canister-cycles.yml` with a small amount on one canister — proves the
   deploy account still controls things.
4. `deploy-frontend-canister.yml` manual run — the site must come up at the
   **same** `proe7-kqaaa-aaaas-qg6gq-cai.icp0.io` URL, not a new one.
5. `deploy-icp-mainnet.yml` manual run — must reuse existing canisters, not
   create any.
6. End-to-end push test (chat message to an ICP-mode account) with only the new
   repo's timer enabled.

**Step 7 — keep this repo alive as a mirror for a while.** Don't delete it until
the other repo has completed one successful frontend deploy, one mainnet deploy,
and one push delivery. Lovable's project stays pointed at its own remote; if you
want the editor to keep tracking the merged code, that's a separate decision
(Lovable would need to be connected to the merged repo, and published git
history here must not be rewritten).

## 7. Decisions still open (answer these on merge day)

1. **The other repo's name/layout** — I don't have it. Its existing top-level
   folders decide whether anything collides (see the root-file list in §2) and
   whether a `frontend/`-shaped SPA fits next to its current app.
2. **Git history** — plain file copy in one commit (simple, recommended) vs
   `git subtree add` / `filter-repo` to preserve this project's commit history
   (heavier, and this project's history lives on Lovable's private remote).
3. **Where the Supabase migrations live** — the 5 SQL files here are already
   applied to `cdrxmelhysdqrccttsjg`; after merging, the other repo's migration
   folder must become the single source of truth and these files must not be
   re-run.
4. **Where native-app builds fit** — answered 2026-10-09: the Codemagic jobs
   reference nothing in `netlify/` or `netlify.toml`; they bundle `dist-live`
   built by `npm run build:live`, so the Netlify config is irrelevant to them.
   Two native gaps do remain — Firebase push is not installed, and two
   same-origin `/api/*` calls go nowhere inside a bundled app. See §8.
5. **What happens to this Lovable project afterwards** — editor-only sandbox,
   re-pointed at the merged repo, or retired.

## 8. Native-app builds (Codemagic)

`codemagic.yaml` (repo root) holds four jobs — `android-debug`, `android-release`,
`ios-debug`, `ios-release`. Each one does: install frontend deps → `npm run
build:live` in `frontend/` → `npx cap add` / `npx cap sync` to scaffold the
native project in CI → gradle or xcodebuild → collect the artifact. `android/`
and `ios/` are never committed, so nothing extra has to land in the other repo
beyond the YAML itself and `frontend/capacitor.config.ts` (appId
`com.igniteclubhq.app`, webDir `dist-live`).

**Free to reuse (account-level, not repo-level):** the App Store Connect
integration named `ignite`, the environment-variable groups `android_release`
and `ios_release`, and the chosen instance types all live in Codemagic team
settings. Any workflow in any repo on that team can use them — there is nothing
to transfer.

**Not reusable from the other repo's own jobs:** their build steps compile their
app from their folders. The steps above are tied to this frontend's build output
and Capacitor config, so they must travel as-is.

**Two ways to merge the YAML**

1. Append the four job keys into the other repo's `codemagic.yaml`. Keys must be
   unique — if their file already has an `android-release`, rename these to e.g.
   `ignite-android-release`.
2. *Recommended:* keep this as a separate config file (`codemagic.ignite.yaml`)
   at the merged repo root and register a second Codemagic app on the same repo
   and branch, pointed at that file. Their jobs stay untouched, this app's builds
   stay isolated, and both still share the same signing groups and secrets.

**Edits needed either way**

- **Install step (real trap).** All four jobs start with
  `node scripts/ensure-frontend-deps.mjs` run from the repo root, and §2 says not
  to copy that file. On merge day pick one: copy that single file across (it only
  resolves `frontend/`), or replace the step with the other repo's normal install
  command for `frontend/`. Leaving it pointing at a missing file fails the build
  on its very first line.
- **Nested folders.** If `frontend/` lands anywhere other than the top level,
  every `working_directory` (`frontend`, `frontend/android`, `frontend/ios/App`)
  and every artifact path (`frontend/android/app/build/outputs/…`,
  `frontend/ios/App/build/ios/ipa/*.ipa`) has to be rewritten — roughly 10 lines
  across the four jobs. A flat copy needs zero edits.
- **`APP_STORE_APP_ID: 0000000000`** is a placeholder; fill in the numeric Apple
  ID from App Store Connect once the app record exists.
- **Store identity.** `com.igniteclubhq.app` is permanent at first upload, and
  one appId equals one store listing. If the other repo already ships an app,
  these builds become a second listing — fine if intended, a collision if not.

**Gaps that follow the code, not the repo**

- **Internet Identity sign-in does not work in a phone app.** It opens a popup a
  phone web view cannot open, and inside a phone app the sign-in identity is
  derived from `localhost` rather than the canister address, so the same person
  becomes a new, empty account. Email sign-in is unaffected. Decide before a
  native release: ship email-only, load the deployed site inside the shell, or
  wire sign-in through the in-app browser and register the app's address.
- **Push (now wired natively) shares one Firebase project with the other repo's
  app.** Direct/device-token sends cannot cross apps — every token is per app
  instance. The one leak path is **topics**: if both apps ever subscribe to the
  same topic name (e.g. `news`), both receive those broadcasts. Rule: prefix
  every topic with the app ID — Ignite subscribes to
  `ignite.<topic>` (e.g. `ignite.club-news`), the other app keeps its own
  prefix. Server-side broadcast code must only ever publish to the
  `ignite.` namespace. Apply this before any topic-based broadcast ships.
- **Same-origin `/api/*` calls.** `LinkPreview.tsx` fetches
  `/api/fetch-link-preview` and `websiteBackendSync.ts` fetches
  `/api/register-club-backend`. Inside a bundled native app a relative URL
  resolves against the app's own local origin, not the deployed site, so both
  silently do nothing on a phone. Point them at the absolute deployed URL (or
  leave those features out of the native build) before shipping them.

**Native checks to add to the step 6 ladder**

Run `android-debug` first (it needs no secrets at all) and install the APK, then
`ios-debug` (simulator, unsigned). Both prove the toolchain before any signing or
store secrets are involved.

## 9. Rough effort

Half a day for the copy plus secret transfer if folder names are kept flat;
a day or so if paths get nested and every workflow's path references and trigger
filters have to be rewritten and re-tested. The verification ladder in step 6 is
the part that must not be rushed — it is what proves the new repo is pointing at
the real canisters rather than fresh empty ones.
