# App-admin ICP audit — 25 October 2026

## Conclusion

**The confirmed ICP Supabase dependencies below have been repaired locally; live completion is not yet verified.** The numbered findings preserve the original audit evidence, not the current repaired status.

## Repair status — 25 October 2026

- Live User Management now uses a narrow, paginated identity directory rather than disabled local connectors or governor exports. Directory and status actions require an active, globally authorized identity administrator. Search scans at most 1,000 accounts per response and returns a continuation cursor.
- ICP Push Analytics uses real notification queue counts, canister-authorized settings and explicit per-queue device cleanup. Complete registered-group reads precede writes; partial writes report partial completion rather than success. These counts are queue acknowledgements, not proof of phone receipt.
- Internet Identity canister overrides load/save through club_domain app configuration; email-mode Supabase behavior remains. Placement club choices and GIPHY reads skip Supabase in ICP mode and surface failed canister reads.
- ICP Active Games no longer opens Supabase realtime. Feedback and notification preference displays page their canister inventories. Administrator query keys introduced here include the signed-in user.
- User analytics club choices now read the registered canister groups, activity queries use the owning club or group aggregation, and profile lookup uses the existing routed cache.
- Local validation: eight focused test files passed with 55 tests in each backend mode; the final four-file UI/queue regression pass completed with 18 tests per mode. Rust directory authorization/search tests passed; notification_queue Motoko check passed; ICP guards and all 17 Candid contracts passed. Preview reports build OK.

### Remaining acceptance and limits

- No canister upgrade, app deployment, credential change or live admin mutation occurred. Release the shared identity_access changes and both groups' notification_queue changes through exact-target protected upgrade tooling, then the matching app. Do not use a broad all-service deployment as a substitute.
- Signed-in Internet Identity admin acceptance in both groups remains required. No usable Internet Identity session was available here; mocked page tests are not live acceptance.
- Existing administrator grants live in multiple canister role stores. The new directory/status endpoints validate identity_access grants independently; inconsistent grants fail closed and need operator verification. Do not authorize by the page's insights-only role check or grant global administrator roles through the directory UI.
- Platform engagement still uses individual club reports rather than a full platform rollup. Activity reads remain capped at 500 rows per canister/time window. These are reporting-parity limits, not evidence of Supabase use.
- Full multi-domain/media-byte disaster recovery and external website synchronization remain outside this repair batch. Resend connection remains intentionally deferred; payment and push-provider boundaries remain external by policy.
- Preference rows from different queues remain queue-specific; cross-group effective-preference reconciliation needs verification before treating their aggregate as unique-person totals.

## Confirmed remaining gaps

### 1. User Management selects a disabled local implementation

- `frontend/src/pages/ManageUsersPage.tsx:98–104` selects `IcpLabManageUsersPage` for real ICP authentication, not just lab sessions.
- Its directory calls `connectLocalIdentityAccessClient(...).exportState()` at lines 119–147.
- `frontend/vite.live.config.ts:56–59` aliases that local module to `frontend/src/live/disabledLabRuntime.ts`, whose connector throws at lines 34–36 and 49.
- This means the live ICP directory cannot load through that path. The catch handles only errors containing “not configured,” not the actual disabled-service error.
- Status defaults to Active from a local override map, rather than authoritative directory status (`ManageUsersPage.tsx:210`). User-management parity, including the existing full management tabs and account deletion UI, is not provided by this branch.
- Mutation helpers in `frontend/src/live/features/identityAccessAdmin.ts` do connect to live ICP, but that does not repair the directory. Furthermore, identity `export_state` and role grant/revoke endpoints are governor-only (`backend/identity_access/src/lib.rs:1935–1937, 2507–2516, 2551–2557`). App-admin-safe narrow directory and management APIs must be verified/designed; do not expose the governor export or weaken its permission check.

### 2. Push Analytics still uses Supabase

- `frontend/src/pages/PushAnalyticsPage.tsx:82–107` always mounts a component with a direct Supabase app-admin lookup.
- Push log and device subscription queries remain direct Supabase calls at lines 110–165.
- Some later controls have ICP callbacks, but these do not replace the initial permission and data reads. A real ICP app admin can be denied by the wrong authority and does not get an ICP-native analytics path.
- External phone push delivery may remain external; authorization, queue state and stored delivery receipts are separate concerns and must not rely on Supabase for ICP administration.

### 3. Canister configuration remains Supabase-owned

- Placement Settings reads canister overrides from Supabase `app_settings` at `frontend/src/pages/PlacementAdminSettingsPage.tsx:266–277` and saves them there at lines 640–660, without an ICP save branch.
- `frontend/src/live/loadIcpAdminOverrides.ts:17–25` also always reads the Supabase row. `frontend/src/App.tsx:377–384` loads this at startup.
- Placement club choices and GIPHY-key loading also attempt Supabase reads before their canister alternatives (`PlacementAdminSettingsPage.tsx:228, 300–320`). GIPHY-key **saving** is already dual-provider and has an ICP path (lines 334–361).
- **Correction to a broad configuration concern:** backend-routing settings themselves already have an ICP save path (lines 414–424), and restored Internet Identity routing reads bypass Supabase (`frontend/src/live/loadBackendRouting.ts:63–68`). Do not report all routing configuration as off-chain. Remaining problems are the override control/loader and extra mixed-provider reads; saving routing still consults Supabase session state.
- Club-website synchronization is explicitly unavailable for an Internet Identity routing save (lines 460–465). The website is external, but its integration is not complete for that admin flow.

### 4. Active Games opens a Supabase realtime subscription in ICP mode

- Data reads have ICP providers, but `frontend/src/pages/AdminActiveGamesPage.tsx:252–266` opens a Supabase `active_games` realtime channel whenever the user is an app admin, without checking the active backend.
- ICP already polls the canisters. This subscription is an unnecessary off-chain dependency and does not monitor on-chain game changes.

## Additional correctness/parity concerns

- **Incomplete preference counts:** `frontend/src/pages/NotificationPreferencesPage.tsx:82–103` fetches only the first 500 preference rows but displays the full reported total alongside an email-enabled count computed from that page. Counts/listing can be incomplete above 500 records. This is on-chain paging correctness, not a Supabase leak.
- **Incomplete feedback inventory:** `frontend/src/pages/ManageFeedbackPage.tsx:95–117` genuinely dispatches reads to ICP despite the `SupabaseManageFeedbackPage` component name. Status changes and deletion also dispatch to ICP (lines 130–157). However, the list stops at 200 records with no continuation and displays principal text rather than resolved user names. It is **not** a confirmed Supabase-only page.
- **Engagement parity:** live ICP platform engagement selects individual club analytics rather than a complete platform rollup (`frontend/src/pages/ClubEngagementAnalyticsPage.tsx:164–210`). Lab fixtures are not evidence of live analytics.
- **Backup scope:** the active ICP backup page supports Vault snapshot creation, restoration, deletion and local export (`frontend/src/pages/IcpManageBackupsPage.tsx:28–102`). Its domain exports explicitly omit media bytes/full club configuration (lines 157–175). This is not a verified full two-group disaster-recovery backup. The older export-only panel is not evidence that active Vault restore is absent.
- **Diagnostic access:** `frontend/src/pages/AdminChatVirtDebugPage.tsx` lacks its own app-admin gate. It changes local diagnostics, not canister authority or global data; do not describe it as an unauthorized canister administration endpoint.
- **Cross-group acceptance:** an ICP callback alone does not prove every group receives global rollout/settings changes or is represented in every inventory. Group scope and current destination authorization still need live verification for admin actions.

## Confirmed existing ICP paths

- App-admin UI permission lookup uses `insights_domain.is_app_admin`, with false on unresolved/error states (`frontend/src/hooks/useIsAppAdmin.ts:36–50, 71–75`). The hook is UI gating, not a substitute for destination authorization.
- Feedback listing/status/deletion use insights helpers; the canister checks app-admin authority (`backend/insights_domain/src/main.mo:609–643`).
- App Settings, Legal reacceptance and PlayHQ configuration have ICP paths.
- AI recap rollout configuration, DM attachment restrictions including actual principal search, and chat-photo reminder settings/manual trigger have ICP paths. Old gap sentinel names/comments are not sufficient evidence that current implementations are absent.
- Deleted chat restore/purge uses messaging helpers with conversation scope.
- Update reminders enqueue on notification canisters and report queued, not delivered, recipients.
- Online Users, ICP realtime reachability and group utilization read canisters; memory report history reads/writes insights through `frontend/src/lib/canisterMemoryReports.ts:44–83`.
- Club/team app-admin subscription overrides have canister write paths. No actual entitlement or role mutations were performed during this audit.
- Vault backups and local downloads are not Supabase storage use in the active ICP branch.

## Intentional boundaries

- Payment-provider configuration, promo/payment features and AdMob are exempt under the owner's policy.
- Temporary password reset is a Supabase-auth concept, not a missing Internet Identity password feature.
- Resend connection remains deferred; phone push providers and other external integrations remain delivery boundaries, not permission sources.
- Local downloads, rendering, caches and diagnostic buffers are device operations, not off-chain ownership of app records.
- Canister deployment, funding and group lifecycle remain protected operator workflows; no broad deployment was requested or run in this audit.

## Verification and limits

- Four parallel read-only reviews covered the admin menu, permissions, secondary admin pages, infrastructure and settings/user-management routes. Findings were checked against current code; incorrect conclusions based only on component names, stale tests or commented imports were excluded.
- Existing focused tests: **13 files passed in each backend mode**; Supabase **70 passed / 1 skipped**, ICP **65 passed / 6 skipped**. Scope: app-admin lookup, chat-photo reminders, recap rollout, legal control, realtime probes, export UI/helper, account deletion helper, subscription overrides, notification preferences, Vault backups and identity profile search.
- ICP isolation guard passed. Its current scope does **not** prove absence of arbitrary Supabase table reads or realtime subscriptions; confirmed gaps above still exist.
- No signed-in Internet Identity admin session was exercised, no live role/status/deletion/restore action was executed, and no deployed module/version parity is claimed.
- Available preview logs contained no fresh build/runtime failure. No app code was edited and no manual build was run.

## Focused follow-up, if approved

1. Replace the disabled live User Management directory with narrow authorized ICP APIs and wire the intended management controls to current authorities.
2. Give Push Analytics an ICP-only authorization/data path, using genuine queue/receipt metrics rather than invented zeros.
3. Move ICP canister overrides/loading fully to an on-chain configuration source and remove avoidable Supabase reads in ICP Placement Settings.
4. Disable Supabase realtime for ICP Active Games; correct bounded paging/counts and verify cross-group action coverage.
5. Use only affected-service protected upgrades after local verification, then signed-in admin acceptance in both groups. Do not expand into unrelated historical recovery or full backup redesign.