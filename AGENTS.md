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
- Retired URLs redirect via App.tsx ParamRedirect, never 404.
- Read frontend/AGENTS.md, backend/AGENTS.md and scripts/AGENTS.md before changes in those directories.
- notification_queue authorizes schedule scopes/update_reminder admin/club audiences in enqueue/fan_out; polls use caller signals. Normalize roster principals; gate admin reads and report queued, not delivered, counts. Why: browsers cannot authorize writes.
- Schedule updates: omitted options keep; empty image/zero end-date clear. Monthly recurrence clamps in UTC. Why: retain Candid compatibility.
- Account erasure revokes club roles first; gallery publication copies decrypted photos under club encryption. Why: prevent residual access and broken shared photos.
- ICP pitch alerts use livePitchRecipients for club scope/staff/match duties; omit child names. Why: avoid wrong audiences and plaintext PII.
- Competition welcome settings live on competition_domain behind refreshed manager access; club-role mirrors fail closed. Why: no Supabase fallback or stale access.
- Native II: use id.ai/authorize and its reply origin; register callbacks before Browser.open, nonce-scope cancellation. Why: legacy-host redirects drop replies.
- Android bars: apply StatusBarBackdrop after SystemBars; keep its remaining CSS inset, no forced floor. Both Codemagic workflows run scripts/configure-android-status-bar.py; preserve keyboard handling. Why: native padding already reserves space.
- Share helpers prevent empty vault bubbles in both renderers. Schedule dates validate Date range, not just finiteness. Why: invalid dates crash calendars.
- Pending sends are QueryClient-scoped; settle temp IDs from server acknowledgements, not photo presence. Why: avoid duplicates after navigation.
- ICP images wait for restored auth, share account-scoped unlocks and retry after cooldown/foreground recovery. Why: avoid false startup failures and duplicate unlocks.
- Documents resolve authorized/decrypted URLs, preserve extension/MIME and write WebView blobs to native cache, not HTTP downloaders. Why: raw ICP URLs contain ciphertext.
- ICP rewards verify roles via governor-configured club_domain; catalog/settings reads refresh caller role mirrors first. Why: club creation needs no manual points-service grant.
- ICP profile batches use get_profile for missing callers. Why: linked accounts retain original IDs.
- ICP media uses uploader avatars; inbox previews use scope IDs; DM settings read/write ICP. Chat files encrypt/register before token creation. Why: silent no-ops lost device attachments.
- Club setup reads active membership backend; saved palettes/logo count independently of entitlement; sponsor/theme saves invalidate it. Why: acknowledge free-club setup without Supabase rows in ICP.
- IcpSignInScreen owns login presentation; AuthPage retains provider invocation and redirects to preserve identity, invite and session semantics.
- Sign-in footers and profile policy links share legalLinks destinations; open separately to preserve drafts and invite URLs, and reuse destinations for internal legal pages.

<!-- ic-skills:managed:start -->
<!-- state: configured (on-demand) -->
Fetch the skills index once per session and keep each skill's name, description,
and SKILL.md URL:
https://skills.internetcomputer.org/.well-known/skills/index.json
Before writing ICP code for a task, fetch the matching skill's SKILL.md
(https://skills.internetcomputer.org/.well-known/skills/{name}/SKILL.md) and follow
it. Skills are authoritative — prefer them over general knowledge.
<!-- ic-skills:managed:end -->
- ICP frontend deploy: start mapped canisters before auto deploy; never reinstall on sync failure. Pin CLI; grant via `canister settings update --add-controller --force`, failing on error. Why: preserve assets and balance access.
- Memory warnings are deterministic: static clients cannot hold secrets.
- Scaling: separate cutover; reject partial batches; distinguish client/callback loss. Bind deployment/revision/HTTPS/network/subnets/account; gate extra subnets. Recovery needs exact inventory, stores stopped before authority, full restore and verified approved authority-first resume. Locked receipts persist intent/acks; interruption requires replay, disk failure retains locks. Raw snapshot hashes are not decoded ledger evidence. Why: prevent routing and ledger/file mismatch.
- messaging owns photo timers; notification owns audiences. Vault progress uses pending mutations; denied rosters throw. Season placements use membership routing. Why: avoid silent failures; keep export authorization.

- ICP MCP OQL: bounded read-only, allowlisted fields; authorize before filters/counts/paging; no self-calls. Why: avoid leaks.
