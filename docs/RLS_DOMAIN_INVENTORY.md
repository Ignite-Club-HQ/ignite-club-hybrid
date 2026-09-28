# Full RLS and Authorization Domain Inventory

This is a complete inventory pass over the inert sanitized reference under
`reference/backend/supabase`. No SQL was executed and no production service,
credential, user, or data was accessed.

## Topology gate records

The following identifiers are consumed by the repository topology checker. A
gate record means the domain has an explicit authorization/privacy parity
boundary; it does not mean production parity is complete.

- `identity_access`: account, principal, role, guardian, exclusion, invite, and PII policy boundary.
- `club_domain`: Club Links membership, admin, team, exclusion, and ownership boundary.
- `events_domain`: event, team, club, RSVP, attendance, lineup, and guardian boundary.
- `competition_domain`: competition, league, team-entry, official, participant, and join-token boundary.
- `messaging_domain`: participant, group, author, moderator, blocked-user, receipt, and deletion boundary.
- `media_metadata`: asset, album, uploader, commenter, capability, retention, and deletion boundary.
- `notification_queue`: recipient, worker capability, domain scope, preference, and delivery boundary.
- `timer_jobs`: workflow, operator capability, callback, claim, and recovery boundary.
- `pii_access_control`: encrypted PII, field-level access control, audit trail, cryptographic erasure, and key rotation boundary.
- `secret_workload_identity`: worker workload registration, scope whitelist enforcement, and vault secret access control boundary.

## Inventory size

The reference scan found:

- 1,064 sanitized SQL markdown files.
- 251 migration files containing `CREATE POLICY` declarations.
- 46 migration files defining reusable authorization helpers or protected RPCs.
- 1,147 RLS, helper, RPC, trigger, or row-security declarations.
- A large Edge Function surface whose authorization is enforced by JWT claims,
  service-role boundaries, webhook signatures, cron/internal tokens, or source
  table checks rather than ordinary table RLS.

The counts are inventory metrics, not a claim that every declaration belongs to
one independent policy. Migrations may replace, tighten, or supersede earlier
policies.

## Cross-cutting rules

These rules recur across the source and are the baseline for every ICP domain:

1. Anonymous callers cannot use authenticated data paths.
2. `app_admin` is a global administrative role for policies that explicitly
   grant it; it is not the same as a club or team role.
3. Club scope is established from the row being read or changed, never from a
   caller-supplied unrelated club ID.
4. Team scope must resolve through the team record and its owning club.
5. Parent and guardian access is derived through child assignments and must be
   checked against the requested team or club.
6. Explicit club and team exclusions override derived membership.
7. Ownership checks bind writes to the row owner, creator, author, uploader,
   participant, or parent/guardian named by the row.
8. Admin mutations validate that related rows belong to the same club, team,
   competition, event, or season.
9. Service-role, cron, webhook, and internal-worker paths are capabilities,
   not public user authorization.
10. Public reads are explicit exceptions and must not expose private columns or
    private child/member data.

Primary reusable source helpers include `has_role`, `is_club_member`,
`is_team_member`, `is_parent_of_child`, `is_guardian_of_child`,
`is_group_member`, `can_access_chat`, `can_access_chat_group`,
`can_view_album`, `can_view_competition`, `can_view_drill`, and domain-specific
`can_manage_*` functions.

## Domain inventory

### Identity, profiles, and account recovery

**Protected surface:** `profiles`, passkeys, sessions, account links, legal
terms, recovery records, deleted-account records, and user-email lookups.

**Rules found:** self-read/self-update, app-admin exceptions, authenticated
session ownership, passkey challenge ownership, rate limits, recovery token
binding, and restricted access to email hashes and user emails.

**Representative evidence:** `can_view_full_profile`, `get_user_by_email_for_passkey`,
`passkey-register`, `passkey-authenticate`, `recover-account`,
`admin-update-email`, and `delete-account`.

**ICP status:** Separate identity/account canister required. Club Links only
implements synthetic principal-to-account linking and revocation.

### Clubs, teams, memberships, roles, and family relationships

**Protected surface:** clubs, teams, user roles, club/team join requests,
children, child guardians, child-team assignments, exclusions, club links,
club news, and team configuration.

**Rules found:** club/team scope, role checks, parent/guardian-derived
membership, creator/admin ownership, app-admin bypasses, invite/token checks,
exclusion overrides, and same-club relationship validation.

**Representative evidence:** `is_club_member`, `is_team_member`,
`is_club_admin_for`, `is_parent_of_child`, `is_guardian_of_child`,
`club_member_exclusions`, `team_member_exclusions`, and
`create_team_with_creator_admin`.

**ICP status:** Club Links authorization boundary is implemented and tested in
`backend/club_links`; general clubs, teams, and membership canisters are not
implemented.

### Events, schedules, attendance, RSVPs, and lineups

**Protected surface:** events, event groups, event players, guests, attendance,
RSVPs, duties, lineups, views, recurring events, game results, captains,
goalkeepers, and pitch-board state.

**Rules found:** event club/team scope, participant or team membership,
parent/guardian access to child participation, event organizer/admin writes,
coach/team-admin controls, RSVP ownership, roster constraints, and event
specific visibility restrictions.

**Representative evidence:** `create_event_with_duties`,
`event_group_player_scope_ok`, `enforce_rsvp_role_restriction`,
`can_manage_event_groups`, `can_manage_game_result`, and
`get_targeted_event_attendance_roster`.

**ICP status:** Not ported. Requires event ownership, child visibility, and
roster parity tests before enablement.

### Messaging, chat, direct messages, polls, and digests

**Protected surface:** direct conversations/messages, chat groups, group
members, team messages, pinned messages, unread state, reactions, polls,
attachments, reports, summaries, and message deletion logs.

**Rules found:** conversation/group membership, team membership, club-admin and
app-admin moderation exceptions, author-only edits/deletes, participant read
receipts, blocked-user checks, attachment scope, poll creator controls, and
message retention/deletion audit paths.

**Representative evidence:** `can_access_chat`, `can_access_chat_group`,
`can_post_in_chat_group`, `can_dm_user`, `is_group_member`,
`20260330231300_9830f487-8864-459a-88aa-98ef026c0f57.sql.md`,
`message_deletions`, and `get_unread_message_counts`.

**ICP status:** Routing contract exists with idempotent IDs and incremental
reads. Full authorization, unread, acknowledgement, retention, and domain
canister behavior remain outstanding.

### Notifications, push, and delivery state

**Protected surface:** notifications, notification preferences, FCM/VAPID
 tokens, delivery queues, dispatch logs, targeted event recipients, and
notification cleanup/audit records.

**Rules found:** recipient-only reads, preference-owner writes, service-worker
or internal delivery capabilities, event/club recipient derivation, token
ownership, claim leases, retry ownership, and bounded cleanup operations.

**Representative evidence:** `derive_notification_club_id`,
`get_targeted_event_notification_recipients`, `claim_push_delivery_jobs`,
`cleanup_fcm_token_for_user`, `process-push-delivery-queue`, and
`notification_dispatch_log`.

**ICP status:** Synthetic routing and queue workflows exist. The local
notification queue now rejects anonymous callers for enqueue, claim,
acknowledge, fail, recovery, and notification reads. External push/email
delivery remains an explicit worker boundary; full recipient/club authorization
parity is not implemented.

### Media, photos, albums, files, and vault storage

**Protected surface:** photo albums, photos, comments, views, reports, file
metadata, storage objects, vault folders, deletion logs, and signed URLs.

**Rules found:** album visibility, club/team/event scope, uploader ownership,
commenter visibility, role-scoped uploads, storage-prefix enforcement, signed
access, deletion authority, retention, and moderation/report visibility.

**Representative evidence:** `can_view_album`, `can_access_chat_attachment`,
`can_publish_club_wide_photo`, `is_photo_uploader_visible`,
`is_photo_commenter_visible`, `authorize_storage_objects`,
`enforce_photo_storage_prefix`, and `get-signed-photo-url`.

**ICP status:** Media router exists only as a placement-aware provider
boundary. Metadata, bytes, capabilities, deletion, scanning, and retention
canisters are not implemented.

### Competitions, leagues, seasons, and mini-leagues

**Protected surface:** competitions, divisions, entries, matches, roles,
officials, ladders, fixtures, seasons, mini-leagues, players, sessions,
leaderboards, and competition chats.

**Rules found:** competition membership, owner/league-admin/official roles,
team entry ownership, join-token capabilities, match/fixture scope, season
editability, roster/child visibility, and cross-club/association checks.

**Representative evidence:** `can_view_competition`, `can_organise_competition`,
`is_competition_admin`, `is_competition_official`,
`enforce_competition_owner_is_league_admin`, `join_competition_with_token`,
and `guard_external_competition_match_edits`.

**ICP status:** Not ported. Requires a separate competition authorization model
and join-token capability design.

### Training, drills, pitch, and coaching

**Protected surface:** drills, drill frames, training defaults, team training,
formations, pitch events, coaching controls, and training attendance.

**Rules found:** drill owner/editor/admin controls, team-member visibility,
club-member visibility, child assignment scope, coach/team-admin pitch control,
and event/team consistency checks.

**Representative evidence:** `can_view_drill`, `can_edit_drill`,
`can_control_pitch_board`, `20260422052748_fb25d89a-a66a-4799-981e-eb8134a410f4.sql.md`,
and `pitch-timer-event`.

**ICP status:** Not ported. Must preserve team and child visibility boundaries.

### EOI, invites, referrals, and onboarding

**Protected surface:** EOI submissions, preferences, invite tokens, pending
invites, shell teams, referrals, and invite/reminder logs.

**Rules found:** parent identity/email confirmation, club-admin EOI management,
claim-token possession, invite recipient ownership, same-club allocation,
role-based invite acceptance, and one-time claim/idempotency behavior.

**Representative evidence:** `confirm_eoi_placement`, `claim_eoi_by_token`,
`get_my_pending_eois`, `allocate_eoi_to_team`, `has_valid_team_invite_for_role`,
and `accept_parent_team_invite`.

**ICP status:** Not ported. The Club Links guardian check is reusable but does
not implement EOI workflows or invite capabilities.

### Rewards, points, engagement, and referrals

**Protected surface:** child/club points, rewards, redemptions, engagement
logs, streaks, referral records, bonuses, and leaderboards.

**Rules found:** self/parent/guardian visibility, club membership, admin
adjustment authority, period/idempotency keys, reward ownership, and bounded
leaderboard reads.

**Representative evidence:** `get_child_club_points`, `increment_child_club_points`,
`increment_user_club_points`, `process-weekly-engagement-bonus`, and
`get_user_leaderboard_rank`.

**ICP status:** Not ported. Requires points mutation authorization and period
idempotency tests.

### Billing, subscriptions, payments, and IAP

**Protected surface:** subscriptions, Stripe configuration, checkout records,
IAP transactions, storage add-ons, payment confirmations, and webhook events.

**Rules found:** no direct client writes to payment configuration, authenticated
owner/admin reads, webhook signature verification, service-role-only mutation,
replay/idempotency protection, and external provider authority.

**Representative evidence:** `get_club_stripe_config`, `apply_stripe_subscription_transition`,
`claim_stripe_webhook_event`, `complete_stripe_webhook_event`,
`verify-iap-receipt`, and `stripe-webhook`.

**ICP status:** Must remain outside ordinary canister state and behind an
external trusted integration boundary. No migration or ICP payment port is
allowed in this phase.

### Admin, audit, diagnostics, and operational controls

**Protected surface:** audit logs, admin alerts, performance logs, cron locks,
dispatch credentials, repair attempts, backups, and operational settings.

**Rules found:** app-admin or explicit operator roles, service-role-only
maintenance, append-only audit paths, internal token checks, bounded cleanup,
and secret separation.

**Representative evidence:** `export-write-audit`, `attach_write_audit`,
`cron_locks`, `dispatch_bootstrap_tokens`, `bootstrap_dispatch_credentials`,
`scheduled-backup`, and `secret-delete-user`.

**ICP status:** Placement registry has synthetic operator roles and audit
history. Audit history and operator records are Auditor-gated, while placement
mutations retain role-specific operator checks. Production credentials, secrets,
backups, and deployment operations remain outside the canisters.

### Public and external integrations

**Protected surface:** public event/team/share views, app version checks,
Google/Drive/PlayHQ integrations, link previews, external competition sync,
and email/push delivery.

**Rules found:** deliberate public-read exceptions, share-token capabilities,
external signature/token validation, service-role boundaries, rate limits,
and no direct exposure of private rows.

**Representative evidence:** `public-club-events`, `public-club-teams`,
`share-page`, `drive-folder-sync`, `playhq-sync`, `fetch-link-preview`, and
`send-email`.

**ICP status:** Remains Supabase-only or external-worker territory until a
separate trust-boundary and bounded-wait design is approved.

## ICP implementation gate

## Upcoming parity implementation phase

This inventory is the source map, not proof that parity is complete. The next
implementation phase must produce a parity matrix for every enabled role with
the source policy/helper/RPC, ICP authorization reference, positive test,
negative test, and explicit status. Required status values are
`implemented_and_proven`, `external_boundary`, `supabase_only`, or
`not_enabled`.

The parity phase must cover cross-site scope, child/guardian visibility,
exclusions, blocked users, service-role/cron/webhook capabilities, stale
revisions, replay safety, worker ownership, and external-call failure behavior.
No domain is ported merely because its canister compiles or a router exists.

The current inventory is domain/policy-level. A separate upcoming artifact must
classify every sensitive source field/column, including direct identifiers,
contact data, child/guardian data, authentication metadata, media references,
operational metadata, and secrets. Each field needs an owner, retention period,
residency class, encryption requirement, and explicit ICP/external boundary.

A domain may be enabled on ICP only after all of the following exist:

- source policy/helper/RPC inventory for the domain;
- an explicit canister authorization module;
- positive and negative tests for every access path;
- cross-scope and ownership tests;
- exclusion and app-admin tests where applicable;
- idempotency and stale-version tests for mutations;
- external worker capability tests where applicable;
- an explicit decision to keep secrets, payments, email, push, and external APIs
  outside ordinary canister state.

The current lab satisfies this gate for Club Links and the basic authenticated
access boundary of the notification queue. Messaging, notification recipient
authorization, and media routing have provider-neutral contracts, but that is
not equivalent to full RLS parity or production domain enablement.
