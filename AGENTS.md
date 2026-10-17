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

- Preview runs frontend/ via lovable.toml and scripts/*-preview.mjs; maps SUPABASE_URL/PUBLISHABLE_KEY to IGNITE_LIVE_SUPABASE_URL/ANON_KEY. Root stays dependency-free.
- Install frontend via scripts/ensure-frontend-deps.mjs only; bare npm ci wipes the running preview's dependencies.
- build-preview.mjs must copy live-index.html to dist/index.html for static hosting and SPA fallback.
- Keep retired URLs alive as redirects in App.tsx (ParamRedirect) instead of letting them hit the 404 page.
- Frontend/live-architecture rules: frontend/AGENTS.md. Canister/Motoko rules: backend/AGENTS.md.
- notification_queue verifies schedule scopes and update_reminder admin/club audiences in enqueue/fan_out; polls use caller signals. Normalize roster principal IDs; admin pages gate reads and report queued counts. Why: browsers cannot authorize writes or prove delivery.
- Schedule updates: omitted options keep; empty image/zero end-date clear. Monthly recurrence clamps in UTC. Why: retain Candid compatibility.
- Account erasure revokes club roles first; gallery publication copies decrypted photos under club encryption. Why: prevent residual access and broken shared photos.
- ICP pitch alerts use livePitchRecipients for club scope/staff/match duties; omit child names. Why: avoid wrong audiences and plaintext PII.
- Competition welcome settings live on competition_domain behind refreshed manager access; club-role mirrors fail closed. Why: no Supabase fallback or stale access.
- Native II: use id.ai/authorize and its reply origin; register callbacks before Browser.open, nonce-scope cancellation. Why: legacy-host redirects drop replies.
- Android bars: apply StatusBarBackdrop after SystemBars; keep its remaining CSS inset, no forced floor. Both Codemagic workflows run scripts/configure-android-status-bar.py; preserve keyboard handling. Why: native padding already reserves space.
- Share helpers prevent empty vault bubbles in both renderers. Schedule dates validate Date range, not just finiteness. Why: invalid dates crash calendars.
- Pending-send recovery is scoped to each QueryClient and reconciles previews already in fetched snapshots as well as missing previews; this prevents duplicate photo bubbles after returning to chat.
- ICP images wait for authenticated session restoration and share account-scoped in-flight unlocks; genuine failures retry after cooldown and foreground recovery. Why: cold startup must not cache missing identity as a failure or unlock the same logo repeatedly.
- Stored document opens and downloads must resolve authorized/decrypted URLs before hand-off, preserve the original extension/MIME, and write WebView blob bytes to native cache instead of using native HTTP downloaders. Why: raw ICP URLs contain ciphertext, not readable documents.
- ICP reward writes verify caller roles against governor-configured club_domain; catalog/settings reads refresh the caller's role mirror first. Why: creating a club must not require a separate manual points-service role grant.
- ICP profile batches use get_profile for missing callers. Why: linked accounts retain original IDs.
- ICP media uses uploader avatars; inbox previews use scope IDs; DM settings read/write ICP. Chat files encrypt/register before token creation. Why: silent no-ops lost device attachments.
- Club setup progress reads the active membership backend and determines saved branding from stored palettes/logo, independently of entitlement; sponsor/theme saves invalidate its query. Why: free clubs must not lose acknowledgement of saved setup, and ICP has no Supabase rows.
- ICP login presentation lives in IcpSignInScreen; AuthPage retains provider invocation and redirect resolution so visual changes cannot alter identity or invite/session semantics.
- Sign-in footers and profile policy links share legalLinks destinations; open separately to preserve drafts and invite URLs, and reuse destinations for internal legal pages.
- Mainnet deploy rules live in backend/AGENTS.md.

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
- Memory monitoring uses readings and deterministic warnings, not AI execution. Why: the static app cannot hold AI secrets.
