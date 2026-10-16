# Production Enhancements Implementation Plan

Planning baseline: hybrid `main` at `98c4342`, compared with `Ignite-Club-HQ/ignite-club_hq-prod` `main` on 2026-10-07. This plan covers the gaps in [the comparison review](PROD_ENHANCEMENTS_GAP_REVIEW_2026-10-07.md).

## Status (2026-10-14)

- **Implemented:** PlayHQ fixture parsing/import through Supabase and ICP; ICP fixture reads and schedule metadata; division and whole-competition ladder visibility; event team-on-duty assignment; scheduled ICP RSVP, points, and duty reminders; season-captain fallback; competition-wide event creation; competition officials; competition-scoped media upload/feed; and per-club invite-message defaults with a club settings editor.
- **Implemented in source with live audience checks:** mini-league- and competition-targeted news. ICP resolves current audiences through trusted canister links on every feed read; recipient snapshots are used only for push fan-out. Supabase has target validation, audience RLS, feed scope, and deduped notification functions for both target types. The deploy script now wires the club-to-competition audience trust link.
- **Implemented in source:** competition member-to-admin conversations and a per-competition admin inbox. Supabase creates private member-scoped chat groups through an authorization-checked RPC; ICP verifies the caller's competition role or accepted/registered team membership through a caller-restricted, bounded club-domain query. Competition detail and admin settings surfaces use the existing group-chat route.
- **Implemented in source:** competition Vault folders and file management in both backends. ICP uses migrated competition scope fields, live membership checks, per-file encryption, and competition-scoped PII grants revalidated by the competition canister. Supabase uses a private `competition-vault` bucket and competition-specific permissive grants constrained by restrictive RLS policies.
- **Implemented in source:** competition gallery uploads now use per-file encryption and a live competition-scoped PII grant, so current competition members can decrypt across clubs without inheriting the organizer club's shared media key. Ordinary club photo uploads retain their existing shared-key path.
- **Implemented in source:** Supabase now has a 15-minute `pg_cron` sweep for configurable RSVP reminders, four-day game-points reminders, and 24-hour individual/team duty reminders. Recipients are resolved server-side, respect event notification preferences, use dedupe keys, and sent markers update transactionally with notification insertion.
- **Implemented in Supabase source:** team/competition welcome-email settings with manager-only RLS, an authenticated `send-welcome-email` Edge Function, server-side recipient lookup from Auth, Resend idempotency, and calls after Supabase team join or competition-entry acceptance. Existing `send-email` invite templates remain unchanged.
- **Implemented in source:** ICP team welcome emails now use the chosen invitee-only policy. Team-admin settings live on `club_domain`; after a pending email invite is accepted, the frontend invokes `send-welcome-email-icp` with only the invite ID. The Edge Function re-reads an accepted, recent, opted-in job from `club_domain`, claims an idempotent delivery, and sends through Resend. It does not rely on a Supabase JWT or expose email addresses in the browser request.
- **Scope limitation:** ICP welcome emails cover accepted, email-addressed team invites only. Shareable-link joins and current principal-targeted competition invites have no recipient email, so they do not send a welcome email; competition-specific ICP settings and broader invite-role coverage remain open if product behavior later expands beyond invitees-only.
- **Additional production changes found after the October 7 comparison, now implemented in source:** audience-gated team-duty badges on Schedule/Next Up; read-only competition fixtures for competition and organizer league admins, deduplicated against the viewer's own team copy and with RSVP controls hidden for nonmembers; entrant-team player/parent join links for competition admins, enforced by Supabase RLS and trusted ICP canister checks; and referee/committee role-specific join links with QR/share/email acceptance on both backends.
- **Official invite email binding:** Supabase claims require the authenticated account's confirmed email to match the invitation. ICP invite records store only per-invite email/code hashes; acceptance requires the one-time code, expires after 48 hours, locks after five failed attempts, and binds the accepted principal to the invite. Internet Identity has no email claim, so the canister cannot independently prove that the accepting principal owns the address; forwarding both link and code transfers the invitation.
- **Not verified for production rollout:** apply and execute the new Supabase migrations (including `20261014000000_allow_competition_admin_team_invites.sql`, `20261014010000_allow_competition_fixture_read.sql`, `20261014020000_add_official_join_links.sql`, and `20261014030000_email_bound_official_invites.sql`), plus the reminder, welcome-email, competition-news/inbox, and Vault migrations. Deploy both welcome Edge Functions, configure `RESEND_API_KEY`, verified `WELCOME_EMAIL_FROM`, and `CLUB_DOMAIN_CANISTER_ID`, deploy the updated canister contracts, verify club↔mini-league/competition/messaging/vault/PII trust links and notification-queue wiring, register IDs, and run the role-based authorization matrix on staging. Keep production routing disabled until those gates pass. This container has no `supabase`, `psql`, `deno`, or `icp` executable, and only `deploy/mainnet` is configured; staging requires external credentials and an isolated ICP target.
- **Verification:** latest focused schedule/competition/news tests pass 15/15; official invite helper tests pass 3/3; `competition_domain` compiles after the email-invite changes; strict frontend typecheck and Candid drift pass. Earlier checks also passed `club_domain`, `events_domain`, ICP guards, and diff formatting. The latest full frontend run reports 528/535 files passing and 5,109/5,142 tests passing; the remaining 33 failures are in `PushNotificationManager`, `CompetitionLadderView`, `ClubDetailPage`, `HomePage`, `NotificationPreferencesPage`, and `VaultPage.top-section`. `EventsPage.icp-roster.test.tsx` also fails during collection. These match the previously known 33 failing test cases; no new test-case failures were added by the parity matrix. `vitest list` reports 3,884 named cases, which does not match the full runner's 5,142 executed count and remains an inventory discrepancy. Deno typechecking, delivery against Supabase/Resend, and SQL migration execution remain unverified.
- **Test parity added:** the frontend package now includes `test:e2e`, a WebKit Playwright project, and three chat journey specs (bottom pin after images, settled scroll stability, and virtualized fast-scroll row integrity). Playwright discovery reports 8 journeys including per-route bottom-pin cases. The full Vitest execution confirms 5,142 tests (5,109 passing), exceeding the 5,000 target. Playwright was run without staging configuration and skipped all 8 tests; browser execution remains unverified. To run the journeys, provide `E2E_BASE_URL`, `E2E_STORAGE_STATE`, and `E2E_TEAM_ID`; additional chat route IDs enable other bottom-pin cases. WebKit is downloaded, but this container lacks required host libraries, so the browser runtime also needs its dependencies installed.

## Architecture Rules

- Keep feature behavior behind `withFeatureBackend` and the existing feature areas (`events`, `competitions`, `messaging`, `media`, `news`, `vault`, `membership`, and `notifications`). Keep Supabase repositories and ICP adapters as separate providers for the same page-level contract.
- Add ICP behavior in `frontend/src/live/features/<domain>.ts` and the owning domain canister. Do not add direct canister imports to app-start modules, and do not route a feature to ICP until its canister contract is deployed and registered.
- Put parsing, validation, audience selection, and other backend-neutral rules in pure feature modules. Reuse those rules from both providers; do not duplicate product logic in Supabase RPCs and Motoko.
- Preserve fail-closed authorization. Supabase paths need RLS/RPC checks; ICP paths validate caller roles and cross-domain relationships in canisters. Never authorize using browser-supplied member/team lists alone.
- For deployed Motoko state, add new timestamped migrations; do not edit migrations that may already have run. Update `.did`, generated bindings, and pass Candid drift checks as part of each canister change.
- Use `notification_queue` for ICP notification fan-out. Use the existing encrypted `media_blob_store` upload/decrypt path for ICP media; never persist plaintext media or bypass matching PII/access-control grants.
- Keep the existing backend pin semantics: a club remains on one backend across features. Avoid dual writes or silent cross-backend fallback that could split a club's records.

## Phases

### 0. Lock Contracts and Parity Gates

1. Define shared TypeScript input/result contracts for each planned workflow and its permission/error outcomes.
2. Add pure tests for audience selection, duplicate suppression, fixture normalization, and retry/idempotency behavior before adding provider code.
3. Add an implementation matrix to the feature-routing checklist: Supabase adapter, ICP adapter, authorization, migration/contract, and tests. Keep any feature Supabase-routed until every required ICP item is complete.

**Exit gate:** the same contract tests pass for both providers; unavailable or unconfigured ICP canisters continue using the existing Supabase route.

### 1. Fixture Import and Competition Controls

1. Extend the pure competition-fixture import workflow with a PlayHQ cricket adapter, multi-date/multi-day normalization, TBD opponents, finals/round/grade labels, stable duplicate keys, and actionable skipped-row reasons. Keep import preview and confirmation in the existing competition UI.
2. Supabase: persist imports through an authorized, batch-safe RPC or repository transaction; return inserted, updated, duplicate, and rejected counts. Hide/disable import after publication where the competition source/status requires it.
3. ICP: add an authorized batch fixture-import method to `competition_domain`, with bounded payloads and idempotency keys so retries cannot create duplicate matches. Return the same result shape as Supabase.
4. Add a competition-level ladder visibility setting in addition to existing per-division settings. Supabase uses a protected column/RPC; ICP extends `competition_domain` state, query, mutation, migration, and Candid contract. Preserve division overrides and define precedence explicitly.

**Exit gate:** fixture parser tests cover production export variants; both adapters produce equivalent preview/save results; public ladder reads obey the competition-level and division-level visibility rules.

### 2. Event Duties and Reminder Coverage

1. Add optional `dutyTeamId` to the shared event contract and event create/edit/detail surfaces. Keep it independent of the event's host team and list only active teams in the selected club.
2. Supabase: add the event field and RLS-safe update path. ICP: add the optional field to `events_domain` `Event`, create/update methods, reads, export/migration state, Candid, generated bindings, and `frontend/src/live/features/events.ts`.
3. Extend the existing 15-minute ICP auto-reminder sweep instead of creating a parallel scheduler. Keep the current configurable RSVP reminder; add separately tracked/idempotent early RSVP/points and duty reminder states, including 24-hour individual-duty reminders and whole-team reminders. Mirror the behavior in the production Supabase Edge Function/cron path.
4. Implement a shared recipient policy: resolve active team members and eligible parents/guardians, deduplicate recipients, exclude canceled/deleted/past events, respect notification preferences, and log/mark each reminder only after successful enqueue. On ICP use `notification_queue`; on Supabase use the existing notification/email delivery path.
5. Add season-captain fallback to match captain presentation. Keep match-specific captain assignment in the event domain; expose/read the season captain through the membership/club domain. Do not enable the fallback for ICP until that read contract exists.

**Exit gate:** identical recipient and schedule tests cover both providers; timer retries are idempotent; missing notification-queue wiring fails closed without marking reminders sent.

### 3. Competition Event and Officials Workflows

1. Add “create event for entered teams” using a shared event input contract and a validated snapshot of accepted competition entries.
2. Supabase: implement the fan-out in one transactional, authorization-checked RPC. ICP: use a competition-authorized operation and events-domain batch/fan-out contract; browser-supplied team IDs must not define the audience. Since inter-canister calls are not one atomic transaction, persist operation/idempotency status and make partial completion safely retryable.
3. Add competition officials management and duty eligibility. Store competition-specific roles in `competition_domain`; verify role grants server-side and pass an authorized assignment reference to `events_domain`. Keep club committee roles distinct from competition officials.
4. Implement season-captain lookup alongside this role work, keeping team-season captain state in the membership/club domain and per-match overrides in events.

**Exit gate:** unauthorized competition admins cannot create/fan out events or grant official roles; fan-out retries do not duplicate team events or invitations; events are visible through the normal event schedule in both modes.

### 4. Competition Messaging, Media, and Vault

1. Add member-to-competition-admin contact and an admin inbox using `messaging_domain` for ICP and the existing messaging schema/RLS for Supabase. Scope conversation discovery to the competition and authorized admins; do not expose private message contents or admin contact details to unrelated members.
2. Add competition gallery UI using the existing `media_metadata` `competition_id` scope. Supabase uses a competition-authorized photos query/upload path. ICP writes encrypted bytes through `mediaUpload`/`media_blob_store`, then registers metadata and matching access grants; reads must use the existing decrypt path and competition membership authorization.
3. Add competition vault folders through `vault_domain` and the existing vault feature adapter. Use stable competition ownership metadata and enforce access through the verified competition role/membership path. Do not simulate folders with public storage paths.

**Exit gate:** both backends enforce identical view/upload/manage permissions; ICP media is unreadable without a valid vetKey grant; cross-competition media and vault access tests fail closed.

### 5. News Targeting and Invitation Defaults

1. Extend the news audience contract from club/team to include league or competition targets. Preserve team targeting already present in hybrid. Supabase adds target fields and RLS/notification fan-out; ICP extends the existing `club_domain` news/announcement path and uses verified competition membership plus `notification_queue` fan-out. Store one canonical news record rather than a duplicate per target.
2. Add saved invite-message defaults and competition/team welcome-email controls. Persist preferences through the selected feature backend; keep recipient addresses and invite tokens out of client-readable settings.
3. Use a trusted shared email delivery worker/Edge Function for both backend modes. ICP canisters should enqueue an authorized delivery request, not make unauthenticated browser calls or require an email secret in the bundle. Preserve PII handling for ICP invite emails through `pii_access_control`; delivery retries need an idempotency key and a visible failure/retry state.

**Exit gate:** team, league, and competition audiences are permission-checked in both modes; email templates are backend-neutral; a failed delivery can be retried without sending duplicate invitations.

### 6. Deployment, Rollout, and Operations

1. Keep CI checks aligned with repository structure: frontend tests/type checks, Supabase migration/RLS tests, Motoko compile/migration checks, Candid drift, and live feature-adapter tests.
2. Add or update environment-specific deployment workflows only after the relevant secrets, protected environments, and rollback steps are documented. Do not copy production Supabase promotion workflows into the ICP deploy path; retain the repo's canister wiring requirements in `scripts/deploy-mainnet.sh`.
3. Deploy contracts and migrations to a non-production target first. Register canister IDs through runtime placement settings, verify notification/media/domain wiring, then enable the feature per country/club only after parity checks pass.
4. Roll out one feature area at a time. Monitor authorization denials, duplicate/idempotency outcomes, reminder queue failures, media decrypt errors, and Supabase/ICP result-shape mismatches. Keep a Supabase fallback only for features not yet selected for ICP, not as a silent recovery after an ICP write failure.

**Rollout Checklist (all pending; no production migrations or deployments have been run):**

1. **Prepare isolated targets.**
	- [ ] Create/identify a Supabase staging project or isolated branch with production-like schema and synthetic users; take a restorable snapshot before migrations.
	- [ ] Provision an ICP non-mainnet target and its canister IDs. This checkout currently has only `deploy/mainnet`; `scripts/deploy-mainnet.sh` defaults to mainnet, so do not run it for staging without a configured separate target. Follow [the ICP deployment runbook](icp-deployment-runbook.md) for an approved cloud-engine/test target.
	- [ ] Keep feature routing on Supabase by default. Configure only the staging target and internal test club for ICP after deployment and wiring are complete.

2. **Apply Supabase schema changes.**
	- [ ] Check the staging project's migration ledger first; apply only unapplied migrations in timestamp order, never manually replay migrations already recorded as applied.
	- [ ] Confirm the database head includes `20261007010000_add_competition_ladder_visibility.sql`, `20261007020000_add_event_duty_team.sql`, `20261009090000_add_competition_media_scope.sql`, `20261009100000_create_competition_event_fanout.sql`, `20261010000000_add_club_invite_message_defaults.sql`, `20261010010000_mini_league_news_audience.sql`, `20261011000000_add_competition_admin_inbox.sql`, `20261012000000_add_competition_vault_access.sql`, `20261012010000_add_scheduled_event_reminders.sql`, `20261012020000_add_welcome_email_contract.sql`, and `20261013000000_add_icp_welcome_email_deliveries.sql`, plus any earlier unapplied baseline migrations.
	- [ ] Verify the `process-scheduled-event-reminders` `pg_cron` job exists on a 15-minute schedule. Run `process_scheduled_event_reminders()` twice against controlled due events; confirm the second run adds no duplicate notifications and that markers update only with successful notification inserts.
	- [ ] Test Vault RLS and private-object policies for entrant, competition admin, organizer-club admin, unrelated user, and removed member. Verify metadata and `competition-vault` object access agree.

3. **Deploy Supabase Edge Functions and secrets.**
	- [ ] Run Deno typecheck/tests in CI or a Deno-enabled environment, then deploy `send-welcome-email` and `send-welcome-email-icp` to staging.
	- [ ] Configure secrets in the Supabase project, not in source or the frontend bundle: `RESEND_API_KEY`, verified `WELCOME_EMAIL_FROM`, and `CLUB_DOMAIN_CANISTER_ID` for ICP delivery. Confirm platform-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are available to their respective functions; configure `ICP_HOST` only when required by the chosen target.
	- [ ] Test enabled/disabled settings, unauthorized callers, missing recipient email, duplicate requests, provider failures, and retry after failure. For ICP, prove an unaccepted/expired invite cannot produce a job and acceptance remains successful if email delivery fails.

4. **Deploy ICP to the isolated target.**
	- [ ] Run `mops check` for every changed canister, `node frontend/scripts/check-candid-drift.mjs`, strict frontend typecheck, `npm run check:icp-guards`, and the focused feature suites before deployment.
	- [ ] Deploy with the target-specific config and authorized governor/deployer identity. Run the wiring in `scripts/deploy-mainnet.sh` against the isolated target, including club↔competition/mini-league, messaging↔competition, vault/PII↔competition, events↔competition, notification-queue, and media-blob-store links. Do not paste mainnet IDs into staging settings.
	- [ ] Verify the target ID mapping, preserve it in the matching target directory as required by the deploy process, and register each ID under **Placement Settings → Canister configuration**. Keep routing disabled until the next gate passes.

5. **Run the cross-backend acceptance matrix.** Use separate test identities for each row and verify both allowed and denied cases:

	| Identity | Expected access |
	|---|---|
	| Unrelated user / non-member | No private competition inbox, vault metadata, private bytes, or targeted news |
	| Accepted/registered entrant member or guardian | Read current competition news, gallery media, vault files, and their own admin-contact thread; no admin mutations |
	| Competition admin/owner | Manage competition settings and welcome template, administer the inbox, and manage scoped media/vault content |
	| Organizer-club admin who is not an entrant | Manage organizer-owned competition resources only where the policy grants it; do not gain entrant-only read access by accident |
	| Removed entrant | Access is revoked on the next read/key derivation; no cached/decrypt path restores access |

	Also verify news fan-out dedupe; event reminder audiences/preferences and idempotency; welcome delivery idempotency; and that ICP welcome email is sent only for recently accepted, email-addressed pending team invites.

6. **Pilot and expand.**
	- [ ] Enable one feature at a time for an internal club/country pin. Compare Supabase and ICP behavior before expanding to another feature or club.
	- [ ] Monitor authorization denials, duplicate claims, reminder queue failures, mail failures/retries, media decrypt errors, and provider result-shape mismatches. Define an owner and alert threshold for each before expanding.

7. **Rollback controls.**
	- [ ] Before writes begin, remove the ICP canister/feature registration or restore Supabase-only routing for the pilot.
	- [ ] After ICP writes begin, do not silently switch the same club to Supabase; pause expansion and forward-fix or perform an explicit data reconciliation first. Preserve both stores and migration history.
	- [ ] Disable the `pg_cron` job with `cron.unschedule` if reminder behavior is unsafe; disable the welcome-email settings/Edge Function if delivery is unsafe. Do not drop delivery logs or invite records during rollback.

## Recommended Order

1. Fixture parser and competition controls (largely isolated, shared pure logic).
2. Event duty-team field and reminder extensions (build on the existing event timer and notification queue).
3. Competition-wide event fan-out and officials (depend on cross-domain authorization contracts).
4. Competition admin inbox, gallery, and vault folders (reuse messaging/media/vault domains).
5. League targeting and saved invitation/welcome-email workflows (require audience and outbound-delivery contracts).
6. Production operational workflow parity and staged rollout.

## Scope Clarifications

- Hybrid already has configurable scheduled RSVP reminders; implement the missing early RSVP/points and duty reminder behaviors by extending that path.
- Hybrid already has team-targeted club news, per-division ladder hiding, generic CSV/XLSX and Dribl imports, QR join links, existing-member checks, child-link onboarding, admin group renaming, and one-off invite copy. Preserve these; do not replace them with production copies.
- Supabase function deployment/promotion and storage synchronization are operational concerns. Match them to hybrid's CI/deploy security model rather than porting production workflow files verbatim.

## Completion Criteria

- Every planned feature has equivalent user-visible behavior in Supabase and ICP modes, including authorization and error behavior.
- Supabase schema/RLS/RPC tests and ICP canister migration/Candid tests pass; shared feature contract tests pass against both adapters.
- ICP features are not routable until the corresponding canister is deployed, wired, registered, and verified on the intended target.
- The app-start bundle remains free of static ICP SDK/domain imports; all existing live media, PII, backend pinning, and notification-queue rules remain satisfied.