<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Preview runs frontend/ via lovable.toml + scripts/*-preview.mjs, mapping SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY onto IGNITE_LIVE_SUPABASE_URL/ANON_KEY; the root package.json is a dependency-free shim (publishing runs a root `bun install` before building) — never add dependencies to it.
- All frontend installs go through scripts/ensure-frontend-deps.mjs (lockfile-hash stamp + tmp lock); never run bare `npm ci` in install/dev/build — it wipes node_modules under the running preview and concurrent runs corrupt it.
- build-preview.mjs must emit dist/index.html (copy of live-index.html) — static hosting serves index.html for / and SPA fallback; without it every URL is "Not found".
- Keep retired URLs alive as redirects in App.tsx (ParamRedirect) instead of letting them hit the 404 page.
- Frontend/live-architecture rules: frontend/AGENTS.md. Canister/Motoko rules: backend/AGENTS.md.
- Poll attachment recognition shares `chatPollToken` across chat content, card-only detection and inbox previews; this preserves opaque backend IDs consistently.
- Event attachment recognition shares `chatEventToken` across chat content, card-only detection and inbox previews; this prevents ICP event IDs being exposed as raw text.
- ICP image unlock failures retry after a cooldown on mounted views and foreground recovery; cold sign-in restoration must not permanently latch saved logos onto a fallback.
- Club setup progress reads the active membership backend and determines saved branding from stored palettes/logo, independently of entitlement; sponsor/theme saves invalidate its query. Why: free clubs must not lose acknowledgement of saved setup, and ICP has no Supabase rows.
- ICP login presentation lives in IcpSignInScreen; AuthPage retains provider invocation and redirect resolution so visual changes cannot alter identity or invite/session semantics.
- Sign-in footers and profile policy links share legalLinks destinations; open separately to preserve drafts and invite URLs, and reuse destinations for internal legal pages.
- Mainnet canister deploy: scripts/deploy-mainnet.sh + deploy/mainnet/icp.yaml + per-canister backend/<c>/canister.yaml (path-based so mops.toml is found at build); the governor principal is baked into those files as init_args/env vars, and .github/workflows/deploy-icp-mainnet.yml seds that sentinel to the deployer identity's actual principal at deploy time (the gwyap-pqop5-…-cae string in the repo is only a placeholder — Internet Identity keys can't be exported, so the workflow generates the key on first run and uploads it as the deployer-key artifact for DEPLOYER_PEM). The script runs the post-install wiring calls and prints the ID table. IDs land in deploy/mainnet/.icp/data/mappings/ic.ids.json — commit it.

<!-- ic-skills:managed:start -->
<!-- state: configured (on-demand) -->
Fetch the skills index once per session and keep each skill's name, description,
and SKILL.md URL:
https://skills.internetcomputer.org/.well-known/skills/index.json
Before writing ICP code for a task, fetch the matching skill's SKILL.md
(https://skills.internetcomputer.org/.well-known/skills/{name}/SKILL.md) and follow
it. Skills are authoritative — prefer them over general knowledge.
<!-- ic-skills:managed:end -->
- Web hosting: the static live build is served from an ICP certified-assets canister (deploy/frontend/icp.yaml, its own project so it never enters the backend ID table), built by frontend/scripts/prepare-canister-dist.mjs (_redirects SPA fallback + _headers CSP/cache) and deployed by .github/workflows/deploy-frontend-canister.yml. Why: removes runtime dependence on Netlify; Codemagic native builds stay bundled and unaffected.
