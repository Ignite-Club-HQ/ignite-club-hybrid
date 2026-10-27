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

- Preview: frontend/ via lovable.toml and scripts/*-preview.mjs; map SUPABASE_URL/PUBLISHABLE_KEY to IGNITE_LIVE_SUPABASE_URL/ANON_KEY; root stays dependency-free.
- Health merges groups; Vault warms; team rows precede names; broken carousels resume selectively. Labels grant no access.
- Install via scripts/ensure-frontend-deps.mjs only: npm ci wipes preview dependencies. build-preview.mjs copies live-index.html for SPA hosting.
- Read nested AGENTS.md. Frontend caches bounded; poll/schedule keyboardSafe prevents clipping.
- notification_queue authorizes schedule scopes/update_reminder admin/club audiences in enqueue/fan_out; polls use caller signals. Normalize roster principals; gate admin reads and report queued, not delivered, counts. Why: browsers cannot authorize writes.
- Schedule: omission keeps; empty image/zero end clears; UTC months clamp. Retry access before events to avoid cancellation.
- Self/admin erasure retains inventory; router locks persist through commit. Gallery copies decrypt under club keys.
- ICP pitch alerts use livePitchRecipients for club scope/staff/match duties; omit child names. Why: avoid wrong audiences and plaintext PII.
- Releases: all groups/shared, router last; preserve keys/unknown locks. Recovery: original plan, acknowledged modules, two live sweeps, no installs, separate repair-source CAS. Why: never replay upgrades. Read scripts/AGENTS.md.
- Native II: use id.ai/authorize and its reply origin; register callbacks before Browser.open, nonce-scope cancellation. Why: legacy-host redirects drop replies.
- Android bars: apply StatusBarBackdrop after SystemBars; keep its remaining CSS inset, no forced floor. Both Codemagic workflows run scripts/configure-android-status-bar.py; preserve keyboard handling. Why: native padding already reserves space.
- ICP images wait for restored auth, share account-scoped unlocks and retry after cooldown/foreground recovery. Why: avoid false startup failures and duplicate unlocks.
- Documents use decrypted URLs, preserve MIME/extensions and cache native blobs; ICP URLs are ciphertext.
- ICP rewards verify roles via governor-configured club_domain; catalog/settings reads refresh caller role mirrors first. Why: club creation needs no manual points-service grant.
- ICP messaging uses authorized DM/window/presence APIs, scoped previews and encrypted files; labels never block attachments. Gallery sends check absence, repair only missing chats, confirm presence and use single-attempt club writes. Why: prevent leakage, stalled threads and unknown-send replay.
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

- ICP invites use public-source previews and atomic owning-group family receipts, never Supabase; child fields stay encrypted in PII. Why: bearer location grants no access; retries cannot duplicate children.
- Media moves require operator-authenticated registries, journaled fences and bounded consensus pages. Policy 2026-10-19: encrypted-media clubs stay put; no re-encryption or reconciliation bypass. Place new clubs into groups. Why: photo keys belong to the creating group.
- Router-only deploy upgrades the pinned mainnet router: no creation, rewiring or automatic fuel conversion. Why: approval-counter repairs must preserve club services/media keys.

- Keys: SDK derivation, controllers, receipts; engines offline; fixtures never authorize release.
- Journal readback pins acknowledged commits; unknown writes stop.
- Migration member converters use exact-destination claims and verified child/media dependencies, preserve points ledgers/cooldowns and refuse unmapped references before import; missing overall writers still block live execution. Why: source UUIDs, dropped award receipts or foreign media cannot safely become on-chain ownership or fresh awards.

- Router index rebuilds from stable rows; writes refresh, picks recheck gates. Never deploy scale-probe.
- History uses nullable DTOs/exact links and verified humans; PlayHQ keys are tenant-scoped, claims grant no ownership. Deploy history scope upgrades only competition/events, never creates or rewires others. Why: preserve data and isolate releases.
- /admin/group-infrastructure owns utilization; duplicates drift.
- News uses the listed club, audience checks, cold discovery and retry. Why: rediscovery hides posts.
- Creation choices filter by theme; absent clubs expose none to retain context.
- Rewards/Profile bound each read; optional labels never block history; pending Pro stays unknown. Why: avoid false locks.
- Reciprocal opening requires identity admission-release and exact eligibility-reader evidence for every admission-enabled destination, not deletion wiring alone. Why: destination flags can pass readiness while membership reads are denied.
- Group 2 admission uses a stable eligibility-only grant from the pinned router; protected identity-only upgrades journal intent/readback and refresh the verified snapshot, never open placements/lifecycle gates. Why: repair access without exposing rehearsal operations.

- Subscription prices/quotes use subscriptionPlans and authoritative team writes serialize capacity checks; new payment products remain disabled until provider catalog and verified entity-scoped fulfillment agree. Why: quotes, URL success and global ICP Pro cannot authorize paid club capacity.
- ICP local media admission and retention read club_domain.get_media_allowance for the exact club/team; admission includes pending gallery/chat/Vault bytes, branding is exempt, and legacy retention checks bounded file pages and unchanged timestamps after awaits. Why: team Pro must not grant club-wide storage or lose replaced/paid media to club-only cleanup.
- Supabase upload preflight receives the exact team scope at all gallery/chat/Vault call sites and uses subscriptionPlans nonstacking allowances; it is UX-only until a trusted actual-byte endpoint and raw Storage write restriction ship together. Why: browser checks cannot enforce concurrent or direct uploads.
- Supabase measured media uses the existing external HTTP service boundary, bounded raw bodies and service-only durable reservations; activate only with restrictive raw Storage write policies and authenticated acceptance in the same release. Retain unknown upload reservations without replay or automatic expiry. Why: a failed deployment must not break uploads or release space after an unknown Storage commit.
- Existing Supabase HTTP functions resolve npm packages through function-local Deno configuration with nodeModulesDir set to none; never depend on the root or frontend node_modules. Why: the preview's split dependency tree is not a deployable Deno package graph.
- ICP media allowance excludes the SDK's fixed versioned IBE framing, charges unframed legacy bytes in full and rechecks actual assembled size plus other pending uploads before commit; physical capacity still counts ciphertext. Why: customers pay for file bytes, while a spoofed declaration must not bypass quota.
- New ICP club fulfillment uses distinct usd_v2_* plan identifiers through platform-authorized subscription writes; legacy identifiers retain their existing allowances. Why: new caps must not silently change promo grants.
- Subscription/invite upgrades use exact runners or protected all-group scopes with immutable journal readback, original keys and verified snapshot publication; never broad deploy or closed-group runners. Why: cover future groups without losing authorities or uncertain outcomes.
- Add groups only via Add new group (scripts/add-group.mjs + add-group-plan.mjs); steps must resume safely and retry only idempotent nothing-happened failures. Why: manual multi-workflow openings failed part-way.
- Router record_routing_approval is governor-only/revision-checked; app acceptance requires matching live configuration revision, group set and canonical hash. Build snapshot pins router/host only. Why: opening needs no app release; drift fails closed.
- Discovery shares account/full-target reads; incomplete clubs stay display-only. Sessions bind identity objects and retire on typed drift without replay; scope markers copy contexts and writes use operation keys. Why: prevent lost clubs, stale sessions, nested discovery and merged posts; destination authorization remains required.
- Schedule member events publish per owning club before labels/duties, retaining the events query prefix for save invalidation; foreign-host fixtures remain independent. Media profiles gate only their own source; incomplete aggregates never persist. Why: unrelated sources must not block authorized content or falsely complete offline inventories.
- Standard club chats use ensure_default_club_chat with an explicit stable identity and authorized legacy-ID adoption; ordinary group creation stays create-only, and deleted bindings require explicit restore. Why: concurrent devices must not duplicate standard chats, overwrite roles, erase histories or revive deleted rooms.
- Permanent discovery reserves identity memories 18–24; revision-bound subject/source indexes stage and reclaim in bounded steps, pin all sources even when skipping empty ones; no public cutover until location/concurrency/recovery pass. Stage A remains. Why: incomplete or stale indexes cannot hide clubs or grant access.
- Membership source retention captures one immutable array generation without copying on writes; exact sequential traversal and historical completion leave newer changes pending and unreadable. Why: finite reconstruction must finish under ongoing writes without certifying stale memberships.

- Media paging releases only via upgrade-media-paging.yml on the exact G1/G2 media_metadata canisters, finishing backfill before snapshot refresh. Why: never hide photos or touch photo stores.

- ICP events atomically commit dates, duties and reminders under caller receipts; consensus supplies audiences, unknown relays stay locked.
- Vault recovery reads owner-wide intents and exact decrypted hash markers before strict grants/store acknowledgement; unknown outcomes retain locks/cursors. Erasure scrubs shared ancestors without orphaning others. Cleanup needs age/allowance or erasure receipts; backups commit validated pages to writable sinks, retaining Blob fallback where unsupported. Why: prevent guessed recovery, data loss and partial exports.
- Private names use rehearsal-only original-PII audiences and synchronous session retirement; generic caches never decrypt references and generation-fence late results. Why: chat IDs and retired contexts cannot authorize disclosure. Read frontend/AGENTS.md and backend/identity_access/AGENTS.md.


