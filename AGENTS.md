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

- Preview runs frontend/ via lovable.toml + scripts/*-preview.mjs, mapping SUPABASE_URL/SUPABASE_PUBLISHABLE_KEY onto IGNITE_LIVE_SUPABASE_URL/ANON_KEY; no root package.json.
- Frontend/live-architecture rules: frontend/AGENTS.md. Canister/Motoko rules: backend/AGENTS.md.
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
