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

- Preview runs frontend/ through lovable.toml and scripts/*-preview.mjs; map SUPABASE_URL/PUBLISHABLE_KEY to IGNITE_LIVE_SUPABASE_URL/ANON_KEY. Keep root dependency-free.
- Health merges all group inventories by ID. Why: prevent unmonitored groups.
- Install only via scripts/ensure-frontend-deps.mjs; npm ci wipes preview dependencies. build-preview.mjs copies live-index.html for SPA hosting.
- Read nested AGENTS.md in scripts/, frontend/, backend/, backend/identity_access/ and backend/media_blob_store/ before scoped changes.
- notification_queue authorizes schedule scopes/update_reminder admin/club audiences in enqueue/fan_out; polls use caller signals. Normalize roster principals; gate admin reads and report queued, not delivered, counts. Why: browsers cannot authorize writes.
- Schedule: omission keeps; empty image/zero end-date clears; monthly dates clamp in UTC. Why: Candid compatibility.
- Self/admin erasure retains inventory; router locks persist through commit. Gallery copies decrypt under club keys.
- ICP pitch alerts use livePitchRecipients for club scope/staff/match duties; omit child names. Why: avoid wrong audiences and plaintext PII.
- Competition welcome settings live on competition_domain behind refreshed manager access; club-role mirrors fail closed. Why: no Supabase fallback or stale access.
- Native II: use id.ai/authorize and its reply origin; register callbacks before Browser.open, nonce-scope cancellation. Why: legacy-host redirects drop replies.
- Android bars: apply StatusBarBackdrop after SystemBars; keep its remaining CSS inset, no forced floor. Both Codemagic workflows run scripts/configure-android-status-bar.py; preserve keyboard handling. Why: native padding already reserves space.
- ICP images wait for restored auth, share account-scoped unlocks and retry after cooldown/foreground recovery. Why: avoid false startup failures and duplicate unlocks.
- Documents use authorized/decrypted URLs, preserve extension/MIME, cache WebView blobs natively. Why: raw ICP URLs are ciphertext.
- ICP rewards verify roles via governor-configured club_domain; catalog/settings reads refresh caller role mirrors first. Why: club creation needs no manual points-service grant.
- ICP messaging uses authorized DM/window/presence APIs, scoped previews and encrypted files; labels never block attachments. Why: prevent Supabase leakage and stalled threads.
- Club setup uses active membership backend; palettes/logo count separately from entitlement; sponsor/theme saves invalidate it. Why: ICP free setup has no Supabase rows.

<!-- ic-skills:managed:start -->
<!-- state: configured (on-demand) -->
Fetch the skills index once per session and keep each skill's name, description,
and SKILL.md URL:
https://skills.internetcomputer.org/.well-known/skills/index.json
Before writing ICP code for a task, fetch the matching skill's SKILL.md
(https://skills.internetcomputer.org/.well-known/skills/{name}/SKILL.md) and follow
it. Skills are authoritative — prefer them over general knowledge.
<!-- ic-skills:managed:end -->
- ICP frontend deploy: start mapped canisters; never reinstall on sync failure. Pin CLI; grant via `canister settings update --add-controller --force`, failing on error. Why: preserve assets/access.
- II paths enforce club scope; uploads verify membership to prevent revocation bypass.
- Scaling: separate cutover; reject partial batches; distinguish client/callback loss. Bind deployment/revision/HTTPS/network/subnets/account; gate extra subnets. Recovery: exact inventory, stop stores before authority, full restore, approved authority-first resume. Persist locked intent/acks; replay interruptions, retain locks on disk failure. Raw hashes cannot prove decoded ledgers. Why: prevent routing/data mismatch.
- messaging owns photo timers; notification owns audiences. Vault progress uses pending mutations; denied rosters throw; season placements use membership routing. Why: preserve errors/export authorization.

- OQL: bounded read-only, allowlisted fields; authorize before filtering/paging/counts; no self-calls.
- Media moves require operator-authenticated registries, journaled fences and bounded consensus pages. Policy 2026-10-19: encrypted-media clubs stay put; no re-encryption or reconciliation bypass. Place new clubs into groups. Why: photo keys belong to the creating group.
- Admission uses the general switch: governor-verified configuration revision, canonical group/placement/policy inventory, hashes and removal wiring must match the live registry; ordinary placements advance only the separate assignment/deletion/session revision. Legacy snapshots need regeneration. Snapshot revisions are decimal text before hashing/emission. Why: new clubs must not invalidate approval, while configuration drift still fails closed.
- Router-only deployment upgrades the pinned existing mainnet router with no creation, service rewiring or automatic fuel conversion. Why: an approval-counter repair must not change club services or media keys.

- Keys: SDK derivation, signed controllers, receipts; engines offline. Fixtures never authorize release.
- G2 journal readback pins the acknowledged commit; unknown writes stop. Why: branch reads can lag.

- Router index rebuilds from stable rows; writes refresh, picks recheck gates. Never deploy scale-probe.
- History uses nullable DTOs/exact links and verified humans; PlayHQ keys are tenant-scoped, claims grant no ownership. Deploy history scope upgrades only competition/events, never creates or rewires others. Why: preserve data and isolate releases.
- /admin/group-infrastructure owns utilization. Why: duplicates drift.
- News uses the listed club, audience checks, cold discovery and retry. Why: rediscovery hides posts.
- Creation choices filter by theme; absent clubs expose none. Why: retain context.
- Rewards/Profile share scoped caches; pending Pro stays unknown, history renders independently. Why: avoid waits/false locks.
- Opening reciprocal checks require identity-side admission-release and exact eligibility-reader evidence for every admission-enabled destination; deletion wiring alone is insufficient. Why: configured destination flags can otherwise pass readiness while all membership reads are denied.
- Group 2 account admission uses a separate stable eligibility-only reader grant derived from the pinned router; its protected identity-only upgrade journals intent/readback and refreshes the verified snapshot without opening placements or releasing lifecycle gates. Why: repair account access without exposing broader rehearsal-only operations.

- Subscription prices/quotes use subscriptionPlans and authoritative team writes serialize capacity checks; new payment products remain disabled until provider catalog and verified entity-scoped fulfillment agree. Why: quotes, URL success and global ICP Pro cannot authorize paid club capacity.
- ICP local media admission and retention read club_domain.get_media_allowance for the exact club/team; admission includes pending gallery/chat/Vault bytes, branding is exempt, and legacy retention checks bounded file pages and unchanged timestamps after awaits. Why: team Pro must not grant club-wide storage or lose replaced/paid media to club-only cleanup.
- Supabase upload preflight receives the exact team scope at all gallery/chat/Vault call sites and uses subscriptionPlans nonstacking allowances; it is UX-only until a trusted actual-byte endpoint and raw Storage write restriction ship together. Why: browser checks cannot enforce concurrent or direct uploads.
- Supabase measured media uses the existing external HTTP service boundary, bounded raw bodies and service-only durable reservations; activate only with restrictive raw Storage write policies and authenticated acceptance in the same release. Retain unknown upload reservations without replay or automatic expiry. Why: a failed deployment must not break uploads or release space after an unknown Storage commit.
- Existing Supabase HTTP functions resolve npm packages through function-local Deno configuration with nodeModulesDir set to none; never depend on the root or frontend node_modules. Why: the preview's split dependency tree is not a deployable Deno package graph.
- ICP media allowance excludes the SDK's fixed versioned IBE framing, charges unframed legacy bytes in full and rechecks actual assembled size plus other pending uploads before commit; physical capacity still counts ciphertext. Why: customers pay for file bytes, while a spoofed declaration must not bypass quota.
- New ICP club fulfillment uses distinct usd_v2_* plan identifiers through platform-authorized subscription writes; legacy identifiers retain their existing allowances. Why: new caps must not silently change promo grants.
- Subscription deployment uses a separate exact four-target Group 1/2 club/media workflow, immutable journal readback and verified snapshot refresh; never reuse the closed thirteen-service runner or broad all-service deploy. Why: preserve unrelated services, routing, photo authorities and unknown upgrade evidence.
- New groups are added only through the one-click Add new group workflow (scripts/add-group.mjs + add-group-plan.mjs); its steps must stay resume-safe and auto-retry only idempotent, nothing-happened failures. Why: multi-workflow manual openings repeatedly failed part-way.
- Group opening approval is recorded on the router (record_routing_approval, revision-checked, governor-only) and the app accepts it only when the live configuration revision, group set and canonical configuration hash match; the build-time snapshot only pins router and host. Why: opening must not require an app release, yet drift must still fail closed.
- Discovery shares account/full-target reads; incomplete clubs stay display-only. Sessions bind identity objects and retire on typed drift without replay; scope markers copy contexts and writes use operation keys. Why: prevent lost clubs, stale sessions, nested discovery and merged posts; destination authorization remains required.
- Schedule member events publish per owning club before labels/duties, retaining the events query prefix for save invalidation; foreign-host fixtures remain independent. Media profiles gate only their own source; incomplete aggregates never persist. Why: unrelated sources must not block authorized content or falsely complete offline inventories.
- Standard club chats use ensure_default_club_chat with an explicit stable identity and authorized legacy-ID adoption; ordinary group creation stays create-only, and deleted bindings require explicit restore. Why: concurrent devices must not duplicate standard chats, overwrite roles, erase histories or revive deleted rooms.
- Gallery paging uses an ordered per-club index, revision-pinned continuations and bounded governor backfill; primary Media requests one page per source and never persists unexhausted/failed feeds. Legacy complete-list callers stay explicit. Why: client slicing/full cursor drains do not bound startup work, and partial snapshots must not hide photos.
- Permanent discovery reserves identity memories 18–24; revision-bound subject/source indexes stage and reclaim in bounded steps, pin all sources even when skipping empty ones; no public cutover until location/concurrency/recovery pass. Stage A remains. Why: incomplete or stale indexes cannot hide clubs or grant access.
- Membership source retention captures one immutable array generation without copying on writes; exact sequential traversal and historical completion leave newer changes pending and unreadable. Why: finite reconstruction must finish under ongoing writes without certifying stale memberships.
- Lookup release upgrades only pinned identity plus every registered club source/original G1, with exact subnet/journal coverage; identity-owned enable and every private page recheck full revisions, registry/photo stores, lifecycle and caller through awaits. Complete Stage A fallback stays. Why: historical reports or partial source coverage cannot authorize discovery.

- Media paging releases only via upgrade-media-paging.yml on the exact G1/G2 media_metadata canisters, finishing backfill before snapshot refresh. Why: never hide photos or touch photo stores.
