# Ignite Club HQ DEV — hybrid-main compatibility report
Date: 2026-10-29 (UTC). **Verdict: NOT YET COMPATIBILITY-CLEARED.** This is a read-only report, not authorization to apply SQL or deploy anything.

## Scope, provenance and safety
- Authorized database: **Ignite Club HQ DEV**, `ecsdwrarzfexssxtrymj` only. Production database was never queried or contacted. All database operations were catalog/metadata SELECTs; no application rows or personal data were read. No migrations, writes, auth/config changes, bucket changes, workflows, deployments, repository settings changes or canister calls were performed.
- Target repository: `Ignite-Club-HQ/ignite-club_hq-prod`. GitHub read-only API pinned `main` at `96642d0750e03d933b68957d61999de3ae983b9c`, and `integration-hybrid` at `70d821c8a58791e4523a1ba4972bf009af90af6c` (tree `d0af5baa4e0e7d22fd2fc30eb76e4c5674c1e41f`). Comparison reported **ahead**, 8,070 commits ahead, zero behind: main is an ancestor, so an ordinary merge without manual content changes produces the hybrid tip tree. Branch movement after these reads invalidates that assumption.
- Full recursive tree was not truncated. Source archive was downloaded into `/tmp`, selectively extracted excluding `.git` and `.env` files, and **4,539 extracted files were individually verified against Git blob hashes**. Archive SHA-256: `6cf75d4e6707a426d0619de909abe7e63a61ae9a4ac9e36e4a9841a316575ecc`. No code was executed or dependencies installed.
- Audited `frontend/src`, hybrid backend Motoko/Candid contracts and `supabase/functions`/migration declarations. Metadata snapshot: **199 public base tables, 2 views, 2,215 columns, 718 constraints, 543 functions, 683 public/storage policies, 221 non-internal public/auth-user triggers**. Reads span several minutes, not one transactional snapshot.
- No secrets or service keys were read, printed or exported. The already-configured public frontend publishable key was used internally only for the DEV public Auth settings endpoint, never reported. Source env requirements are reported as names only. Defaults/function bodies were not bulk-exported, avoiding embedded credentials. No row counts were needed.
- Important limits: deployed Edge Function inventory/source and hosted Site URL/redirect allowlist/email-template configuration are unavailable through the connected metadata interface; they remain **UNVERIFIED**, not presumed present. Public Auth provider flags were independently read successfully. No mutation-based behavior tests were permitted.
- Static inventories cover literal calls and generated contracts; dynamic names, spread objects, computed selects, embedded joins and runtime routing need additional review. A name/signature match is not proof of authorized runtime behavior or exact JSON contents. No blanket “all compatible” claim is made.

## 1. Tables and columns
**Expected-by-code:** 141 literal frontend table targets; 168 frontend/edge targets and 198 generated table contracts. See complete inventory below.

**Found-in-this-DB:** 199 base tables and 2 views; columns/types/nullability and constraints listed below.

**GAP (essential blocker):** Missing frontend tables: `canister_memory_reports`, `club_invite_message_defaults`, `welcome_email_settings`. Missing competition email-invite contract table and hard missing scalar columns described below.

**DIFFERENCE (non-blocking):** Generated types are not a migration ledger. Tables not directly called by frontend may be used by SQL triggers, scheduled services or canisters; never remove them on this evidence.

### Confirmed missing/changed scalar columns
| Missing scalar reference | Hybrid source (`frontend/src/`) | Impact |
|---|---|---|
| `clubs.home_country` | `ClubBackendEnforcement.tsx:94–95` | Query throws; backend country enforcement lookup cannot load. |
| `club_subscriptions.pricing_version` | `features/vault/clubMediaAllowance.ts:101–104` | Query throws before upload allowance validation; Supabase media/Vault upload path blocked. |
| `mini_leagues.status` | `features/news/useClubNews.ts:351–357` | Active mini-league news audience query throws. |
| `user_roles.mini_league_id` | `components/chat/CreateGroupDialog.tsx:271–274` | Role lookup errors are ignored, producing empty mini-league audience data. |
| `profiles.full_name` | `components/chat/ChatGroupJoinRequests.tsx:43–48` | Profile SELECT errors are ignored; requester names can disappear. |
| `profiles.first_name` | `components/chat/GlobalChatRecapSheet.tsx:300–305` | Recap greeting/profile query throws; assess local error UI. |
| `teams.age_group` | `components/event/ClubWideRsvpBreakdown.tsx:75–80` | Team query errors ignored; RSVP team breakdown can be empty. |
| `team_memberships.user_id` | `components/layout/AppHeader.tsx:446–450; hooks/useNotificationClubSwitch.ts` | Actual schema links club_player_id; membership discovery query fails. Other role paths may compensate, not guaranteed. |
| `club_players.user_id` | `components/layout/AppHeader.tsx:451; hooks/useNotificationClubSwitch.ts` | Actual column is profile_id, not user_id. Alternate membership lookup also fails. |
| `profiles.email` | `pages/AdminDmAttachmentsPage.tsx:115–119` | Admin-only SELECT errors ignored; restricted-user display may be empty. Do not add private email fields just to satisfy a query. |
| `events.start_at` | `pages/AssociationDetailPage.tsx:144–149` | Upcoming-event count query uses absent column; DEV has event_date/start_time. Count can be incorrect. |

Missing generated-only fields: `competition_matches.home_score/away_score`, `duties.duty_team_id`, `events.duty_team_reminder_sent/individual_duty_reminder_sent`. No scalar type or nullability mismatch was found for shared generated scalar columns using TS string/number/boolean mapping. JSON, arrays and custom returns need semantic checks. Score columns were deliberately removed from the match metadata table: do **not** restore them and weaken hidden-score protection. Hybrid match writes already target `save_competition_match_result`, which is missing. `events.duty_team_id` and `events.duty_team_label` **do exist**; reminder source uses these, not the generated sent-flag fields.

Other missing edge targets: `write_audit_log` (audit exporter); `competition_role_email_invites` exists in expected generated/migration contracts but not DEV. Edge welcome-email supporting delivery tables must be checked alongside missing claim/finish RPCs.

### DB tables/views with no literal frontend/edge `.from()` reference
`business_matches`, `business_profiles`, `business_shortlist`, `chat_notification_log`, `chat_photo_gallery_reminders`, `client_perf_log`, `club_member_exclusions`, `competition_ladder`, `cron_locks`, `dispatch_bootstrap_tokens`, `dispatch_repair_attempts`, `drill_frames`, `drill_recent_uses`, `drills`, `event_session_drills`, `match_message_reads`, `member_referrals`, `message_deletions`, `mini_league_group_players`, `mini_league_groups`, `mini_league_session_availability`, `mini_league_sessions`, `photo_albums`, `photos`, `playhq_fixtures`, `playhq_grades`, `playhq_ladder`, `public_clubs`, `rsvp_audit_log`, `sponsorship_packages`, `stripe_notification_outbox`, `stripe_subscription_event_state`, `stripe_webhook_events`, `team_member_exclusions`, `training_session_drills`, `vault_deletion_jobs`, `vault_storage_reservations`. **Not “unused by the system”:** SQL-only/internal use is outside this literal list.

### Complete public schema inventory
Notation: `?` = nullable; `!` = non-null. Custom/array types include PostgreSQL UDT name. “Typed only” means generated contract, not a proven runtime call. All constraints below are catalog definitions, not SQL to execute.

#### active_games
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid?`; `user_id: uuid!`; `timer_state: jsonb!`; `pitch_state: jsonb!`; `is_active: boolean!`; `last_sub_check_time: integer?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `board_session_id: uuid!`.
- `active_games_pkey`: `PRIMARY KEY (id)`
- `active_games_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `active_games_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/check-pending-subs/index.ts:401; supabase/functions/check-pending-subs/index.ts:439; supabase/functions/check-pending-subs/index.ts:559.

#### active_games_write_log
Code usage: literal frontend/edge reference.
Columns: `id: bigint!`; `active_game_id: uuid!`; `user_id: uuid!`; `team_id: uuid?`; `op: text!`; `created_at: timestamp with time zone!`.
- `active_games_write_log_op_check`: `CHECK ((op = ANY (ARRAY['INSERT'::text, 'UPDATE'::text])))`
- `active_games_write_log_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/pages/AdminActiveGamesPage.tsx:229.

#### admin_alerts
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `alert_type: text!`; `details: jsonb?`; `created_at: timestamp with time zone!`.
- `admin_alerts_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/cancel-subscription/index.ts:176; supabase/functions/cancel-subscription/index.ts:201; supabase/functions/cancel-subscription/index.ts:262.

#### admob_config
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `platform: text!`; `app_id: text!`; `banner_ad_unit_id: text!`; `interstitial_ad_unit_id: text!`; `is_enabled: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `admob_config_pkey`: `PRIMARY KEY (id)`
- `admob_config_platform_check`: `CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])))`
- `admob_config_platform_key`: `UNIQUE (platform)`
Evidence: frontend/src/hooks/useAdMob.ts:40; frontend/src/pages/AdMobSettingsPage.tsx:58; frontend/src/pages/AdMobSettingsPage.tsx:113.

#### app_ad_analytics
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `ad_id: uuid!`; `event_type: text!`; `context: text!`; `user_id: uuid?`; `created_at: timestamp with time zone!`.
- `app_ad_analytics_ad_id_fkey`: `FOREIGN KEY (ad_id) REFERENCES app_ads(id) ON DELETE CASCADE`
- `app_ad_analytics_pkey`: `PRIMARY KEY (id)`
- `app_ad_analytics_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
Evidence: frontend/src/hooks/useAdAnalytics.ts:18; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1107; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1146.

#### app_ad_settings
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `location: text!`; `is_enabled: boolean!`; `override_sponsors: boolean!`; `show_only_when_no_sponsors: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `app_ad_settings_location_key`: `UNIQUE (location)`
- `app_ad_settings_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/AppAdCarousel.tsx:87; frontend/src/components/SponsorOrAdCarousel.tsx:207; frontend/src/pages/ManageAdsPage.tsx:296.

#### app_ads
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `name: text!`; `image_url: text?`; `link_url: text?`; `description: text?`; `is_active: boolean!`; `display_order: integer!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `ad_type: text!`; `logo_url: text?`; `headline: text?`; `subtext: text?`; `cta_label: text?`; `bg_color: text?`; `text_color: text?`.
- `app_ads_ad_type_check`: `CHECK ((ad_type = ANY (ARRAY['image'::text, 'logo_text'::text])))`
- `app_ads_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/AppAdCarousel.tsx:115; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1057; frontend/src/pages/ManageAdsPage.tsx:279.

#### app_settings
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `key: text!`; `value: jsonb!`; `description: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `app_settings_key_key`: `UNIQUE (key)`
- `app_settings_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/chat-photo-gallery-reminders/index.ts:47; supabase/functions/digest-messages/index.ts:161; supabase/functions/export-write-audit/index.ts:26.

#### app_stripe_config
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `stripe_secret_key: text!`; `stripe_publishable_key: text!`; `is_enabled: boolean?`; `created_at: timestamp with time zone?`; `updated_at: timestamp with time zone?`.
- `app_stripe_config_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/cancel-subscription/index.ts:159; supabase/functions/confirm-event-payment/index.ts:253; supabase/functions/create-member-payment-checkout/index.ts:126.

#### association_broadcasts
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `association_id: uuid!`; `sent_by: uuid!`; `message: text!`; `club_ids: _uuid?`; `team_ids: _uuid!`; `recipient_team_count: integer!`; `created_at: timestamp with time zone!`.
- `association_broadcasts_association_id_fkey`: `FOREIGN KEY (association_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `association_broadcasts_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-association-broadcast/index.ts:121; frontend/src/pages/AssociationDetailPage.tsx:402.

#### audit_logs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `action_type: text!`; `actor_id: uuid?`; `target_user_id: uuid?`; `target_user_name: text?`; `details: jsonb?`; `created_at: timestamp with time zone!`.
- `audit_logs_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:540; supabase/functions/admin-set-temp-password/index.ts:131; supabase/functions/admin-update-email/index.ts:58.

#### blocked_users
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `blocker_id: uuid!`; `blocked_id: uuid!`; `reason: text?`; `created_at: timestamp with time zone!`.
- `blocked_users_blocked_id_fkey`: `FOREIGN KEY (blocked_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `blocked_users_blocker_id_blocked_id_key`: `UNIQUE (blocker_id, blocked_id)`
- `blocked_users_blocker_id_fkey`: `FOREIGN KEY (blocker_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `blocked_users_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/hooks/useBlockedUsers.ts:30; frontend/src/hooks/useBlockedUsers.ts:50; frontend/src/hooks/useBlockedUsers.ts:69.

#### broadcast_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `edited_at: timestamp with time zone?`; `target_club_ids: _uuid?`.
- `broadcast_messages_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `broadcast_messages_pkey`: `PRIMARY KEY (id)`
- `broadcast_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES broadcast_messages(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:424; supabase/functions/cleanup-deleted-accounts/index.ts:162; supabase/functions/prefetch-user-data/index.ts:70.

#### business_matches
Code usage: generated contract only.
Columns: `id: uuid!`; `club_id: uuid!`; `business_profile_id: uuid!`; `status: text!`; `tier: text!`; `amount: numeric!`; `coverage_percentage: integer!`; `benefits: _text!`; `recognition_tier: text?`; `proposed_tier: text?`; `donation_tier: text?`; `cash_addon: numeric!`; `cash_addon_note: text?`; `cash_addon_recorded_by: text?`; `payment_link_url: text?`; `stripe_session_id: text?`; `paid_at: timestamp with time zone?`; `expires_at: timestamp with time zone?`; `matched_at: timestamp with time zone!`; `renewal_reminder_sent: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `business_matches_business_profile_id_fkey`: `FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)`
- `business_matches_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id)`
- `sponsor_matches_pkey`: `PRIMARY KEY (id)`

#### business_profiles
Code usage: generated contract only.
Columns: `id: uuid!`; `user_id: uuid!`; `company_name: text!`; `contact_email: text!`; `website_url: text?`; `logo_url: text?`; `description: text?`; `industry: text?`; `city: text?`; `state: text?`; `latitude: double precision?`; `longitude: double precision?`; `preferred_benefits: _text!`; `preferred_tiers: _text!`; `is_visible: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `notify_renewals: boolean!`.
- `sponsor_profiles_pkey`: `PRIMARY KEY (id)`

#### business_shortlist
Code usage: generated contract only.
Columns: `id: uuid!`; `club_id: uuid!`; `business_profile_id: uuid!`; `notes: text?`; `created_at: timestamp with time zone!`.
- `business_shortlist_business_profile_id_fkey`: `FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id)`
- `business_shortlist_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id)`
- `sponsor_shortlist_club_id_sponsor_profile_id_key`: `UNIQUE (club_id, business_profile_id)`
- `sponsor_shortlist_pkey`: `PRIMARY KEY (id)`

#### chat_group_join_requests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `user_id: uuid!`; `status: text!`; `message: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `decided_by: uuid?`; `decided_at: timestamp with time zone?`.
- `chat_group_join_requests_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `chat_group_join_requests_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/notify-join-request-decision/index.ts:57; frontend/src/components/chat/ChatGroupJoinRequests.tsx:34; frontend/src/components/chat/DiscoverGroupsList.tsx:172.

#### chat_group_unread
Code usage: literal frontend/edge reference.
Columns: `group_id: uuid!`; `user_id: uuid!`; `unread_count: integer!`; `last_read_message_id: uuid?`; `updated_at: timestamp with time zone!`.
- `chat_group_unread_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `chat_group_unread_pkey`: `PRIMARY KEY (group_id, user_id)`
- `chat_group_unread_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/hooks/useGroupChatUnreadCache.ts:53.

#### chat_groups
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `name: text!`; `club_id: uuid?`; `team_id: uuid?`; `allowed_roles: _app_role!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `mini_league_id: uuid?`; `membership_mode: text!`; `category: text?`; `deleted_at: timestamp with time zone?`; `deleted_by: uuid?`; `competition_id: uuid?`; `join_policy: text!`; `allow_forwarding: boolean!`; `last_message_id: uuid?`; `last_message_text: text?`; `last_message_at: timestamp with time zone?`; `last_message_author_id: uuid?`; `last_message_author_name: text?`; `last_message_image_url: text?`; `last_message_is_system: boolean?`; `competition_scope: text?`; `contact_user_id: uuid?`; `include_captains: boolean!`.
- `chat_groups_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `chat_groups_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `chat_groups_competition_scope_check`: `CHECK ((((competition_id IS NULL) AND (competition_scope IS NULL)) OR ((competition_id IS NOT NULL) AND (competition_scope = ANY (ARRAY['coordinators'::text, 'all_members'::text, 'referees'::text, 'committee'::text, 'admin_contact'::text])))))`
- `chat_groups_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `chat_groups_join_policy_check`: `CHECK ((join_policy = ANY (ARRAY['invite_only'::text, 'request_to_join'::text, 'open_to_club'::text])))`
- `chat_groups_membership_mode_check`: `CHECK ((membership_mode = ANY (ARRAY['role'::text, 'manual'::text])))`
- `chat_groups_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `chat_groups_pkey`: `PRIMARY KEY (id)`
- `chat_groups_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/backfill-chat-vault-groups/index.ts:136; supabase/functions/digest-messages/index.ts:190; supabase/functions/notify-join-request-decision/index.ts:81.

#### chat_mute_preferences
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `chat_type: text!`; `chat_id: uuid!`; `muted_at: timestamp with time zone!`; `muted_until: timestamp with time zone?`.
- `chat_mute_preferences_pkey`: `PRIMARY KEY (id)`
- `chat_mute_preferences_user_id_chat_type_chat_id_key`: `UNIQUE (user_id, chat_type, chat_id)`
- `chat_mute_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/process-message-notifications/index.ts:227; supabase/functions/process-message-notifications/index.ts:275; supabase/functions/process-message-notifications/index.ts:384.

#### chat_notification_log
Code usage: generated contract only.
Columns: `id: uuid!`; `match_id: uuid!`; `recipient_email: text!`; `sent_at: timestamp with time zone!`.
- `chat_notification_log_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES business_matches(id)`
- `chat_notification_log_match_id_recipient_email_key`: `UNIQUE (match_id, recipient_email)`
- `chat_notification_log_pkey`: `PRIMARY KEY (id)`

#### chat_open_perf
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `chat_kind: text!`; `target_id: uuid!`; `source: text!`; `tap_to_render_ms: integer!`; `message_count: integer?`; `from_cache: boolean?`; `platform: text?`; `created_at: timestamp with time zone!`; `stages: jsonb?`.
- `chat_open_perf_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/lib/chatOpenLatency.ts:105.

#### chat_photo_gallery_reminders
Code usage: generated contract only.
Columns: `id: uuid!`; `team_id: uuid!`; `author_id: uuid!`; `message_id: uuid?`; `photo_count: integer!`; `created_at: timestamp with time zone!`.
- `chat_photo_gallery_reminders_pkey`: `PRIMARY KEY (id)`

#### chat_pinned_vault
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `chat_type: text!`; `chat_id: uuid!`; `vault_file_id: uuid?`; `vault_folder_id: uuid?`; `root_scope: text?`; `root_id: uuid?`; `enabled: boolean!`; `set_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `chat_pinned_vault_chat_type_chat_id_key`: `UNIQUE (chat_type, chat_id)`
- `chat_pinned_vault_chat_type_check`: `CHECK ((chat_type = ANY (ARRAY['team'::text, 'club'::text, 'group'::text])))`
- `chat_pinned_vault_check`: `CHECK ((((((vault_file_id IS NOT NULL))::integer + ((vault_folder_id IS NOT NULL))::integer) + (((root_scope IS NOT NULL) AND (root_id IS NOT NULL)))::integer) = 1))`
- `chat_pinned_vault_pkey`: `PRIMARY KEY (id)`
- `chat_pinned_vault_root_scope_check`: `CHECK ((root_scope = ANY (ARRAY['team'::text, 'club'::text])))`
- `chat_pinned_vault_vault_file_id_fkey`: `FOREIGN KEY (vault_file_id) REFERENCES vault_files(id) ON DELETE CASCADE`
- `chat_pinned_vault_vault_folder_id_fkey`: `FOREIGN KEY (vault_folder_id) REFERENCES vault_folders(id) ON DELETE CASCADE`
Evidence: frontend/src/hooks/useChatPinnedVault.ts:74; frontend/src/hooks/useChatPinnedVault.ts:134; frontend/src/hooks/useChatPinnedVault.ts:167.

#### chat_summaries
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `scope_type: text!`; `scope_id: text!`; `last_message_id: uuid?`; `message_count: integer!`; `summary: jsonb!`; `model: text?`; `created_at: timestamp with time zone!`; `expires_at: timestamp with time zone!`.
- `chat_summaries_pkey`: `PRIMARY KEY (id)`
- `chat_summaries_scope_type_check`: `CHECK ((scope_type = ANY (ARRAY['team'::text, 'club'::text, 'group'::text, 'club_admin'::text, 'direct'::text])))`
- `chat_summaries_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/summarize-chat-icp/index.ts:301; supabase/functions/summarize-chat-icp/index.ts:677; supabase/functions/summarize-chat/index.ts:393.

#### child_club_points
Code usage: literal frontend/edge reference.
Columns: `child_id: uuid!`; `club_id: uuid!`; `points: integer!`; `updated_at: timestamp with time zone!`.
- `child_club_points_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `child_club_points_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `child_club_points_pkey`: `PRIMARY KEY (child_id, club_id)`
Evidence: frontend/src/components/RewardRedemptionCard.tsx:304; frontend/src/components/RewardRedemptionCard.tsx:595; frontend/src/hooks/useAddTeamMemberRosterData.ts:122.

#### child_guardians
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `child_id: uuid!`; `guardian_id: uuid!`; `relationship_type: text?`; `is_primary: boolean?`; `created_at: timestamp with time zone!`.
- `child_guardians_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `child_guardians_child_id_guardian_id_key`: `UNIQUE (child_id, guardian_id)`
- `child_guardians_guardian_id_fkey`: `FOREIGN KEY (guardian_id) REFERENCES profiles(id) ON DELETE CASCADE`
- `child_guardians_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/audit-orphan-children/index.ts:55; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:125; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:159.

#### child_mini_league_assignments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `child_id: uuid!`; `mini_league_id: uuid!`; `ability_rating: integer?`; `notes: text?`; `created_at: timestamp with time zone!`.
- `child_mini_league_assignments_ability_rating_check`: `CHECK (((ability_rating IS NULL) OR ((ability_rating >= 1) AND (ability_rating <= 5))))`
- `child_mini_league_assignments_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `child_mini_league_assignments_child_id_mini_league_id_key`: `UNIQUE (child_id, mini_league_id)`
- `child_mini_league_assignments_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `child_mini_league_assignments_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:369; supabase/functions/cleanup-deleted-accounts/index.ts:140; frontend/src/components/AddMiniLeagueMemberSheet.tsx:355.

#### child_team_assignments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `child_id: uuid!`; `team_id: uuid!`; `created_at: timestamp with time zone!`.
- `child_team_assignments_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `child_team_assignments_child_id_team_id_key`: `UNIQUE (child_id, team_id)`
- `child_team_assignments_pkey`: `PRIMARY KEY (id)`
- `child_team_assignments_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/admin-delete-account/index.ts:229; supabase/functions/audit-orphan-children/index.ts:53; supabase/functions/cleanup-deleted-accounts/index.ts:139.

#### child_training_defaults
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `child_id: uuid?`; `user_id: uuid?`; `default_status: text!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `last_confirmation_at: timestamp with time zone?`; `auto_paused_at: timestamp with time zone?`; `auto_paused_reason: text?`.
- `child_or_user_required`: `CHECK ((((child_id IS NOT NULL) AND (user_id IS NULL)) OR ((child_id IS NULL) AND (user_id IS NOT NULL))))`
- `child_training_defaults_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `child_training_defaults_default_status_check`: `CHECK ((default_status = ANY (ARRAY['going'::text, 'not_going'::text])))`
- `child_training_defaults_pkey`: `PRIMARY KEY (id)`
- `child_training_defaults_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `child_training_defaults_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:82; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:116; frontend/src/hooks/useTrainingDefault.ts:59.

#### children
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `parent_id: uuid?`; `name: text!`; `year_of_birth: integer?`; `created_at: timestamp with time zone!`; `ignite_points: integer!`.
- `children_parent_id_fkey`: `FOREIGN KEY (parent_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `children_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:220; supabase/functions/admin-delete-account/index.ts:260; supabase/functions/audit-orphan-children/index.ts:40.

#### class_attendance
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `term_id: uuid!`; `team_id: uuid!`; `session_date: date!`; `child_id: uuid?`; `user_id: uuid?`; `status: text!`; `marked_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `class_attendance_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `class_attendance_marked_by_fkey`: `FOREIGN KEY (marked_by) REFERENCES profiles(id)`
- `class_attendance_pkey`: `PRIMARY KEY (id)`
- `class_attendance_status_check`: `CHECK ((status = ANY (ARRAY['present'::text, 'absent'::text, 'late'::text])))`
- `class_attendance_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `class_attendance_term_id_fkey`: `FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE`
- `class_attendance_term_id_team_id_session_date_child_id_key`: `UNIQUE (term_id, team_id, session_date, child_id)`
- `class_attendance_term_id_team_id_session_date_user_id_key`: `UNIQUE (term_id, team_id, session_date, user_id)`
- `class_attendance_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: frontend/src/components/ClassAttendanceManager.tsx:123; frontend/src/components/ClassAttendanceManager.tsx:184; frontend/src/components/ClassAttendanceSingle.tsx:104.

#### class_enrolments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `child_id: uuid?`; `team_id: uuid!`; `term_id: uuid!`; `status: enrolment_status!`; `waitlist_position: integer?`; `enrolled_at: timestamp with time zone!`; `withdrawn_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `user_id: uuid?`.
- `class_enrolments_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `class_enrolments_child_id_team_id_term_id_key`: `UNIQUE (child_id, team_id, term_id)`
- `class_enrolments_pkey`: `PRIMARY KEY (id)`
- `class_enrolments_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `class_enrolments_term_id_fkey`: `FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE`
- `class_enrolments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/admin-delete-account/index.ts:361; supabase/functions/cleanup-deleted-accounts/index.ts:141; frontend/src/components/AdminManualEnrolDialog.tsx:98.

#### client_perf_log
Code usage: generated contract only.
Columns: `id: uuid!`; `created_at: timestamp with time zone!`; `user_id: uuid?`; `query_name: text!`; `duration_ms: integer!`; `status: integer?`; `aborted: boolean!`; `network_type: text?`; `online: boolean!`; `url_path: text?`; `ua: text?`.
- `client_perf_log_pkey`: `PRIMARY KEY (id)`

#### club_admin_conversations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `member_user_id: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `club_admin_conversations_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_admin_conversations_club_id_member_user_id_key`: `UNIQUE (club_id, member_user_id)`
- `club_admin_conversations_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/process-scheduled-messages/index.ts:281; supabase/functions/scheduled-messages-write/index.ts:130; supabase/functions/summarize-chat-icp/index.ts:97.

#### club_admin_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `conversation_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `deleted_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `edited_at: timestamp with time zone?`.
- `club_admin_messages_conversation_id_fkey`: `FOREIGN KEY (conversation_id) REFERENCES club_admin_conversations(id) ON DELETE CASCADE`
- `club_admin_messages_pkey`: `PRIMARY KEY (id)`
- `club_admin_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES club_admin_messages(id)`
Evidence: supabase/functions/process-scheduled-messages/index.ts:364; frontend/src/lib/messageQueue.ts:167; frontend/src/lib/notificationChatRouting.ts:141.

#### club_dm_settings
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `dm_enabled: boolean!`; `allowed_roles: _text!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `club_dm_settings_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_dm_settings_club_id_key`: `UNIQUE (club_id)`
- `club_dm_settings_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/ClubDMSettings.tsx:57; frontend/src/components/ClubDMSettings.tsx:83; frontend/src/components/chat/StartDMDialog.tsx:256.

#### club_invites
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `role: app_role!`; `token: text!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `expires_at: timestamp with time zone?`; `max_uses: integer?`; `uses_count: integer!`.
- `club_invites_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_invites_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `club_invites_pkey`: `PRIMARY KEY (id)`
- `club_invites_token_key`: `UNIQUE (token)`
Evidence: supabase/functions/vault-backup/index.ts:170; frontend/src/pages/JoinClubPage.tsx:241.

#### club_join_requests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `user_id: uuid!`; `message: text?`; `status: text!`; `reviewed_by: uuid?`; `reviewed_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `club_join_requests_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_join_requests_club_id_user_id_key`: `UNIQUE (club_id, user_id)`
- `club_join_requests_pkey`: `PRIMARY KEY (id)`
- `club_join_requests_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)`
- `club_join_requests_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
- `club_join_requests_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/components/FindOrCreateClubWizard.tsx:259.

#### club_links
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `title: text!`; `subtitle: text?`; `url: text!`; `icon: text!`; `open_mode: text!`; `sort_order: integer!`; `is_active: boolean!`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `club_links_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_links_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/pages/ClubLinkEmbedPage.tsx:30; frontend/src/live/features/clubLinksService.ts:60; frontend/src/live/features/clubLinksService.ts:68.

#### club_member_exclusions
Code usage: generated contract only.
Columns: `club_id: uuid!`; `user_id: uuid!`; `excluded_at: timestamp with time zone!`; `excluded_by: uuid?`.
- `club_member_exclusions_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_member_exclusions_pkey`: `PRIMARY KEY (club_id, user_id)`

#### club_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `forwarded_from_user_id: uuid?`; `forwarded_at: timestamp with time zone?`; `forwarded_source_label: text?`; `edited_at: timestamp with time zone?`.
- `club_messages_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `club_messages_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_messages_pkey`: `PRIMARY KEY (id)`
- `club_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES club_messages(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:408; supabase/functions/auto-post-news-to-chat/index.ts:236; supabase/functions/cleanup-deleted-accounts/index.ts:160.

#### club_news
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `title: text!`; `content: text!`; `image_url: text?`; `author_id: uuid?`; `target_team_ids: _uuid?`; `is_important: boolean!`; `is_published: boolean!`; `published_at: timestamp with time zone!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `chat_posted_at: timestamp with time zone?`; `attachments: jsonb!`; `target_mini_league_id: uuid?`; `target_competition_id: uuid?`.
- `club_news_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_news_pkey`: `PRIMARY KEY (id)`
- `club_news_target_competition_id_fkey`: `FOREIGN KEY (target_competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `club_news_target_mini_league_id_fkey`: `FOREIGN KEY (target_mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
Evidence: supabase/functions/auto-post-news-to-chat/index.ts:156; supabase/functions/auto-post-news-to-chat/index.ts:167; supabase/functions/auto-post-news-to-chat/index.ts:250.

#### club_players
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `profile_id: uuid?`; `child_id: uuid?`; `display_name: text!`; `date_of_birth: date?`; `preferred_position: text?`; `medical_notes: text?`; `contact_notes: text?`; `is_active: boolean!`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `club_players_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE SET NULL`
- `club_players_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_players_identity_check`: `CHECK (((profile_id IS NOT NULL) OR (child_id IS NOT NULL)))`
- `club_players_pkey`: `PRIMARY KEY (id)`
- `club_players_profile_id_fkey`: `FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE SET NULL`
- `club_players_unique_child`: `UNIQUE (club_id, child_id)`
- `club_players_unique_profile`: `UNIQUE (club_id, profile_id)`
Evidence: frontend/src/hooks/useNotificationClubSwitch.ts:128; frontend/src/components/layout/AppHeader.tsx:451; frontend/src/components/seasons/DraftTeamBuilder.tsx:105.

#### club_rewards
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `name: text!`; `description: text?`; `points_required: integer!`; `is_default: boolean!`; `is_active: boolean!`; `logo_url: text?`; `reward_type: text!`; `qr_code_url: text?`; `show_qr_code: boolean!`; `sponsor_id: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `team_id: uuid?`.
- `club_rewards_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_rewards_pkey`: `PRIMARY KEY (id)`
- `club_rewards_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL`
- `club_rewards_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/generate-demo-data/index.ts:924; supabase/functions/generate-demo-data/index.ts:1197; supabase/functions/generate-demo-data/index.ts:1206.

#### club_stripe_configs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `stripe_secret_key: text!`; `stripe_publishable_key: text!`; `is_enabled: boolean?`; `created_at: timestamp with time zone?`; `updated_at: timestamp with time zone?`; `stripe_secret_key_encrypted: text?`; `stripe_publishable_key_encrypted: text?`.
- `club_stripe_configs_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_stripe_configs_club_id_key`: `UNIQUE (club_id)`
- `club_stripe_configs_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/cancel-subscription/index.ts:146; supabase/functions/confirm-event-payment/index.ts:239; supabase/functions/create-event-checkout/index.ts:191.

#### club_subscriptions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `plan: club_subscription_plan!`; `is_pro: boolean!`; `is_pro_football: boolean!`; `team_limit: integer?`; `promo_code_id: uuid?`; `activated_at: timestamp with time zone?`; `expires_at: timestamp with time zone?`; `stripe_subscription_id: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `storage_purchased_gb: integer!`; `member_payments_enabled: boolean!`; `member_subscription_amount: numeric?`; `admin_pro_override: boolean!`; `admin_pro_football_override: boolean!`; `scheduled_storage_downgrade_gb: integer?`; `storage_downgrade_at: timestamp with time zone?`; `is_trial: boolean!`; `trial_ends_at: timestamp with time zone?`; `trial_tier: text?`; `trial_plan: text?`; `trial_is_annual: boolean?`; `disable_team_pom_rewards: boolean!`; `disable_points_system: boolean!`; `cancelled_at: timestamp with time zone?`; `last_stripe_event_id: text?`; `last_stripe_event_at: timestamp with time zone?`.
- `club_subscriptions_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `club_subscriptions_club_id_key`: `UNIQUE (club_id)`
- `club_subscriptions_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-default-rsvp-confirm-cron/index.ts:191; supabase/functions/auto-rsvp-dm-cron/index.ts:241; supabase/functions/auto-rsvp-push-cron/index.ts:174.

#### clubs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `name: text!`; `logo_url: text?`; `description: text?`; `is_pro: boolean!`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `sport: text?`; `storage_used_bytes: bigint!`; `auto_reward_threshold: integer?`; `primary_sponsor_id: uuid?`; `theme_primary_h: integer?`; `theme_primary_s: integer?`; `theme_primary_l: integer?`; `theme_secondary_h: integer?`; `theme_secondary_s: integer?`; `theme_secondary_l: integer?`; `theme_accent_h: integer?`; `theme_accent_s: integer?`; `theme_accent_l: integer?`; `show_logo_in_header: boolean!`; `show_name_in_header: boolean?`; `logo_only_mode: boolean?`; `theme_dark_primary_h: integer?`; `theme_dark_primary_s: integer?`; `theme_dark_primary_l: integer?`; `theme_dark_secondary_h: integer?`; `theme_dark_secondary_s: integer?`; `theme_dark_secondary_l: integer?`; `theme_dark_accent_h: integer?`; `theme_dark_accent_s: integer?`; `theme_dark_accent_l: integer?`; `theme_enabled: boolean!`; `class_mode_enabled: boolean!`; `city: text?`; `state: text?`; `latitude: double precision?`; `longitude: double precision?`; `member_count: integer?`; `team_count: integer?`; `sponsorship_pitch: text?`; `proposed_tier: text?`; `listed_on_marketplace: boolean!`; `notify_committee: boolean!`; `notify_committee_chat: boolean!`; `recognition_silver_threshold: numeric!`; `recognition_gold_threshold: numeric!`; `stripe_customer_id: text?`; `stripe_subscription_id: text?`; `stripe_connect_account_id: text?`; `stripe_connect_onboarding_complete: boolean!`; `subscription_status: text!`; `subscription_expiry: timestamp with time zone?`; `subscription_source: text?`; `member_payments_enabled: boolean!`; `admin_user_id: uuid?`; `seeking_advertiser: boolean!`; `allow_guests_default: boolean!`; `max_guests_per_member_default: integer!`; `points_display_name: text?`; `points_icon_url: text?`; `contact_email: text?`; `deleted_at: timestamp with time zone?`; `deleted_by: uuid?`; `bot_user_id: uuid?`; `current_season_id: uuid?`; `kind: text!`; `parent_org_id: uuid?`; `playhq_org_id: text?`; `playhq_tenant: text?`; `chat_thread_ads_enabled: boolean!`; `media_sponsors_enabled: boolean!`; `media_header_sponsors_enabled: boolean!`; `events_sponsor_strip_enabled: boolean!`; `force_disable_message_previews: boolean!`; `ai_catch_up_enabled: boolean!`; `last_message_id: uuid?`; `last_message_text: text?`; `last_message_at: timestamp with time zone?`; `last_message_author_id: uuid?`; `last_message_author_name: text?`; `last_message_image_url: text?`; `purged_at: timestamp with time zone?`; `purged_by: uuid?`; `invite_email_style: text!`; `invite_email_message: text?`.
- `clubs_bot_user_id_fkey`: `FOREIGN KEY (bot_user_id) REFERENCES auth.users(id)`
- `clubs_current_season_id_fkey`: `FOREIGN KEY (current_season_id) REFERENCES seasons(id) ON DELETE SET NULL`
- `clubs_invite_email_style_check`: `CHECK ((invite_email_style = ANY (ARRAY['detailed'::text, 'simple'::text, 'discover'::text])))`
- `clubs_kind_check`: `CHECK ((kind = ANY (ARRAY['full'::text, 'shell'::text, 'association'::text])))`
- `clubs_parent_org_id_fkey`: `FOREIGN KEY (parent_org_id) REFERENCES clubs(id) ON DELETE SET NULL`
- `clubs_pkey`: `PRIMARY KEY (id)`
- `clubs_primary_sponsor_id_fkey`: `FOREIGN KEY (primary_sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL`
Evidence: supabase/functions/_shared/clubChatBot.ts:36; supabase/functions/_shared/clubChatBot.ts:68; supabase/functions/_shared/clubChatBot.ts:94.

#### comment_reports
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `comment_id: uuid!`; `reporter_id: uuid!`; `reason: text!`; `additional_details: text?`; `status: text!`; `reviewed_at: timestamp with time zone?`; `reviewed_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `comment_reports_comment_id_fkey`: `FOREIGN KEY (comment_id) REFERENCES photo_comments(id) ON DELETE CASCADE`
- `comment_reports_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:393; supabase/functions/cleanup-deleted-accounts/index.ts:154; supabase/functions/send-comment-report-email/index.ts:94.

#### competition_admin_conversations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `member_user_id: uuid!`; `last_message_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `competition_admin_conversatio_competition_id_member_user_id_key`: `UNIQUE (competition_id, member_user_id)`
- `competition_admin_conversations_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_admin_conversations_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/pages/CompetitionAdminChatPage.tsx:57.

#### competition_admin_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `conversation_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `is_admin_reply: boolean!`; `created_at: timestamp with time zone!`.
- `competition_admin_messages_conversation_id_fkey`: `FOREIGN KEY (conversation_id) REFERENCES competition_admin_conversations(id) ON DELETE CASCADE`
- `competition_admin_messages_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/pages/CompetitionAdminChatPage.tsx:72; frontend/src/pages/CompetitionAdminChatPage.tsx:114.

#### competition_broadcasts
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `sent_by: uuid!`; `message: text!`; `division_ids: _uuid?`; `team_ids: _uuid!`; `recipient_team_count: integer!`; `created_at: timestamp with time zone!`.
- `competition_broadcasts_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_broadcasts_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-competition-broadcast/index.ts:140; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1837; frontend/src/pages/CompetitionDetailPage.tsx:1299.

#### competition_divisions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `name: text!`; `age_group: text?`; `gender: text?`; `skill_level: text?`; `sort_order: integer!`; `max_entries: integer?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `hide_ladder: boolean!`; `play_weekdays: _int4?`; `day_start_time: time without time zone!`; `day_end_time: time without time zone!`; `source: text!`; `external_id: text?`; `hide_scores: boolean!`.
- `competition_divisions_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_divisions_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/pages/CompetitionDetailPage.tsx:375; frontend/src/pages/CompetitionDetailPage.tsx:2088; frontend/src/pages/CompetitionSettingsPage.tsx:724.

#### competition_entries
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `division_id: uuid?`; `team_id: uuid!`; `status: text!`; `invited_by: uuid?`; `responded_by: uuid?`; `responded_at: timestamp with time zone?`; `notes: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `competition_entries_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_entries_competition_id_team_id_key`: `UNIQUE (competition_id, team_id)`
- `competition_entries_division_id_fkey`: `FOREIGN KEY (division_id) REFERENCES competition_divisions(id) ON DELETE SET NULL`
- `competition_entries_pkey`: `PRIMARY KEY (id)`
- `competition_entries_status_check`: `CHECK ((status = ANY (ARRAY['invited'::text, 'accepted'::text, 'declined'::text, 'withdrawn'::text, 'removed'::text])))`
- `competition_entries_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/send-competition-broadcast/index.ts:52; supabase/functions/send-email/index.ts:136; frontend/src/components/CompetitionFixturesPanel.tsx:2054.

#### competition_ladder
Code usage: no literal reference; possible SQL/internal use.
Columns: `competition_id: uuid?`; `division_id: uuid?`; `team_id: uuid?`; `played: integer?`; `wins: integer?`; `draws: integer?`; `losses: integer?`; `goals_for: integer?`; `goals_against: integer?`; `goal_diff: integer?`; `points: integer?`.

#### competition_match_results
Code usage: literal frontend/edge reference.
Columns: `match_id: uuid!`; `home_score: integer?`; `away_score: integer?`; `entered_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `competition_match_results_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES competition_matches(id) ON DELETE CASCADE`
- `competition_match_results_pkey`: `PRIMARY KEY (match_id)`
Evidence: supabase/functions/playhq-sync/index.ts:261.

#### competition_matches
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `division_id: uuid?`; `round_number: integer?`; `home_team_id: uuid?`; `away_team_id: uuid?`; `scheduled_at: timestamp with time zone?`; `venue: text?`; `status: text!`; `notes: text?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `home_event_id: uuid?`; `away_event_id: uuid?`; `duration_minutes: integer?`; `arrival_minutes_before: integer?`; `pitch_number: text?`; `source: text!`; `external_id: text?`; `external_home_team_id: text?`; `external_away_team_id: text?`; `home_team_name: text?`; `away_team_name: text?`; `manually_overridden_at: timestamp with time zone?`; `last_synced_at: timestamp with time zone?`.
- `competition_matches_away_event_id_fkey`: `FOREIGN KEY (away_event_id) REFERENCES events(id) ON DELETE SET NULL`
- `competition_matches_away_team_id_fkey`: `FOREIGN KEY (away_team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `competition_matches_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_matches_division_id_fkey`: `FOREIGN KEY (division_id) REFERENCES competition_divisions(id) ON DELETE SET NULL`
- `competition_matches_home_event_id_fkey`: `FOREIGN KEY (home_event_id) REFERENCES events(id) ON DELETE SET NULL`
- `competition_matches_home_team_id_fkey`: `FOREIGN KEY (home_team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `competition_matches_pkey`: `PRIMARY KEY (id)`
- `competition_matches_status_check`: `CHECK ((status = ANY (ARRAY['scheduled'::text, 'in_progress'::text, 'completed'::text, 'postponed'::text, 'cancelled'::text])))`
- `competition_matches_teams_check`: `CHECK ((home_team_id <> away_team_id))`
Evidence: supabase/functions/playhq-materialise-team-events/index.ts:63; supabase/functions/playhq-materialise-team-events/index.ts:153; supabase/functions/playhq-sync/index.ts:237.

#### competition_role_invites
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `email: text!`; `invited_name: text?`; `role: text!`; `invited_by: uuid!`; `status: text!`; `accepted_user_id: uuid?`; `accepted_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `competition_role_invites_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_role_invites_pkey`: `PRIMARY KEY (id)`
- `competition_role_invites_role_chk`: `CHECK ((role = ANY (ARRAY['referee'::text, 'committee'::text])))`
- `competition_role_invites_status_chk`: `CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text])))`
Evidence: frontend/src/components/competitions/CompetitionOfficialsCard.tsx:265; frontend/src/components/competitions/CompetitionOfficialsCard.tsx:330.

#### competition_role_links
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `role: text!`; `token: text!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `expires_at: timestamp with time zone?`; `max_uses: integer?`; `use_count: integer!`.
- `competition_role_links_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_role_links_pkey`: `PRIMARY KEY (id)`
- `competition_role_links_role_check`: `CHECK ((role = ANY (ARRAY['referee'::text, 'committee'::text])))`
- `competition_role_links_token_key`: `UNIQUE (token)`
Evidence: frontend/src/components/competitions/CompetitionOfficialJoinLinksCard.tsx:65; frontend/src/components/competitions/CompetitionOfficialJoinLinksCard.tsx:89; frontend/src/components/competitions/CompetitionOfficialJoinLinksCard.tsx:92.

#### competition_roles
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `competition_id: uuid!`; `user_id: uuid!`; `role: text!`; `created_at: timestamp with time zone!`.
- `competition_roles_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `competition_roles_competition_id_user_id_role_key`: `UNIQUE (competition_id, user_id, role)`
- `competition_roles_pkey`: `PRIMARY KEY (id)`
- `competition_roles_role_check`: `CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'referee'::text, 'scorer'::text, 'committee'::text])))`
Evidence: frontend/src/components/HomeInviteFlow.tsx:124; frontend/src/lib/competitionViewerScope.ts:31; frontend/src/features/news/useClubNews.ts:388.

#### competitions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `organizer_club_id: uuid!`; `name: text!`; `slug: text?`; `sport: text?`; `description: text?`; `season: text?`; `starts_on: date?`; `ends_on: date?`; `status: text!`; `visibility: text!`; `logo_url: text?`; `contact_email: text?`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `points_win: integer!`; `points_draw: integer!`; `points_loss: integer!`; `join_token: uuid?`; `join_token_enabled: boolean!`; `source: text!`; `external_id: text?`; `external_tenant: text?`; `last_synced_at: timestamp with time zone?`; `member_chat_enabled: boolean!`; `member_chat_admins_only: boolean!`; `invite_email_message: text?`; `player_welcome_message: text?`; `code_of_conduct_path: text?`; `code_of_conduct_name: text?`; `hide_ladder: boolean!`; `hide_scores: boolean!`.
- `competitions_organizer_club_id_fkey`: `FOREIGN KEY (organizer_club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `competitions_pkey`: `PRIMARY KEY (id)`
- `competitions_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'open'::text, 'active'::text, 'completed'::text, 'archived'::text])))`
- `competitions_visibility_check`: `CHECK ((visibility = ANY (ARRAY['private'::text, 'unlisted'::text, 'public'::text])))`
Evidence: supabase/functions/playhq-sync-club/index.ts:157; supabase/functions/playhq-sync-cron/index.ts:17; supabase/functions/playhq-sync/index.ts:173.

#### cron_locks
Code usage: generated contract only.
Columns: `key: text!`; `acquired_at: timestamp with time zone!`; `expires_at: timestamp with time zone!`.
- `cron_locks_pkey`: `PRIMARY KEY (key)`

#### default_rollover_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `default_id: uuid!`; `notified_at: timestamp with time zone!`.
- `default_rollover_log_default_id_fkey`: `FOREIGN KEY (default_id) REFERENCES child_training_defaults(id) ON DELETE CASCADE`
- `default_rollover_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:147; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:155.

#### direct_conversations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `participant_1: uuid!`; `participant_2: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `created_by: uuid?`.
- `direct_conversations_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL`
- `direct_conversations_participant_1_fkey`: `FOREIGN KEY (participant_1) REFERENCES profiles(id) ON DELETE CASCADE`
- `direct_conversations_participant_2_fkey`: `FOREIGN KEY (participant_2) REFERENCES profiles(id) ON DELETE CASCADE`
- `direct_conversations_pkey`: `PRIMARY KEY (id)`
- `ordered_participants`: `CHECK ((participant_1 < participant_2))`
- `unique_participants`: `UNIQUE (participant_1, participant_2)`
Evidence: supabase/functions/admin-delete-account/index.ts:448; supabase/functions/admin-delete-account/index.ts:453; supabase/functions/auto-default-rsvp-confirm-cron/index.ts:108.

#### direct_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `conversation_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `is_system_message: boolean?`; `forwarded_from_user_id: uuid?`; `forwarded_at: timestamp with time zone?`; `forwarded_source_label: text?`; `edited_at: timestamp with time zone?`.
- `direct_messages_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES profiles(id) ON DELETE CASCADE`
- `direct_messages_conversation_id_fkey`: `FOREIGN KEY (conversation_id) REFERENCES direct_conversations(id) ON DELETE CASCADE`
- `direct_messages_pkey`: `PRIMARY KEY (id)`
- `direct_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES direct_messages(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:432; supabase/functions/auto-default-rsvp-confirm-cron/index.ts:297; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:60.

#### dispatch_bootstrap_tokens
Code usage: generated contract only.
Columns: `token: text!`; `expires_at: timestamp with time zone!`; `used_at: timestamp with time zone?`; `created_at: timestamp with time zone!`.
- `dispatch_bootstrap_tokens_pkey`: `PRIMARY KEY (token)`

#### dispatch_repair_attempts
Code usage: generated contract only.
Columns: `id: uuid!`; `request_id: bigint!`; `status: text!`; `attempt_count: integer!`; `created_at: timestamp with time zone!`; `deadline_at: timestamp with time zone!`; `checked_at: timestamp with time zone?`; `completed_at: timestamp with time zone?`; `failure_reason: text?`.
- `dispatch_repair_attempts_pkey`: `PRIMARY KEY (id)`
- `dispatch_repair_attempts_status_chk`: `CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'failed'::text])))`

#### dm_attachment_restrictions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `scope: text!`; `club_id: uuid?`; `user_id: uuid?`; `created_at: timestamp with time zone!`; `created_by: uuid?`.
- `dm_attachment_restrictions_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `dm_attachment_restrictions_pkey`: `PRIMARY KEY (id)`
- `dm_attachment_restrictions_scope_check`: `CHECK ((scope = ANY (ARRAY['club'::text, 'user'::text])))`
- `dm_restriction_scope_check`: `CHECK ((((scope = 'club'::text) AND (club_id IS NOT NULL) AND (user_id IS NULL)) OR ((scope = 'user'::text) AND (user_id IS NOT NULL) AND (club_id IS NULL))))`
Evidence: frontend/src/pages/AdminDmAttachmentsPage.tsx:55; frontend/src/pages/AdminDmAttachmentsPage.tsx:141; frontend/src/pages/AdminDmAttachmentsPage.tsx:162.

#### drill_frames
Code usage: generated contract only.
Columns: `id: uuid!`; `drill_id: uuid!`; `position: integer!`; `duration_ms: integer!`; `notes: text?`; `objects: jsonb!`; `annotations: jsonb!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `drill_frames_drill_id_fkey`: `FOREIGN KEY (drill_id) REFERENCES drills(id) ON DELETE CASCADE`
- `drill_frames_drill_id_position_key`: `UNIQUE (drill_id, "position")`
- `drill_frames_pkey`: `PRIMARY KEY (id)`

#### drill_recent_uses
Code usage: generated contract only.
Columns: `user_id: uuid!`; `drill_id: uuid!`; `last_used_at: timestamp with time zone!`.
- `drill_recent_uses_drill_id_fkey`: `FOREIGN KEY (drill_id) REFERENCES drills(id) ON DELETE CASCADE`
- `drill_recent_uses_pkey`: `PRIMARY KEY (user_id, drill_id)`

#### drills
Code usage: generated contract only.
Columns: `id: uuid!`; `owner_user_id: uuid!`; `team_id: uuid?`; `club_id: uuid?`; `name: text!`; `description: text?`; `age_group: text?`; `focus: _text!`; `duration_minutes: integer?`; `players_required: integer?`; `equipment: _text!`; `coaching_points: _text!`; `progression: text?`; `regression: text?`; `tags: _text!`; `visibility: text!`; `pitch_size: text!`; `thumbnail_url: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `is_official: boolean!`.
- `drills_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL`
- `drills_pkey`: `PRIMARY KEY (id)`
- `drills_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL`
- `drills_visibility_check`: `CHECK ((visibility = ANY (ARRAY['private'::text, 'team'::text, 'club'::text, 'official'::text])))`

#### duties
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `name: text!`; `assigned_to: uuid?`; `status: duty_status!`; `points: integer?`; `points_awarded: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `completed_at: timestamp with time zone?`; `start_time: timestamp with time zone?`; `end_time: timestamp with time zone?`.
- `duties_assigned_to_fkey`: `FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL`
- `duties_assigned_to_profiles_fkey`: `FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL`
- `duties_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `duties_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:530; supabase/functions/check-pending-subs/index.ts:117; supabase/functions/cleanup-deleted-accounts/index.ts:149.

#### engagement_reminder_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `sent_at: timestamp with time zone!`; `unread_messages_count: integer!`; `unread_photos_count: integer!`.
- `engagement_reminder_log_pkey`: `PRIMARY KEY (id)`
- `engagement_reminder_log_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/send-engagement-reminders/index.ts:226.

#### eoi_form_views
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `season_id: uuid!`; `club_id: uuid!`; `source: text!`; `viewed_at: timestamp with time zone!`.
- `eoi_form_views_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `eoi_form_views_pkey`: `PRIMARY KEY (id)`
- `eoi_form_views_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE`
Evidence: frontend/src/pages/PublicEoiFormPage.tsx:95.

#### eoi_submissions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `season_id: uuid!`; `parent_user_id: uuid?`; `child_id: uuid?`; `assigned_team_id: uuid?`; `parent_name: text!`; `parent_email: text!`; `parent_mobile: text?`; `player_name: text!`; `player_dob: date?`; `player_gender: text?`; `age_group: text?`; `preferred_teammates: text?`; `preferred_position: text?`; `skill_level: smallint?`; `notes: text?`; `returning_player: boolean!`; `training_days: _text!`; `game_days: _text!`; `status: eoi_status!`; `source: eoi_source!`; `claim_token: text!`; `claimed_at: timestamp with time zone?`; `submitted_at: timestamp with time zone!`; `allocated_at: timestamp with time zone?`; `confirmed_at: timestamp with time zone?`; `registered_at: timestamp with time zone?`; `withdrawn_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `invite_sent_at: timestamp with time zone?`; `invite_sent_count: integer!`; `parent_confirmed_at: timestamp with time zone?`; `extra_notes: text?`.
- `eoi_submissions_assigned_team_id_fkey`: `FOREIGN KEY (assigned_team_id) REFERENCES teams(id) ON DELETE SET NULL`
- `eoi_submissions_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE SET NULL`
- `eoi_submissions_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `eoi_submissions_parent_user_id_fkey`: `FOREIGN KEY (parent_user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
- `eoi_submissions_pkey`: `PRIMARY KEY (id)`
- `eoi_submissions_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE`
- `eoi_submissions_skill_level_check`: `CHECK (((skill_level IS NULL) OR ((skill_level >= 1) AND (skill_level <= 5))))`
Evidence: supabase/functions/eoi-webhook/index.ts:114; supabase/functions/send-eoi-invite/index.ts:40; supabase/functions/send-eoi-invite/index.ts:118.

#### event_auto_dm_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid!`; `cadence: text!`; `sent_at: timestamp with time zone!`; `dm_message_id: uuid?`.
- `event_auto_dm_log_cadence_check`: `CHECK ((cadence = ANY (ARRAY['t72'::text, 't24'::text, 't3'::text])))`
- `event_auto_dm_log_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_auto_dm_log_event_id_user_id_cadence_key`: `UNIQUE (event_id, user_id, cadence)`
- `event_auto_dm_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-rsvp-dm-cron/index.ts:278; supabase/functions/auto-rsvp-dm-cron/index.ts:332.

#### event_auto_push_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid!`; `cadence: text!`; `sent_at: timestamp with time zone!`; `notification_id: uuid?`.
- `event_auto_push_log_cadence_check`: `CHECK ((cadence = ANY (ARRAY['t6d'::text, 't48h'::text, 't6h'::text])))`
- `event_auto_push_log_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_auto_push_log_event_id_user_id_cadence_key`: `UNIQUE (event_id, user_id, cadence)`
- `event_auto_push_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-rsvp-push-cron/index.ts:210; supabase/functions/auto-rsvp-push-cron/index.ts:258.

#### event_default_confirm_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `parent_user_id: uuid!`; `child_id: uuid?`; `rsvp_id: uuid?`; `dm_message_id: uuid?`; `sent_at: timestamp with time zone!`.
- `event_default_confirm_log_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_default_confirm_log_pkey`: `PRIMARY KEY (id)`
- `event_default_confirm_log_rsvp_id_fkey`: `FOREIGN KEY (rsvp_id) REFERENCES rsvps(id) ON DELETE CASCADE`
Evidence: supabase/functions/auto-default-rsvp-confirm-cron/index.ts:265; supabase/functions/auto-default-rsvp-confirm-cron/index.ts:311.

#### event_group_duties
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `name: text!`; `assigned_to: uuid?`; `status: text!`; `points: integer?`; `points_awarded: boolean?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `event_group_duties_assigned_to_fkey`: `FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL`
- `event_group_duties_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES event_groups(id) ON DELETE CASCADE`
- `event_group_duties_pkey`: `PRIMARY KEY (id)`
- `event_group_duties_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text])))`
Evidence: supabase/functions/admin-delete-account/index.ts:378; supabase/functions/check-pending-subs/index.ts:59; supabase/functions/cleanup-deleted-accounts/index.ts:150.

#### event_group_players
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `player_id: uuid!`; `created_at: timestamp with time zone!`; `team: text?`; `event_id: uuid!`.
- `event_group_players_event_id_player_id_key`: `UNIQUE (event_id, player_id)`
- `event_group_players_group_event_fkey`: `FOREIGN KEY (group_id, event_id) REFERENCES event_groups(id, event_id) ON UPDATE CASCADE ON DELETE CASCADE`
- `event_group_players_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES event_groups(id) ON DELETE CASCADE`
- `event_group_players_group_id_player_id_key`: `UNIQUE (group_id, player_id)`
- `event_group_players_pkey`: `PRIMARY KEY (id)`
- `event_group_players_player_id_fkey`: `FOREIGN KEY (player_id) REFERENCES mini_league_players(id) ON DELETE CASCADE`
- `event_group_players_team_check`: `CHECK ((team = ANY (ARRAY['a'::text, 'b'::text])))`
Evidence: frontend/src/components/EventGroupsManager.tsx:149; frontend/src/components/EventGroupsManager.tsx:729; frontend/src/components/EventGroupsManager.tsx:870.

#### event_groups
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `name: text!`; `ability_band: text?`; `pitch_name: text?`; `pitch_state: jsonb?`; `timer_state: jsonb?`; `display_order: integer?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `team_a_color: text?`; `team_b_color: text?`.
- `event_groups_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_groups_id_event_id_key`: `UNIQUE (id, event_id)`
- `event_groups_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/EventGroupsManager.tsx:140; frontend/src/components/EventGroupsManager.tsx:712; frontend/src/components/EventGroupsManager.tsx:858.

#### event_guests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `added_by: uuid!`; `guest_name: text!`; `created_at: timestamp with time zone!`.
- `event_guests_added_by_fkey`: `FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `event_guests_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_guests_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/EventGuestsManager.tsx:78; frontend/src/components/EventGuestsManager.tsx:125; frontend/src/components/EventGuestsManager.tsx:154.

#### event_lineups
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `team_id: uuid!`; `lineup: jsonb!`; `updated_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `event_lineups_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_lineups_event_team_unique`: `UNIQUE (event_id, team_id)`
- `event_lineups_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/pitch/eventLineupRepository.ts:136; frontend/src/components/pitch/eventLineupRepository.ts:196.

#### event_payments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid!`; `amount: numeric!`; `payment_status: text!`; `stripe_payment_intent_id: text?`; `paid_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `event_payments_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_payments_event_id_user_id_key`: `UNIQUE (event_id, user_id)`
- `event_payments_pkey`: `PRIMARY KEY (id)`
- `event_payments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/confirm-event-payment/index.ts:332; supabase/functions/confirm-event-payment/index.ts:347; supabase/functions/create-event-checkout/index.ts:166.

#### event_reminder_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `sent_by: uuid!`; `sent_at: timestamp with time zone!`; `recipients_count: integer!`; `channels: text!`; `pushes_sent: integer!`; `emails_sent: integer!`; `recipient_user_ids: _uuid!`.
- `event_reminder_log_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_reminder_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-event-view-reminder/index.ts:277; supabase/functions/send-event-view-reminder/index.ts:541; frontend/src/components/event/AttendanceSection.tsx:146.

#### event_session_drills
Code usage: generated contract only.
Columns: `id: uuid!`; `event_id: uuid!`; `drill_id: uuid!`; `position: integer!`; `added_by: uuid!`; `added_at: timestamp with time zone!`.
- `event_session_drills_drill_id_fkey`: `FOREIGN KEY (drill_id) REFERENCES drills(id) ON DELETE CASCADE`
- `event_session_drills_event_id_drill_id_key`: `UNIQUE (event_id, drill_id)`
- `event_session_drills_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_session_drills_pkey`: `PRIMARY KEY (id)`

#### event_sponsors
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `sponsor_id: uuid!`; `display_order: integer!`; `created_at: timestamp with time zone!`.
- `event_sponsors_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_sponsors_event_id_sponsor_id_key`: `UNIQUE (event_id, sponsor_id)`
- `event_sponsors_pkey`: `PRIMARY KEY (id)`
- `event_sponsors_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE`
Evidence: supabase/functions/vault-backup/index.ts:231; frontend/src/components/EventSponsorSelector.tsx:64; frontend/src/components/EventSponsorSelector.tsx:96.

#### event_views
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid!`; `viewed_at: timestamp with time zone!`.
- `event_views_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `event_views_event_id_user_id_key`: `UNIQUE (event_id, user_id)`
- `event_views_pkey`: `PRIMARY KEY (id)`
- `event_views_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/hooks/useEventViews.ts:33; frontend/src/hooks/useEventViews.ts:64; frontend/src/hooks/useEventViews.ts:107.

#### events
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `team_id: uuid?`; `title: text!`; `description: text?`; `event_date: timestamp with time zone!`; `location: text?`; `location_name: text?`; `type: event_type!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `is_cancelled: boolean!`; `opponent: text?`; `is_home_game: boolean?`; `final_score_home: integer?`; `final_score_away: integer?`; `player_of_match: uuid?`; `parent_event_id: uuid?`; `recurrence_rule: text?`; `recurrence_end_date: timestamp with time zone?`; `meet_time: timestamp with time zone?`; `start_time: timestamp with time zone?`; `end_time: timestamp with time zone?`; `preview_image_url: text?`; `amount: numeric?`; `requires_payment: boolean?`; `reminder_hours_before: integer?`; `reminder_sent: boolean?`; `address: text?`; `suburb: text?`; `state: text?`; `postcode: text?`; `is_recurring: boolean?`; `mini_league_id: uuid?`; `allow_guests: boolean?`; `max_guests_per_member: integer?`; `points_reminder_sent: boolean?`; `arrival_minutes_before: integer?`; `coach_note: text?`; `coach_note_author: uuid?`; `coach_note_updated_at: timestamp with time zone?`; `chat_post_message_id: uuid?`; `is_bye: boolean!`; `competition_match_id: uuid?`; `competition_side: text?`; `rsvp_audience: text?`; `chat_cancel_post_handled: boolean!`; `restricted_to_roles: _app_role?`; `association_id: uuid?`; `association_event_id: uuid?`; `adults_only: boolean!`; `rsvp_grouping: text?`; `target_team_ids: _uuid?`; `notify_suppressed: boolean!`; `competition_id: uuid?`; `duty_team_id: uuid?`; `duty_team_label: text?`.
- `events_arrival_minutes_before_range`: `CHECK (((arrival_minutes_before IS NULL) OR ((arrival_minutes_before >= 0) AND (arrival_minutes_before <= 480))))`
- `events_association_event_id_fkey`: `FOREIGN KEY (association_event_id) REFERENCES events(id) ON DELETE CASCADE`
- `events_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `events_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL`
- `events_competition_match_id_fkey`: `FOREIGN KEY (competition_match_id) REFERENCES competition_matches(id) ON DELETE CASCADE`
- `events_competition_side_check`: `CHECK ((competition_side = ANY (ARRAY['home'::text, 'away'::text])))`
- `events_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE SET NULL`
- `events_parent_event_id_fkey`: `FOREIGN KEY (parent_event_id) REFERENCES events(id) ON DELETE CASCADE`
- `events_pkey`: `PRIMARY KEY (id)`
- `events_rsvp_audience_check`: `CHECK (((rsvp_audience IS NULL) OR (rsvp_audience = ANY (ARRAY['players_only'::text, 'players_and_parents'::text, 'parents_only'::text]))))`
- `events_rsvp_grouping_check`: `CHECK (((rsvp_grouping IS NULL) OR (rsvp_grouping = ANY (ARRAY['level'::text, 'team'::text]))))`
- `events_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/auto-default-rsvp-confirm-cron/index.ts:154; supabase/functions/auto-post-event-to-chat/index.ts:61; supabase/functions/auto-post-event-to-chat/index.ts:186.

#### favorite_event_titles
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `title: text!`; `created_at: timestamp with time zone!`; `event_type: text?`.
- `favorite_event_titles_pkey`: `PRIMARY KEY (id)`
- `favorite_event_titles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `favorite_event_titles_user_id_title_key`: `UNIQUE (user_id, title)`
Evidence: frontend/src/pages/CreateEventPage.tsx:822; frontend/src/pages/CreateEventPage.tsx:850; frontend/src/pages/CreateEventPage.tsx:887.

#### favorite_opponents
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `opponent_name: text!`; `club_id: uuid?`; `team_id: uuid?`; `created_at: timestamp with time zone!`.
- `favorite_opponents_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `favorite_opponents_pkey`: `PRIMARY KEY (id)`
- `favorite_opponents_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `favorite_opponents_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `favorite_opponents_user_id_opponent_name_club_id_key`: `UNIQUE (user_id, opponent_name, club_id)`
- `favorite_opponents_user_id_opponent_name_team_id_key`: `UNIQUE (user_id, opponent_name, team_id)`
Evidence: frontend/src/components/OpponentInput.tsx:50; frontend/src/components/OpponentInput.tsx:82; frontend/src/components/OpponentInput.tsx:104.

#### fcm_tokens
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `token: text!`; `platform: text!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `app_version: text?`; `build_number: text?`.
- `fcm_tokens_pkey`: `PRIMARY KEY (id)`
- `fcm_tokens_platform_check`: `CHECK ((platform = ANY (ARRAY['android'::text, 'ios'::text])))`
- `fcm_tokens_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `fcm_tokens_user_id_token_key`: `UNIQUE (user_id, token)`
Evidence: supabase/functions/send-event-view-reminder/index.ts:495; supabase/functions/send-fcm-notification/index.ts:193; supabase/functions/send-fcm-notification/index.ts:211.

#### feedback
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `type: text!`; `message: text!`; `page_url: text?`; `status: feedback_status!`; `admin_notes: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `title: text?`; `description: text?`.
- `feedback_pkey`: `PRIMARY KEY (id)`
- `feedback_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `feedback_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/export-user-data/index.ts:232; frontend/src/components/FeedbackDialog.tsx:59; frontend/src/pages/ManageFeedbackPage.tsx:100.

#### file_deletion_logs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `file_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `file_url: text?`; `file_size: bigint?`; `file_name: text?`; `deleted_by: uuid!`; `deletion_type: text!`; `deleted_at: timestamp with time zone!`; `original_created_at: timestamp with time zone?`; `original_uploaded_by: uuid?`.
- `file_deletion_logs_deletion_type_check`: `CHECK ((deletion_type = ANY (ARRAY['permanent'::text, 'soft'::text, 'auto_purge'::text])))`
- `file_deletion_logs_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-purge-trash/index.ts:158.

#### gallery_chat_cards
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `uploader_id: uuid!`; `message_id: uuid!`; `event_id: uuid?`; `hero_photo_id: uuid?`; `hero_image_url: text?`; `photo_ids: _uuid!`; `photo_count: integer!`; `push_sent: boolean!`; `is_prompt: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `gallery_chat_cards_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL`
- `gallery_chat_cards_hero_photo_id_fkey`: `FOREIGN KEY (hero_photo_id) REFERENCES photos(id) ON DELETE SET NULL`
- `gallery_chat_cards_message_id_fkey`: `FOREIGN KEY (message_id) REFERENCES team_messages(id) ON DELETE CASCADE`
- `gallery_chat_cards_pkey`: `PRIMARY KEY (id)`
- `gallery_chat_cards_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/send-photo-prompt-followup/index.ts:34; supabase/functions/send-photo-prompt-followup/index.ts:87; supabase/functions/send-photo-prompt-followup/index.ts:120.

#### game_player_stats
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid?`; `team_id: uuid?`; `user_id: uuid?`; `child_id: uuid?`; `player_name: text?`; `position: text?`; `total_play_time_seconds: integer?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `fill_in_player_name: text?`; `jersey_number: integer?`; `total_game_time: integer?`; `minutes_played: integer?`; `positions_played: _text?`; `position_minutes: jsonb?`; `substitutions_count: integer?`; `started_on_pitch: boolean?`; `goals_scored: integer?`; `assists: integer?`.
- `game_player_stats_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `game_player_stats_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `game_player_stats_pkey`: `PRIMARY KEY (id)`
- `game_player_stats_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `game_player_stats_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `game_player_stats_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/admin-delete-account/index.ts:245; supabase/functions/cleanup-deleted-accounts/index.ts:143; supabase/functions/vault-backup/index.ts:335.

#### game_results
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `event_id: uuid?`; `sport: text!`; `home_label: text!`; `away_label: text!`; `home_score: integer!`; `away_score: integer!`; `period_scores: jsonb!`; `player_stats: jsonb!`; `mvp_player_id: text?`; `mvp_player_name: text?`; `played_at: timestamp with time zone!`; `saved_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `notes: text?`.
- `game_results_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL`
- `game_results_event_id_key`: `UNIQUE (event_id)`
- `game_results_pkey`: `PRIMARY KEY (id)`
- `game_results_sport_check`: `CHECK (((sport IS NOT NULL) AND (length(sport) > 0)))`
- `game_results_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: frontend/src/hooks/useSaveGameResult.ts:133; frontend/src/hooks/useSaveGameResult.ts:175; frontend/src/hooks/useSaveGameResult.ts:177.

#### game_summaries
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid?`; `team_id: uuid?`; `user_id: uuid?`; `pitch_state: jsonb!`; `timer_state: jsonb!`; `is_active: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `total_game_time: integer?`; `total_substitutions: integer?`; `formation_used: text?`; `half_duration: integer?`.
- `game_summaries_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `game_summaries_event_id_key`: `UNIQUE (event_id)`
- `game_summaries_pkey`: `PRIMARY KEY (id)`
- `game_summaries_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `game_summaries_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/vault-backup/index.ts:343; frontend/src/hooks/useGameStats.ts:225; frontend/src/pages/EventDetailPage.tsx:881.

#### group_members
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `user_id: uuid!`; `added_at: timestamp with time zone!`; `added_by: uuid?`.
- `group_members_added_by_fkey`: `FOREIGN KEY (added_by) REFERENCES profiles(id)`
- `group_members_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `group_members_group_id_user_id_key`: `UNIQUE (group_id, user_id)`
- `group_members_pkey`: `PRIMARY KEY (id)`
- `group_members_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/notify-join-request-decision/index.ts:69; supabase/functions/prefetch-user-data/index.ts:125; supabase/functions/process-message-notifications/index.ts:316.

#### group_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `is_system_message: boolean!`; `forwarded_from_user_id: uuid?`; `forwarded_at: timestamp with time zone?`; `forwarded_source_label: text?`; `edited_at: timestamp with time zone?`.
- `group_messages_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `group_messages_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `group_messages_pkey`: `PRIMARY KEY (id)`
- `group_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES group_messages(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:416; supabase/functions/backfill-chat-vault-groups/index.ts:189; supabase/functions/cleanup-deleted-accounts/index.ts:161.

#### hidden_chat_groups
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `group_id: uuid!`; `hidden_at: timestamp with time zone!`.
- `hidden_chat_groups_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `hidden_chat_groups_pkey`: `PRIMARY KEY (id)`
- `hidden_chat_groups_user_id_group_id_key`: `UNIQUE (user_id, group_id)`
Evidence: frontend/src/pages/MessagesPage.tsx:709; frontend/src/features/messaging/inbox/inboxRepositories.ts:1100.

#### hidden_dm_conversations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `conversation_id: uuid!`; `hidden_at: timestamp with time zone!`.
- `hidden_dm_conversations_conversation_id_fkey`: `FOREIGN KEY (conversation_id) REFERENCES direct_conversations(id) ON DELETE CASCADE`
- `hidden_dm_conversations_pkey`: `PRIMARY KEY (id)`
- `hidden_dm_conversations_user_id_conversation_id_key`: `UNIQUE (user_id, conversation_id)`
- `hidden_dm_conversations_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/pages/DirectMessagePage.tsx:1341; frontend/src/pages/MessagesPage.tsx:691; frontend/src/features/messaging/inbox/inboxRepositories.ts:1083.

#### home_open_perf
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `created_at: timestamp with time zone!`; `source: text!`; `tap_to_paint_ms: integer!`; `query_ms: integer?`; `first_paint_ms: integer?`; `cache_hit: boolean!`; `context: jsonb?`; `platform: text?`; `stages: jsonb?`; `primary_club_id: uuid?`.
- `home_open_perf_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/lib/homeOpenLatency.ts:94.

#### iap_transactions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `transaction_id: text!`; `original_transaction_id: text?`; `product_id: text!`; `platform: text!`; `entity_id: uuid!`; `entity_type: text!`; `status: text!`; `created_at: timestamp with time zone!`; `purchase_token: text?`; `environment: text?`; `verified_at: timestamp with time zone?`; `purchased_at: timestamp with time zone?`; `expires_at: timestamp with time zone?`; `store_status: text?`; `tier: text?`; `plan: text?`; `storage_gb: integer?`.
- `iap_transactions_entity_type_check`: `CHECK ((entity_type = ANY (ARRAY['club'::text, 'team'::text])))`
- `iap_transactions_pkey`: `PRIMARY KEY (id)`
- `iap_transactions_platform_check`: `CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))`
- `iap_transactions_transaction_id_key`: `UNIQUE (transaction_id)`
Evidence: supabase/functions/send-renewal-reminders/index.ts:143.

#### inbox_open_perf
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `created_at: timestamp with time zone!`; `source: text!`; `tap_to_paint_ms: integer!`; `bootstrap_ms: integer?`; `first_paint_ms: integer?`; `cache_hit: boolean!`; `bootstrap_enabled: boolean!`; `section_counts: jsonb?`; `platform: text?`; `stages: jsonb?`; `primary_club_id: uuid?`.
- `inbox_open_perf_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/lib/inboxOpenLatency.ts:149.

#### match_captains
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `assigned_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `match_captains_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `match_captains_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `match_captains_event_unique`: `UNIQUE (event_id)`
- `match_captains_pkey`: `PRIMARY KEY (id)`
- `match_captains_subject_check`: `CHECK ((((user_id IS NOT NULL) AND (child_id IS NULL)) OR ((user_id IS NULL) AND (child_id IS NOT NULL))))`
Evidence: frontend/src/components/MatchCaptainSelector.tsx:71; frontend/src/components/MatchCaptainSelector.tsx:191; frontend/src/components/MatchCaptainSelector.tsx:192.

#### match_goalkeepers
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `assigned_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `match_goalkeepers_assigned_by_fkey`: `FOREIGN KEY (assigned_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- `match_goalkeepers_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `match_goalkeepers_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `match_goalkeepers_one_target`: `CHECK ((((user_id IS NOT NULL) AND (child_id IS NULL)) OR ((user_id IS NULL) AND (child_id IS NOT NULL))))`
- `match_goalkeepers_pkey`: `PRIMARY KEY (id)`
- `match_goalkeepers_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/components/MatchGoalkeepersSelector.tsx:53; frontend/src/components/MatchGoalkeepersSelector.tsx:143; frontend/src/components/MatchGoalkeepersSelector.tsx:173.

#### match_message_reads
Code usage: generated contract only.
Columns: `id: uuid!`; `match_id: uuid!`; `user_id: uuid!`; `last_read_at: timestamp with time zone!`.
- `match_message_reads_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES business_matches(id)`
- `match_message_reads_match_id_user_id_key`: `UNIQUE (match_id, user_id)`
- `match_message_reads_pkey`: `PRIMARY KEY (id)`

#### match_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `match_id: uuid!`; `sender_id: uuid!`; `sender_type: text!`; `message: text!`; `created_at: timestamp with time zone!`.
- `match_messages_match_id_fkey`: `FOREIGN KEY (match_id) REFERENCES business_matches(id)`
- `match_messages_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:440; supabase/functions/cleanup-deleted-accounts/index.ts:164.

#### member_referrals
Code usage: generated contract only.
Columns: `id: uuid!`; `team_id: uuid!`; `referred_by: uuid!`; `referred_name: text!`; `referred_email: text?`; `referred_phone: text?`; `status: text!`; `reviewed_by: uuid?`; `reviewed_at: timestamp with time zone?`; `reject_reason: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `referred_role: text?`.
- `member_referrals_pkey`: `PRIMARY KEY (id)`
- `member_referrals_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
- `member_referrals_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`

#### member_subscription_payments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `club_id: uuid!`; `amount: numeric!`; `payment_period: text!`; `payment_status: text!`; `stripe_payment_intent_id: text?`; `paid_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `notes: text?`; `payment_type: text!`; `child_id: uuid?`; `marked_by: uuid?`.
- `member_subscription_payments_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `member_subscription_payments_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `member_subscription_payments_payment_type_check`: `CHECK ((payment_type = ANY (ARRAY['subscription'::text, 'uniform'::text])))`
- `member_subscription_payments_pkey`: `PRIMARY KEY (id)`
- `member_subscription_payments_user_club_period_type_key`: `UNIQUE (user_id, club_id, payment_period, payment_type)`
- `member_subscription_payments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/create-member-payment-checkout/index.ts:85; supabase/functions/stripe-webhook/index.ts:1011; supabase/functions/stripe-webhook/index.ts:1025.

#### message_deletions
Code usage: generated contract only.
Columns: `id: uuid!`; `message_id: uuid!`; `message_type: text!`; `author_id: uuid!`; `deleted_by: uuid?`; `message_text_preview: text?`; `context_id: uuid?`; `created_at: timestamp with time zone!`.
- `message_deletions_pkey`: `PRIMARY KEY (id)`

#### message_digests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `message_id: uuid!`; `message_type: message_digest_source!`; `chat_scope_id: uuid!`; `message_created_at: timestamp with time zone!`; `classification: message_digest_classification!`; `summary: text!`; `topic: text?`; `mentions_user_ids: _uuid!`; `provider: text!`; `digested_at: timestamp with time zone!`.
- `message_digests_message_type_message_id_key`: `UNIQUE (message_type, message_id)`
- `message_digests_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/assemble-catchup/index.ts:325; supabase/functions/digest-messages/index.ts:207; supabase/functions/digest-messages/index.ts:308.

#### message_reactions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `reaction_type: text!`; `team_message_id: uuid?`; `club_message_id: uuid?`; `broadcast_message_id: uuid?`; `group_message_id: uuid?`; `created_at: timestamp with time zone!`; `direct_message_id: uuid?`; `club_admin_message_id: uuid?`.
- `message_reactions_broadcast_message_id_fkey`: `FOREIGN KEY (broadcast_message_id) REFERENCES broadcast_messages(id) ON DELETE CASCADE`
- `message_reactions_club_admin_message_id_fkey`: `FOREIGN KEY (club_admin_message_id) REFERENCES club_admin_messages(id) ON DELETE CASCADE`
- `message_reactions_club_message_id_fkey`: `FOREIGN KEY (club_message_id) REFERENCES club_messages(id) ON DELETE CASCADE`
- `message_reactions_direct_message_id_fkey`: `FOREIGN KEY (direct_message_id) REFERENCES direct_messages(id) ON DELETE CASCADE`
- `message_reactions_group_message_id_fkey`: `FOREIGN KEY (group_message_id) REFERENCES group_messages(id) ON DELETE CASCADE`
- `message_reactions_pkey`: `PRIMARY KEY (id)`
- `message_reactions_team_message_id_fkey`: `FOREIGN KEY (team_message_id) REFERENCES team_messages(id) ON DELETE CASCADE`
- `message_reactions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/pages/BroadcastChatPage.tsx:368; frontend/src/pages/BroadcastChatPage.tsx:730; frontend/src/pages/ClubAdminChatPage.tsx:491.

#### message_reads
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `team_message_id: uuid?`; `club_message_id: uuid?`; `broadcast_message_id: uuid?`; `group_message_id: uuid?`; `read_at: timestamp with time zone!`; `direct_message_id: uuid?`; `club_admin_message_id: uuid?`; `scope_key: text?`.
- `message_reads_broadcast_message_id_fkey`: `FOREIGN KEY (broadcast_message_id) REFERENCES broadcast_messages(id) ON DELETE CASCADE`
- `message_reads_club_admin_message_id_fkey`: `FOREIGN KEY (club_admin_message_id) REFERENCES club_admin_messages(id) ON DELETE CASCADE`
- `message_reads_club_message_id_fkey`: `FOREIGN KEY (club_message_id) REFERENCES club_messages(id) ON DELETE CASCADE`
- `message_reads_direct_message_id_fkey`: `FOREIGN KEY (direct_message_id) REFERENCES direct_messages(id) ON DELETE CASCADE`
- `message_reads_group_message_id_fkey`: `FOREIGN KEY (group_message_id) REFERENCES group_messages(id) ON DELETE CASCADE`
- `message_reads_pkey`: `PRIMARY KEY (id)`
- `message_reads_team_message_id_fkey`: `FOREIGN KEY (team_message_id) REFERENCES team_messages(id) ON DELETE CASCADE`
- `message_reads_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/hooks/useMessageReads.ts:212; frontend/src/components/chat/ReadReceiptSheet.tsx:179.

#### message_reports
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `message_id: uuid!`; `message_type: text!`; `reporter_id: uuid!`; `reason: text!`; `additional_details: text?`; `status: text!`; `reviewed_at: timestamp with time zone?`; `reviewed_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `message_reports_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:395; supabase/functions/cleanup-deleted-accounts/index.ts:156; supabase/functions/send-message-report-email/index.ts:108.

#### mini_league_admins
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `mini_league_id: uuid!`; `user_id: uuid!`; `granted_by: uuid?`; `created_at: timestamp with time zone!`.
- `mini_league_admins_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `mini_league_admins_mini_league_id_user_id_key`: `UNIQUE (mini_league_id, user_id)`
- `mini_league_admins_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/process-event-notifications/recipients.ts:111; supabase/functions/process-message-notifications/index.ts:335; supabase/functions/send-event-view-reminder/index.ts:164.

#### mini_league_group_duties
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `group_id: uuid!`; `name: text!`; `assigned_to: uuid?`; `status: text!`; `points: integer?`; `points_awarded: boolean?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `mini_league_group_duties_assigned_to_fkey`: `FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL`
- `mini_league_group_duties_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES mini_league_groups(id) ON DELETE CASCADE`
- `mini_league_group_duties_pkey`: `PRIMARY KEY (id)`
- `mini_league_group_duties_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'confirmed'::text, 'completed'::text])))`
Evidence: supabase/functions/admin-delete-account/index.ts:386; supabase/functions/cleanup-deleted-accounts/index.ts:151.

#### mini_league_group_players
Code usage: generated contract only.
Columns: `id: uuid!`; `group_id: uuid!`; `player_id: uuid!`; `jersey_number: integer?`; `created_at: timestamp with time zone!`.
- `mini_league_group_players_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES mini_league_groups(id) ON DELETE CASCADE`
- `mini_league_group_players_group_id_player_id_key`: `UNIQUE (group_id, player_id)`
- `mini_league_group_players_pkey`: `PRIMARY KEY (id)`
- `mini_league_group_players_player_id_fkey`: `FOREIGN KEY (player_id) REFERENCES mini_league_players(id) ON DELETE CASCADE`

#### mini_league_groups
Code usage: generated contract only.
Columns: `id: uuid!`; `session_id: uuid!`; `name: text!`; `ability_band: text?`; `target_size: integer!`; `pitch_name: text?`; `display_order: integer!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `pitch_state: jsonb?`; `timer_state: jsonb?`; `linked_event_id: uuid?`.
- `mini_league_groups_linked_event_id_fkey`: `FOREIGN KEY (linked_event_id) REFERENCES events(id) ON DELETE SET NULL`
- `mini_league_groups_pkey`: `PRIMARY KEY (id)`
- `mini_league_groups_session_id_fkey`: `FOREIGN KEY (session_id) REFERENCES mini_league_sessions(id) ON DELETE CASCADE`

#### mini_league_players
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `mini_league_id: uuid!`; `name: text!`; `ability_rating: integer?`; `notes: text?`; `parent_user_id: uuid?`; `child_id: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `mini_league_players_ability_rating_check`: `CHECK (((ability_rating IS NULL) OR ((ability_rating >= 1) AND (ability_rating <= 5))))`
- `mini_league_players_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id)`
- `mini_league_players_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `mini_league_players_parent_user_id_fkey`: `FOREIGN KEY (parent_user_id) REFERENCES auth.users(id)`
- `mini_league_players_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/process-event-notifications/recipients.ts:101; supabase/functions/process-message-notifications/index.ts:329; supabase/functions/send-event-view-reminder/index.ts:159.

#### mini_league_session_availability
Code usage: generated contract only.
Columns: `id: uuid!`; `session_id: uuid!`; `player_id: uuid!`; `status: text!`; `marked_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `mini_league_session_availability_pkey`: `PRIMARY KEY (id)`
- `mini_league_session_availability_player_id_fkey`: `FOREIGN KEY (player_id) REFERENCES mini_league_players(id) ON DELETE CASCADE`
- `mini_league_session_availability_session_id_fkey`: `FOREIGN KEY (session_id) REFERENCES mini_league_sessions(id) ON DELETE CASCADE`
- `mini_league_session_availability_session_id_player_id_key`: `UNIQUE (session_id, player_id)`
- `mini_league_session_availability_status_check`: `CHECK ((status = ANY (ARRAY['available'::text, 'unavailable'::text, 'late'::text, 'unknown'::text])))`

#### mini_league_sessions
Code usage: generated contract only.
Columns: `id: uuid!`; `mini_league_id: uuid!`; `session_date: date!`; `start_time: time without time zone!`; `end_time: time without time zone?`; `location_name: text?`; `address: text?`; `postcode: text?`; `status: text!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `team_size_override: integer?`; `linked_event_id: uuid?`.
- `mini_league_sessions_linked_event_id_fkey`: `FOREIGN KEY (linked_event_id) REFERENCES events(id) ON DELETE SET NULL`
- `mini_league_sessions_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `mini_league_sessions_pkey`: `PRIMARY KEY (id)`
- `mini_league_sessions_status_check`: `CHECK ((status = ANY (ARRAY['draft'::text, 'locked'::text])))`

#### mini_leagues
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `name: text!`; `description: text?`; `team_size: integer!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `logo_url: text?`; `bib_colors: _text?`; `min_players_per_side: integer!`; `minutes_per_half: integer!`; `show_matches_to_members: boolean!`.
- `min_players_valid`: `CHECK (((min_players_per_side >= 2) AND (min_players_per_side <= team_size)))`
- `mini_leagues_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `mini_leagues_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-message-notification-email/index.ts:264; frontend/src/components/EventGroupsManager.tsx:230; frontend/src/components/HomeInviteFlow.tsx:204.

#### notification_dispatch_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `request_id: bigint?`; `message_type: text!`; `message_id: uuid?`; `target_function: text!`; `status_code: integer?`; `error_detail: text?`; `resolved_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `notification_dispatch_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-renewal-reminders/index.ts:61.

#### notification_preferences
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `messages_enabled: boolean!`; `events_enabled: boolean!`; `media_enabled: boolean!`; `membership_enabled: boolean!`; `pitch_board_enabled: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `email_messages_enabled: boolean!`; `email_events_enabled: boolean!`; `email_media_enabled: boolean!`; `email_membership_enabled: boolean!`; `email_admin_enabled: boolean!`; `email_pitch_board_enabled: boolean!`; `email_rewards_enabled: boolean!`; `email_pom_enabled: boolean!`; `admin_enabled: boolean?`; `rewards_enabled: boolean?`; `pom_enabled: boolean?`; `show_message_preview: boolean!`.
- `notification_preferences_pkey`: `PRIMARY KEY (id)`
- `notification_preferences_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `notification_preferences_user_id_key`: `UNIQUE (user_id)`
Evidence: supabase/functions/check-pending-subs/index.ts:206; supabase/functions/check-pending-subs/index.ts:219; supabase/functions/export-user-data/index.ts:227.

#### notifications
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `type: text!`; `message: text!`; `related_id: uuid?`; `is_read: boolean!`; `created_at: timestamp with time zone!`; `skip_push: boolean!`; `club_id: uuid?`; `dedupe_key: text?`.
- `notifications_pkey`: `PRIMARY KEY (id)`
- `notifications_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/admin-delete-account/index.ts:593; supabase/functions/auto-rsvp-push-cron/index.ts:230; supabase/functions/check-pending-subs/index.ts:273.

#### pending_invites
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `invited_user_id: uuid?`; `invited_by_user_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `role: app_role!`; `status: text!`; `accepted_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `invited_label: text?`; `invited_email: text?`; `invite_token: text?`; `metadata: jsonb?`; `email_sent_at: timestamp with time zone?`; `email_id: text?`; `email_error: text?`; `last_reminder_sent_at: timestamp with time zone?`; `reminder_count: integer?`; `short_code: text?`.
- `pending_invites_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `pending_invites_invite_token_key`: `UNIQUE (invite_token)`
- `pending_invites_invited_by_user_id_fkey`: `FOREIGN KEY (invited_by_user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `pending_invites_invited_user_id_fkey`: `FOREIGN KEY (invited_user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `pending_invites_pkey`: `PRIMARY KEY (id)`
- `pending_invites_short_code_key`: `UNIQUE (short_code)`
- `pending_invites_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/send-invite-reminders/index.ts:45; supabase/functions/send-invite-reminders/index.ts:173; frontend/src/components/AddClubAdminSheet.tsx:262.

#### photo_albums
Code usage: generated contract only.
Columns: `id: uuid!`; `caption: text?`; `club_id: uuid?`; `team_id: uuid?`; `mini_league_id: uuid?`; `event_id: uuid?`; `uploader_id: uuid!`; `cover_photo_id: uuid?`; `photo_count: integer!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `photo_albums_pkey`: `PRIMARY KEY (id)`

#### photo_comment_reactions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `comment_id: uuid!`; `user_id: uuid!`; `reaction_type: text!`; `created_at: timestamp with time zone!`.
- `photo_comment_reactions_comment_id_fkey`: `FOREIGN KEY (comment_id) REFERENCES photo_comments(id) ON DELETE CASCADE`
- `photo_comment_reactions_comment_id_user_id_key`: `UNIQUE (comment_id, user_id)`
- `photo_comment_reactions_pkey`: `PRIMARY KEY (id)`
- `photo_comment_reactions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/components/PhotoComment.tsx:151; frontend/src/components/PhotoComment.tsx:160; frontend/src/components/PhotoComment.tsx:171.

#### photo_comments
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `photo_id: uuid!`; `user_id: uuid!`; `text: text!`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`.
- `photo_comments_photo_id_fkey`: `FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE`
- `photo_comments_pkey`: `PRIMARY KEY (id)`
- `photo_comments_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES photo_comments(id) ON DELETE CASCADE`
- `photo_comments_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `photo_comments_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/export-user-data/index.ts:229; supabase/functions/generate-demo-data/index.ts:660; supabase/functions/generate-demo-data/index.ts:3010.

#### photo_deletion_logs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `photo_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `file_url: text?`; `image_url: text?`; `file_size: bigint?`; `deleted_by: uuid!`; `deletion_type: text!`; `deleted_at: timestamp with time zone!`; `original_created_at: timestamp with time zone?`; `original_uploader_id: uuid?`.
- `photo_deletion_logs_deletion_type_check`: `CHECK ((deletion_type = ANY (ARRAY['permanent'::text, 'soft'::text, 'auto_purge'::text])))`
- `photo_deletion_logs_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/auto-purge-trash/index.ts:101.

#### photo_reactions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `photo_id: uuid!`; `user_id: uuid!`; `reaction_type: text!`; `created_at: timestamp with time zone!`.
- `photo_reactions_photo_id_fkey`: `FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE`
- `photo_reactions_photo_id_user_id_reaction_type_key`: `UNIQUE (photo_id, user_id, reaction_type)`
- `photo_reactions_pkey`: `PRIMARY KEY (id)`
- `photo_reactions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `photo_reactions_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/export-user-data/index.ts:230; supabase/functions/generate-demo-data/index.ts:654; supabase/functions/generate-demo-data/index.ts:2991.

#### photo_reports
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `photo_id: uuid!`; `reporter_id: uuid!`; `reason: text!`; `additional_details: text?`; `status: text!`; `reviewed_at: timestamp with time zone?`; `reviewed_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `photo_reports_photo_id_fkey`: `FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE`
- `photo_reports_pkey`: `PRIMARY KEY (id)`
- `photo_reports_reporter_id_fkey`: `FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE`
- `photo_reports_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES profiles(id)`
Evidence: supabase/functions/admin-delete-account/index.ts:394; supabase/functions/cleanup-deleted-accounts/index.ts:155; supabase/functions/send-photo-report-email/index.ts:97.

#### photo_views
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `photo_id: uuid!`; `user_id: uuid!`; `viewed_at: timestamp with time zone!`.
- `photo_views_photo_id_fkey`: `FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE`
- `photo_views_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-engagement-reminders/index.ts:390; frontend/src/hooks/usePhotoViews.ts:97; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:803.

#### photos
Code usage: generated contract only.
Columns: `id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `event_id: uuid?`; `uploader_id: uuid!`; `image_url: text!`; `caption: text?`; `file_size: bigint?`; `created_at: timestamp with time zone!`; `file_url: text?`; `title: text?`; `folder_id: uuid?`; `deleted_at: timestamp with time zone?`; `show_in_feed: boolean?`; `mini_league_id: uuid?`; `album_id: uuid?`; `competition_id: uuid?`.
- `photos_album_id_fkey`: `FOREIGN KEY (album_id) REFERENCES photo_albums(id) ON DELETE SET NULL`
- `photos_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `photos_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `photos_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL`
- `photos_folder_id_fkey`: `FOREIGN KEY (folder_id) REFERENCES vault_folders(id) ON DELETE SET NULL`
- `photos_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE SET NULL`
- `photos_pkey`: `PRIMARY KEY (id)`
- `photos_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `photos_uploader_id_fkey`: `FOREIGN KEY (uploader_id) REFERENCES auth.users(id) ON DELETE CASCADE`

#### pinned_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `chat_type: text!`; `chat_id: uuid!`; `message_id: uuid!`; `pinned_by: uuid!`; `created_at: timestamp with time zone!`.
- `pinned_messages_chat_type_chat_id_message_id_key`: `UNIQUE (chat_type, chat_id, message_id)`
- `pinned_messages_chat_type_check`: `CHECK ((chat_type = ANY (ARRAY['team'::text, 'club'::text, 'group'::text, 'dm'::text])))`
- `pinned_messages_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/hooks/usePinnedMessages.ts:76; frontend/src/hooks/usePinnedMessages.ts:177; frontend/src/hooks/usePinnedMessages.ts:218.

#### pitch_formations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid?`; `user_id: uuid?`; `name: text!`; `formation_data: jsonb!`; `is_default: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `team_size: integer?`.
- `pitch_formations_pkey`: `PRIMARY KEY (id)`
- `pitch_formations_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/generate-demo-data/index.ts:722; supabase/functions/generate-demo-data/index.ts:894; supabase/functions/generate-demo-data/index.ts:2506.

#### player_of_match
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `points_awarded: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `points: integer?`; `awarded_by: uuid?`.
- `player_of_match_awarded_by_fkey`: `FOREIGN KEY (awarded_by) REFERENCES auth.users(id)`
- `player_of_match_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `player_of_match_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `player_of_match_event_id_key`: `UNIQUE (event_id)`
- `player_of_match_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:253; supabase/functions/cleanup-deleted-accounts/index.ts:144; supabase/functions/generate-demo-data/index.ts:802.

#### playhq_fixtures
Code usage: generated contract only.
Columns: `id: uuid!`; `playhq_game_id: text!`; `playhq_grade_id: text!`; `scheduled_at: timestamp with time zone?`; `status: text?`; `round: text?`; `venue_name: text?`; `venue_address: text?`; `court: text?`; `home_playhq_team_id: text?`; `home_team_name: text?`; `home_score: integer?`; `away_playhq_team_id: text?`; `away_team_name: text?`; `away_score: integer?`; `raw: jsonb?`; `updated_at: timestamp with time zone!`; `created_at: timestamp with time zone!`.
- `playhq_fixtures_pkey`: `PRIMARY KEY (id)`
- `playhq_fixtures_playhq_game_id_key`: `UNIQUE (playhq_game_id)`

#### playhq_grades
Code usage: generated contract only.
Columns: `id: uuid!`; `playhq_grade_id: text!`; `playhq_season_id: text?`; `playhq_competition_id: text?`; `tenant: text!`; `name: text!`; `sport: text?`; `raw: jsonb?`; `last_synced_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `playhq_grades_pkey`: `PRIMARY KEY (id)`
- `playhq_grades_playhq_grade_id_key`: `UNIQUE (playhq_grade_id)`

#### playhq_ladder
Code usage: generated contract only.
Columns: `id: uuid!`; `playhq_grade_id: text!`; `playhq_team_id: text!`; `team_name: text!`; `position: integer?`; `played: integer!`; `wins: integer!`; `draws: integer!`; `losses: integer!`; `points: integer!`; `points_for: integer!`; `points_against: integer!`; `points_diff: integer!`; `raw: jsonb?`; `snapshot_at: timestamp with time zone!`.
- `playhq_ladder_pkey`: `PRIMARY KEY (id)`
- `playhq_ladder_playhq_grade_id_playhq_team_id_key`: `UNIQUE (playhq_grade_id, playhq_team_id)`

#### playhq_player_links
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `tenant: text!`; `playhq_player_id: text!`; `user_id: uuid?`; `child_id: uuid?`; `claimed_by: uuid!`; `confirmed_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `playhq_player_links_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `playhq_player_links_claimed_by_fkey`: `FOREIGN KEY (claimed_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `playhq_player_links_pkey`: `PRIMARY KEY (id)`
- `playhq_player_links_target_check`: `CHECK (((((user_id IS NOT NULL))::integer + ((child_id IS NOT NULL))::integer) = 1))`
- `playhq_player_links_unique`: `UNIQUE (tenant, playhq_player_id, user_id, child_id)`
- `playhq_player_links_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/features/competitions/playhqRepository.ts:15; frontend/src/components/competitions/CompetitionPlayerStatsPanel.tsx:166.

#### playhq_player_stats
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `playhq_game_id: text!`; `playhq_team_id: text!`; `playhq_player_id: text!`; `player_name: text?`; `stats: jsonb!`; `raw: jsonb?`; `updated_at: timestamp with time zone!`.
- `playhq_player_stats_pkey`: `PRIMARY KEY (id)`
- `playhq_player_stats_playhq_game_id_playhq_player_id_key`: `UNIQUE (playhq_game_id, playhq_player_id)`
Evidence: supabase/functions/playhq-sync/index.ts:270; frontend/src/components/competitions/CompetitionPlayerStatsPanel.tsx:151.

#### playhq_sync_log
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `playhq_grade_id: text!`; `tenant: text!`; `status: text!`; `fixtures_synced: integer!`; `ladder_rows: integer!`; `stat_rows: integer!`; `error: text?`; `started_at: timestamp with time zone!`; `finished_at: timestamp with time zone?`.
- `playhq_sync_log_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/playhq-sync/index.ts:298.

#### points_cooldowns
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `action_type: text!`; `scope_id: text!`; `awarded_date: date!`; `points_awarded: integer!`; `club_id: uuid!`; `created_at: timestamp with time zone!`.
- `points_cooldowns_pkey`: `PRIMARY KEY (id)`
- `points_cooldowns_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/process-weekly-engagement-bonus/index.ts:51; supabase/functions/process-weekly-engagement-bonus/index.ts:112; supabase/functions/process-weekly-engagement-bonus/index.ts:151.

#### points_history
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `club_id: uuid?`; `amount: integer!`; `balance_after: integer!`; `source_type: text!`; `source_id: uuid?`; `description: text!`; `created_at: timestamp with time zone!`; `created_by: uuid?`; `season_id: uuid?`.
- `points_history_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `points_history_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL`
- `points_history_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL`
- `points_history_pkey`: `PRIMARY KEY (id)`
- `points_history_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL`
- `points_history_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
- `points_history_user_or_child`: `CHECK ((((user_id IS NOT NULL) AND (child_id IS NULL)) OR ((user_id IS NULL) AND (child_id IS NOT NULL))))`
Evidence: supabase/functions/process-duty-points/index.ts:160; supabase/functions/process-duty-points/index.ts:322; supabase/functions/process-duty-points/index.ts:476.

#### poll_options
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `poll_id: uuid!`; `label: text!`; `position: smallint!`; `created_at: timestamp with time zone!`.
- `poll_options_label_check`: `CHECK (((char_length(label) >= 1) AND (char_length(label) <= 200)))`
- `poll_options_pkey`: `PRIMARY KEY (id)`
- `poll_options_poll_id_fkey`: `FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE`
Evidence: frontend/src/lib/pollReadRepository.ts:71; frontend/src/components/chat/CreatePollDialog.tsx:208; frontend/src/components/chat/PollAttachmentPreview.tsx:26.

#### poll_votes
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `poll_id: uuid!`; `option_id: uuid!`; `user_id: uuid!`; `created_at: timestamp with time zone!`.
- `poll_votes_option_id_fkey`: `FOREIGN KEY (option_id) REFERENCES poll_options(id) ON DELETE CASCADE`
- `poll_votes_pkey`: `PRIMARY KEY (id)`
- `poll_votes_poll_id_fkey`: `FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE`
- `poll_votes_poll_id_option_id_user_id_key`: `UNIQUE (poll_id, option_id, user_id)`
Evidence: frontend/src/lib/pollReadRepository.ts:72; frontend/src/components/chat/PollCard.tsx:130; frontend/src/components/chat/PollCard.tsx:142.

#### polls
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `chat_type: poll_chat_type!`; `chat_id: uuid!`; `created_by: uuid!`; `question: text!`; `allow_multiple: boolean!`; `closes_at: timestamp with time zone?`; `closed_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `polls_pkey`: `PRIMARY KEY (id)`
- `polls_question_check`: `CHECK (((char_length(question) >= 1) AND (char_length(question) <= 300)))`
Evidence: frontend/src/lib/pollReadRepository.ts:70; frontend/src/components/chat/CreatePollDialog.tsx:188; frontend/src/components/chat/CreatePollDialog.tsx:210.

#### profiles
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `display_name: text?`; `avatar_url: text?`; `profile_visibility: text?`; `ignite_points: integer!`; `last_seen_at: timestamp with time zone?`; `photo_consent: boolean?`; `scheduled_deletion_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `has_sausage_reward: boolean?`; `photo_consent_given_at: timestamp with time zone?`; `email_hash: text?`; `theme_preference: text?`; `active_club_theme_id: uuid?`; `events_view_mode: text?`; `terms_accepted_at: timestamp with time zone?`; `privacy_accepted_at: timestamp with time zone?`; `leaderboard_opt_out: boolean!`; `ai_catch_up_enabled: boolean!`; `ai_catch_up_acknowledged_at: timestamp with time zone?`; `accessibility_prefs: jsonb!`; `club_switcher_hint_seen_at: timestamp with time zone?`.
- `profiles_active_club_theme_id_fkey`: `FOREIGN KEY (active_club_theme_id) REFERENCES clubs(id) ON DELETE SET NULL`
- `profiles_events_view_mode_check`: `CHECK ((events_view_mode = ANY (ARRAY['list'::text, 'calendar'::text])))`
- `profiles_id_fkey`: `FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `profiles_pkey`: `PRIMARY KEY (id)`
- `profiles_theme_preference_check`: `CHECK ((theme_preference = ANY (ARRAY['light'::text, 'dark'::text])))`
Evidence: supabase/functions/_shared/clubChatBot.ts:67; supabase/functions/admin-delete-account/index.ts:513; supabase/functions/admin-delete-account/index.ts:580.

#### promo_codes
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `code: text!`; `is_active: boolean!`; `expires_at: timestamp with time zone?`; `access_level: text?`; `club_id: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `storage_gb: integer?`; `uses_count: integer!`; `scope_type: text?`; `created_by: uuid?`.
- `promo_codes_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `promo_codes_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- `promo_codes_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/StoragePurchaseDialog.tsx:151; frontend/src/components/StoragePurchaseDialog.tsx:193; frontend/src/pages/ClubUpgradePage.tsx:398.

#### public_clubs
Code usage: no literal reference; possible SQL/internal use.
Columns: `id: uuid?`; `name: text?`; `city: text?`; `state: text?`; `latitude: double precision?`; `longitude: double precision?`; `member_count: integer?`; `team_count: integer?`; `sponsorship_pitch: text?`; `listed_on_marketplace: boolean?`; `proposed_tier: text?`; `subscription_status: text?`; `created_at: timestamp with time zone?`.

#### push_alert_settings
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `failure_threshold_percent: integer!`; `check_window_hours: integer!`; `min_notifications: integer!`; `cooldown_hours: integer!`; `alerts_enabled: boolean!`; `updated_at: timestamp with time zone!`; `updated_by: uuid?`.
- `push_alert_settings_pkey`: `PRIMARY KEY (id)`
- `push_alert_settings_updated_by_fkey`: `FOREIGN KEY (updated_by) REFERENCES auth.users(id)`
Evidence: supabase/functions/check-push-failure-rate/index.ts:35; frontend/src/pages/PushAnalyticsPage.tsx:183; frontend/src/pages/PushAnalyticsPage.tsx:266.

#### push_delivery_queue
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `notification_id: uuid!`; `user_id: uuid!`; `payload: jsonb!`; `status: text!`; `attempt_count: integer!`; `next_attempt_at: timestamp with time zone!`; `claimed_at: timestamp with time zone?`; `completed_at: timestamp with time zone?`; `last_error: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `push_delivery_queue_notification_id_fkey`: `FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE`
- `push_delivery_queue_notification_id_key`: `UNIQUE (notification_id)`
- `push_delivery_queue_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/process-push-delivery-queue/index.ts:94.

#### push_notification_logs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `notification_id: uuid?`; `user_id: uuid!`; `endpoint: text!`; `status: text!`; `status_code: integer?`; `error_message: text?`; `created_at: timestamp with time zone!`.
- `push_notification_logs_pkey`: `PRIMARY KEY (id)`
- `push_notification_logs_status_check`: `CHECK ((status = ANY (ARRAY['sent'::text, 'failed'::text, 'expired'::text, 'invalid'::text, 'skipped'::text])))`
Evidence: supabase/functions/check-push-failure-rate/index.ts:61; supabase/functions/cleanup-push-subscriptions/index.ts:143; supabase/functions/cleanup-push-subscriptions/index.ts:188.

#### push_subscriptions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `endpoint: text!`; `p256dh: text!`; `auth: text!`; `platform: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `last_success_at: timestamp with time zone?`; `failure_count: integer?`; `last_failure_at: timestamp with time zone?`; `last_failure_reason: text?`.
- `push_subscriptions_pkey`: `PRIMARY KEY (id)`
- `push_subscriptions_user_id_endpoint_key`: `UNIQUE (user_id, endpoint)`
- `push_subscriptions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/cleanup-push-subscriptions/index.ts:45; supabase/functions/cleanup-push-subscriptions/index.ts:54; supabase/functions/cleanup-push-subscriptions/index.ts:67.

#### rate_limits
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `identifier: text!`; `endpoint: text!`; `request_count: integer!`; `window_start: timestamp with time zone!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `rate_limits_identifier_endpoint_key`: `UNIQUE (identifier, endpoint)`
- `rate_limits_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/admin-delete-account/index.ts:40; supabase/functions/admin-delete-account/index.ts:50; supabase/functions/admin-delete-account/index.ts:63.

#### realtime_perf_samples
Code usage: literal frontend/edge reference.
Columns: `id: bigint!`; `user_id: uuid!`; `channel: text!`; `event: text!`; `latency_ms: integer!`; `sent_at: timestamp with time zone!`; `received_at: timestamp with time zone!`; `platform: text?`; `created_at: timestamp with time zone!`.
- `realtime_perf_samples_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/hooks/useRealtimePerfSampler.ts:83.

#### reward_redemptions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `reward_id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `points_spent: integer!`; `verified_by: uuid?`; `verified_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `status: text!`; `club_id: uuid?`; `redeemed_at: timestamp with time zone?`; `idempotency_key: text?`.
- `reward_redemptions_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `reward_redemptions_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `reward_redemptions_pkey`: `PRIMARY KEY (id)`
- `reward_redemptions_reward_id_fkey`: `FOREIGN KEY (reward_id) REFERENCES club_rewards(id) ON DELETE CASCADE`
- `reward_redemptions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `reward_redemptions_verified_by_fkey`: `FOREIGN KEY (verified_by) REFERENCES auth.users(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:237; supabase/functions/cleanup-deleted-accounts/index.ts:142; supabase/functions/export-user-data/index.ts:233.

#### role_requests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `role: app_role!`; `status: role_request_status!`; `processed_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `mini_league_id: uuid?`; `metadata: jsonb?`.
- `role_requests_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `role_requests_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE CASCADE`
- `role_requests_pkey`: `PRIMARY KEY (id)`
- `role_requests_processed_by_fkey`: `FOREIGN KEY (processed_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- `role_requests_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `role_requests_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `role_requests_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: frontend/src/pages/ClubDetailPage.tsx:1123; frontend/src/pages/ClubDetailPage.tsx:1138; frontend/src/pages/HomePage.tsx:2010.

#### rsvp_audit_log
Code usage: generated contract only.
Columns: `id: uuid!`; `rsvp_id: uuid?`; `event_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `mini_league_id: uuid?`; `action: text!`; `old_status: text?`; `new_status: text?`; `actor_user_id: uuid?`; `subject_user_id: uuid?`; `subject_child_id: uuid?`; `subject_mini_league_player_id: uuid?`; `subject_kind: text!`; `subject_label: text?`; `source: text?`; `created_at: timestamp with time zone!`.
- `rsvp_audit_log_action_check`: `CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))`
- `rsvp_audit_log_pkey`: `PRIMARY KEY (id)`
- `rsvp_audit_log_subject_kind_check`: `CHECK ((subject_kind = ANY (ARRAY['self'::text, 'parent_for_user'::text, 'parent_for_child'::text, 'parent_for_league_player'::text, 'admin_override'::text])))`

#### rsvps
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `event_id: uuid!`; `user_id: uuid?`; `status: rsvp_status!`; `child_id: uuid?`; `has_paid: boolean?`; `notes: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `mini_league_player_id: uuid?`; `early_rsvp_points_awarded: boolean!`; `attendance_points_awarded: boolean!`; `source: text!`.
- `rsvps_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `rsvps_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`
- `rsvps_has_identifier_check`: `CHECK (((user_id IS NOT NULL) OR (mini_league_player_id IS NOT NULL)))`
- `rsvps_mini_league_player_id_fkey`: `FOREIGN KEY (mini_league_player_id) REFERENCES mini_league_players(id) ON DELETE CASCADE`
- `rsvps_pkey`: `PRIMARY KEY (id)`
- `rsvps_source_check`: `CHECK ((source = ANY (ARRAY['user'::text, 'default'::text, 'coach'::text])))`
- `rsvps_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/auto-default-rsvp-confirm-cron/index.ts:214; supabase/functions/auto-default-rsvp-maintenance-cron/index.ts:104; supabase/functions/export-user-data/index.ts:225.

#### saved_locations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `address: text!`; `name: text?`; `latitude: double precision?`; `longitude: double precision?`; `is_favorite: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `saved_locations_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/components/AddressAutocomplete.tsx:125; frontend/src/components/AddressAutocomplete.tsx:320; frontend/src/components/AddressAutocomplete.tsx:357.

#### schedule_broadcasts
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `team_id: uuid?`; `bumped_by: uuid!`; `bumped_at: timestamp with time zone!`.
- `schedule_broadcasts_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `schedule_broadcasts_pkey`: `PRIMARY KEY (id)`
- `schedule_broadcasts_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: frontend/src/lib/scheduleBroadcast.ts:34.

#### schedule_open_perf
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `created_at: timestamp with time zone!`; `source: text!`; `tap_to_paint_ms: integer!`; `query_ms: integer?`; `first_paint_ms: integer?`; `cache_hit: boolean!`; `context: jsonb?`; `platform: text?`; `stages: jsonb?`; `primary_club_id: uuid?`.
- `schedule_open_perf_pkey`: `PRIMARY KEY (id)`
Evidence: frontend/src/lib/scheduleOpenLatency.ts:129.

#### scheduled_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `author_id: uuid!`; `chat_type: scheduled_chat_type!`; `team_id: uuid?`; `club_id: uuid?`; `group_id: uuid?`; `conversation_id: uuid?`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `scheduled_for: timestamp with time zone!`; `status: scheduled_message_status!`; `sent_message_id: uuid?`; `error_message: text?`; `attempted_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `recurrence: scheduled_message_recurrence!`; `recurrence_until: timestamp with time zone?`; `recurrence_parent_id: uuid?`.
- `scheduled_messages_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `scheduled_messages_destination_matches_type`: `CHECK ((((chat_type = 'team'::scheduled_chat_type) AND (team_id IS NOT NULL) AND (club_id IS NULL) AND (group_id IS NULL) AND (conversation_id IS NULL)) OR ((chat_type = 'club'::scheduled_chat_type) AND (club_id IS NOT NULL) AND (team_id IS NULL) AND (group_id IS NULL) AND (conversation_id IS NULL)) OR ((chat_type = 'group'::scheduled_chat_type) AND (group_id IS NOT NULL) AND (team_id IS NULL) AND (club_id IS NULL) AND (conversation_id IS NULL)) OR ((chat_type = 'direct'::scheduled_chat_type) AND (conversation_id IS NOT NULL) AND (team_id IS NULL) AND (club_id IS NULL) AND (group_id IS NULL)) OR ((chat_type = 'club_admin'::scheduled_chat_type) AND (conversation_id IS NOT NULL) AND (team_id IS NULL) AND (club_id IS NULL) AND (group_id IS NULL)) OR ((chat_type = 'broadcast'::scheduled_chat_type) AND (team_id IS NULL) AND (club_id IS NULL) AND (group_id IS NULL) AND (conversation_id IS NULL))))`
- `scheduled_messages_group_id_fkey`: `FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`
- `scheduled_messages_has_content`: `CHECK (((length(COALESCE(text, ''::text)) > 0) OR (image_url IS NOT NULL)))`
- `scheduled_messages_pkey`: `PRIMARY KEY (id)`
- `scheduled_messages_recurrence_parent_id_fkey`: `FOREIGN KEY (recurrence_parent_id) REFERENCES scheduled_messages(id) ON DELETE SET NULL`
- `scheduled_messages_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/process-scheduled-messages/index.ts:51; supabase/functions/process-scheduled-messages/index.ts:66; supabase/functions/process-scheduled-messages/index.ts:74.

#### seasons
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `name: text!`; `status: season_status!`; `start_date: date?`; `end_date: date?`; `archived_at: timestamp with time zone?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `eoi_enabled: boolean!`; `eoi_slug: text?`; `eoi_opens_at: timestamp with time zone?`; `eoi_closes_at: timestamp with time zone?`; `eoi_welcome_message: text?`; `eoi_thank_you_message: text?`; `eoi_require_dob: boolean!`; `eoi_require_gender: boolean!`; `eoi_ask_preferences: boolean!`; `eoi_ask_availability: boolean!`; `eoi_ask_skill_level: boolean!`; `eoi_ask_position: boolean!`; `eoi_embed_code: text?`; `eoi_webhook_token: text?`; `eoi_thank_you_redirect_url: text?`.
- `seasons_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `seasons_name_per_club_unique`: `UNIQUE (club_id, name)`
- `seasons_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/eoi-webhook/index.ts:85; supabase/functions/send-eoi-invite/index.ts:67; frontend/src/hooks/useClubSeasons.ts:42.

#### sponsor_analytics
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `sponsor_id: uuid!`; `event_type: text!`; `context: text!`; `user_id: uuid?`; `event_id: uuid?`; `created_at: timestamp with time zone!`.
- `sponsor_analytics_event_id_fkey`: `FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL`
- `sponsor_analytics_pkey`: `PRIMARY KEY (id)`
- `sponsor_analytics_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE`
- `sponsor_analytics_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
Evidence: frontend/src/hooks/useSponsorAnalytics.ts:17; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:866; frontend/src/pages/ClubEngagementAnalyticsPage.tsx:872.

#### sponsors
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `name: text!`; `logo_url: text?`; `website_url: text?`; `description: text?`; `is_active: boolean!`; `display_order: integer!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `is_team_only: boolean!`; `tier: sponsor_tier?`; `exposure_percentage: integer?`.
- `sponsors_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `sponsors_pkey`: `PRIMARY KEY (id)`
- `sponsors_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/generate-demo-data/index.ts:939; supabase/functions/generate-demo-data/index.ts:1122; supabase/functions/generate-demo-data/index.ts:1134.

#### sponsorship_packages
Code usage: generated contract only.
Columns: `id: uuid!`; `club_id: uuid!`; `tier: text!`; `title: text!`; `benefits: _text!`; `custom_price: numeric?`; `is_active: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `sponsorship_packages_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id)`
- `sponsorship_packages_pkey`: `PRIMARY KEY (id)`

#### stripe_notification_outbox
Code usage: generated contract only.
Columns: `id: uuid!`; `stripe_event_id: text!`; `purpose: text!`; `user_id: uuid?`; `entity_type: text?`; `entity_id: uuid?`; `created_at: timestamp with time zone!`.
- `stripe_notification_outbox_pkey`: `PRIMARY KEY (id)`
- `stripe_notification_outbox_unique`: `UNIQUE (stripe_event_id, purpose)`

#### stripe_subscription_event_state
Code usage: generated contract only.
Columns: `stripe_subscription_id: text!`; `entity_type: text?`; `entity_id: uuid?`; `last_event_id: text!`; `last_event_type: text!`; `last_event_at: timestamp with time zone!`; `subscription_state: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `stripe_subscription_event_state_entity_chk`: `CHECK (((entity_type IS NULL) OR (entity_type = ANY (ARRAY['club'::text, 'team'::text]))))`
- `stripe_subscription_event_state_pkey`: `PRIMARY KEY (stripe_subscription_id)`
- `stripe_subscription_event_state_state_chk`: `CHECK (((subscription_state IS NULL) OR (subscription_state = ANY (ARRAY['active'::text, 'cancelled'::text]))))`

#### stripe_webhook_events
Code usage: generated contract only.
Columns: `stripe_event_id: text!`; `event_type: text!`; `status: text!`; `attempts: integer!`; `stripe_object_id: text?`; `last_error: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `completed_at: timestamp with time zone?`.
- `stripe_webhook_events_pkey`: `PRIMARY KEY (stripe_event_id)`
- `stripe_webhook_events_status_chk`: `CHECK ((status = ANY (ARRAY['processing'::text, 'completed'::text, 'failed'::text])))`

#### system_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `message_type: text!`; `text: text!`; `created_at: timestamp with time zone!`; `read_at: timestamp with time zone?`.
- `system_messages_pkey`: `PRIMARY KEY (id)`
Evidence: supabase/functions/send-welcome-dm/index.ts:54; supabase/functions/send-welcome-dm/index.ts:70; frontend/src/pages/WelcomeMessagePage.tsx:96.

#### team_captains
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `user_id: uuid!`; `assigned_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `team_captains_pkey`: `PRIMARY KEY (id)`
- `team_captains_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_captains_team_id_user_id_key`: `UNIQUE (team_id, user_id)`
Evidence: frontend/src/components/MatchCaptainSelector.tsx:142; frontend/src/components/TeamCaptainCard.tsx:56; frontend/src/components/TeamCaptainCard.tsx:94.

#### team_creation_requests
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `requested_by: uuid!`; `name: text!`; `level_age: text?`; `description: text?`; `logo_url: text?`; `team_type: text?`; `folder_id: uuid?`; `class_day: text?`; `class_time: text?`; `class_duration_minutes: integer?`; `class_capacity: integer?`; `status: text!`; `rejection_reason: text?`; `reviewed_by: uuid?`; `reviewed_at: timestamp with time zone?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `team_creation_requests_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `team_creation_requests_pkey`: `PRIMARY KEY (id)`
- `team_creation_requests_requested_by_fkey`: `FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `team_creation_requests_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)`
- `team_creation_requests_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))`
Evidence: frontend/src/components/PendingTeamRequests.tsx:68; frontend/src/components/PendingTeamRequests.tsx:179; frontend/src/components/PendingTeamRequests.tsx:240.

#### team_folders
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid?`; `name: text!`; `description: text?`; `sort_order: integer!`; `color: text?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `club_id: uuid?`.
- `team_folders_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `team_folders_pkey`: `PRIMARY KEY (id)`
- `team_folders_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/vault-backup/index.ts:327; frontend/src/components/TeamFoldersManager.tsx:84; frontend/src/components/TeamFoldersManager.tsx:115.

#### team_invites
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `role: app_role!`; `token: text!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `expires_at: timestamp with time zone?`; `max_uses: integer?`; `uses_count: integer!`; `metadata: jsonb?`.
- `team_invites_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE`
- `team_invites_pkey`: `PRIMARY KEY (id)`
- `team_invites_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_invites_token_key`: `UNIQUE (token)`
Evidence: supabase/functions/vault-backup/index.ts:178; frontend/src/components/AddTeamMemberSheet.tsx:457; frontend/src/components/AddTeamMemberSheet.tsx:471.

#### team_member_exclusions
Code usage: generated contract only.
Columns: `team_id: uuid!`; `user_id: uuid!`; `excluded_at: timestamp with time zone!`; `excluded_by: uuid?`.
- `team_member_exclusions_pkey`: `PRIMARY KEY (team_id, user_id)`
- `team_member_exclusions_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`

#### team_memberships
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_player_id: uuid!`; `team_id: uuid!`; `season_id: uuid!`; `role: team_membership_role!`; `status: team_membership_status!`; `joined_at: timestamp with time zone!`; `removed_at: timestamp with time zone?`; `notes: text?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `team_memberships_club_player_id_fkey`: `FOREIGN KEY (club_player_id) REFERENCES club_players(id) ON DELETE CASCADE`
- `team_memberships_pkey`: `PRIMARY KEY (id)`
- `team_memberships_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE CASCADE`
- `team_memberships_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_memberships_unique_per_season`: `UNIQUE (club_player_id, team_id, season_id)`
Evidence: supabase/functions/send-photo-prompt-followup/index.ts:167; frontend/src/hooks/useNotificationClubSwitch.ts:118; frontend/src/pages/JoinTeamPage.tsx:719.

#### team_messages
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `author_id: uuid!`; `text: text!`; `image_url: text?`; `reply_to_id: uuid?`; `created_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `is_club_announcement: boolean!`; `club_announcement_name: text?`; `is_system_message: boolean!`; `forwarded_from_user_id: uuid?`; `forwarded_at: timestamp with time zone?`; `forwarded_source_label: text?`; `is_sponsor: boolean!`; `edited_at: timestamp with time zone?`.
- `team_messages_author_id_fkey`: `FOREIGN KEY (author_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `team_messages_pkey`: `PRIMARY KEY (id)`
- `team_messages_reply_to_id_fkey`: `FOREIGN KEY (reply_to_id) REFERENCES team_messages(id) ON DELETE SET NULL`
- `team_messages_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/_shared/clubChatBot.ts:103; supabase/functions/admin-delete-account/index.ts:400; supabase/functions/auto-post-event-to-chat/index.ts:165.

#### team_player_positions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `user_id: uuid?`; `child_id: uuid?`; `position: text!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `preferred_positions: _text?`; `jersey_number: integer?`.
- `team_player_positions_child_id_fkey`: `FOREIGN KEY (child_id) REFERENCES children(id) ON DELETE CASCADE`
- `team_player_positions_pkey`: `PRIMARY KEY (id)`
- `team_player_positions_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_player_positions_team_user_unique`: `UNIQUE (team_id, user_id)`
- `team_player_positions_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/generate-demo-data/index.ts:847; supabase/functions/generate-demo-data/index.ts:893; supabase/functions/generate-demo-data/index.ts:1656.

#### team_sponsor_allocations
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `sponsor_id: uuid!`; `display_order: integer!`; `created_at: timestamp with time zone!`.
- `team_sponsor_allocations_pkey`: `PRIMARY KEY (id)`
- `team_sponsor_allocations_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE`
- `team_sponsor_allocations_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_sponsor_allocations_team_id_sponsor_id_key`: `UNIQUE (team_id, sponsor_id)`
Evidence: frontend/src/components/ClubSponsorSection.tsx:72; frontend/src/components/ClubTeamSponsorAllocator.tsx:103; frontend/src/components/ClubTeamSponsorAllocator.tsx:123.

#### team_sponsors
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `sponsor_id: uuid!`; `display_order: integer!`; `created_at: timestamp with time zone!`.
- `team_sponsors_pkey`: `PRIMARY KEY (id)`
- `team_sponsors_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE CASCADE`
- `team_sponsors_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_sponsors_team_id_sponsor_id_key`: `UNIQUE (team_id, sponsor_id)`
Evidence: supabase/functions/vault-backup/index.ts:159.

#### team_subscriptions
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `is_pro: boolean!`; `is_pro_football: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `admin_pro_override: boolean!`; `admin_pro_football_override: boolean!`; `disable_auto_subs: boolean?`; `rotation_speed: integer?`; `disable_position_swaps: boolean?`; `disable_batch_subs: boolean?`; `minutes_per_half: integer?`; `team_size: integer?`; `formation: text?`; `show_match_header: boolean?`; `expires_at: timestamp with time zone?`; `is_trial: boolean?`; `trial_ends_at: timestamp with time zone?`; `rotate_gk_at_halftime: boolean?`; `show_lineup_picker: boolean!`; `cancelled_at: timestamp with time zone?`; `court_minutes_per_quarter: integer?`; `court_rotation_mode: text?`; `court_rotation_interval_minutes: integer?`; `court_validation_mode: text?`; `court_period_type: text?`; `court_timeouts_per_half: integer?`; `max_spread_minutes: integer!`; `pitch_notify_coach: boolean!`; `pitch_notify_team_admin: boolean!`; `pitch_notify_subs_manager: boolean!`; `stripe_subscription_id: text?`; `last_stripe_event_id: text?`; `last_stripe_event_at: timestamp with time zone?`.
- `team_subscriptions_pkey`: `PRIMARY KEY (id)`
- `team_subscriptions_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `team_subscriptions_team_id_key`: `UNIQUE (team_id)`
Evidence: supabase/functions/auto-default-rsvp-confirm-cron/index.ts:186; supabase/functions/auto-rsvp-dm-cron/index.ts:236; supabase/functions/auto-rsvp-push-cron/index.ts:169.

#### team_training_pauses
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `team_id: uuid!`; `starts_at: timestamp with time zone!`; `ends_at: timestamp with time zone!`; `label: text?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `team_training_pauses_check`: `CHECK ((ends_at > starts_at))`
- `team_training_pauses_pkey`: `PRIMARY KEY (id)`
- `team_training_pauses_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: frontend/src/components/team/TeamTrainingPausesCard.tsx:43; frontend/src/components/team/TeamTrainingPausesCard.tsx:88; frontend/src/components/team/TeamTrainingPausesCard.tsx:116.

#### teams
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid?`; `name: text!`; `logo_url: text?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `default_pitch_format: text?`; `default_formation: text?`; `default_pitch_orientation: text?`; `default_pitch_view: text?`; `sponsor_id: uuid?`; `level_age: text?`; `description: text?`; `folder_id: uuid?`; `team_type: text?`; `class_capacity: integer?`; `class_day: text?`; `class_time: time without time zone?`; `class_duration_minutes: integer?`; `is_archived: boolean!`; `archived_at: timestamp with time zone?`; `season_label: text?`; `is_pro: boolean!`; `pro_expires_at: timestamp with time zone?`; `pro_activated_at: timestamp with time zone?`; `stripe_subscription_id: text?`; `deleted_at: timestamp with time zone?`; `deleted_by: uuid?`; `season_id: uuid?`; `lifecycle_status: team_lifecycle_status!`; `default_match_arrival_minutes: integer?`; `auto_rsvp_dm_enabled: boolean!`; `auto_chat_post_enabled: boolean!`; `auto_rsvp_dm_cadences: _text!`; `auto_rsvp_dm_event_types: _text!`; `auto_rsvp_push_enabled: boolean!`; `auto_rsvp_push_cadences: _text!`; `auto_rsvp_push_event_types: _text!`; `default_rsvp_audience: text!`; `is_shell: boolean!`; `shell_contact_name: text?`; `shell_contact_email: text?`; `shell_claim_token: uuid?`; `shell_claimed_at: timestamp with time zone?`; `shell_claimed_by: uuid?`; `shell_invited_by: uuid?`; `shell_last_invite_sent_at: timestamp with time zone?`; `playhq_team_id: text?`; `playhq_grade_id: text?`; `playhq_season_id: text?`; `playhq_auto_create_events: boolean!`; `playhq_competition_id: uuid?`; `last_message_id: uuid?`; `last_message_text: text?`; `last_message_at: timestamp with time zone?`; `last_message_author_id: uuid?`; `last_message_author_name: text?`; `last_message_image_url: text?`; `last_message_is_system: boolean?`; `last_message_is_club_announcement: boolean?`; `last_message_club_announcement_name: text?`.
- `teams_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `teams_default_match_arrival_minutes_range`: `CHECK (((default_match_arrival_minutes IS NULL) OR ((default_match_arrival_minutes >= 0) AND (default_match_arrival_minutes <= 480))))`
- `teams_default_rsvp_audience_check`: `CHECK ((default_rsvp_audience = ANY (ARRAY['players_only'::text, 'players_and_parents'::text, 'parents_only'::text])))`
- `teams_folder_id_fkey`: `FOREIGN KEY (folder_id) REFERENCES team_folders(id) ON DELETE SET NULL`
- `teams_pkey`: `PRIMARY KEY (id)`
- `teams_playhq_competition_id_fkey`: `FOREIGN KEY (playhq_competition_id) REFERENCES competitions(id) ON DELETE SET NULL`
- `teams_season_id_fkey`: `FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE SET NULL`
- `teams_sponsor_id_fkey`: `FOREIGN KEY (sponsor_id) REFERENCES sponsors(id) ON DELETE SET NULL`
- `teams_team_type_check`: `CHECK ((team_type = ANY (ARRAY['junior'::text, 'senior'::text, 'mixed'::text])))`
Evidence: supabase/functions/auto-post-event-to-chat/index.ts:89; supabase/functions/auto-post-news-to-chat/index.ts:202; supabase/functions/cancel-subscription/index.ts:55.

#### terms
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `name: text!`; `start_date: date!`; `end_date: date!`; `is_active: boolean!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `status: text!`.
- `terms_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `terms_pkey`: `PRIMARY KEY (id)`
- `terms_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'archived'::text])))`
Evidence: frontend/src/components/ClassModeOnboardingGuide.tsx:18; frontend/src/components/AdminEnrolmentManager.tsx:41; frontend/src/components/ClassAttendanceManager.tsx:50.

#### training_session_drills
Code usage: generated contract only.
Columns: `id: uuid!`; `user_id: uuid!`; `drill_id: uuid!`; `position: integer!`; `added_at: timestamp with time zone!`.
- `training_session_drills_drill_id_fkey`: `FOREIGN KEY (drill_id) REFERENCES drills(id) ON DELETE CASCADE`
- `training_session_drills_pkey`: `PRIMARY KEY (id)`

#### user_activity_logs
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `club_id: uuid?`; `page_path: text!`; `page_label: text?`; `session_id: text!`; `started_at: timestamp with time zone!`; `duration_seconds: integer!`; `created_at: timestamp with time zone!`.
- `user_activity_logs_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE SET NULL`
- `user_activity_logs_pkey`: `PRIMARY KEY (id)`
- `user_activity_logs_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/components/admin/UserAnalyticsTab.tsx:94.

#### user_club_points
Code usage: literal frontend/edge reference.
Columns: `user_id: uuid!`; `club_id: uuid!`; `points: integer!`; `updated_at: timestamp with time zone!`.
- `user_club_points_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `user_club_points_pkey`: `PRIMARY KEY (user_id, club_id)`
Evidence: frontend/src/components/RewardRedemptionCard.tsx:317; frontend/src/hooks/useClubPoints.ts:28; frontend/src/hooks/useClubPoints.ts:86.

#### user_passkeys
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `credential_id: text!`; `public_key: text!`; `counter: bigint!`; `device_type: text?`; `created_at: timestamp with time zone!`; `last_used_at: timestamp with time zone?`.
- `user_passkeys_pkey`: `PRIMARY KEY (id)`
- `user_passkeys_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: supabase/functions/passkey-authenticate/index.ts:183; supabase/functions/passkey-authenticate/index.ts:253; supabase/functions/passkey-authenticate/index.ts:261.

#### user_presence
Code usage: literal frontend/edge reference.
Columns: `user_id: uuid!`; `last_seen_at: timestamp with time zone!`; `platform: text?`; `user_agent: text?`; `updated_at: timestamp with time zone!`.
- `user_presence_pkey`: `PRIMARY KEY (user_id)`
- `user_presence_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
Evidence: frontend/src/pages/RealtimeHealthPage.tsx:101; frontend/src/components/admin/OnlineUsersTab.tsx:55.

#### user_roles
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `role: app_role!`; `created_at: timestamp with time zone!`; `via_captain: boolean!`.
- `user_roles_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `user_roles_pkey`: `PRIMARY KEY (id)`
- `user_roles_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `user_roles_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE`
- `user_roles_user_id_profiles_fkey`: `FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE`
Evidence: supabase/functions/_shared/callerAuth.ts:143; supabase/functions/_shared/clubChatBot.ts:74; supabase/functions/_shared/clubChatBot.ts:80.

#### vault_deletion_jobs
Code usage: generated contract only.
Columns: `id: uuid!`; `kind: text!`; `record_id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `bucket: text?`; `object_path: text?`; `requested_by: uuid!`; `deletion_type: text!`; `status: text!`; `attempts: integer!`; `last_error_code: text?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`.
- `vault_deletion_jobs_kind_check`: `CHECK ((kind = ANY (ARRAY['photo'::text, 'file'::text])))`
- `vault_deletion_jobs_kind_record_id_key`: `UNIQUE (kind, record_id)`
- `vault_deletion_jobs_pkey`: `PRIMARY KEY (id)`
- `vault_deletion_jobs_status_check`: `CHECK ((status = ANY (ARRAY['pending'::text, 'storage_deleted'::text, 'completed'::text, 'failed'::text])))`

#### vault_drive_links
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid!`; `team_id: uuid?`; `vault_folder_id: uuid!`; `drive_folder_id: text!`; `drive_folder_name: text!`; `refresh_token: text!`; `google_account_email: text?`; `sync_enabled: boolean!`; `sync_interval_minutes: integer!`; `last_synced_at: timestamp with time zone?`; `last_sync_status: text?`; `last_sync_error: text?`; `files_imported_count: integer!`; `files_updated_count: integer!`; `created_by: uuid!`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `last_failed_files: jsonb!`.
- `vault_drive_links_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `vault_drive_links_pkey`: `PRIMARY KEY (id)`
- `vault_drive_links_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `vault_drive_links_vault_folder_id_fkey`: `FOREIGN KEY (vault_folder_id) REFERENCES vault_folders(id) ON DELETE CASCADE`
- `vault_drive_links_vault_folder_id_key`: `UNIQUE (vault_folder_id)`
Evidence: supabase/functions/drive-folder-sync/index.ts:403; supabase/functions/drive-folder-sync/index.ts:420; supabase/functions/drive-folder-sync/index.ts:436.

#### vault_files
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `folder_id: uuid?`; `club_id: uuid?`; `team_id: uuid?`; `name: text!`; `file_url: text!`; `file_size: bigint?`; `file_type: text?`; `uploaded_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `deleted_at: timestamp with time zone?`; `mini_league_id: uuid?`; `is_external_link: boolean?`; `deleted_by: uuid?`; `drive_file_id: text?`; `drive_modified_time: timestamp with time zone?`; `storage_bucket: text?`; `storage_path: text?`; `competition_id: uuid?`.
- `vault_files_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `vault_files_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `vault_files_deleted_by_fkey`: `FOREIGN KEY (deleted_by) REFERENCES auth.users(id)`
- `vault_files_folder_id_fkey`: `FOREIGN KEY (folder_id) REFERENCES vault_folders(id) ON DELETE CASCADE`
- `vault_files_mini_league_id_fkey`: `FOREIGN KEY (mini_league_id) REFERENCES mini_leagues(id) ON DELETE SET NULL`
- `vault_files_pkey`: `PRIMARY KEY (id)`
- `vault_files_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
- `vault_files_uploaded_by_fkey`: `FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL`
Evidence: supabase/functions/admin-delete-account/index.ts:486; supabase/functions/admin-delete-account/index.ts:507; supabase/functions/auto-purge-trash/index.ts:90.

#### vault_folders
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `club_id: uuid?`; `team_id: uuid?`; `name: text!`; `parent_id: uuid?`; `created_by: uuid?`; `created_at: timestamp with time zone!`; `updated_at: timestamp with time zone!`; `drive_folder_id: text?`; `chat_group_id: uuid?`; `restricted_roles: _app_role?`; `deleted_at: timestamp with time zone?`; `competition_id: uuid?`; `competition_team_id: uuid?`.
- `vault_folders_chat_group_id_fkey`: `FOREIGN KEY (chat_group_id) REFERENCES chat_groups(id) ON DELETE SET NULL`
- `vault_folders_club_id_fkey`: `FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE`
- `vault_folders_competition_id_fkey`: `FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE`
- `vault_folders_competition_team_id_fkey`: `FOREIGN KEY (competition_team_id) REFERENCES teams(id) ON DELETE SET NULL`
- `vault_folders_created_by_fkey`: `FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL`
- `vault_folders_parent_id_fkey`: `FOREIGN KEY (parent_id) REFERENCES vault_folders(id) ON DELETE CASCADE`
- `vault_folders_pkey`: `PRIMARY KEY (id)`
- `vault_folders_team_id_fkey`: `FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE`
Evidence: supabase/functions/backfill-chat-vault-groups/index.ts:159; supabase/functions/backfill-chat-vault-groups/index.ts:171; supabase/functions/drive-folder-sync/index.ts:284.

#### vault_storage_reservations
Code usage: generated contract only.
Columns: `id: uuid!`; `club_id: uuid!`; `user_id: uuid!`; `bytes: bigint!`; `status: text!`; `created_at: timestamp with time zone!`; `expires_at: timestamp with time zone!`.
- `vault_storage_reservations_bytes_check`: `CHECK ((bytes >= 0))`
- `vault_storage_reservations_pkey`: `PRIMARY KEY (id)`
- `vault_storage_reservations_status_check`: `CHECK ((status = ANY (ARRAY['active'::text, 'committed'::text, 'released'::text])))`

#### web_vitals
Code usage: literal frontend/edge reference.
Columns: `id: uuid!`; `user_id: uuid?`; `metric_name: text!`; `metric_value: double precision!`; `rating: text?`; `page_path: text?`; `user_agent: text?`; `connection_type: text?`; `device_memory: double precision?`; `created_at: timestamp with time zone!`.
- `web_vitals_pkey`: `PRIMARY KEY (id)`
- `web_vitals_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL`
Evidence: frontend/src/lib/webVitalsReporter.ts:43.

## 2. RPCs and functions
**Expected-by-code:** 157 distinct parsed frontend RPC names; complete call/signature matrix below, including edge callers.

**Found-in-this-DB:** 543 public functions inventoried with argument names/types, return types, default-argument count, security-definer and effective EXECUTE privileges.

**GAP (essential blocker):** Missing frontend RPCs: `accept_competition_role_email_invite`, `can_access_competition_vault`, `create_competition_role_email_invite`, `get_competition_role_email_invite_status`, `get_my_viewable_competition_match_ids`, `notify_competition_news`, `notify_mini_league_news`, `read_competition_playhq`, `read_game_history`, `read_game_result`, `read_history_player_stats`, `read_history_report_events`, `read_history_summary`, `revoke_competition_role_email_invite`, `save_competition_match_result`, `save_game_history`.

**DIFFERENCE (non-blocking):** Argument-name compatibility is static only; no RPC was invoked, including apparently read-only RPCs, because SECURITY DEFINER bodies may write or expose private rows.

### Requested critical functions
- **History/results:** `read_game_history(p_team_id uuid DEFAULT NULL, p_club_id uuid DEFAULT NULL, p_limit integer DEFAULT 100) → jsonb`, `read_game_result(p_event_id uuid) → jsonb`, `save_game_history(p_result jsonb, p_only_if_missing boolean)`, `read_history_player_stats`, `read_history_report_events`, `read_history_summary` are all absent. Expected bodies/signatures are in hybrid staged migration declarations; see matrix for exact source signatures. Email sessions take the Supabase path (`featureRouter.ts:70`), so canister alternatives do not rescue these flows.
- **Fixture visibility and scores:** `get_my_viewable_competition_match_ids() → TABLE(match_id uuid)` and `save_competition_match_result` absent. `read_competition_playhq` absent. These block scoped fixture visibility/result saving and protected PlayHQ reads on the Supabase branch.
- **Competition role invitations:** share-link `get_competition_role_link_status(p_token text)` and `accept_competition_role_link(p_token text)` exist; expected status result fields match the contracts. Email-bound create/status/accept/revoke RPCs and `competition_role_email_invites` are absent. Existing `competition_role_invites` is not a signature-compatible substitute.
- **`can_create_competition_event`:** DEV `(_user_id uuid, _competition_id uuid) → boolean`, security definer, exists. Generated types omit it; no direct literal frontend RPC call located. Server-side policy/helper contract still matters.
- **`club_admin_can_rename_group`:** DEV `(_user_id uuid, _group_id uuid, _club_id uuid) → boolean`, exists; caller arguments match. Generated types omit it, frontend uses an untyped cast.
- **Competition creation:** new first-call contract includes `p_operation_id`, `p_event_type`, `p_starts_at`, `p_ends_at`; DEV only has legacy `p_type`, `p_event_date`, `p_end_time` and returns integer. `createSupabaseCompetitionEvent.ts:19–38` retries legacy signature **only on PGRST202**. That fallback matches DEV; classify legacy support as DIFFERENCE, not an unconditional creation blocker. Idempotency support differs.
- **Notification queue:** `enqueue`, `fan_out`, `get_update_reminder_audience`, `schedule_message`, `update_scheduled_message`, `cancel_scheduled` are **Motoko canister methods**, not SQL RPCs. DEV SQL `enqueue_event_push(p_url text,p_rows jsonb)` and v2 are service-only delivery APIs, not substitutes. No SQL or actor method literally named `update_reminder` exists; it is a protected notification kind prefix.

### Queue scopes (static contract only)
- `enqueue(id:text,user:text,club:text,kind:text,body:text,key:text) → Result`; `fan_out(inputUsers:vec text,club:text,kind:text,body:text,key_prefix:text,related_id:opt text) → ResultNat16`. Recipients are principals, not Supabase user UUIDs; batch cap 500, de-duplication/preferences applied.
- `schedule_refresh`: caller must be club/app/league admin, or team admin/coach scoped to `related_id`. For club-wide scope (`related_id = null`), recipient needs a club role; for team scope recipient needs matching team scope. Entire recipient batch is authorized before writes. Protected `update_reminder*` kinds use update-reminder authorization; competition broadcasts require trusted relay.
- Evidence: `backend/notification_queue/src/main.mo:459,527–590,1622`, `src/scheduleAccess.mo`, `src/updateReminderAccess.mo`, frontend `live/features/notifications.ts`, `notificationBatching.ts`. Canister deployment IDs, worker authority, version and wiring were not queried/verified.

### Every parsed literal RPC contract (frontend and edge)
“Args subset match” checks supplied object keys against catalog parameter names; unknown/computed arguments or required omissions are not proven. Return types shown are catalog/staged/generated declarations, not sampled data.

#### accept_competition_role_email_invite
Expected callers: `frontend/src/pages/CompetitionOfficialJoinPage.tsx:150 args=p_token,p_verification_code_hash`.
Generated return: `{           competition_id: string \| null           role: string \| null           status: string         }[]`.
Staged SQL declaration (not applied): `accept_competition_role_email_invite(p_token text, p_verification_code_hash text) → TABLE(status text, competition_id uuid, role text)`; `supabase/migrations/20261014030000_email_bound_official_invites.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### accept_competition_role_link
Expected callers: `frontend/src/pages/CompetitionOfficialJoinPage.tsx:189 args=p_token`.
Staged SQL declaration (not applied): `accept_competition_role_link(p_token text) → TABLE(status text, competition_id uuid, chat_group_id uuid)`; `supabase/migrations/20261015192331_dbec16fd-1649-4a11-85ed-95857aabd325.sql`.
Found: `accept_competition_role_link(p_token text) → TABLE(status text, competition_id uuid, chat_group_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### admin_link_child_to_parent
Expected callers: `frontend/src/components/LinkChildToParentSheet.tsx:95 args=p_child_name,p_existing_child_id,p_parent_user_id,p_team_id,p_club_id,p_pending_invite_ids`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `admin_link_child_to_parent(p_parent_user_id uuid, p_team_id uuid, p_club_id uuid, p_child_name text, p_existing_child_id uuid DEFAULT NULL, p_pending_invite_ids uuid[] DEFAULT NULL) → void`; `supabase/migrations/20260804224302_dd6abb52-0475-41ca-8905-61c318b29242.sql`.
Found: `admin_link_child_to_parent(p_parent_user_id uuid, p_team_id uuid, p_club_id uuid, p_child_name text, p_existing_child_id uuid, p_pending_invite_ids uuid[]) → void`; default args=2; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### admin_update_rsvp_status
Expected callers: `frontend/src/features/events/eventRsvpWorkflow.ts:155 args=p_rsvp_id,p_status,p_acting_user_id`; `frontend/src/hooks/useEventRsvpMutations.ts:471 args=p_rsvp_id,p_status,p_acting_user_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `admin_update_rsvp_status(p_rsvp_id uuid, p_status text, p_acting_user_id uuid) → void`; `supabase/migrations/20260508224941_e1f427c4-7cb9-4d3e-ad2e-d5316c82fb1b.sql`.
Found: `admin_update_rsvp_status(p_rsvp_id uuid, p_status text, p_acting_user_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### admin_upsert_rsvp
Expected callers: `frontend/src/features/events/eventRsvpWorkflow.ts:147 args=<dynamic>`; `frontend/src/hooks/useEventRsvpMutations.ts:414 args=p_event_id,p_user_id,p_status,p_acting_user_id,p_child_id`; `frontend/src/hooks/useEventRsvpMutations.ts:423 args=p_event_id,p_user_id,p_status,p_acting_user_id,p_mini_league_player_id`; `frontend/src/hooks/useEventRsvpMutations.ts:511 args=p_event_id,p_user_id,p_status,p_acting_user_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `admin_upsert_rsvp(p_event_id uuid, p_user_id uuid, p_status text, p_acting_user_id uuid, p_child_id uuid DEFAULT NULL::uuid, p_mini_league_player_id uuid DEFAULT NULL::uuid) → void`; `supabase/migrations/20260610083610_5c785cb0-f8da-40db-aeca-e87066ed0b0e.sql`.
Found: `admin_upsert_rsvp(p_event_id uuid, p_user_id uuid, p_status text, p_acting_user_id uuid, p_child_id uuid, p_mini_league_player_id uuid) → void`; default args=2; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### allocate_eoi_to_team
Expected callers: `frontend/src/hooks/useEoiTeamBuilder.ts:60 args=_submission_id,_team_id`; `frontend/src/hooks/useEoiTeamBuilder.ts:91 args=_submission_id,_team_id`.
Generated return: `{           age_group: string \| null           allocated_at: string \| null           assigned_team_id: string \| null           child_id: string \| null           claim_token: string           claimed_at: string \| null           club_id: string           confirmed_at: string \| null           created_at: string           extra_notes: string \| null           game_days: string[]           id: string           invite_sent_at: string \| null           invite_sent_count: number           notes: string \| null           parent_confirmed_at: string \| null           parent_email: string           parent_mobile: string \| null           parent_name: string           parent_user_id: string \| null           player_dob: string \| null           player_gender: string \| null           player_name: string           preferred_position: string \| null           preferred_teammates: string \| null           registered_at: string \| null           returning_player: boolean           season_id: string           skill_level: number \| null           source: Database["public"]["Enums"]["eoi_source"]           status: Database["public"]["Enums"]["eoi_status"]           submitted_at: string           training_days: string[]           updated_at: string           withdrawn_at: string \| null         }`.
Staged SQL declaration (not applied): `allocate_eoi_to_team(_submission_id uuid, _team_id uuid) → public.eoi_submissions`; `supabase/migrations/20260417195631_a60831b6-63eb-4ff5-96e5-c52c66ff9a30.sql`.
Found: `allocate_eoi_to_team(_submission_id uuid, _team_id uuid) → eoi_submissions`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### apply_stripe_storage_addon
Expected callers: `supabase/functions/stripe-webhook/index.ts:936 args=p_event_id,p_club_id,p_storage_gb,p_user_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `apply_stripe_storage_addon(p_event_id text, p_club_id uuid, p_storage_gb integer, p_user_id uuid) → text`; `supabase/migrations/20260727032352_b9330d3c-5074-48dc-a78a-da5321ac42fe.sql`.
Found: `apply_stripe_storage_addon(p_event_id text, p_club_id uuid, p_storage_gb integer, p_user_id uuid) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### apply_stripe_subscription_transition
Expected callers: `supabase/functions/stripe-webhook/index.ts:361 args=p_event_id,p_event_type,p_event_at,p_subscription_id,p_transition,p_entity_type,p_entity_id,p_params`.
Generated return: `Json`.
Staged SQL declaration (not applied): `apply_stripe_subscription_transition(p_event_id text, p_event_type text, p_event_at timestamptz, p_subscription_id text, p_transition text, p_entity_type text DEFAULT NULL, p_entity_id uuid DEFAULT NULL, p_params jsonb DEFAULT '{}'::jsonb) → jsonb`; `supabase/migrations/20260727034414_a7c32e7a-9476-43e8-ba79-23b869b3c0ee.sql`.
Found: `apply_stripe_subscription_transition(p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription_id text, p_transition text, p_entity_type text, p_entity_id uuid, p_params jsonb) → jsonb`; default args=3; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### apply_verified_iap_purchase
Expected callers: `supabase/functions/verify-iap-receipt/index.ts:210 args=p_facts`.
Generated return: `Json`.
Staged SQL declaration (not applied): `apply_verified_iap_purchase(p_facts jsonb) → jsonb`; `supabase/migrations/20260726043547_1041407b-61ff-40fe-8665-af1f19be6fe5.sql`.
Found: `apply_verified_iap_purchase(p_facts jsonb) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### approve_chat_group_join_request
Expected callers: `frontend/src/components/chat/ChatGroupJoinRequests.tsx:80 args=_request_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `approve_chat_group_join_request(_request_id uuid) → uuid`; `supabase/migrations/20260602103128_c918cc68-94c4-4301-80de-ff21609a6763.sql`.
Found: `approve_chat_group_join_request(_request_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### approve_role_request
Expected callers: `frontend/src/pages/NotificationsPage.tsx:627 args=p_request_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `approve_role_request(p_request_id uuid) → void`; `supabase/migrations/20260719011514_aa8400f5-e3dc-450b-bbaf-51098b97958e.sql`.
Found: `approve_role_request(p_request_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### archive_season
Expected callers: `frontend/src/components/seasons/StartNewSeasonWizard.tsx:95 args=_season_id`; `frontend/src/pages/SeasonDetailPage.tsx:178 args=_season_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `archive_season(_season_id UUID) → VOID`; `supabase/migrations/20260417155655_85004b07-0f77-4915-85ee-893c5569aa2b.sql`.
Found: `archive_season(_season_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### authorize_storage_objects
Expected callers: `supabase/functions/get-signed-photo-url/index.ts:136 args=_user_id,_items`.
Generated return: `{           allowed: boolean           bucket: string           path: string         }[]`.
Staged SQL declaration (not applied): `authorize_storage_objects(_user_id uuid, _items jsonb) → TABLE(bucket text, path text, allowed boolean)`; `supabase/migrations/20261014093001_b735f7aa-ba6c-4618-8758-1dad2bb5a557.sql`.
Found: `authorize_storage_objects(_user_id uuid, _items jsonb) → TABLE(bucket text, path text, allowed boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### authorize_vault_deletion
Expected callers: `supabase/functions/permanent-delete-photos/index.ts:100 args=_caller_id,_kind,_record_id`.
Generated return: `{           authorized: boolean           created_at: string           effective_club_id: string           file_size: number           file_url: string           image_url: string           mini_league_id: string           owner_id: string           reason: string           storage_bucket: string           storage_path: string           team_id: string         }[]`.
Staged SQL declaration (not applied): `authorize_vault_deletion(_caller_id uuid, _kind text, _record_id uuid) → TABLE ( authorized boolean, reason text, effective_club_id uuid, team_id uuid, mini_league_id uuid, owner_id uuid, file_url text, image_url text, file_size bigint, created_at timestamptz, storage_bucket text, storage_path text )`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `authorize_vault_deletion(_caller_id uuid, _kind text, _record_id uuid) → TABLE(authorized boolean, reason text, effective_club_id uuid, team_id uuid, mini_league_id uuid, owner_id uuid, file_url text, image_url text, file_size bigint, created_at timestamp with time zone, storage_bucket text, storage_path text)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### begin_vault_deletion
Expected callers: `supabase/functions/permanent-delete-photos/index.ts:138 args=_caller_id,_kind,_record_id,_bucket,_object_path,_deletion_type`.
Generated return: `{           job_id: string           status: string         }[]`.
Staged SQL declaration (not applied): `begin_vault_deletion(_caller_id uuid, _kind text, _record_id uuid, _bucket text, _object_path text, _deletion_type text DEFAULT 'permanent') → TABLE (job_id uuid, status text)`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `begin_vault_deletion(_caller_id uuid, _kind text, _record_id uuid, _bucket text, _object_path text, _deletion_type text) → TABLE(job_id uuid, status text)`; default args=1; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### can_access_competition_vault
Expected callers: `frontend/src/features/vault/vaultAccessRepository.ts:264 args=_competition_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `can_access_competition_vault(_competition_id uuid) → boolean`; `supabase/migrations/20261012000000_add_competition_vault_access.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### can_control_pitch_board
Expected callers: `supabase/functions/pitch-timer-event/index.ts:286 args=_team_id,_event_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `can_control_pitch_board(_team_id uuid, _event_id uuid) → boolean`; `supabase/migrations/20260516005757_77c0b47f-9d80-4848-b0a6-46b8666df303.sql`.
Found: `can_control_pitch_board(_team_id uuid, _event_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### can_dm_user
Expected callers: `frontend/src/components/MemberDetailSheet.tsx:143 args=other_user_id`; `frontend/src/pages/DirectMessagePage.tsx:539 args=other_user_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `can_dm_user(other_user_id uuid) → boolean`; `supabase/migrations/20261009072209_d01fd590-7c65-40bc-bfa1-4605f76e804a.sql`.
Found: `can_dm_user(other_user_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### can_invite_players_to_team
Expected callers: `frontend/src/pages/TeamDetailPage.tsx:1046 args=_user_id,_team_id`.
Staged SQL declaration (not applied): `can_invite_players_to_team(_team_id uuid) → boolean`; `supabase/migrations/20261014000000_allow_competition_admin_team_invites.sql`.
Found: `can_invite_players_to_team(_user_id uuid, _team_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### carry_over_players
Expected callers: `frontend/src/components/seasons/BulkRolloverDialog.tsx:110 args=_source_season_id,_target_season_id,_club_player_ids`.
Generated return: `number`.
Staged SQL declaration (not applied): `carry_over_players(_source_season_id UUID, _target_season_id UUID, _club_player_ids UUID[]) → INT`; `supabase/migrations/20260417161107_5a22d65a-086c-448c-bb62-e7113d7ba70c.sql`.
Found: `carry_over_players(_source_season_id uuid, _target_season_id uuid, _club_player_ids uuid[]) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### carry_over_players_to_teams
Expected callers: `frontend/src/components/seasons/StartNewSeasonWizard.tsx:184 args=_target_season_id,_assignments`.
Generated return: `number`.
Staged SQL declaration (not applied): `carry_over_players_to_teams(_target_season_id UUID, _assignments JSONB) → INT`; `supabase/migrations/20260728071635_a0abce00-538f-466d-99eb-5fd2d5dfac08.sql`.
Found: `carry_over_players_to_teams(_target_season_id uuid, _assignments jsonb) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### claim_eoi_by_token
Expected callers: `frontend/src/hooks/useMyEois.ts:72 args=_token`.
Generated return: `{           age_group: string \| null           allocated_at: string \| null           assigned_team_id: string \| null           child_id: string \| null           claim_token: string           claimed_at: string \| null           club_id: string           confirmed_at: string \| null           created_at: string           extra_notes: string \| null           game_days: string[]           id: string           invite_sent_at: string \| null           invite_sent_count: number           notes: string \| null           parent_confirmed_at: string \| null           parent_email: string           parent_mobile: string \| null           parent_name: string           parent_user_id: string \| null           player_dob: string \| null           player_gender: string \| null           player_name: string           preferred_position: string \| null           preferred_teammates: string \| null           registered_at: string \| null           returning_player: boolean           season_id: string           skill_level: number \| null           source: Database["public"]["Enums"]["eoi_source"]           status: Database["public"]["Enums"]["eoi_status"]           submitted_at: string           training_days: string[]           updated_at: string           withdrawn_at: string \| null         }`.
Staged SQL declaration (not applied): `claim_eoi_by_token(_token text) → public.eoi_submissions`; `supabase/migrations/20260504035922_32d30f11-9a20-43fb-bc3c-9152cee7be21.sql`.
Found: `claim_eoi_by_token(_token text) → eoi_submissions`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### claim_icp_welcome_email
Expected callers: `supabase/functions/send-welcome-email-icp/index.ts:130 args=_invite_id`; `supabase/functions/send-welcome-email-icp/index.ts:168 args=_invite_id`; `supabase/functions/send-welcome-email-icp/index.ts:201 args=_invite_id`.
Staged SQL declaration (not applied): `claim_icp_welcome_email(_invite_id text) → boolean`; `supabase/migrations/20261013000000_add_icp_welcome_email_deliveries.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### claim_mini_league_invite
Expected callers: `frontend/src/pages/JoinTeamPage.tsx:908 args=_token`.
Generated return: `{           child_id: string           club_id: string           mini_league_id: string         }[]`.
Staged SQL declaration (not applied): `claim_mini_league_invite(_token uuid) → TABLE(child_id uuid, mini_league_id uuid, club_id uuid)`; `supabase/migrations/20260610072158_699b8639-8a37-4e89-836c-267741a08f0e.sql`.
Found: `claim_mini_league_invite(_token uuid) → TABLE(child_id uuid, mini_league_id uuid, club_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### claim_push_delivery_jobs
Expected callers: `supabase/functions/process-push-delivery-queue/index.ts:51 args=p_limit`.
Generated return: `{           attempt_count: number           id: string           notification_id: string           payload: Json           user_id: string         }[]`.
Staged SQL declaration (not applied): `claim_push_delivery_jobs(p_limit integer DEFAULT 25) → TABLE( id uuid, notification_id uuid, user_id uuid, payload jsonb, attempt_count integer )`; `supabase/migrations/20260726093234_bbfefd61-9362-4cc2-82d5-ccd335bc7a46.sql`.
Found: `claim_push_delivery_jobs(p_limit integer) → TABLE(id uuid, notification_id uuid, user_id uuid, payload jsonb, attempt_count integer)`; default args=1; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### claim_shell_team
Expected callers: `frontend/src/pages/ClaimTeamPage.tsx:48 args=p_token`.
Generated return: `{           club_id: string           team_id: string         }[]`.
Staged SQL declaration (not applied): `claim_shell_team(p_token uuid) → TABLE(team_id uuid, club_id uuid)`; `supabase/migrations/20260606105007_458eecec-28f5-4dc3-9514-61ea7adae7cf.sql`.
Found: `claim_shell_team(p_token uuid) → TABLE(team_id uuid, club_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### claim_stripe_webhook_event
Expected callers: `supabase/functions/stripe-webhook/index.ts:161 args=p_event_id,p_event_type,p_object_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `claim_stripe_webhook_event(p_event_id text, p_event_type text, p_object_id text DEFAULT NULL, p_stale_after interval DEFAULT interval '15 minutes') → text`; `supabase/migrations/20260727032352_b9330d3c-5074-48dc-a78a-da5321ac42fe.sql`.
Found: `claim_stripe_webhook_event(p_event_id text, p_event_type text, p_object_id text, p_stale_after interval) → text`; default args=2; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### claim_welcome_email_delivery
Expected callers: `supabase/functions/send-welcome-email/index.ts:119 args=_dedupe_key,_scope_kind,_scope_id,_recipient_user_id`.
Staged SQL declaration (not applied): `claim_welcome_email_delivery(_dedupe_key text, _scope_kind text, _scope_id uuid, _recipient_user_id uuid) → uuid`; `supabase/migrations/20261012020000_add_welcome_email_contract.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### cleanup_fcm_token_for_user
Expected callers: `frontend/src/hooks/useNativePush.ts:214 args=p_token,p_user_id`; `frontend/src/lib/nativePush.ts:220 args=p_token,p_user_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `cleanup_fcm_token_for_user(p_token TEXT, p_user_id UUID) → void`; `supabase/migrations/20260317085832_dda97ab7-9da0-4db0-9ecd-431c1f0bbcac.sql`.
Found: `cleanup_fcm_token_for_user(p_token text, p_user_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_admin_can_rename_group
Expected callers: `frontend/src/components/chat/EditGroupDialog.tsx:129 args=_user_id,_group_id,_club_id`; `frontend/src/pages/GroupChatPage.tsx:486 args=_user_id,_group_id,_club_id`.
Staged SQL declaration (not applied): `club_admin_can_rename_group(_user_id uuid, _group_id uuid, _club_id uuid) → boolean`; `supabase/migrations/20260917060659_1c828ee8-2b1e-488a-b21b-343e122e586e.sql`.
Found: `club_admin_can_rename_group(_user_id uuid, _group_id uuid, _club_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_engagement_active_users
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:407 args=_club_id,_start,_end`; `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:426 args=_club_id,_start,_end`; `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:449 args=_club_id,_start,_end`.
Generated return: `{           day: string           user_id: string         }[]`.
Staged SQL declaration (not applied): `club_engagement_active_users(_club_id uuid, _start timestamptz, _end timestamptz) → TABLE(day date, user_id uuid)`; `supabase/migrations/20260621201740_6317b10b-c91a-4d0f-a886-6d9fb6c75dc4.sql`.
Found: `club_engagement_active_users(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone) → TABLE(day date, user_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_engagement_benchmarks
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:930 args=_club_id,_start,_end,_prev_start,_prev_end`.
Generated return: `Json`.
Staged SQL declaration (not applied): `club_engagement_benchmarks(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone) → jsonb`; `supabase/migrations/20260622023024_2c209e7e-39ba-4bfb-83d9-8c53470852e3.sql`.
Found: `club_engagement_benchmarks(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### club_engagement_message_volume
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:677 args=_club_id,_start,_end`.
Generated return: `{           club_count: number           day: string           team_count: number         }[]`.
Staged SQL declaration (not applied): `club_engagement_message_volume(_club_id uuid, _start timestamptz, _end timestamptz) → TABLE(day date, club_count bigint, team_count bigint)`; `supabase/migrations/20260622030733_0b79f6ee-ec1d-4840-8cc9-8dab95e19cf3.sql`.
Found: `club_engagement_message_volume(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone) → TABLE(day date, club_count bigint, team_count bigint)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### club_engagement_rsvp_completion_series
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:706 args=_club_id,_start,_end`.
Generated return: `{           completion_pct: number           expected: number           responded: number           week: string         }[]`.
Staged SQL declaration (not applied): `club_engagement_rsvp_completion_series(_club_id uuid, _start timestamptz, _end timestamptz) → TABLE(week date, completion_pct numeric, responded bigint, expected bigint)`; `supabase/migrations/20260622031534_2442ee27-acb7-4787-ba60-76874b38a79e.sql`.
Found: `club_engagement_rsvp_completion_series(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone) → TABLE(week date, completion_pct numeric, responded bigint, expected bigint)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_engagement_sponsor_performance
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1005 args=_club_id,_start,_end,_prev_start,_prev_end`.
Generated return: `{           clicks: number           ctr: number           prev_clicks: number           prev_views: number           raw_clicks: number           raw_views: number           sponsor_id: string           sponsor_name: string           tracking_started: string           unique_reach: number           views: number         }[]`.
Staged SQL declaration (not applied): `club_engagement_sponsor_performance(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone) → TABLE(sponsor_id uuid, sponsor_name text, unique_reach integer, views integer, clicks integer, ctr numeric, prev_clicks integer, prev_views integer, raw_views integer, raw_clicks integer, tracking_started timestamp with time zone)`; `supabase/migrations/20260621235832_2e713316-dd25-4740-af52-f274cb1f5e14.sql`.
Found: `club_engagement_sponsor_performance(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone) → TABLE(sponsor_id uuid, sponsor_name text, unique_reach integer, views integer, clicks integer, ctr numeric, prev_clicks integer, prev_views integer, raw_views integer, raw_clicks integer, tracking_started timestamp with time zone)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_engagement_total_unique_reach
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:1030 args=_club_id,_start,_end`.
Generated return: `number`.
Staged SQL declaration (not applied): `club_engagement_total_unique_reach(_club_id uuid, _start timestamptz, _end timestamptz) → integer`; `supabase/migrations/20260624161436_9565ca3b-4d33-427f-aace-193bb8cf176a.sql`.
Found: `club_engagement_total_unique_reach(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### club_engagement_totals
Expected callers: `frontend/src/pages/ClubEngagementAnalyticsPage.tsx:628 args=_club_id,_start,_end`.
Generated return: `{           broadcasts: number           club_msgs: number           events: number           photos_uploaded: number           reactions: number           rsvps_going: number           rsvps_responded: number           rsvps_total: number           team_msgs: number         }[]`.
Staged SQL declaration (not applied): `club_engagement_totals(_club_id uuid, _start timestamptz, _end timestamptz) → TABLE(club_msgs bigint, team_msgs bigint, reactions bigint, broadcasts bigint, events bigint, rsvps_total bigint, rsvps_responded bigint, rsvps_going bigint, photos_uploaded bigint)`; `supabase/migrations/20260622030733_0b79f6ee-ec1d-4840-8cc9-8dab95e19cf3.sql`.
Found: `club_engagement_totals(_club_id uuid, _start timestamp with time zone, _end timestamp with time zone) → TABLE(club_msgs bigint, team_msgs bigint, reactions bigint, broadcasts bigint, events bigint, rsvps_total bigint, rsvps_responded bigint, rsvps_going bigint, photos_uploaded bigint)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### club_news_competition_ids
Expected callers: `frontend/src/features/news/useClubNews.ts:121 args=_club_id`.
Generated return: `string[]`.
Staged SQL declaration (not applied): `club_news_competition_ids(_club_id uuid) → SETOF uuid`; `supabase/migrations/20261010010000_mini_league_news_audience.sql`.
Found: `club_news_competition_ids(_club_id uuid) → SETOF uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### club_scoped_child_guardians
Expected callers: `frontend/src/hooks/useEventReminderMutations.ts:180 args=p_child_ids,p_club_id`; `frontend/src/lib/exportClubRoster.ts:152 args=p_child_ids,p_club_id`; `frontend/src/pages/EventDetailPage.tsx:1572 args=p_child_ids,p_club_id`; `frontend/src/pages/TeamDetailPage.tsx:724 args=p_child_ids,p_club_id`; `supabase/functions/send-event-reminders/index.ts:540 args=p_child_ids,p_club_id`.
Generated return: `{           child_id: string           guardian_id: string         }[]`.
Staged SQL declaration (not applied): `club_scoped_child_guardians(p_child_ids uuid[], p_club_id uuid) → TABLE(child_id uuid, guardian_id uuid)`; `supabase/migrations/20260819025253_6c62e02c-6520-41d0-a99d-20a137707100.sql`.
Found: `club_scoped_child_guardians(p_child_ids uuid[], p_club_id uuid) → TABLE(child_id uuid, guardian_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### complete_stripe_webhook_event
Expected callers: `supabase/functions/stripe-webhook/index.ts:270 args=p_event_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `complete_stripe_webhook_event(p_event_id text) → void`; `supabase/migrations/20260727032352_b9330d3c-5074-48dc-a78a-da5321ac42fe.sql`.
Found: `complete_stripe_webhook_event(p_event_id text) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### confirm_eoi_placement
Expected callers: `frontend/src/hooks/useMyEois.ts:47 args=_submission_id`.
Generated return: `{           age_group: string \| null           allocated_at: string \| null           assigned_team_id: string \| null           child_id: string \| null           claim_token: string           claimed_at: string \| null           club_id: string           confirmed_at: string \| null           created_at: string           extra_notes: string \| null           game_days: string[]           id: string           invite_sent_at: string \| null           invite_sent_count: number           notes: string \| null           parent_confirmed_at: string \| null           parent_email: string           parent_mobile: string \| null           parent_name: string           parent_user_id: string \| null           player_dob: string \| null           player_gender: string \| null           player_name: string           preferred_position: string \| null           preferred_teammates: string \| null           registered_at: string \| null           returning_player: boolean           season_id: string           skill_level: number \| null           source: Database["public"]["Enums"]["eoi_source"]           status: Database["public"]["Enums"]["eoi_status"]           submitted_at: string           training_days: string[]           updated_at: string           withdrawn_at: string \| null         }`.
Staged SQL declaration (not applied): `confirm_eoi_placement(_submission_id uuid) → public.eoi_submissions`; `supabase/migrations/20260417195631_a60831b6-63eb-4ff5-96e5-c52c66ff9a30.sql`.
Found: `confirm_eoi_placement(_submission_id uuid) → eoi_submissions`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### consume_dispatch_bootstrap_token
Expected callers: `supabase/functions/sync-dispatch-credentials/index.ts:40 args=_token`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `consume_dispatch_bootstrap_token(_token text) → boolean`; `supabase/migrations/20260731094335_e02c64a9-0751-4c85-aec8-5b16726998b0.sql`.
Found: `consume_dispatch_bootstrap_token(_token text) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### convert_event_to_recurring_series
Expected callers: `frontend/src/features/events/editEventWorkflow.ts:240 args=p_event_id,p_parent_updates,p_child_events,p_parent_event_date,p_parent_start_time,p_parent_end_time,p_recurrence_end_date`.
Generated return: `Json`.
Staged SQL declaration (not applied): `convert_event_to_recurring_series(p_event_id uuid, p_parent_updates jsonb, p_child_events jsonb, p_parent_event_date timestamp with time zone, p_parent_start_time timestamp with time zone, p_parent_end_time timestamp with time zone, p_recurrence_end_date date) → jsonb`; `supabase/migrations/20260812032908_35563d4a-7225-4b93-b9bb-0849ad66071d.sql`.
Found: `convert_event_to_recurring_series(p_event_id uuid, p_parent_updates jsonb, p_child_events jsonb, p_parent_event_date timestamp with time zone, p_parent_start_time timestamp with time zone, p_parent_end_time timestamp with time zone, p_recurrence_end_date date) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### create_association_club_event_atomic
Expected callers: `supabase/functions/association-create-club-event/index.ts:91 args=_caller_id,_association_id,_club_ids,_title,_description,_event_date,_start_time,_end_time,_location_name,_address,_allow_guests`.
Generated return: `Json`.
Staged SQL declaration (not applied): `create_association_club_event_atomic(_caller_id uuid, _association_id uuid, _club_ids uuid[], _title text, _description text, _event_date timestamptz, _start_time timestamptz, _end_time timestamptz, _location_name text, _address text, _allow_guests boolean) → jsonb`; `supabase/migrations/20260727021741_ba915595-8e50-4209-94a1-96fc1919649a.sql`.
Found: `create_association_club_event_atomic(_caller_id uuid, _association_id uuid, _club_ids uuid[], _title text, _description text, _event_date timestamp with time zone, _start_time timestamp with time zone, _end_time timestamp with time zone, _location_name text, _address text, _allow_guests boolean) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### create_child_for_parent_on_team
Expected callers: `frontend/src/components/team/AddPlayerToParentSheet.tsx:195 args=p_parent_user_id,p_team_id,p_name,p_year_of_birth`; `frontend/src/hooks/useAddBulkTeamMembersMutation.ts:306 args=p_parent_user_id,p_team_id,p_name,p_year_of_birth`; `frontend/src/hooks/useAddExistingTeamMemberMutation.ts:137 args=p_parent_user_id,p_team_id,p_name,p_year_of_birth`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_child_for_parent_on_team(p_parent_user_id uuid, p_team_id uuid, p_name text, p_year_of_birth integer DEFAULT NULL::integer) → uuid`; `supabase/migrations/20260821031038_d0c4c2c5-acf6-44ec-968e-ad4fbe02a030.sql`.
Found: `create_child_for_parent_on_team(p_parent_user_id uuid, p_team_id uuid, p_name text, p_year_of_birth integer) → uuid`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### create_competition_event
Expected callers: `frontend/src/features/competitions/createSupabaseCompetitionEvent.ts:19 args=p_operation_id,p_competition_id,p_title,p_event_type,p_starts_at,p_ends_at,p_location,p_description`; `frontend/src/features/competitions/createSupabaseCompetitionEvent.ts:30 args=p_competition_id,p_title,p_type,p_event_date,p_end_time,p_location,p_description`.
Generated return: `number`.
Staged SQL declaration (not applied): `create_competition_event(p_operation_id uuid, p_competition_id uuid, p_title text, p_event_type public.event_type, p_starts_at timestamptz, p_ends_at timestamptz, p_location text DEFAULT NULL, p_description text DEFAULT NULL) → integer`; `supabase/migrations/20261009100000_create_competition_event_fanout.sql`.
Found: `create_competition_event(p_competition_id uuid, p_title text, p_type event_type, p_event_date timestamp with time zone, p_location text, p_description text, p_end_time timestamp with time zone) → integer`; default args=3; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### create_competition_role_email_invite
Expected callers: `frontend/src/components/competitions/CompetitionOfficialJoinLinksCard.tsx:157 args=_competition_id,_role,_token,_email,_verification_code_hash`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_competition_role_email_invite(_competition_id uuid, _role text, _token text, _email text, _verification_code_hash text) → uuid`; `supabase/migrations/20261014030000_email_bound_official_invites.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### create_event_with_duties
Expected callers: `frontend/src/features/events/createEventWorkflow.ts:47 args=p_event,p_child_dates,p_duties`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_event_with_duties(p_event jsonb, p_child_dates timestamptz[] DEFAULT NULL, p_duties jsonb DEFAULT '[]'::jsonb) → uuid`; `supabase/migrations/20260731034429_92e4d97e-7809-4d34-ab3a-277ada400c04.sql`.
Found: `create_event_with_duties(p_event jsonb, p_child_dates timestamp with time zone[], p_duties jsonb) → uuid`; default args=2; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### create_personal_competition
Expected callers: `frontend/src/pages/CreateCompetitionPage.tsx:246 args=p_name,p_description,p_sport,p_season,p_visibility,p_shell_name`.
Generated return: `{           club_id: string           competition_id: string         }[]`.
Staged SQL declaration (not applied): `create_personal_competition(p_name text, p_description text DEFAULT NULL, p_sport text DEFAULT NULL, p_season text DEFAULT NULL, p_visibility text DEFAULT 'private', p_shell_name text DEFAULT NULL) → TABLE (competition_id uuid, club_id uuid)`; `supabase/migrations/20260720011429_4fea39ef-6f89-4875-8659-9a37ad09078e.sql`.
Found: `create_personal_competition(p_name text, p_description text, p_sport text, p_season text, p_visibility text, p_shell_name text) → TABLE(competition_id uuid, club_id uuid)`; default args=5; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### create_photo_album
Expected callers: `frontend/src/components/UploadPhotoSheet.tsx:899 args=<dynamic>`; `frontend/src/pages/PublishChatPhotosPage.tsx:385 args=_club_id,_team_id,_mini_league_id,_event_id,_caption`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_photo_album(_club_id uuid, _team_id uuid, _mini_league_id uuid, _event_id uuid, _caption text) → uuid`; `supabase/migrations/20260513203535_bcd312c4-8366-4eed-8a60-40ca465d5731.sql`.
Found: `create_photo_album(_club_id uuid, _team_id uuid, _mini_league_id uuid, _event_id uuid, _caption text) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### create_season_from_template
Expected callers: `frontend/src/components/seasons/SeasonTemplateDialog.tsx:52 args=_source_season_id,_new_name,_start_date,_end_date`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_season_from_template(_source_season_id uuid, _new_name text, _start_date date, _end_date date) → uuid`; `supabase/migrations/20260417192745_0589a1a6-482d-4941-99fe-f0db41c81547.sql`.
Found: `create_season_from_template(_source_season_id uuid, _new_name text, _start_date date, _end_date date) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### create_team_with_creator_admin
Expected callers: `frontend/src/pages/ClubSetupWizardPage.tsx:331 args=p_club_id,p_name,p_level_age,p_default_rsvp_audience`.
Generated return: `string`.
Staged SQL declaration (not applied): `create_team_with_creator_admin(p_club_id uuid, p_name text, p_level_age text DEFAULT NULL, p_default_rsvp_audience text DEFAULT 'players_and_parents') → uuid`; `supabase/migrations/20260728235105_99a7ba13-3c0a-42f3-810a-4578e7a9d87a.sql`.
Found: `create_team_with_creator_admin(p_club_id uuid, p_name text, p_level_age text, p_default_rsvp_audience text) → uuid`; default args=2; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### delete_media_photo
Expected callers: `frontend/src/lib/mediaPhotoDeletion.ts:71 args=_photo_id,_mode`.
Generated return: `{           already_deleted: boolean           mode: string           photo_id: string           vault_file_id: string           vault_updated: boolean         }[]`.
Staged SQL declaration (not applied): `delete_media_photo(_photo_id uuid, _mode text) → TABLE ( photo_id uuid, mode text, vault_file_id uuid, vault_updated boolean, already_deleted boolean )`; `supabase/migrations/20260727055726_c7d9fd14-7753-4e42-b6ea-a88a91033be4.sql`.
Found: `delete_media_photo(_photo_id uuid, _mode text) → TABLE(photo_id uuid, mode text, vault_file_id uuid, vault_updated boolean, already_deleted boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### deny_role_request
Expected callers: `frontend/src/pages/NotificationsPage.tsx:700 args=p_request_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `deny_role_request(p_request_id uuid) → void`; `supabase/migrations/20260517100659_403267c6-e03f-441a-beef-7fb1c5c1c6bd.sql`.
Found: `deny_role_request(p_request_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### dm_attachments_disabled
Expected callers: `frontend/src/pages/DirectMessagePage.tsx:514 args=_user_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `dm_attachments_disabled(_user_id uuid) → boolean`; `supabase/migrations/20260429231819_d2d901bd-df39-4b77-b132-ad985aefdda0.sql`.
Found: `dm_attachments_disabled(_user_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### dm_block_reason
Expected callers: `frontend/src/lib/dmBlockReason.ts:56 args=other_user_id`.
Staged SQL declaration (not applied): `dm_block_reason(other_user_id uuid) → text`; `supabase/migrations/20261009072209_d01fd590-7c65-40bc-bfa1-4605f76e804a.sql`.
Found: `dm_block_reason(other_user_id uuid) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### duplicate_season_structure
Expected callers: `frontend/src/components/seasons/StartNewSeasonWizard.tsx:117 args=_source_season_id,_new_season_name,_copy_staff`.
Generated return: `string`.
Staged SQL declaration (not applied): `duplicate_season_structure(_source_season_id uuid, _new_season_name text, _copy_staff boolean DEFAULT true) → uuid`; `supabase/migrations/20260729070345_c227ec87-e146-4a23-9cea-5789a28caddc.sql`.
Found: `duplicate_season_structure(_source_season_id uuid, _new_season_name text, _copy_staff boolean) → uuid`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### enqueue_event_push_v2
Expected callers: `supabase/functions/process-event-notifications/index.ts:269 args=p_url,p_rows`.
Generated return: `{           created: boolean           dedupe_key: string           notification_id: string           queued: boolean           user_id: string         }[]`.
Staged SQL declaration (not applied): `enqueue_event_push_v2(p_url text, p_rows jsonb) → TABLE( notification_id uuid, user_id uuid, dedupe_key text, created boolean, queued boolean )`; `supabase/migrations/20260824015944_acd2a1a1-c6fb-46a7-b4d2-eb657126229f.sql`.
Found: `enqueue_event_push_v2(p_url text, p_rows jsonb) → TABLE(notification_id uuid, user_id uuid, dedupe_key text, created boolean, queued boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### fail_stripe_webhook_event
Expected callers: `supabase/functions/stripe-webhook/index.ts:289 args=p_event_id,p_error`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `fail_stripe_webhook_event(p_event_id text, p_error text DEFAULT NULL) → void`; `supabase/migrations/20260727032352_b9330d3c-5074-48dc-a78a-da5321ac42fe.sql`.
Found: `fail_stripe_webhook_event(p_event_id text, p_error text) → void`; default args=1; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### fail_vault_deletion
Expected callers: `supabase/functions/permanent-delete-photos/index.ts:165 args=_job_id,_error_code`; `supabase/functions/permanent-delete-photos/index.ts:181 args=_job_id,_error_code`.
Generated return: `string`.
Staged SQL declaration (not applied): `fail_vault_deletion(_job_id uuid, _error_code text) → text`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `fail_vault_deletion(_job_id uuid, _error_code text) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### finalize_vault_deletion
Expected callers: `supabase/functions/permanent-delete-photos/index.ts:176 args=_job_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `finalize_vault_deletion(_job_id uuid) → text`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `finalize_vault_deletion(_job_id uuid) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### finish_icp_welcome_email
Expected callers: `supabase/functions/send-welcome-email-icp/index.ts:146 args=_invite_id,_sent,_provider_message_id,_error`; `supabase/functions/send-welcome-email-icp/index.ts:184 args=_invite_id,_sent,_provider_message_id,_error`; `supabase/functions/send-welcome-email-icp/index.ts:221 args=_invite_id,_sent,_provider_message_id,_error`; `supabase/functions/send-welcome-email-icp/index.ts:231 args=_invite_id,_sent,_provider_message_id,_error`.
Staged SQL declaration (not applied): `finish_icp_welcome_email(_invite_id text, _sent boolean, _provider_message_id text DEFAULT NULL, _error text DEFAULT NULL) → boolean`; `supabase/migrations/20261013000000_add_icp_welcome_email_deliveries.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### finish_welcome_email_delivery
Expected callers: `supabase/functions/send-welcome-email/index.ts:154 args=_delivery_id,_sent,_provider_message_id,_error`; `supabase/functions/send-welcome-email/index.ts:165 args=_delivery_id,_sent,_provider_message_id,_error`.
Staged SQL declaration (not applied): `finish_welcome_email_delivery(_delivery_id uuid, _sent boolean, _provider_message_id text DEFAULT NULL, _error text DEFAULT NULL) → boolean`; `supabase/migrations/20261012020000_add_welcome_email_contract.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### generate_email_hash
Expected callers: `supabase/functions/send-email/index.ts:509 args=email`.
Generated return: `string`.
Found: `generate_email_hash(email text) → text`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_club_day_events
Expected callers: `frontend/src/components/events/ClubDaySummary.tsx:131 args=_club_id,_day`.
Generated return: `{           address: string           end_time: string           event_date: string           id: string           is_cancelled: boolean           location_name: string           opponent: string           start_time: string           suburb: string           team_id: string           team_name: string           title: string           type: string         }[]`.
Staged SQL declaration (not applied): `get_club_day_events(_club_id uuid, _day date) → TABLE ( id uuid, title text, type text, event_date timestamptz, start_time timestamptz, end_time timestamptz, location_name text, address text, suburb text, team_id uuid, team_name text, opponent text, is_cancelled boolean )`; `supabase/migrations/20260502232020_164352f6-4162-4d6d-86d6-de6135aed805.sql`.
Found: `get_club_day_events(_club_id uuid, _day date) → TABLE(id uuid, title text, type text, event_date timestamp with time zone, start_time timestamp with time zone, end_time timestamp with time zone, location_name text, address text, suburb text, team_id uuid, team_name text, opponent text, is_cancelled boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_club_free_usage
Expected callers: `frontend/src/components/UploadPhotoSheet.tsx:828 args=_club_id`; `frontend/src/components/chat/ChatImageInput.tsx:385 args=_club_id`; `frontend/src/hooks/useClubFreeUsage.ts:181 args=_club_id`.
Generated return: `{           chat_file_storage_bytes: number           chat_file_uploads_this_cycle: number           chat_photo_uploads_this_cycle: number           cycle_end: string           cycle_start: string           file_count: number           file_storage_bytes: number           is_pro: boolean           photo_storage_bytes: number           photo_uploads_this_cycle: number           polls_this_cycle: number         }[]`.
Staged SQL declaration (not applied): `get_club_free_usage(_club_id uuid) → TABLE( cycle_start timestamptz, cycle_end timestamptz, photo_uploads_this_cycle integer, photo_storage_bytes bigint, chat_photo_uploads_this_cycle integer, chat_file_uploads_this_cycle integer, chat_file_storage_bytes bigint, file_count integer, file_storage_bytes bigint, polls_this_cycle integer, is_pro boolean )`; `supabase/migrations/20260624104611_f9c9eb39-be9a-4616-85c1-19aa35322c02.sql`.
Found: `get_club_free_usage(_club_id uuid) → TABLE(cycle_start timestamp with time zone, cycle_end timestamp with time zone, photo_uploads_this_cycle integer, photo_storage_bytes bigint, chat_photo_uploads_this_cycle integer, chat_file_uploads_this_cycle integer, chat_file_storage_bytes bigint, file_count integer, file_storage_bytes bigint, polls_this_cycle integer, is_pro boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_club_invite_by_token
Expected callers: `frontend/src/pages/JoinClubPage.tsx:83 args=_token`.
Generated return: `{           club_description: string           club_id: string           club_logo_url: string           club_name: string           created_at: string           created_by: string           expires_at: string           id: string           max_uses: number           role: Database["public"]["Enums"]["app_role"]           token: string           uses_count: number         }[]`.
Found: `get_club_invite_by_token(_token text) → TABLE(id uuid, club_id uuid, role app_role, token text, uses_count integer, max_uses integer, expires_at timestamp with time zone, created_at timestamp with time zone, created_by uuid, club_name text, club_logo_url text, club_description text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_club_leaderboard
Expected callers: `frontend/src/pages/LeaderboardPage.tsx:181 args=_club_id,_window,_viewer_id,_limit`.
Generated return: `{           avatar_url: string           display_name: string           hidden: boolean           is_viewer: boolean           points: number           rank: number           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_club_leaderboard(_club_id uuid, _window text, _viewer_id uuid, _limit integer) → TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)`; `supabase/migrations/20260514111542_14f87594-8f9a-4fdf-bbf0-fb29c8ad44b1.sql`.
Found: `get_club_leaderboard(_club_id uuid, _window text, _viewer_id uuid, _limit integer) → TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_competition_by_join_token
Expected callers: `frontend/src/pages/CompetitionJoinPage.tsx:195 args=p_token`; `supabase/functions/share-page/index.ts:133 args=p_token`.
Generated return: `{           id: string           name: string           organizer_club_id: string           organizer_club_name: string           season: string           sport: string           status: string         }[]`.
Staged SQL declaration (not applied): `get_competition_by_join_token(p_token uuid) → TABLE( id uuid, name text, organizer_club_id uuid, organizer_club_name text, sport text, season text, status text )`; `supabase/migrations/20260606111007_ac018d3e-6374-4aed-8050-a7164c0fc891.sql`.
Found: `get_competition_by_join_token(p_token uuid) → TABLE(id uuid, name text, organizer_club_id uuid, organizer_club_name text, sport text, season text, status text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_competition_event_recipients
Expected callers: `frontend/src/features/events/eventRecipientPolicy.ts:61 args=p_event_id`.
Staged SQL declaration (not applied): `get_competition_event_recipients(p_event_id uuid) → SETOF uuid`; `supabase/migrations/20261007215550_4301c00e-aa15-4e52-b51f-b3d2196c0e68.sql`.
Found: `get_competition_event_recipients(p_event_id uuid) → SETOF uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_competition_join_token_status
Expected callers: `frontend/src/pages/CompetitionJoinPage.tsx:197 args=p_token`.
Generated return: `string`.
Staged SQL declaration (not applied): `get_competition_join_token_status(p_token uuid) → text`; `supabase/migrations/20260607051901_6814f27f-8633-4820-af2b-5a9743c28bd2.sql`.
Found: `get_competition_join_token_status(p_token uuid) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_competition_role_email_invite_status
Expected callers: `frontend/src/pages/CompetitionOfficialJoinPage.tsx:77 args=p_token`.
Generated return: `{           competition_id: string \| null           competition_name: string \| null           role: string \| null           status: string         }[]`.
Staged SQL declaration (not applied): `get_competition_role_email_invite_status(p_token text) → TABLE(status text, competition_id uuid, competition_name text, role text)`; `supabase/migrations/20261014030000_email_bound_official_invites.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### get_competition_role_link_status
Expected callers: `frontend/src/pages/CompetitionOfficialJoinPage.tsx:91 args=p_token`.
Staged SQL declaration (not applied): `get_competition_role_link_status(p_token text) → TABLE(status text, competition_id uuid, competition_name text, role text)`; `supabase/migrations/20261015192331_dbec16fd-1649-4a11-85ed-95857aabd325.sql`.
Found: `get_competition_role_link_status(p_token text) → TABLE(status text, competition_id uuid, competition_name text, role text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_duplicate_push_subscriptions
Expected callers: `supabase/functions/cleanup-push-subscriptions/index.ts:89 args=<dynamic>`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### get_engagement_streak
Expected callers: `frontend/src/lib/engagementGamification.ts:151 args=_user_id,_club_id`.
Generated return: `number`.
Staged SQL declaration (not applied): `get_engagement_streak(_user_id uuid, _club_id uuid) → integer`; `supabase/migrations/20260523020140_4cb8f375-c206-41e6-986c-ed6172e3ac88.sql`.
Found: `get_engagement_streak(_user_id uuid, _club_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_eoi_by_claim_token
Expected callers: `frontend/src/pages/EoiCompletePage.tsx:93 args=_token`.
Generated return: `{           age_group: string \| null           allocated_at: string \| null           assigned_team_id: string \| null           child_id: string \| null           claim_token: string           claimed_at: string \| null           club_id: string           confirmed_at: string \| null           created_at: string           extra_notes: string \| null           game_days: string[]           id: string           invite_sent_at: string \| null           invite_sent_count: number           notes: string \| null           parent_confirmed_at: string \| null           parent_email: string           parent_mobile: string \| null           parent_name: string           parent_user_id: string \| null           player_dob: string \| null           player_gender: string \| null           player_name: string           preferred_position: string \| null           preferred_teammates: string \| null           registered_at: string \| null           returning_player: boolean           season_id: string           skill_level: number \| null           source: Database["public"]["Enums"]["eoi_source"]           status: Database["public"]["Enums"]["eoi_status"]           submitted_at: string           training_days: string[]           updated_at: string           withdrawn_at: string \| null         }`.
Staged SQL declaration (not applied): `get_eoi_by_claim_token(_token text) → public.eoi_submissions`; `supabase/migrations/20260417194907_5f30c04f-0394-41a0-9928-dd44c6024d05.sql`.
Found: `get_eoi_by_claim_token(_token text) → eoi_submissions`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_eoi_stats
Expected callers: `frontend/src/hooks/useEoiAdmin.ts:52 args=_club_id,_season_id`.
Generated return: `{           allocated: number           confirmed: number           conversion_rate: number           new_players: number           registered: number           returning_players: number           submitted: number           total: number           views: number           withdrawn: number         }[]`.
Staged SQL declaration (not applied): `get_eoi_stats(_club_id uuid, _season_id uuid DEFAULT NULL) → TABLE( total bigint, submitted bigint, allocated bigint, confirmed bigint, registered bigint, withdrawn bigint, new_players bigint, returning_players bigint, views bigint, conversion_rate numeric )`; `supabase/migrations/20260417201551_285af472-c894-4952-a286-e251714bd22f.sql`.
Found: `get_eoi_stats(_club_id uuid, _season_id uuid) → TABLE(total bigint, submitted bigint, allocated bigint, confirmed bigint, registered bigint, withdrawn bigint, new_players bigint, returning_players bigint, views bigint, conversion_rate numeric)`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_event_non_responders_audience
Expected callers: `supabase/functions/auto-rsvp-dm-cron/index.ts:264 args=_event_id,_audience`; `supabase/functions/auto-rsvp-push-cron/index.ts:196 args=_event_id,_audience`.
Generated return: `{           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_event_non_responders_audience(_event_id uuid, _audience text) → TABLE(user_id uuid)`; `supabase/migrations/20260521083115_edd20330-ad8b-4a45-b4dd-e14ba4ece854.sql`.
Found: `get_event_non_responders_audience(_event_id uuid, _audience text) → TABLE(user_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_group_captain_user_ids
Expected callers: `supabase/functions/process-message-notifications/index.ts:356 args=_group_id`.
Staged SQL declaration (not applied): `get_group_captain_user_ids(_group_id uuid) → SETOF uuid`; `supabase/migrations/20261007230606_aa4b7adc-1b13-4774-851d-8edad17d16ed.sql`.
Found: `get_group_captain_user_ids(_group_id uuid) → SETOF uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_inbox_latest_club_messages
Expected callers: `frontend/src/components/layout/DesktopMessagesRail.tsx:305 args=_club_ids`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:186 args=_club_ids`; `frontend/src/features/messaging/inbox/inboxRepositories.ts:345 args=_club_ids`.
Generated return: `{           author_display_name: string           author_id: string           club_id: string           created_at: string           image_url: string           message_id: string           text: string         }[]`.
Staged SQL declaration (not applied): `get_inbox_latest_club_messages(_club_ids uuid[]) → TABLE ( club_id uuid, message_id uuid, text text, created_at timestamptz, image_url text, author_id uuid, author_display_name text )`; `supabase/migrations/20260708013949_fea1ae28-9af1-4e20-ad97-3a5eec783a1c.sql`.
Found: `get_inbox_latest_club_messages(_club_ids uuid[]) → TABLE(club_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, author_display_name text)`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_inbox_latest_dm_messages
Expected callers: `frontend/src/components/layout/DesktopMessagesRail.tsx:101 args=_conversation_ids`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:514 args=_conversation_ids`; `frontend/src/features/messaging/inbox/inboxRepositories.ts:216 args=_conversation_ids`.
Generated return: `{           author_id: string           conversation_id: string           created_at: string           image_url: string           message_id: string           text: string         }[]`.
Staged SQL declaration (not applied): `get_inbox_latest_dm_messages(_conversation_ids uuid[]) → TABLE ( conversation_id uuid, message_id uuid, text text, image_url text, created_at timestamptz, author_id uuid )`; `supabase/migrations/20260520052315_2c09c175-5c40-4b0e-9f8b-df4745ee92b9.sql`.
Found: `get_inbox_latest_dm_messages(_conversation_ids uuid[]) → TABLE(conversation_id uuid, message_id uuid, text text, image_url text, created_at timestamp with time zone, author_id uuid)`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_inbox_latest_group_messages
Expected callers: `frontend/src/components/layout/DesktopMessagesRail.tsx:167 args=_group_ids`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:450 args=_group_ids`; `frontend/src/features/messaging/inbox/inboxRepositories.ts:635 args=_group_ids`.
Generated return: `{           author_display_name: string           author_id: string           created_at: string           group_id: string           image_url: string           message_id: string           text: string         }[]`.
Staged SQL declaration (not applied): `get_inbox_latest_group_messages(_group_ids uuid[]) → TABLE ( group_id uuid, message_id uuid, text text, created_at timestamptz, image_url text, author_id uuid, author_display_name text )`; `supabase/migrations/20260708013949_fea1ae28-9af1-4e20-ad97-3a5eec783a1c.sql`.
Found: `get_inbox_latest_group_messages(_group_ids uuid[]) → TABLE(group_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, author_display_name text)`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_inbox_latest_team_messages
Expected callers: `frontend/src/components/layout/DesktopMessagesRail.tsx:247 args=_team_ids`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:303 args=_team_ids`; `frontend/src/features/messaging/inbox/inboxRepositories.ts:485 args=_team_ids`.
Generated return: `{           author_display_name: string           author_id: string           club_announcement_name: string           created_at: string           image_url: string           is_club_announcement: boolean           message_id: string           team_id: string           text: string         }[]`.
Staged SQL declaration (not applied): `get_inbox_latest_team_messages(_team_ids uuid[]) → TABLE ( team_id uuid, message_id uuid, text text, created_at timestamptz, image_url text, author_id uuid, is_club_announcement boolean, club_announcement_name text, author_display_name text )`; `supabase/migrations/20260708013949_fea1ae28-9af1-4e20-ad97-3a5eec783a1c.sql`.
Found: `get_inbox_latest_team_messages(_team_ids uuid[]) → TABLE(team_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, is_club_announcement boolean, club_announcement_name text, author_display_name text)`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_manual_group_participants
Expected callers: `frontend/src/components/chat/ChatParticipantsList.tsx:479 args=p_group_id`.
Generated return: `{           avatar_url: string           display_name: string           is_creator: boolean           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_manual_group_participants(p_group_id uuid) → TABLE(user_id uuid, display_name text, avatar_url text, is_creator boolean)`; `supabase/migrations/20260926212818_a60a41df-9a21-4b55-8d0a-6302b3e82d48.sql`.
Found: `get_manual_group_participants(p_group_id uuid) → TABLE(user_id uuid, display_name text, avatar_url text, is_creator boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_members_events_enabled
Expected callers: `frontend/src/components/event/AttendanceSection.tsx:228 args=member_ids`; `supabase/functions/send-event-view-reminder/index.ts:460 args=member_ids`.
Generated return: `{           events_enabled: boolean           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_members_events_enabled(member_ids uuid[]) → TABLE(user_id uuid, events_enabled boolean)`; `supabase/migrations/20260214094741_61de360f-5bcb-42e3-9b3e-d55a917d9c8a.sql`.
Found: `get_members_events_enabled(member_ids uuid[]) → TABLE(user_id uuid, events_enabled boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_members_messages_enabled
Expected callers: `frontend/src/components/chat/ChatParticipantsList.tsx:598 args=member_ids`.
Generated return: `{           messages_enabled: boolean           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_members_messages_enabled(member_ids uuid[]) → TABLE(user_id uuid, messages_enabled boolean)`; `supabase/migrations/20260214091224_12bce874-6aee-498c-9d3d-7e34f8eda70d.sql`.
Found: `get_members_messages_enabled(member_ids uuid[]) → TABLE(user_id uuid, messages_enabled boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_members_push_reachable
Expected callers: `frontend/src/components/chat/ChatParticipantsList.tsx:618 args=member_ids`; `frontend/src/components/event/AttendanceSection.tsx:212 args=member_ids`.
Generated return: `{           has_push: boolean           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_members_push_reachable(member_ids uuid[]) → TABLE(user_id uuid, has_push boolean)`; `supabase/migrations/20260323015352_8bfb4aa3-5823-4776-b720-9756b31e768b.sql`.
Found: `get_members_push_reachable(member_ids uuid[]) → TABLE(user_id uuid, has_push boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_messages_page_bootstrap
Expected callers: `frontend/src/hooks/useMessagesPageBootstrap.ts:100 args=_user_id`.
Generated return: `Json`.
Staged SQL declaration (not applied): `get_messages_page_bootstrap(_user_id uuid) → jsonb`; `supabase/migrations/20260520082823_747311e3-bc9a-49fa-87c7-bc3db115e36d.sql`.
Found: `get_messages_page_bootstrap(_user_id uuid) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_my_accessible_chat_group_ids
Expected callers: `frontend/src/components/layout/DesktopMessagesRail.tsx:146 args=_user_id`; `frontend/src/features/messaging/inbox/inboxPreviewSources.ts:419 args=_user_id`; `frontend/src/features/messaging/inbox/inboxRepositories.ts:598 args=_user_id`.
Generated return: `string[]`.
Staged SQL declaration (not applied): `get_my_accessible_chat_group_ids(_user_id uuid) → uuid[]`; `supabase/migrations/20261007230849_67e1f4d0-b428-49b3-9ca8-45c4dbac4f57.sql`.
Found: `get_my_accessible_chat_group_ids(_user_id uuid) → uuid[]`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_my_pending_eois
Expected callers: `frontend/src/hooks/useMyEois.ts:28 args=<dynamic>`.
Generated return: `{           age_group: string \| null           allocated_at: string \| null           assigned_team_id: string \| null           child_id: string \| null           claim_token: string           claimed_at: string \| null           club_id: string           confirmed_at: string \| null           created_at: string           extra_notes: string \| null           game_days: string[]           id: string           invite_sent_at: string \| null           invite_sent_count: number           notes: string \| null           parent_confirmed_at: string \| null           parent_email: string           parent_mobile: string \| null           parent_name: string           parent_user_id: string \| null           player_dob: string \| null           player_gender: string \| null           player_name: string           preferred_position: string \| null           preferred_teammates: string \| null           registered_at: string \| null           returning_player: boolean           season_id: string           skill_level: number \| null           source: Database["public"]["Enums"]["eoi_source"]           status: Database["public"]["Enums"]["eoi_status"]           submitted_at: string           training_days: string[]           updated_at: string           withdrawn_at: string \| null         }[]`.
Staged SQL declaration (not applied): `get_my_pending_eois() → SETOF public.eoi_submissions`; `supabase/migrations/20260417195631_a60831b6-63eb-4ff5-96e5-c52c66ff9a30.sql`.
Found: `get_my_pending_eois() → SETOF eoi_submissions`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_my_viewable_competition_match_ids
Expected callers: `frontend/src/features/events/competitionFixtureVisibility.ts:10 args=<dynamic>`.
Generated return: `{ match_id: string }[]`.
Staged SQL declaration (not applied): `get_my_viewable_competition_match_ids() → TABLE (match_id uuid)`; `supabase/migrations/20261014010000_allow_competition_fixture_read.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### get_or_create_club_admin_conversation
Expected callers: `frontend/src/components/ContactClubButton.tsx:167 args=p_club_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `get_or_create_club_admin_conversation(p_club_id uuid) → uuid`; `supabase/migrations/20260331042612_f99edb31-de1a-46e3-9cac-2c372cc02925.sql`.
Found: `get_or_create_club_admin_conversation(p_club_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_or_create_competition_admin_chat
Expected callers: `frontend/src/components/competitions/ContactCompetitionAdminsButton.tsx:47 args=p_competition_id`; `frontend/src/pages/CompetitionDetailPage.tsx:345 args=p_competition_id`.
Staged SQL declaration (not applied): `get_or_create_competition_admin_chat(p_competition_id uuid) → uuid`; `supabase/migrations/20260927011908_fe42ee3b-731e-4bdd-9f97-cc603462c82d.sql`.
Found: `get_or_create_competition_admin_chat(p_competition_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_or_create_dm_conversation
Expected callers: `frontend/src/components/MemberDetailSheet.tsx:208 args=other_user_id`; `frontend/src/components/chat/StartDMDialog.tsx:551 args=other_user_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `get_or_create_dm_conversation(other_user_id UUID) → UUID`; `supabase/migrations/20260424232155_5d82e9b7-8539-4364-81da-177ad1a26ae7.sql`.
Found: `get_or_create_dm_conversation(other_user_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_pending_invite_by_token
Expected callers: `frontend/src/features/membership/inviteTokenRepository.ts:2 args=_token`; `frontend/src/pages/JoinTeamPage.tsx:172 args=_token`.
Generated return: `{           club_id: string           club_logo_url: string           club_name: string           id: string           invited_email: string           invited_label: string           metadata: Json           role: string           status: string           team_id: string           team_logo_url: string           team_name: string         }[]`.
Staged SQL declaration (not applied): `get_pending_invite_by_token(_token text) → TABLE(id uuid, team_id uuid, club_id uuid, role text, invited_label text, invited_email text, status text, team_name text, team_logo_url text, club_name text, club_logo_url text, metadata jsonb)`; `supabase/migrations/20260125204707_28b6e6fc-11a2-4185-81c8-3f7afd77ad92.sql`.
Found: `get_pending_invite_by_token(_token text) → TABLE(id uuid, team_id uuid, club_id uuid, role text, invited_label text, invited_email text, status text, team_name text, team_logo_url text, club_name text, club_logo_url text, metadata jsonb)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_photo_view_counts
Expected callers: `frontend/src/hooks/usePhotoViews.ts:52 args=_photo_ids`.
Generated return: `{           photo_id: string           view_count: number         }[]`.
Staged SQL declaration (not applied): `get_photo_view_counts(_photo_ids uuid[]) → TABLE(photo_id uuid, view_count bigint)`; `supabase/migrations/20260420102338_12c39587-10f2-40b1-bc8b-ff076f880da4.sql`.
Found: `get_photo_view_counts(_photo_ids uuid[]) → TABLE(photo_id uuid, view_count bigint)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_public_eoi_config
Expected callers: `frontend/src/pages/PublicEoiFormPage.tsx:80 args=_club_slug,_season_slug`.
Generated return: `{           ask_availability: boolean           ask_position: boolean           ask_preferences: boolean           ask_skill_level: boolean           closes_at: string           club_id: string           club_logo_url: string           club_name: string           is_open: boolean           opens_at: string           require_dob: boolean           require_gender: boolean           season_id: string           season_name: string           thank_you_message: string           thank_you_redirect_url: string           welcome_message: string         }[]`.
Staged SQL declaration (not applied): `get_public_eoi_config(_club_slug text, _season_slug text) → TABLE( season_id uuid, season_name text, club_id uuid, club_name text, club_logo_url text, is_open boolean, opens_at timestamptz, closes_at timestamptz, welcome_message text, thank_you_message text, thank_you_redirect_url text, require_dob boolean, require_gender boolean, ask_preferences boolean, ask_availability boolean, ask_skill_level boolean, ask_position boolean )`; `supabase/migrations/20260417201551_285af472-c894-4952-a286-e251714bd22f.sql`.
Found: `get_public_eoi_config(_club_slug text, _season_slug text) → TABLE(season_id uuid, season_name text, club_id uuid, club_name text, club_logo_url text, is_open boolean, opens_at timestamp with time zone, closes_at timestamp with time zone, welcome_message text, thank_you_message text, thank_you_redirect_url text, require_dob boolean, require_gender boolean, ask_preferences boolean, ask_availability boolean, ask_skill_level boolean, ask_position boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_push_notification_health
Expected callers: `frontend/src/pages/PushAnalyticsPage.tsx:238 args=<dynamic>`.
Generated return: `Json`.
Staged SQL declaration (not applied): `get_push_notification_health() → jsonb`; `supabase/migrations/20260509192959_2dfcb672-76fe-4d18-8421-37acbde0a467.sql`.
Found: `get_push_notification_health() → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_returning_players
Expected callers: `frontend/src/components/seasons/BulkRolloverDialog.tsx:64 args=_source_season_id`; `frontend/src/components/seasons/ReturningMembersStep.tsx:67 args=_source_season_id`.
Generated return: `{           age_years: number           club_player_id: string           date_of_birth: string           display_name: string           membership_role: Database["public"]["Enums"]["team_membership_role"]           previous_team_id: string           previous_team_name: string         }[]`.
Staged SQL declaration (not applied): `get_returning_players(_source_season_id UUID) → TABLE ( club_player_id UUID, display_name TEXT, date_of_birth DATE, age_years INT, previous_team_id UUID, previous_team_name TEXT, membership_role public.team_membership_role )`; `supabase/migrations/20260417161107_5a22d65a-086c-448c-bb62-e7113d7ba70c.sql`.
Found: `get_returning_players(_source_season_id uuid) → TABLE(club_player_id uuid, display_name text, date_of_birth date, age_years integer, previous_team_id uuid, previous_team_name text, membership_role team_membership_role)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_targeted_event_attendance_roster
Expected callers: `frontend/src/features/events/targetedAttendanceRepository.ts:10 args=p_event_id`; `frontend/src/pages/EventDetailPage.tsx:1453 args=p_event_id`.
Generated return: `{           display_name: string           kind: string           parent_id: string           person_id: string           team_ids: string[]         }[]`.
Staged SQL declaration (not applied): `get_targeted_event_attendance_roster(p_event_id uuid) → TABLE ( kind text, person_id uuid, display_name text, parent_id uuid, team_ids uuid[] )`; `supabase/migrations/20260726022309_5c4e12ce-300e-43d7-9bc8-8651485c9be1.sql`.
Found: `get_targeted_event_attendance_roster(p_event_id uuid) → TABLE(kind text, person_id uuid, display_name text, parent_id uuid, team_ids uuid[])`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_targeted_event_notification_recipients
Expected callers: `frontend/src/features/events/eventRecipientPolicy.ts:67 args=p_event_id`.
Generated return: `{           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_targeted_event_notification_recipients(p_event_id uuid) → TABLE(user_id uuid)`; `supabase/migrations/20260811111328_5420009e-f9b4-4a17-b57c-60e69c925a42.sql`.
Found: `get_targeted_event_notification_recipients(p_event_id uuid) → TABLE(user_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_team_children_for_pitch_board
Expected callers: `frontend/src/pages/AttendanceStatsPage.tsx:391 args=p_team_id`; `frontend/src/pages/EventDetailPage.tsx:935 args=p_team_id`; `frontend/src/pages/HomePage.tsx:1869 args=p_team_id`; `frontend/src/pages/TeamDetailPage.tsx:706 args=p_team_id`.
Generated return: `{           assignment_id: string           child_id: string           child_name: string           parent_id: string           year_of_birth: number         }[]`.
Staged SQL declaration (not applied): `get_team_children_for_pitch_board(p_team_id uuid) → TABLE(assignment_id uuid, child_id uuid, child_name text, year_of_birth integer, parent_id uuid)`; `supabase/migrations/20260401122000_28a2ed7d-29ff-42bb-b453-c51bb625761b.sql`.
Found: `get_team_children_for_pitch_board(p_team_id uuid) → TABLE(assignment_id uuid, child_id uuid, child_name text, year_of_birth integer, parent_id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_team_competition_names
Expected callers: `frontend/src/components/MyTeamsPremiumCarousel.tsx:1080 args=_team_ids`.
Generated return: `{           competition_id: string           competition_logo_url: string           competition_name: string           competition_sport: string           team_id: string         }[]`.
Staged SQL declaration (not applied): `get_team_competition_names(_team_ids uuid[]) → TABLE( team_id uuid, competition_id uuid, competition_name text, competition_logo_url text, competition_sport text )`; `supabase/migrations/20260620074938_1a5c4991-86d1-41dc-a916-11865e0cde1b.sql`.
Found: `get_team_competition_names(_team_ids uuid[]) → TABLE(team_id uuid, competition_id uuid, competition_name text, competition_logo_url text, competition_sport text)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_team_invite_by_token
Expected callers: `frontend/src/features/membership/inviteTokenRepository.ts:10 args=_token`; `frontend/src/pages/JoinTeamPage.tsx:318 args=_token`.
Generated return: `{           club_id: string           club_name: string           created_at: string           created_by: string           expires_at: string           id: string           max_uses: number           metadata: Json           role: string           team_id: string           team_logo_url: string           team_name: string           token: string           uses_count: number         }[]`.
Staged SQL declaration (not applied): `get_team_invite_by_token(_token text) → TABLE( id uuid, team_id uuid, role text, token text, uses_count int, max_uses int, expires_at timestamptz, created_at timestamptz, created_by uuid, team_name text, team_logo_url text, club_id uuid, club_name text, metadata jsonb )`; `supabase/migrations/20260409104918_4a1ddd21-77c0-499f-a2b3-7205bca831d4.sql`.
Found: `get_team_invite_by_token(_token text) → TABLE(id uuid, team_id uuid, role text, token text, uses_count integer, max_uses integer, expires_at timestamp with time zone, created_at timestamp with time zone, created_by uuid, team_name text, team_logo_url text, club_id uuid, club_name text, metadata jsonb)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_team_leaderboard
Expected callers: `frontend/src/pages/LeaderboardPage.tsx:191 args=_team_id,_window,_viewer_id,_limit`.
Generated return: `{           avatar_url: string           display_name: string           hidden: boolean           is_viewer: boolean           points: number           rank: number           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_team_leaderboard(_team_id uuid, _window text, _viewer_id uuid, _limit integer) → TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)`; `supabase/migrations/20260514111542_14f87594-8f9a-4fdf-bbf0-fb29c8ad44b1.sql`.
Found: `get_team_leaderboard(_team_id uuid, _window text, _viewer_id uuid, _limit integer) → TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_teams_leaderboard
Expected callers: `frontend/src/components/team/TeamRankCard.tsx:44 args=_club_id,_window,_limit`; `frontend/src/pages/LeaderboardPage.tsx:227 args=_club_id,_window,_limit`.
Generated return: `{           points: number           rank: number           team_id: string           team_name: string         }[]`.
Staged SQL declaration (not applied): `get_teams_leaderboard(_club_id uuid, _window text, _limit integer) → TABLE(rank integer, team_id uuid, team_name text, points integer)`; `supabase/migrations/20260513075801_036241f1-549a-451a-94ca-ee79331fa706.sql`.
Found: `get_teams_leaderboard(_club_id uuid, _window text, _limit integer) → TABLE(rank integer, team_id uuid, team_name text, points integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### get_unread_message_counts
Expected callers: `frontend/src/lib/unreadMessageCounts.ts:63 args=_user_id`.
Generated return: `Json`.
Staged SQL declaration (not applied): `get_unread_message_counts(_user_id uuid) → jsonb`; `supabase/migrations/20260604020432_8cc6a7bf-b53e-41ec-8881-e1bd45de4905.sql`.
Found: `get_unread_message_counts(_user_id uuid) → jsonb`; default args=0; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_user_by_email_for_passkey
Expected callers: `frontend/src/components/mini-league/AddSecondParentDialog.tsx:102 args=lookup_email`; `supabase/functions/passkey-authenticate/index.ts:168 args=lookup_email`.
Generated return: `{           id: string         }[]`.
Staged SQL declaration (not applied): `get_user_by_email_for_passkey(lookup_email text) → TABLE(id uuid)`; `supabase/migrations/20260116224900_6d317537-8b39-4e35-aafb-2111b079b801.sql`.
Found: `get_user_by_email_for_passkey(lookup_email text) → TABLE(id uuid)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_user_emails
Expected callers: `supabase/functions/send-email/index.ts:930 args=user_ids`; `supabase/functions/send-enrolment-notification-email/index.ts:37 args=user_ids`; `supabase/functions/send-event-view-reminder/index.ts:313 args=user_ids`; `supabase/functions/send-game-stats-email/index.ts:140 args=user_ids`; `supabase/functions/send-message-notification-email/index.ts:117 args=user_ids`; `supabase/functions/send-photo-notification-email/index.ts:148 args=user_ids`; `supabase/functions/send-pitch-board-notification-email/index.ts:147 args=user_ids`.
Generated return: `{           email: string           id: string         }[]`.
Staged SQL declaration (not applied): `get_user_emails(user_ids uuid[]) → TABLE (id uuid, email text)`; `supabase/migrations/20260426112925_7490edda-1980-47aa-8a11-d7c69d2712a4.sql`.
Found: `get_user_emails(user_ids uuid[]) → TABLE(id uuid, email text)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### get_user_emails_by_ids
Expected callers: `frontend/src/features/notifications/roleRequestService.ts:90 args=user_ids`; `frontend/src/pages/NotificationsPage.tsx:643 args=user_ids`; `frontend/src/pages/NotificationsPage.tsx:715 args=user_ids`; `supabase/functions/send-event-reminders/index.ts:183 args=user_ids`; `supabase/functions/send-event-reminders/index.ts:447 args=user_ids`; `supabase/functions/send-renewal-reminders/index.ts:208 args=user_ids`; `supabase/functions/send-renewal-reminders/index.ts:339 args=user_ids`; `supabase/functions/send-storage-warnings/index.ts:168 args=user_ids`; `supabase/functions/stripe-webhook/index.ts:505 args=user_ids`; `supabase/functions/stripe-webhook/index.ts:603 args=user_ids`; `supabase/functions/stripe-webhook/index.ts:666 args=user_ids`; `supabase/functions/stripe-webhook/index.ts:726 args=user_ids`.
Generated return: `{           email: string           user_id: string         }[]`.
Staged SQL declaration (not applied): `get_user_emails_by_ids(user_ids uuid[]) → TABLE(user_id uuid, email text)`; `supabase/migrations/20260116224900_6d317537-8b39-4e35-aafb-2111b079b801.sql`.
Found: `get_user_emails_by_ids(user_ids uuid[]) → TABLE(user_id uuid, email text)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### get_user_leaderboard_rank
Expected callers: `frontend/src/lib/engagementGamification.ts:85 args=_user_id,_club_id`.
Generated return: `number`.
Staged SQL declaration (not applied): `get_user_leaderboard_rank(_user_id uuid, _club_id uuid) → integer`; `supabase/migrations/20260416080636_7f638056-758f-4d26-a2cc-6cd131f00295.sql`.
Found: `get_user_leaderboard_rank(_user_id uuid, _club_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_user_leaderboard_rank_all_time
Expected callers: `frontend/src/pages/ProfilePage.tsx:279 args=_user_id,_club_id`.
Generated return: `{           points: number           rank: number           total: number         }[]`.
Staged SQL declaration (not applied): `get_user_leaderboard_rank_all_time(_user_id uuid, _club_id uuid) → TABLE (rank int, total int, points int)`; `supabase/migrations/20260426121303_3eb7827b-4d2f-4ea5-bb5e-267c268785c4.sql`.
Found: `get_user_leaderboard_rank_all_time(_user_id uuid, _club_id uuid) → TABLE(rank integer, total integer, points integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### get_user_leaderboard_rank_seasoned
Expected callers: `frontend/src/pages/ProfilePage.tsx:313 args=_user_id,_club_id,_season_id`.
Generated return: `{           points: number           rank: number           total: number         }[]`.
Staged SQL declaration (not applied): `get_user_leaderboard_rank_seasoned(_user_id uuid, _club_id uuid, _season_id uuid) → TABLE (rank int, total int, points int)`; `supabase/migrations/20260502065042_a657b199-3f27-42f4-ba10-f190e1943c2b.sql`.
Found: `get_user_leaderboard_rank_seasoned(_user_id uuid, _club_id uuid, _season_id uuid) → TABLE(rank integer, total integer, points integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### has_active_pro_for_club
Expected callers: `frontend/src/lib/galleryVaultSync.ts:47 args=_club_id`; `frontend/src/lib/proShareGate.ts:64 args=_club_id`; `supabase/functions/_shared/proGuard.ts:71 args=_club_id`; `supabase/functions/summarize-chat/index.ts:343 args=_club_id`; `supabase/functions/summarize-chat-icp/index.ts:258 args=_club_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `has_active_pro_for_club(_club_id uuid) → boolean`; `supabase/migrations/20260520211253_193d9f80-6938-4982-b02e-e3436ef2959d.sql`.
Found: `has_active_pro_for_club(_club_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### has_active_pro_for_team
Expected callers: `frontend/src/lib/proShareGate.ts:41 args=_team_id`; `supabase/functions/_shared/proGuard.ts:93 args=_team_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `has_active_pro_for_team(_team_id uuid) → boolean`; `supabase/migrations/20260520211253_193d9f80-6938-4982-b02e-e3436ef2959d.sql`.
Found: `has_active_pro_for_team(_team_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### has_role
Expected callers: `supabase/functions/cancel-subscription/index.ts:67 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/cancel-subscription/index.ts:69 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/cancel-subscription/index.ts:73 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/cancel-subscription/index.ts:76 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/cancel-subscription/index.ts:96 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/cancel-subscription/index.ts:98 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:50 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:52 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:61 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:63 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:71 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/check-iap-authorization/index.ts:73 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/create-storage-checkout/index.ts:62 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/reconcile-legacy-subscriptions/index.ts:57 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/summarize-chat/index.ts:307 args=_user_id,_role`; `supabase/functions/summarize-chat-icp/index.ts:254 args=_user_id,_role`; `supabase/functions/verify-iap-receipt/index.ts:40 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/verify-iap-receipt/index.ts:49 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/verify-iap-receipt/index.ts:58 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/verify-iap-receipt/index.ts:66 args=_user_id,_role,_club_id,_team_id`; `supabase/functions/verify-iap-receipt/index.ts:76 args=_user_id,_role,_club_id,_team_id`.
Generated return: `boolean`.
Found: `has_role(_user_id uuid, _role app_role, _club_id uuid, _team_id uuid) → boolean`; default args=2; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### increment_child_ignite_points
Expected callers: `supabase/functions/process-duty-points/index.ts:460 args=_child_id,_amount,_club_id`.
Generated return: `<not parsed>`.
Staged SQL declaration (not applied): `increment_child_ignite_points(_child_id uuid, _amount integer, _club_id uuid) → integer`; `supabase/migrations/20260505100733_b6d01d98-1049-40cc-91bc-6c842e7e8ff8.sql`.
Found: `increment_child_ignite_points(_child_id uuid, _amount integer) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.
Found: `increment_child_ignite_points(_child_id uuid, _amount integer, _club_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### increment_ignite_points
Expected callers: `frontend/src/pages/ManageUsersPage.tsx:988 args=<dynamic>`; `supabase/functions/process-duty-points/index.ts:117 args=_user_id,_amount,_club_id`; `supabase/functions/process-duty-points/index.ts:307 args=_user_id,_amount,_club_id`; `supabase/functions/process-weekly-engagement-bonus/index.ts:137 args=_user_id,_amount,_club_id`.
Generated return: `<not parsed>`.
Staged SQL declaration (not applied): `increment_ignite_points(_user_id uuid, _amount integer, _club_id uuid) → integer`; `supabase/migrations/20260505100733_b6d01d98-1049-40cc-91bc-6c842e7e8ff8.sql`.
Found: `increment_ignite_points(_user_id uuid, _amount integer) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.
Found: `increment_ignite_points(_user_id uuid, _amount integer, _club_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### insert_engagement_reminders_atomic
Expected callers: `supabase/functions/send-engagement-reminders/dispatch.ts:69 args=p_rows`.
Generated return: `number`.
Staged SQL declaration (not applied): `insert_engagement_reminders_atomic(p_rows jsonb) → integer`; `supabase/migrations/20260811113952_139285ef-b465-4da2-8058-c73f6feaaceb.sql`.
Found: `insert_engagement_reminders_atomic(p_rows jsonb) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### invite_competition_official
Expected callers: `frontend/src/components/competitions/CompetitionOfficialsCard.tsx:280 args=p_competition_id,p_email,p_name,p_role`.
Staged SQL declaration (not applied): `invite_competition_official(p_competition_id uuid, p_email text, p_name text, p_role text) → jsonb`; `supabase/migrations/20261015192331_dbec16fd-1649-4a11-85ed-95857aabd325.sql`.
Found: `invite_competition_official(p_competition_id uuid, p_email text, p_name text, p_role text) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### invite_shell_team_to_competition
Expected callers: `frontend/src/pages/CompetitionDetailPage.tsx:1766 args=p_competition_id,p_team_name,p_club_name,p_contact_name,p_contact_email,p_division_id`.
Generated return: `{           club_id: string           team_id: string           token: string         }[]`.
Staged SQL declaration (not applied): `invite_shell_team_to_competition(p_competition_id uuid, p_team_name text, p_club_name text, p_contact_name text, p_contact_email text, p_division_id uuid DEFAULT NULL) → TABLE(team_id uuid, club_id uuid, token uuid)`; `supabase/migrations/20260606111007_ac018d3e-6374-4aed-8050-a7164c0fc891.sql`.
Found: `invite_shell_team_to_competition(p_competition_id uuid, p_team_name text, p_club_name text, p_contact_name text, p_contact_email text, p_division_id uuid) → TABLE(team_id uuid, club_id uuid, token uuid)`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### invite_token_has_existing_account
Expected callers: `frontend/src/pages/JoinTeamPage.tsx:291 args=_token`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `invite_token_has_existing_account(_token text) → boolean`; `supabase/migrations/20260819204415_079e1a8f-3a13-4ddd-8f3f-2344d90d5bb4.sql`.
Found: `invite_token_has_existing_account(_token text) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_association_admin
Expected callers: `frontend/src/pages/AssociationDetailPage.tsx:73 args=_user_id,_association_id`; `supabase/functions/send-association-broadcast/index.ts:29 args=_user_id,_association_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `is_association_admin(_user_id uuid, _association_id uuid) → boolean`; `supabase/migrations/20260517022416_7c171ed7-1cba-4098-9ecb-a062a8d2d9db.sql`.
Found: `is_association_admin(_user_id uuid, _association_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_club_admin
Expected callers: `supabase/functions/association-create-club-event/index.ts:61 args=_user_id,_club_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `is_club_admin(_user_id UUID, _club_id UUID) → BOOLEAN`; `supabase/migrations/20260417155655_85004b07-0f77-4915-85ee-893c5569aa2b.sql`.
Found: `is_club_admin(_user_id uuid, _club_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_club_admin_for
Expected callers: `supabase/functions/auto-post-news-to-chat/index.ts:161 args=_club_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `is_club_admin_for(_club_id uuid) → boolean`; `supabase/migrations/20260417195631_a60831b6-63eb-4ff5-96e5-c52c66ff9a30.sql`.
Found: `is_club_admin_for(_club_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_club_member
Expected callers: `frontend/src/hooks/useClubScopeGuard.ts:130 args=_user_id,_club_id`; `supabase/functions/confirm-event-payment/index.ts:119 args=_user_id,_club_id`; `supabase/functions/create-member-payment-checkout/index.ts:42 args=_user_id,_club_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `is_club_member(_user_id uuid, _club_id uuid) → boolean`; `supabase/migrations/20260721114111_aa56e96d-22f4-415a-bedd-486e04eb5849.sql`.
Found: `is_club_member(_user_id uuid, _club_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_competition_admin
Expected callers: `frontend/src/features/vault/vaultAccessRepository.ts:265 args=_user_id,_competition_id`; `frontend/src/pages/CompetitionDetailPage.tsx:327 args=_user_id,_competition_id`; `frontend/src/pages/CompetitionSettingsPage.tsx:416 args=_user_id,_competition_id`; `frontend/src/pages/GroupChatPage.tsx:1583 args=_user_id,_competition_id`; `supabase/functions/send-competition-broadcast/index.ts:35 args=_user_id,_competition_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `is_competition_admin(_user_id uuid, _competition_id uuid) → boolean`; `supabase/migrations/20260925080734_3cc598d1-00eb-4fe1-8184-eda4eb1cb79e.sql`.
Found: `is_competition_admin(_user_id uuid, _competition_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### is_welcome_email_recipient
Expected callers: `supabase/functions/send-welcome-email/index.ts:101 args=_scope_kind,_scope_id,_recipient_user_id`.
Staged SQL declaration (not applied): `is_welcome_email_recipient(_scope_kind text, _scope_id uuid, _recipient_user_id uuid) → boolean`; `supabase/migrations/20261012020000_add_welcome_email_contract.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### join_competition_with_token
Expected callers: `frontend/src/pages/CompetitionJoinPage.tsx:388 args=p_token,p_team_id,p_division_id`.
Generated return: `{           competition_id: string           entry_id: string         }[]`.
Staged SQL declaration (not applied): `join_competition_with_token(p_token uuid, p_team_id uuid, p_division_id uuid DEFAULT NULL) → TABLE(competition_id uuid, entry_id uuid)`; `supabase/migrations/20260606111007_ac018d3e-6374-4aed-8050-a7164c0fc891.sql`.
Found: `join_competition_with_token(p_token uuid, p_team_id uuid, p_division_id uuid) → TABLE(competition_id uuid, entry_id uuid)`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### join_open_chat_group
Expected callers: `frontend/src/components/chat/DiscoverGroupsList.tsx:279 args=_group_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `join_open_chat_group(_group_id uuid) → uuid`; `supabase/migrations/20260803224655_06a329ab-c0f1-4ab4-81ba-e18913f5b039.sql`.
Found: `join_open_chat_group(_group_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### link_existing_child_as_guardian
Expected callers: `frontend/src/pages/ChildrenPage.tsx:286 args=<dynamic>`.
Generated return: `Json`.
Staged SQL declaration (not applied): `link_existing_child_as_guardian(p_child_id uuid, p_relationship text DEFAULT 'parent') → jsonb`; `supabase/migrations/20260805075126_cdfd324b-4413-4295-b7b6-fed705d137df.sql`.
Found: `link_existing_child_as_guardian(p_child_id uuid, p_relationship text) → jsonb`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### list_club_parents_for_team
Expected callers: `frontend/src/components/team/AddPlayerToParentSheet.tsx:125 args=p_team_id`.
Generated return: `{           avatar_url: string           display_name: string           role: string           user_id: string         }[]`.
Staged SQL declaration (not applied): `list_club_parents_for_team(p_team_id uuid) → TABLE ( user_id uuid, display_name text, avatar_url text, role text )`; `supabase/migrations/20260526022948_0b8e43fe-0a29-4cf3-bd54-475d8361a5dc.sql`.
Found: `list_club_parents_for_team(p_team_id uuid) → TABLE(user_id uuid, display_name text, avatar_url text, role text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### list_contactable_competitions
Expected callers: `frontend/src/components/competitions/ContactCompetitionAdminsButton.tsx:150 args=p_club_id`.
Staged SQL declaration (not applied): `list_contactable_competitions(p_club_id uuid DEFAULT NULL) → TABLE(id uuid, name text, logo_url text)`; `supabase/migrations/20260927005824_fea92a2f-26b8-4758-b500-ffb583de8e32.sql`.
Found: `list_contactable_competitions(p_club_id uuid) → TABLE(id uuid, name text, logo_url text)`; default args=1; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### list_divisions_by_join_token
Expected callers: `frontend/src/pages/CompetitionJoinPage.tsx:196 args=p_token`.
Generated return: `{           age_group: string           gender: string           id: string           name: string           skill_level: string           sort_order: number         }[]`.
Staged SQL declaration (not applied): `list_divisions_by_join_token(p_token uuid) → TABLE(id uuid, name text, age_group text, gender text, skill_level text, sort_order int)`; `supabase/migrations/20260606111007_ac018d3e-6374-4aed-8050-a7164c0fc891.sql`.
Found: `list_divisions_by_join_token(p_token uuid) → TABLE(id uuid, name text, age_group text, gender text, skill_level text, sort_order integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### list_entered_team_ids_by_join_token
Expected callers: `frontend/src/pages/CompetitionJoinPage.tsx:301 args=p_token`.
Generated return: `{           status: string           team_id: string         }[]`.
Staged SQL declaration (not applied): `list_entered_team_ids_by_join_token(p_token uuid) → TABLE(team_id uuid, status text)`; `supabase/migrations/20260607051901_6814f27f-8633-4820-af2b-5a9743c28bd2.sql`.
Found: `list_entered_team_ids_by_join_token(p_token uuid) → TABLE(team_id uuid, status text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### list_leaderboard_teams
Expected callers: `frontend/src/pages/LeaderboardPage.tsx:127 args=_club_id`.
Generated return: `{           id: string           name: string         }[]`.
Staged SQL declaration (not applied): `list_leaderboard_teams(_club_id uuid) → TABLE (id uuid, name text)`; `supabase/migrations/20260502063452_0dee3191-4d6f-42f0-994e-607ac544fbe4.sql`.
Found: `list_leaderboard_teams(_club_id uuid) → TABLE(id uuid, name text)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### lookup_invitable_user_by_email
Expected callers: `frontend/src/lib/inviteEmailDedupe.ts:93 args=_email,_club_id,_team_id,_mini_league_id`.
Generated return: `{           already_in_club: boolean           already_in_mini_league: boolean           already_in_team: boolean           avatar_url: string           display_name: string           user_id: string         }[]`.
Staged SQL declaration (not applied): `lookup_invitable_user_by_email(_email text, _club_id uuid DEFAULT NULL, _team_id uuid DEFAULT NULL, _mini_league_id uuid DEFAULT NULL) → TABLE( user_id uuid, display_name text, avatar_url text, already_in_club boolean, already_in_team boolean, already_in_mini_league boolean )`; `supabase/migrations/20260624041555_538a2ce6-86e7-430d-aa8d-fe51797854fd.sql`.
Found: `lookup_invitable_user_by_email(_email text, _club_id uuid, _team_id uuid, _mini_league_id uuid) → TABLE(user_id uuid, display_name text, avatar_url text, already_in_club boolean, already_in_team boolean, already_in_mini_league boolean)`; default args=3; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### mark_chat_scope_notifications_read
Expected callers: `frontend/src/lib/markChatScopeRead.ts:123 args=_user_id,_scope_kind,_scope_id`.
Generated return: `number`.
Staged SQL declaration (not applied): `mark_chat_scope_notifications_read(_user_id uuid, _scope_kind text, _scope_id uuid DEFAULT NULL::uuid) → integer`; `supabase/migrations/20260604020432_8cc6a7bf-b53e-41ec-8881-e1bd45de4905.sql`.
Found: `mark_chat_scope_notifications_read(_user_id uuid, _scope_kind text, _scope_id uuid) → integer`; default args=1; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### mark_gallery_card_push_sent
Expected callers: `frontend/src/components/UploadPhotoSheet.tsx:1045 args=_card_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `mark_gallery_card_push_sent(_card_id UUID) → VOID`; `supabase/migrations/20260425112609_794fd957-f76e-4b1b-812e-4ed2091a7e50.sql`.
Found: `mark_gallery_card_push_sent(_card_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### mark_message_reads
Expected callers: `frontend/src/hooks/useMessageReads.ts:297 args=_message_type,_message_ids`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `mark_message_reads(_message_type text, _message_ids uuid[]) → void`; `supabase/migrations/20260426115153_4b918da6-9048-4089-a097-aa6fbed9b85d.sql`.
Found: `mark_message_reads(_message_type text, _message_ids uuid[]) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### move_child_to_team
Expected callers: `frontend/src/components/MoveToTeamSheet.tsx:89 args=p_child_id,p_from_team_id,p_to_team_id,p_club_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `move_child_to_team(p_child_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid) → void`; `supabase/migrations/20260523031857_1e594353-2627-4c98-8ef1-e988db4db506.sql`.
Found: `move_child_to_team(p_child_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### move_event_group_player
Expected callers: `frontend/src/components/EventGroupsManager.tsx:1032 args=p_player_id,p_from_group_id,p_to_group_id,p_to_team`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `move_event_group_player(p_player_id uuid, p_from_group_id uuid, p_to_group_id uuid, p_to_team text) → void`; `supabase/migrations/20260730074102_39bd1d83-2fc8-4239-a904-c3b754385cea.sql`.
Found: `move_event_group_player(p_player_id uuid, p_from_group_id uuid, p_to_group_id uuid, p_to_team text) → void`; default args=0; security_definer=False; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### move_member_to_team
Expected callers: `frontend/src/components/MoveToTeamSheet.tsx:81 args=p_user_id,p_from_team_id,p_to_team_id,p_club_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `move_member_to_team(p_user_id UUID, p_from_team_id UUID, p_to_team_id UUID, p_club_id UUID) → void`; `supabase/migrations/20260407112527_91b3994e-be7d-45d7-bcb5-28c22b04861c.sql`.
Found: `move_member_to_team(p_user_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### notify_club_news
Expected callers: `frontend/src/components/news/ClubNewsComposer.tsx:327 args=_news_id,_send_push`.
Generated return: `number`.
Staged SQL declaration (not applied): `notify_club_news(_news_id uuid, _send_push boolean DEFAULT true) → integer`; `supabase/migrations/20260927032034_e98bc34b-5b3d-4e10-9074-d8c0fa1e3951.sql`.
Found: `notify_club_news(_news_id uuid, _send_push boolean) → integer`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### notify_competition_news
Expected callers: `frontend/src/components/news/ClubNewsComposer.tsx:326 args=_news_id,_send_push`.
Generated return: `number`.
Staged SQL declaration (not applied): `notify_competition_news(_news_id uuid, _send_push boolean DEFAULT true) → integer`; `supabase/migrations/20261010010000_mini_league_news_audience.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### notify_formation_change
Expected callers: `frontend/src/components/pitch/PitchBoard.tsx:1346 args=_recipient_ids,_message,_related_id`; `frontend/src/components/pitch/hooks/usePitchBoardFormationNotifications.ts:145 args=_recipient_ids,_message,_related_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `notify_formation_change(_recipient_ids uuid[], _message text, _related_id text) → void`; `supabase/migrations/20260321001743_f51df196-9845-46a1-905f-9a6fbae4b07e.sql`.
Found: `notify_formation_change(_recipient_ids uuid[], _message text, _related_id text) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### notify_mini_league_news
Expected callers: `frontend/src/components/news/ClubNewsComposer.tsx:324 args=_news_id,_send_push`.
Generated return: `number`.
Staged SQL declaration (not applied): `notify_mini_league_news(_news_id uuid, _send_push boolean DEFAULT true) → integer`; `supabase/migrations/20261010010000_mini_league_news_audience.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### notify_season_archived
Expected callers: `frontend/src/pages/SeasonDetailPage.tsx:180 args=_season_id`.
Generated return: `number`.
Staged SQL declaration (not applied): `notify_season_archived(_season_id uuid) → integer`; `supabase/migrations/20260417192851_be72955c-8d20-46e9-bcd9-161b4130a7ba.sql`.
Found: `notify_season_archived(_season_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### notify_season_published
Expected callers: `frontend/src/components/seasons/StartNewSeasonWizard.tsx:161 args=_season_id`; `frontend/src/pages/SeasonDetailPage.tsx:276 args=_season_id`.
Generated return: `number`.
Staged SQL declaration (not applied): `notify_season_published(_season_id UUID) → INTEGER`; `supabase/migrations/20260417164210_4421b28f-34ad-45f0-9e26-5491f4bc11aa.sql`.
Found: `notify_season_published(_season_id uuid) → integer`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### post_chat_photo_gallery_reminder
Expected callers: `supabase/functions/chat-photo-gallery-reminders/index.ts:177 args=_team_id,_author_id,_system_user_id,_photo_count`.
Generated return: `string`.
Staged SQL declaration (not applied): `post_chat_photo_gallery_reminder(_team_id uuid, _author_id uuid, _system_user_id uuid, _photo_count integer) → uuid`; `supabase/migrations/20260529111036_96d2f7fd-7c19-4e7c-9c8c-819dbde150ef.sql`.
Found: `post_chat_photo_gallery_reminder(_team_id uuid, _author_id uuid, _system_user_id uuid, _photo_count integer) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### post_or_update_team_gallery_card
Expected callers: `frontend/src/components/UploadPhotoSheet.tsx:1003 args=_team_id,_photo_ids,_hero_photo_id,_hero_image_url,_event_id`.
Generated return: `{           card_id: string           message_id: string           total_count: number           was_new: boolean         }[]`.
Staged SQL declaration (not applied): `post_or_update_team_gallery_card(_team_id UUID, _photo_ids UUID[], _hero_photo_id UUID, _hero_image_url TEXT, _event_id UUID DEFAULT NULL) → TABLE(card_id UUID, message_id UUID, total_count INT, was_new BOOLEAN)`; `supabase/migrations/20260425112609_794fd957-f76e-4b1b-812e-4ed2091a7e50.sql`.
Found: `post_or_update_team_gallery_card(_team_id uuid, _photo_ids uuid[], _hero_photo_id uuid, _hero_image_url text, _event_id uuid) → TABLE(card_id uuid, message_id uuid, total_count integer, was_new boolean)`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### post_team_gallery_prompt
Expected callers: `supabase/functions/post-game-photo-prompts/index.ts:76 args=_team_id,_event_id,_system_user_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `post_team_gallery_prompt(_team_id uuid, _event_id uuid, _system_user_id uuid) → uuid`; `supabase/migrations/20260524031943_54a7ad8d-c36a-47fe-9575-df5e5e12a2d4.sql`.
Found: `post_team_gallery_prompt(_team_id uuid, _event_id uuid, _system_user_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### profile_team_history
Expected callers: `frontend/src/hooks/useProfileTeamHistory.ts:29 args=_profile_id`.
Generated return: `{           club_id: string           club_name: string           joined_at: string           membership_id: string           season_end_date: string           season_id: string           season_name: string           season_start_date: string           season_status: Database["public"]["Enums"]["season_status"]           team_id: string           team_level_age: string           team_name: string         }[]`.
Staged SQL declaration (not applied): `profile_team_history(_profile_id uuid) → TABLE ( membership_id uuid, team_id uuid, team_name text, team_level_age text, club_id uuid, club_name text, season_id uuid, season_name text, season_status season_status, season_start_date date, season_end_date date, joined_at timestamptz )`; `supabase/migrations/20260417191016_abf80efd-a778-4e1c-9bcf-a7c38ae4972c.sql`.
Found: `profile_team_history(_profile_id uuid) → TABLE(membership_id uuid, team_id uuid, team_name text, team_level_age text, club_id uuid, club_name text, season_id uuid, season_name text, season_status season_status, season_start_date date, season_end_date date, joined_at timestamp with time zone)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### publish_season
Expected callers: `frontend/src/components/seasons/StartNewSeasonWizard.tsx:156 args=_season_id`; `frontend/src/pages/SeasonDetailPage.tsx:274 args=_season_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `publish_season(_season_id UUID) → VOID`; `supabase/migrations/20260417155655_85004b07-0f77-4915-85ee-893c5569aa2b.sql`.
Found: `publish_season(_season_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### quick_rsvp_from_dm
Expected callers: `frontend/src/components/chat/InlineRsvpActions.tsx:75 args=_event_id,_status`.
Generated return: `{           inserted_count: number         }[]`.
Staged SQL declaration (not applied): `quick_rsvp_from_dm(_event_id uuid, _status text) → TABLE(inserted_count integer)`; `supabase/migrations/20260510000821_0dfb6e6e-8b07-4cc6-8cb7-8d44960ba84f.sql`.
Found: `quick_rsvp_from_dm(_event_id uuid, _status text) → TABLE(inserted_count integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### read_competition_playhq
Expected callers: `frontend/src/features/competitions/playhqRepository.ts:9 args=p_competition_id`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### read_game_history
Expected callers: `frontend/src/features/competitions/history/historyRepository.ts:88 args=p_team_id,p_club_id,p_limit`.
Staged SQL declaration (not applied): `read_game_history(p_team_id uuid DEFAULT NULL,p_club_id uuid DEFAULT NULL,p_limit integer DEFAULT 100) → jsonb`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### read_game_result
Expected callers: `frontend/src/features/competitions/history/historyRepository.ts:33 args=p_event_id`.
Staged SQL declaration (not applied): `read_game_result(p_event_id uuid) → jsonb`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### read_history_player_stats
Expected callers: `frontend/src/features/competitions/history/reportRepository.ts:7 args=p_team_id,p_event_id,p_from,p_to`.
Staged SQL declaration (not applied): `read_history_player_stats(p_team_id uuid,p_event_id uuid DEFAULT NULL,p_from timestamptz DEFAULT NULL,p_to timestamptz DEFAULT NULL) → jsonb`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### read_history_report_events
Expected callers: `frontend/src/features/competitions/history/reportRepository.ts:40 args=p_team_id`.
Staged SQL declaration (not applied): `read_history_report_events(p_team_id uuid) → jsonb`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### read_history_summary
Expected callers: `frontend/src/features/competitions/history/reportRepository.ts:33 args=p_event_id`.
Staged SQL declaration (not applied): `read_history_summary(p_event_id uuid) → jsonb`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### reconcile_pending_invites
Expected callers: `frontend/src/components/ReconcilePendingInvitesButton.tsx:57 args=_team_id,_club_id`.
Generated return: `{           reconciled_count: number           skipped_count: number         }[]`.
Staged SQL declaration (not applied): `reconcile_pending_invites(_team_id uuid DEFAULT NULL, _club_id uuid DEFAULT NULL) → TABLE(reconciled_count integer, skipped_count integer)`; `supabase/migrations/20260417043819_0bfc4aa1-502a-467f-9bbe-7088044ea1d6.sql`.
Found: `reconcile_pending_invites(_team_id uuid, _club_id uuid) → TABLE(reconciled_count integer, skipped_count integer)`; default args=2; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### record_push_failure
Expected callers: `supabase/functions/send-push-notification/index.ts:916 args=p_endpoint,p_reason`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `record_push_failure(p_endpoint TEXT, p_reason TEXT DEFAULT NULL) → void`; `supabase/migrations/20260206065709_c273fd28-10e5-4292-bb0a-0f1f4ba330d3.sql`.
Found: `record_push_failure(p_endpoint text, p_reason text) → void`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### record_push_success
Expected callers: `supabase/functions/send-push-notification/index.ts:890 args=p_endpoint`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `record_push_success(p_endpoint TEXT) → void`; `supabase/migrations/20260206065709_c273fd28-10e5-4292-bb0a-0f1f4ba330d3.sql`.
Found: `record_push_success(p_endpoint text) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### record_verified_event_payment
Expected callers: `supabase/functions/confirm-event-payment/index.ts:312 args=_event_id,_user_id,_amount,_provider_payment_id`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### redeem_club_reward
Expected callers: `frontend/src/pages/HomePage.tsx:1141 args=_reward_id,_child_id,_idempotency_key`.
Generated return: `Json`.
Staged SQL declaration (not applied): `redeem_club_reward(_reward_id uuid, _child_id uuid DEFAULT NULL, _idempotency_key text DEFAULT NULL) → jsonb`; `supabase/migrations/20260730034551_d1231813-cc79-4e9d-b332-1491be782c0f.sql`.
Found: `redeem_club_reward(_reward_id uuid, _child_id uuid, _idempotency_key text) → jsonb`; default args=2; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### regenerate_competition_join_token
Expected callers: `frontend/src/components/CompetitionShareJoinLink.tsx:52 args=p_competition_id`; `frontend/src/components/CompetitionShareJoinLink.tsx:127 args=p_competition_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `regenerate_competition_join_token(p_competition_id uuid) → uuid`; `supabase/migrations/20260606111007_ac018d3e-6374-4aed-8050-a7164c0fc891.sql`.
Found: `regenerate_competition_join_token(p_competition_id uuid) → uuid`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### reject_chat_group_join_request
Expected callers: `frontend/src/components/chat/ChatGroupJoinRequests.tsx:109 args=_request_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `reject_chat_group_join_request(_request_id uuid) → void`; `supabase/migrations/20260602103128_c918cc68-94c4-4301-80de-ff21609a6763.sql`.
Found: `reject_chat_group_join_request(_request_id uuid) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### release_cron_lock
Expected callers: `supabase/functions/auto-rsvp-dm-cron/index.ts:363 args=p_key`; `supabase/functions/auto-rsvp-push-cron/index.ts:288 args=p_key`; `supabase/functions/chat-photo-gallery-reminders/index.ts:214 args=p_key`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `release_cron_lock(p_key text) → void`; `supabase/migrations/20260621063127_c4096ddf-a91e-4ba2-a33f-f1c5443f150c.sql`.
Found: `release_cron_lock(p_key text) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### remove_team_member
Expected callers: `frontend/src/components/chat/ChatParticipantsList.tsx:828 args=_team_id,_user_id`; `frontend/src/pages/TeamChatPage.tsx:491 args=_team_id,_user_id`; `frontend/src/pages/TeamDetailPage.tsx:2193 args=_team_id,_user_id`.
Generated return: `Json`.
Staged SQL declaration (not applied): `remove_team_member(_team_id uuid, _user_id uuid) → jsonb`; `supabase/migrations/20260925205943_1e785475-fcef-4fa7-ba5f-697b0138ee5d.sql`.
Found: `remove_team_member(_team_id uuid, _user_id uuid) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### replace_event_groups
Expected callers: `frontend/src/components/EventGroupsManager.tsx:667 args=p_event_id,p_groups,p_delete_existing`; `frontend/src/components/EventGroupsManager.tsx:903 args=p_event_id,p_groups,p_delete_existing`.
Generated return: `string[]`.
Staged SQL declaration (not applied): `replace_event_groups(p_event_id uuid, p_groups jsonb, p_delete_existing boolean DEFAULT true) → uuid[]`; `supabase/migrations/20260730213118_f52ed597-488c-400b-9f78-2c80917dc434.sql`.
Found: `replace_event_groups(p_event_id uuid, p_groups jsonb, p_delete_existing boolean) → uuid[]`; default args=1; security_definer=False; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### request_join_chat_group
Expected callers: `frontend/src/components/chat/DiscoverGroupsList.tsx:247 args=_group_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `request_join_chat_group(_group_id uuid, _message text DEFAULT NULL) → uuid`; `supabase/migrations/20260803224655_06a329ab-c0f1-4ab4-81ba-e18913f5b039.sql`.
Found: `request_join_chat_group(_group_id uuid, _message text) → uuid`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### reserve_measured_media
Expected callers: `supabase/functions/verify-iap-receipt-icp/index.ts:155 args=p_user,p_club,p_team,p_bucket,p_path,p_bytes,p_vault`.
Staged SQL declaration (not applied): `reserve_measured_media(p_user uuid,p_club uuid,p_team uuid,p_bucket text,p_path text,p_bytes bigint,p_vault boolean DEFAULT false) → uuid`; `supabase/migrations/20261022042440_9386f4cc-f699-4c85-a763-8dd7350e12a2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### reserve_vault_storage
Expected callers: `frontend/src/lib/vaultUpload.ts:28 args=_club_id,_bytes`.
Generated return: `{           limit_bytes: number           reservation_id: string           used_bytes: number         }[]`.
Staged SQL declaration (not applied): `reserve_vault_storage(_club_id uuid, _bytes bigint) → TABLE (reservation_id uuid, limit_bytes bigint, used_bytes bigint)`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `reserve_vault_storage(_club_id uuid, _bytes bigint) → TABLE(reservation_id uuid, limit_bytes bigint, used_bytes bigint)`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### resolve_invite_short_code
Expected callers: `frontend/src/pages/ShortInviteRedirect.tsx:97 args=_code`.
Generated return: `string`.
Staged SQL declaration (not applied): `resolve_invite_short_code(_code text) → text`; `supabase/migrations/20260421104045_0bd28826-6032-4603-85d4-7b15e84b0f0d.sql`.
Found: `resolve_invite_short_code(_code text) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### revoke_competition_role_email_invite
Expected callers: `frontend/src/components/competitions/CompetitionOfficialJoinLinksCard.tsx:209 args=_token`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `revoke_competition_role_email_invite(_token text) → boolean`; `supabase/migrations/20261014030000_email_bound_official_invites.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### save_competition_match_result
Expected callers: `frontend/src/features/competitions/fixtures/matchWorkflows.ts:127 args=p_match_id,p_home_score,p_away_score,p_status`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `save_competition_match_result(p_match_id uuid,p_home_score integer,p_away_score integer,p_status text) → void`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### save_game_history
Expected callers: `frontend/src/features/competitions/history/historyRepository.ts:62 args=p_result,p_only_if_missing`.
Staged SQL declaration (not applied): `save_game_history(p_result jsonb,p_only_if_missing boolean DEFAULT false) → void`; `supabase/migrations/20261021003048_cc898ea3-1b7f-44d1-81d4-e894260fa5f2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### search_invitable_profiles
Expected callers: `frontend/src/components/AddClubAdminSheet.tsx:144 args=_query,_limit,_club_id`; `frontend/src/components/AddMiniLeagueMemberSheet.tsx:256 args=_query,_limit,_club_id`; `frontend/src/components/InviteOtherParentSheet.tsx:102 args=_query,_limit,_club_id`; `frontend/src/components/competitions/CompetitionAdminsCard.tsx:125 args=_query,_limit,_club_id`; `frontend/src/components/competitions/CompetitionOfficialsCard.tsx:166 args=_query,_limit,_club_id`; `frontend/src/components/mini-league/AddSecondParentDialog.tsx:79 args=_query,_limit,_club_id`; `frontend/src/features/membership/membershipInvitationRepository.ts:242 args=_query,_limit`; `frontend/src/hooks/useAddTeamMemberSearch.ts:121 args=_query,_limit,_club_id`; `frontend/src/hooks/useAddTeamMemberSearch.ts:387 args=_query,_limit,_club_id`; `frontend/src/hooks/useAddTeamMemberSearch.ts:469 args=_query,_limit,_club_id`; `frontend/src/hooks/useAddTeamMemberSearch.ts:503 args=_query,_limit,_club_id`.
Generated return: `{           avatar_url: string           display_name: string           id: string           masked_email: string         }[]`.
Staged SQL declaration (not applied): `search_invitable_profiles(_query text, _limit integer DEFAULT 8, _club_id uuid DEFAULT NULL) → TABLE(id uuid, display_name text, avatar_url text, masked_email text)`; `supabase/migrations/20260817222225_9939b358-4d11-4a4a-aa3f-60ec0b2b3ae9.sql`.
Found: `search_invitable_profiles(_query text, _limit integer, _club_id uuid) → TABLE(id uuid, display_name text, avatar_url text, masked_email text)`; default args=2; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### season_orphan_events
Expected callers: `frontend/src/components/seasons/OrphanEventsCard.tsx:31 args=_club_id`.
Generated return: `{           event_date: string           event_id: string           team_id: string           team_name: string           title: string         }[]`.
Staged SQL declaration (not applied): `season_orphan_events(_club_id uuid) → TABLE ( event_id uuid, title text, event_date date, team_id uuid, team_name text )`; `supabase/migrations/20260417192851_be72955c-8d20-46e9-bcd9-161b4130a7ba.sql`.
Found: `season_orphan_events(_club_id uuid) → TABLE(event_id uuid, title text, event_date date, team_id uuid, team_name text)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### season_player_stats
Expected callers: `frontend/src/hooks/useSeasonAnalytics.ts:62 args=_season_id,_team_id`.
Generated return: `{           attendance_pct: number           club_player_id: string           events_attended: number           events_total: number           games_played: number           player_name: string         }[]`.
Staged SQL declaration (not applied): `season_player_stats(_season_id uuid, _team_id uuid) → TABLE ( club_player_id uuid, player_name text, events_total integer, events_attended integer, attendance_pct numeric, games_played integer )`; `supabase/migrations/20260417191016_abf80efd-a778-4e1c-9bcf-a7c38ae4972c.sql`.
Found: `season_player_stats(_season_id uuid, _team_id uuid) → TABLE(club_player_id uuid, player_name text, events_total integer, events_attended integer, attendance_pct numeric, games_played integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### season_team_summary
Expected callers: `frontend/src/hooks/useSeasonAnalytics.ts:30 args=_season_id`.
Generated return: `{           avg_attendance_pct: number           events_count: number           roster_size: number           team_id: string           team_name: string         }[]`.
Staged SQL declaration (not applied): `season_team_summary(_season_id uuid) → TABLE ( team_id uuid, team_name text, events_count integer, avg_attendance_pct numeric, roster_size integer )`; `supabase/migrations/20260417191016_abf80efd-a778-4e1c-9bcf-a7c38ae4972c.sql`.
Found: `season_team_summary(_season_id uuid) → TABLE(team_id uuid, team_name text, events_count integer, avg_attendance_pct numeric, roster_size integer)`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### send_game_stats_email_rpc
Expected callers: `frontend/src/hooks/useGameStats.ts:302 args=_event_id,_team_id,_event_title,_event_date,_opponent,_total_players,_total_game_time`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `send_game_stats_email_rpc(_event_id uuid, _team_id uuid, _event_title text, _event_date text, _opponent text, _total_players integer, _total_game_time text) → void`; `supabase/migrations/20260504035922_32d30f11-9a20-43fb-bc3c-9152cee7be21.sql`.
Found: `send_game_stats_email_rpc(_event_id uuid, _team_id uuid, _event_title text, _event_date text, _opponent text, _total_players integer, _total_game_time text) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### send_pitch_board_notification_email_rpc
Expected callers: `frontend/src/components/pitch/hooks/usePitchBoardEventLink.ts:139 args=_recipient_user_id,_team_id,_team_name,_notification_type,_notification_message,_event_id`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `send_pitch_board_notification_email_rpc(_recipient_user_id uuid, _team_id uuid, _team_name text, _notification_type text, _notification_message text, _event_id uuid DEFAULT NULL) → void`; `supabase/migrations/20260504035922_32d30f11-9a20-43fb-bc3c-9152cee7be21.sql`.
Found: `send_pitch_board_notification_email_rpc(_recipient_user_id uuid, _team_id uuid, _team_name text, _notification_type text, _notification_message text, _event_id uuid) → void`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### send_reward_redeemed_email_rpc
Expected callers: `frontend/src/components/RewardRedemptionCard.tsx:392 args=_reward_name,_points_spent,_remaining_points,_club_name,_reward_description,_sponsor_name,_show_qr_code,_club_logo_url,_reward_logo_url,_redeemed_for_child_name`; `frontend/src/pages/HomePage.tsx:1167 args=_reward_name,_points_spent,_remaining_points,_club_name,_reward_description,_sponsor_name,_show_qr_code,_club_logo_url,_reward_logo_url,_redeemed_for_child_name`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `send_reward_redeemed_email_rpc(_reward_name text, _points_spent integer, _remaining_points integer, _club_name text, _reward_description text DEFAULT NULL, _sponsor_name text DEFAULT NULL, _show_qr_code boolean DEFAULT false, _club_logo_url text DEFAULT NULL, _reward_logo_url text DEFAULT NULL, _redeemed_for_child_name text DEFAULT NULL) → void`; `supabase/migrations/20260504035922_32d30f11-9a20-43fb-bc3c-9152cee7be21.sql`.
Found: `send_reward_redeemed_email_rpc(_reward_name text, _points_spent integer, _remaining_points integer, _club_name text, _reward_description text, _sponsor_name text, _show_qr_code boolean, _club_logo_url text, _reward_logo_url text, _redeemed_for_child_name text) → void`; default args=6; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### set_internal_dispatch_credentials
Expected callers: `supabase/functions/sync-dispatch-credentials/index.ts:61 args=_service_role_key,_functions_base_url`.
Generated return: `Json`.
Staged SQL declaration (not applied): `set_internal_dispatch_credentials(_service_role_key text, _functions_base_url text) → jsonb`; `supabase/migrations/20260731094044_ee163b3f-46b0-4a7d-9503-3f02dc4ce16e.sql`.
Found: `set_internal_dispatch_credentials(_service_role_key text, _functions_base_url text) → jsonb`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### settle_measured_media
Expected callers: `supabase/functions/verify-iap-receipt-icp/index.ts:164 args=p_id,p_completed`.
Staged SQL declaration (not applied): `settle_measured_media(p_id uuid,p_completed boolean) → void`; `supabase/migrations/20261022042440_9386f4cc-f699-4c85-a763-8dd7350e12a2.sql`.
**GAP: absent in DEV.** No signature/return match can be confirmed.

#### settle_vault_storage
Expected callers: `frontend/src/lib/vaultUpload.ts:45 args=_reservation_id,_committed`.
Generated return: `string`.
Staged SQL declaration (not applied): `settle_vault_storage(_reservation_id uuid, _committed boolean) → text`; `supabase/migrations/20260727042355_51a7968c-ef11-4c89-96d4-d10c97fff65b.sql`.
Found: `settle_vault_storage(_reservation_id uuid, _committed boolean) → text`; default args=0; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### suggest_eoi_teams
Expected callers: `frontend/src/hooks/useEoiTeamBuilder.ts:22 args=_season_id`.
Generated return: `{           age_group: string           avg_skill: number           player_count: number           submission_ids: string[]         }[]`.
Staged SQL declaration (not applied): `suggest_eoi_teams(_season_id uuid) → TABLE ( age_group text, player_count bigint, avg_skill numeric, submission_ids uuid[] )`; `supabase/migrations/20260417195631_a60831b6-63eb-4ff5-96e5-c52c66ff9a30.sql`.
Found: `suggest_eoi_teams(_season_id uuid) → TABLE(age_group text, player_count bigint, avg_skill numeric, submission_ids uuid[])`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### swap_event_group_players
Expected callers: `frontend/src/components/EventGroupsManager.tsx:1070 args=p_player1_id,p_player1_group_id,p_player1_team,p_player2_id,p_player2_group_id,p_player2_team`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `swap_event_group_players(p_player1_id uuid, p_player1_group_id uuid, p_player1_team text, p_player2_id uuid, p_player2_group_id uuid, p_player2_team text) → void`; `supabase/migrations/20260730074102_39bd1d83-2fc8-4239-a904-c3b754385cea.sql`.
Found: `swap_event_group_players(p_player1_id uuid, p_player1_group_id uuid, p_player1_team text, p_player2_id uuid, p_player2_group_id uuid, p_player2_team text) → void`; default args=0; security_definer=False; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': True}`.

#### sync_event_duties
Expected callers: `frontend/src/features/events/editEventWorkflow.ts:178 args=p_event_id,p_delete_ids,p_duties`.
Generated return: `Json`.
Staged SQL declaration (not applied): `sync_event_duties(p_event_id uuid, p_delete_ids uuid[] DEFAULT '{}'::uuid[], p_duties jsonb DEFAULT '[]'::jsonb) → jsonb`; `supabase/migrations/20260731034429_92e4d97e-7809-4d34-ab3a-277ada400c04.sql`.
Found: `sync_event_duties(p_event_id uuid, p_delete_ids uuid[], p_duties jsonb) → jsonb`; default args=2; security_definer=False; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### track_user_activity_start
Expected callers: `frontend/src/hooks/useActivityTracking.ts:157 args=_page_path,_page_label,_session_id,_club_id`.
Generated return: `string`.
Staged SQL declaration (not applied): `track_user_activity_start(_page_path text, _page_label text, _session_id text, _club_id uuid DEFAULT NULL) → uuid`; `supabase/migrations/20260426115153_4b918da6-9048-4089-a097-aa6fbed9b85d.sql`.
Found: `track_user_activity_start(_page_path text, _page_label text, _session_id text, _club_id uuid) → uuid`; default args=1; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### try_award_streak_bonus
Expected callers: `frontend/src/lib/engagementGamification.ts:158 args=_user_id,_club_id,_streak_length,_bonus_points`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `try_award_streak_bonus(_user_id uuid, _club_id uuid, _streak_length integer, _bonus_points integer) → boolean`; `supabase/migrations/20260416080636_7f638056-758f-4d26-a2cc-6cd131f00295.sql`.
Found: `try_award_streak_bonus(_user_id uuid, _club_id uuid, _streak_length integer, _bonus_points integer) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### try_cron_lock
Expected callers: `supabase/functions/auto-rsvp-dm-cron/index.ts:177 args=p_key,p_ttl_seconds`; `supabase/functions/auto-rsvp-push-cron/index.ts:110 args=p_key,p_ttl_seconds`; `supabase/functions/chat-photo-gallery-reminders/index.ts:29 args=p_key,p_ttl_seconds`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `try_cron_lock(p_key text, p_ttl_seconds int DEFAULT 600) → boolean`; `supabase/migrations/20260621063127_c4096ddf-a91e-4ba2-a33f-f1c5443f150c.sql`.
Found: `try_cron_lock(p_key text, p_ttl_seconds integer) → boolean`; default args=1; security_definer=True; EXECUTE=`{'anon': False, 'service_role': True, 'authenticated': False}`.

#### try_insert_points_cooldown
Expected callers: `frontend/src/lib/engagementPoints.ts:104 args=_user_id,_action_type,_scope_id,_awarded_date,_points_awarded,_club_id,_daily_cap`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `try_insert_points_cooldown(_user_id uuid, _action_type text, _scope_id text, _awarded_date date, _points_awarded integer, _club_id uuid, _daily_cap integer) → boolean`; `supabase/migrations/20260326042201_b9a7af24-0a6c-47b0-9800-65e23913e45b.sql`.
Found: `try_insert_points_cooldown(_user_id uuid, _action_type text, _scope_id text, _awarded_date date, _points_awarded integer, _club_id uuid, _daily_cap integer) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### update_event_series
Expected callers: `frontend/src/features/events/editEventWorkflow.ts:59 args=p_event_id,p_updates,p_selected_event_date,p_selected_start_time,p_selected_end_time`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `update_event_series(p_event_id uuid, p_updates jsonb, p_selected_event_date timestamptz, p_selected_start_time timestamptz, p_selected_end_time timestamptz) → void`; `supabase/migrations/20260725071203_1ddcc09c-7cd5-47e3-88d9-018b0ae1acd5.sql`.
Found: `update_event_series(p_event_id uuid, p_updates jsonb, p_selected_event_date timestamp with time zone, p_selected_start_time timestamp with time zone, p_selected_end_time timestamp with time zone) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### update_user_activity_duration
Expected callers: `frontend/src/hooks/useActivityTracking.ts:96 args=_activity_log_id,_duration_seconds`.
Generated return: `undefined`.
Staged SQL declaration (not applied): `update_user_activity_duration(_activity_log_id uuid, _duration_seconds integer) → void`; `supabase/migrations/20260426115153_4b918da6-9048-4089-a097-aa6fbed9b85d.sql`.
Found: `update_user_activity_duration(_activity_log_id uuid, _duration_seconds integer) → void`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### upsert_child_for_guardian
Expected callers: `frontend/src/pages/ChildrenPage.tsx:233 args=<dynamic>`.
Generated return: `Json`.
Staged SQL declaration (not applied): `upsert_child_for_guardian(p_name text, p_year_of_birth integer DEFAULT NULL, p_guardian_user_id uuid DEFAULT NULL, p_relationship text DEFAULT 'parent', p_club_id uuid DEFAULT NULL) → jsonb`; `supabase/migrations/20260805081218_316c2fc5-b224-4e08-9ef7-6943d09f8227.sql`.
Found: `upsert_child_for_guardian(p_name text, p_year_of_birth integer, p_guardian_user_id uuid, p_relationship text, p_club_id uuid) → jsonb`; default args=4; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### user_has_any_club_pro
Expected callers: `supabase/functions/_shared/proGuard.ts:114 args=_user_id`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `user_has_any_club_pro(_user_id uuid) → boolean`; `supabase/migrations/20260520212140_fa2426f3-37ae-4b90-b730-867d582cea39.sql`.
Found: `user_has_any_club_pro(_user_id uuid) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

#### validate_eoi_webhook_token
Expected callers: `supabase/functions/eoi-webhook/index.ts:71 args=_club_id,_token`.
Generated return: `boolean`.
Staged SQL declaration (not applied): `validate_eoi_webhook_token(_club_id UUID, _token TEXT) → BOOLEAN`; `supabase/migrations/20260417200746_44044233-05e8-4c4b-ab68-1be80e3c04db.sql`.
Found: `validate_eoi_webhook_token(_club_id uuid, _token text) → boolean`; default args=0; security_definer=True; EXECUTE=`{'anon': True, 'service_role': True, 'authenticated': True}`.

### All public functions (including non-frontend helpers)
| Function | Arguments | Returns | Defaults | Definer | EXECUTE anon / authenticated / service |
|---|---|---|---|---|---|
| `_can_add_player_to_team` | `p_team_id uuid` | `uuid` | 0 | True | no/no/yes |
| `_internal_service_role_key` | `` | `text` | 0 | True | no/no/yes |
| `_leaderboard_window_start` | `_window text` | `timestamp with time zone` | 0 | False | yes/yes/yes |
| `_provision_invite_children_internal` | `p_invite_id uuid, p_user_id uuid` | `jsonb` | 0 | True | no/no/yes |
| `accept_competition_role_link` | `p_token text` | `TABLE(status text, competition_id uuid, chat_group_id uuid)` | 0 | True | yes/yes/yes |
| `accept_current_legal_terms` | `` | `void` | 0 | True | no/yes/yes |
| `accept_guardian_parent_invite` | `_invite_id uuid` | `jsonb` | 0 | True | yes/yes/yes |
| `accept_parent_team_invite` | `_invite_id uuid, _invite_token text` | `jsonb` | 2 | True | no/yes/yes |
| `acknowledge_ai_catch_up_disclosure` | `` | `timestamp with time zone` | 0 | True | yes/yes/yes |
| `add_creator_to_personal_group` | `` | `trigger` | 0 | True | yes/yes/yes |
| `add_existing_club_child_to_team` | `p_team_id uuid, p_child_id uuid` | `uuid` | 0 | True | no/yes/yes |
| `admin_get_user_emails` | `user_ids uuid[]` | `TABLE(id uuid, email text)` | 0 | True | yes/yes/yes |
| `admin_link_child_to_parent` | `p_parent_user_id uuid, p_team_id uuid, p_club_id uuid, p_child_name text, p_existing_child_id uuid, p_pending_invite_ids uuid[]` | `void` | 2 | True | yes/yes/yes |
| `admin_update_rsvp_status` | `p_rsvp_id uuid, p_status text, p_acting_user_id uuid` | `void` | 0 | True | yes/yes/yes |
| `admin_upsert_rsvp` | `p_event_id uuid, p_user_id uuid, p_status text, p_acting_user_id uuid, p_child_id uuid, p_mini_league_player_id uuid` | `void` | 2 | True | yes/yes/yes |
| `allocate_eoi_to_team` | `_submission_id uuid, _team_id uuid` | `eoi_submissions` | 0 | True | yes/yes/yes |
| `app_admin_enable_ai_catch_up_for_pro_clubs` | `p_club_ids uuid[]` | `jsonb` | 1 | True | no/yes/yes |
| `app_ads_validate_payload` | `` | `trigger` | 0 | False | yes/yes/yes |
| `apply_stripe_storage_addon` | `p_event_id text, p_club_id uuid, p_storage_gb integer, p_user_id uuid` | `text` | 0 | True | no/no/yes |
| `apply_stripe_subscription_transition` | `p_event_id text, p_event_type text, p_event_at timestamp with time zone, p_subscription_id text, p_transition text, p_entity_type text, p_entity_id uuid, p_params jsonb` | `jsonb` | 3 | True | no/no/yes |
| `apply_training_default_forward` | `` | `trigger` | 0 | True | yes/yes/yes |
| `apply_training_defaults_on_event` | `` | `trigger` | 0 | True | yes/yes/yes |
| `apply_verified_iap_purchase` | `p_facts jsonb` | `jsonb` | 0 | True | no/no/yes |
| `approve_chat_group_join_request` | `_request_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `approve_role_request` | `p_request_id uuid` | `void` | 0 | True | yes/yes/yes |
| `archive_season` | `_season_id uuid` | `void` | 0 | True | yes/yes/yes |
| `audit_orphan_children` | `` | `TABLE(child_id uuid, name text, year_of_birth integer, parent_id uuid, created_at timestamp with time zone)` | 0 | True | yes/yes/yes |
| `authorize_storage_objects` | `_user_id uuid, _items jsonb` | `TABLE(bucket text, path text, allowed boolean)` | 0 | True | no/no/yes |
| `authorize_vault_deletion` | `_caller_id uuid, _kind text, _record_id uuid` | `TABLE(authorized boolean, reason text, effective_club_id uuid, team_id uuid, mini_league_id uuid, owner_id uuid, file_url text, image_url text, file_size bigint, created_at timestamp with time zone, storage_bucket text, storage_path text)` | 0 | True | no/no/yes |
| `auto_accept_pending_invites_on_role` | `` | `trigger` | 0 | True | yes/yes/yes |
| `auto_claim_eois_by_email` | `` | `trigger` | 0 | True | yes/yes/yes |
| `begin_vault_deletion` | `_caller_id uuid, _kind text, _record_id uuid, _bucket text, _object_path text, _deletion_type text` | `TABLE(job_id uuid, status text)` | 1 | True | no/no/yes |
| `bootstrap_dispatch_credentials` | `_base_url text` | `bigint` | 0 | True | yes/yes/yes |
| `broadcast_targets_user` | `_club_ids uuid[], _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `broadcast_visible_to_user` | `_club_ids uuid[], _sent_at timestamp with time zone, _user_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `bump_chat_group_unread_on_message` | `` | `trigger` | 0 | True | yes/yes/yes |
| `can_access_chat` | `_chat_type text, _chat_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_access_chat_attachment` | `_name text` | `boolean` | 0 | True | yes/yes/yes |
| `can_access_chat_group` | `_user_id uuid, _group_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_access_competition_admin_conversation` | `_user_id uuid, _conversation_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_access_mini_league_chat` | `_user_id uuid, _mini_league_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_access_poll_chat` | `_chat_type poll_chat_type, _chat_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_access_targeted_event` | `_user_id uuid, _event_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_admin_view_child` | `_child_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_admin_view_child_of_parent` | `_viewer uuid, _parent uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_contact_competition_admins` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/no/yes |
| `can_control_pitch_board` | `_team_id uuid, _event_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_create_competition_event` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_dm_user` | `other_user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_edit_drill` | `_drill_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_invite_players_to_team` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_manage_club_eois` | `_club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_manage_competition_media` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_manage_event_groups` | `_user_id uuid, _event_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_manage_game_result` | `_user_id uuid, _team_id uuid, _event_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_manage_team_captains` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_manage_team_roster` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_organise_competition` | `_user_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_post_in_chat_group` | `_user_id uuid, _group_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_publish_club_wide_photo` | `_user_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_read_general_chat_attachment` | `_user_id uuid, _name text` | `boolean` | 0 | True | no/no/yes |
| `can_rename_competition_chat` | `_user_id uuid, _group_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_view_album` | `_album_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_child_via_team` | `_child_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_competition` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_competition_match_event` | `_user_id uuid, _match_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_view_competition_wide_event` | `_user_id uuid, _event_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `can_view_drill` | `_drill_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_full_profile` | `_viewer_id uuid, _profile_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_message_read` | `_user_id uuid, _team_message_id uuid, _club_message_id uuid, _broadcast_message_id uuid, _group_message_id uuid, _direct_message_id uuid, _club_admin_message_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `can_view_mini_league` | `_user_id uuid, _mini_league_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `carry_over_players` | `_source_season_id uuid, _target_season_id uuid, _club_player_ids uuid[]` | `integer` | 0 | True | yes/yes/yes |
| `carry_over_players_to_teams` | `_target_season_id uuid, _assignments jsonb` | `integer` | 0 | True | yes/yes/yes |
| `cascade_club_soft_delete` | `` | `trigger` | 0 | True | yes/yes/yes |
| `cascade_team_soft_delete` | `` | `trigger` | 0 | True | yes/yes/yes |
| `chat_pinned_vault_touch_updated_at` | `` | `trigger` | 0 | False | yes/yes/yes |
| `check_password_reset_rate_limit` | `p_email text` | `boolean` | 0 | True | yes/yes/yes |
| `child_is_in_event_audience` | `_event_id uuid, _child_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `claim_competition_role_invites_on_profile_create` | `` | `trigger` | 0 | True | no/no/yes |
| `claim_competition_role_link` | `p_token text` | `uuid` | 0 | True | no/yes/yes |
| `claim_eoi_by_token` | `_token text` | `eoi_submissions` | 0 | True | yes/yes/yes |
| `claim_eoi_submission` | `_token text` | `eoi_submissions` | 0 | True | yes/yes/yes |
| `claim_mini_league_invite` | `_token uuid` | `TABLE(child_id uuid, mini_league_id uuid, club_id uuid)` | 0 | True | yes/yes/yes |
| `claim_pending_invites_on_profile_create` | `` | `trigger` | 0 | True | yes/yes/yes |
| `claim_push_delivery_jobs` | `p_limit integer` | `TABLE(id uuid, notification_id uuid, user_id uuid, payload jsonb, attempt_count integer)` | 1 | True | no/no/yes |
| `claim_shell_team` | `p_token uuid` | `TABLE(team_id uuid, club_id uuid)` | 0 | True | yes/yes/yes |
| `claim_stripe_webhook_event` | `p_event_id text, p_event_type text, p_object_id text, p_stale_after interval` | `text` | 2 | True | no/no/yes |
| `cleanup_expired_chat_summaries` | `` | `integer` | 0 | True | yes/yes/yes |
| `cleanup_fcm_token_for_user` | `p_token text, p_user_id uuid` | `void` | 0 | True | yes/yes/yes |
| `cleanup_notifications_for_deleted_comment` | `` | `trigger` | 0 | True | yes/yes/yes |
| `cleanup_notifications_for_deleted_photo` | `` | `trigger` | 0 | True | yes/yes/yes |
| `cleanup_old_fcm_tokens` | `` | `trigger` | 0 | True | yes/yes/yes |
| `cleanup_rate_limits` | `` | `void` | 0 | True | no/no/yes |
| `clear_chat_group_unread_on_read` | `` | `trigger` | 0 | True | yes/yes/yes |
| `clear_member_exclusion_on_role_insert` | `` | `trigger` | 0 | True | yes/yes/yes |
| `club_admin_can_rename_group` | `_user_id uuid, _group_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `club_engagement_active_users` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone` | `TABLE(day date, user_id uuid)` | 0 | True | yes/yes/yes |
| `club_engagement_benchmarks` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone` | `jsonb` | 0 | True | no/yes/yes |
| `club_engagement_message_volume` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone` | `TABLE(day date, club_count bigint, team_count bigint)` | 0 | True | no/yes/yes |
| `club_engagement_rsvp_completion_series` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone` | `TABLE(week date, completion_pct numeric, responded bigint, expected bigint)` | 0 | True | yes/yes/yes |
| `club_engagement_sponsor_performance` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone, _prev_start timestamp with time zone, _prev_end timestamp with time zone` | `TABLE(sponsor_id uuid, sponsor_name text, unique_reach integer, views integer, clicks integer, ctr numeric, prev_clicks integer, prev_views integer, raw_views integer, raw_clicks integer, tracking_started timestamp with time zone)` | 0 | True | yes/yes/yes |
| `club_engagement_total_unique_reach` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone` | `integer` | 0 | True | yes/yes/yes |
| `club_engagement_totals` | `_club_id uuid, _start timestamp with time zone, _end timestamp with time zone` | `TABLE(club_msgs bigint, team_msgs bigint, reactions bigint, broadcasts bigint, events bigint, rsvps_total bigint, rsvps_responded bigint, rsvps_going bigint, photos_uploaded bigint)` | 0 | True | no/yes/yes |
| `club_news_competition_ids` | `_club_id uuid` | `SETOF uuid` | 0 | True | no/yes/yes |
| `club_scoped_child_guardians` | `p_child_ids uuid[], p_club_id uuid` | `TABLE(child_id uuid, guardian_id uuid)` | 0 | True | yes/yes/yes |
| `competition_event_audience` | `_competition_id uuid` | `TABLE(user_id uuid, club_id uuid)` | 0 | True | no/no/yes |
| `complete_stripe_webhook_event` | `p_event_id text` | `void` | 0 | True | no/no/yes |
| `compute_push_notification_url` | `` | `trigger` | 0 | True | yes/yes/yes |
| `confirm_eoi_placement` | `_submission_id uuid` | `eoi_submissions` | 0 | True | yes/yes/yes |
| `consume_dispatch_bootstrap_token` | `_token text` | `boolean` | 0 | True | yes/yes/yes |
| `convert_event_to_recurring_series` | `p_event_id uuid, p_parent_updates jsonb, p_child_events jsonb, p_parent_event_date timestamp with time zone, p_parent_start_time timestamp with time zone, p_parent_end_time timestamp with time zone, p_recurrence_end_date date` | `jsonb` | 0 | True | yes/yes/yes |
| `create_association_club_event_atomic` | `_caller_id uuid, _association_id uuid, _club_ids uuid[], _title text, _description text, _event_date timestamp with time zone, _start_time timestamp with time zone, _end_time timestamp with time zone, _location_name text, _address text, _allow_guests boolean` | `jsonb` | 0 | True | no/no/yes |
| `create_child_for_parent_on_team` | `p_parent_user_id uuid, p_team_id uuid, p_name text, p_year_of_birth integer` | `uuid` | 1 | True | yes/yes/yes |
| `create_competition_event` | `p_competition_id uuid, p_title text, p_type event_type, p_event_date timestamp with time zone, p_location text, p_description text, p_end_time timestamp with time zone` | `integer` | 3 | True | no/yes/yes |
| `create_competition_owner_role` | `` | `trigger` | 0 | True | yes/yes/yes |
| `create_default_club_chats` | `` | `trigger` | 0 | True | yes/yes/yes |
| `create_default_notification_preferences` | `` | `trigger` | 0 | True | yes/yes/yes |
| `create_event_with_duties` | `p_event jsonb, p_child_dates timestamp with time zone[], p_duties jsonb` | `uuid` | 2 | False | yes/yes/yes |
| `create_mini_league_chat` | `` | `trigger` | 0 | True | yes/yes/yes |
| `create_mini_league_chat_group` | `` | `trigger` | 0 | True | yes/yes/yes |
| `create_personal_competition` | `p_name text, p_description text, p_sport text, p_season text, p_visibility text, p_shell_name text` | `TABLE(competition_id uuid, club_id uuid)` | 5 | True | no/yes/yes |
| `create_photo_album` | `_club_id uuid, _team_id uuid, _mini_league_id uuid, _event_id uuid, _caption text` | `uuid` | 0 | True | yes/yes/yes |
| `create_season_from_template` | `_source_season_id uuid, _new_name text, _start_date date, _end_date date` | `uuid` | 0 | True | yes/yes/yes |
| `create_team_with_creator_admin` | `p_club_id uuid, p_name text, p_level_age text, p_default_rsvp_audience text` | `uuid` | 2 | True | yes/yes/yes |
| `decrypt_sensitive_data` | `encrypted_data text` | `text` | 0 | True | no/no/yes |
| `default_competition_event_reminder` | `` | `trigger` | 0 | False | yes/yes/yes |
| `delete_media_photo` | `_photo_id uuid, _mode text` | `TABLE(photo_id uuid, mode text, vault_file_id uuid, vault_updated boolean, already_deleted boolean)` | 0 | True | no/yes/yes |
| `deny_role_request` | `p_request_id uuid` | `void` | 0 | True | yes/yes/yes |
| `derive_notification_club_id` | `_type text, _related_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `detect_returning_eoi_player` | `` | `trigger` | 0 | True | yes/yes/yes |
| `dismiss_accepted_pending_invites` | `p_team_id uuid, p_club_id uuid` | `integer` | 2 | True | yes/yes/yes |
| `dm_attachments_disabled` | `_user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `dm_block_reason` | `other_user_id uuid` | `text` | 0 | True | no/yes/yes |
| `duplicate_season_structure` | `_source_season_id uuid, _new_season_name text, _copy_staff boolean` | `uuid` | 1 | True | yes/yes/yes |
| `enable_ai_catch_up_for_all_club_members` | `p_club_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `encrypt_club_stripe_keys` | `` | `trigger` | 0 | True | yes/yes/yes |
| `encrypt_sensitive_data` | `data text` | `text` | 0 | True | no/no/yes |
| `enforce_child_event_audience` | `` | `trigger` | 0 | True | yes/yes/yes |
| `enforce_competition_owner_is_league_admin` | `_competition_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `enforce_photo_storage_prefix` | `` | `trigger` | 0 | False | yes/yes/yes |
| `enforce_pin_limit` | `` | `trigger` | 0 | False | yes/yes/yes |
| `enforce_rsvp_role_restriction` | `` | `trigger` | 0 | True | yes/yes/yes |
| `enforce_single_choice_poll` | `` | `trigger` | 0 | True | yes/yes/yes |
| `enforce_unique_event_player_assignment` | `` | `trigger` | 0 | True | no/yes/yes |
| `engagement_activity_trend` | `_days integer` | `TABLE(day date, messages bigint, rsvps bigint, event_views bigint, new_users bigint)` | 1 | True | yes/yes/yes |
| `engagement_dau_trend` | `_days integer` | `TABLE(day date, dau bigint, wau bigint, mau bigint)` | 1 | True | yes/yes/yes |
| `enqueue_event_push` | `p_url text, p_rows jsonb` | `TABLE(notification_id uuid, user_id uuid)` | 0 | True | no/no/yes |
| `enqueue_event_push_v2` | `p_url text, p_rows jsonb` | `TABLE(notification_id uuid, user_id uuid, dedupe_key text, created boolean, queued boolean)` | 0 | True | no/no/yes |
| `ensure_chat_group_vault_folder` | `_group_id uuid, _group_name text, _club_id uuid, _category text, _created_by uuid` | `uuid` | 0 | True | no/no/yes |
| `ensure_club_role_folders` | `_club_id uuid` | `void` | 0 | True | yes/yes/yes |
| `ensure_competition_coord_chat` | `_competition_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `ensure_competition_member_chat` | `_competition_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `ensure_competition_role_chat` | `_competition_id uuid, _scope text` | `uuid` | 0 | True | yes/yes/yes |
| `ensure_competition_vault` | `_competition_id uuid` | `uuid` | 0 | True | no/no/yes |
| `ensure_team_role_folders` | `_team_id uuid` | `void` | 0 | True | yes/yes/yes |
| `event_group_player_scope_ok` | `_group_id uuid, _player_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `event_has_target_team_restriction` | `_event_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `extract_mentioned_user_ids` | `message_text text` | `uuid[]` | 0 | False | yes/yes/yes |
| `fail_stripe_webhook_event` | `p_event_id text, p_error text` | `void` | 1 | True | no/no/yes |
| `fail_vault_deletion` | `_job_id uuid, _error_code text` | `text` | 0 | True | no/no/yes |
| `finalize_vault_deletion` | `_job_id uuid` | `text` | 0 | True | no/no/yes |
| `format_message_preview` | `_text text, _has_image boolean` | `text` | 1 | False | yes/yes/yes |
| `format_role_label` | `_role app_role` | `text` | 0 | False | yes/yes/yes |
| `generate_email_hash` | `email text` | `text` | 0 | False | yes/yes/yes |
| `generate_invite_short_code` | `` | `trigger` | 0 | True | yes/yes/yes |
| `get_business_contact_email` | `_business_id uuid` | `text` | 0 | True | yes/yes/yes |
| `get_child_club_points` | `_child_id uuid, _club_id uuid` | `integer` | 0 | True | no/yes/yes |
| `get_club_day_events` | `_club_id uuid, _day date` | `TABLE(id uuid, title text, type text, event_date timestamp with time zone, start_time timestamp with time zone, end_time timestamp with time zone, location_name text, address text, suburb text, team_id uuid, team_name text, opponent text, is_cancelled boolean)` | 0 | True | no/yes/yes |
| `get_club_free_usage` | `_club_id uuid` | `TABLE(cycle_start timestamp with time zone, cycle_end timestamp with time zone, photo_uploads_this_cycle integer, photo_storage_bytes bigint, chat_photo_uploads_this_cycle integer, chat_file_uploads_this_cycle integer, chat_file_storage_bytes bigint, file_count integer, file_storage_bytes bigint, polls_this_cycle integer, is_pro boolean)` | 0 | True | yes/yes/yes |
| `get_club_invite_by_token` | `_token text` | `TABLE(id uuid, club_id uuid, role app_role, token text, uses_count integer, max_uses integer, expires_at timestamp with time zone, created_at timestamp with time zone, created_by uuid, club_name text, club_logo_url text, club_description text)` | 0 | True | yes/yes/yes |
| `get_club_leaderboard` | `_club_id uuid, _window text, _viewer_id uuid, _limit integer` | `TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)` | 0 | True | no/yes/yes |
| `get_club_team_count` | `_club_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `get_competition_by_join_token` | `p_token uuid` | `TABLE(id uuid, name text, organizer_club_id uuid, organizer_club_name text, sport text, season text, status text)` | 0 | True | yes/yes/yes |
| `get_competition_event_recipients` | `p_event_id uuid` | `SETOF uuid` | 0 | True | no/yes/yes |
| `get_competition_join_token_status` | `p_token uuid` | `text` | 0 | True | yes/yes/yes |
| `get_competition_role_link_info` | `p_token text` | `TABLE(competition_id uuid, competition_name text, role text)` | 0 | True | yes/yes/yes |
| `get_competition_role_link_status` | `p_token text` | `TABLE(status text, competition_id uuid, competition_name text, role text)` | 0 | True | yes/yes/yes |
| `get_engagement_streak` | `_user_id uuid, _club_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `get_eoi_by_claim_token` | `_token text` | `eoi_submissions` | 0 | True | yes/yes/yes |
| `get_eoi_stats` | `_club_id uuid, _season_id uuid` | `TABLE(total bigint, submitted bigint, allocated bigint, confirmed bigint, registered bigint, withdrawn bigint, new_players bigint, returning_players bigint, views bigint, conversion_rate numeric)` | 1 | True | yes/yes/yes |
| `get_event_non_responders` | `_event_id uuid` | `TABLE(user_id uuid)` | 0 | True | no/no/yes |
| `get_event_non_responders_audience` | `_event_id uuid, _audience text` | `TABLE(user_id uuid)` | 0 | True | yes/yes/yes |
| `get_group_captain_user_ids` | `_group_id uuid` | `SETOF uuid` | 0 | True | no/yes/yes |
| `get_inbox_latest_club_messages` | `_club_ids uuid[]` | `TABLE(club_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, author_display_name text)` | 0 | False | yes/yes/yes |
| `get_inbox_latest_dm_messages` | `_conversation_ids uuid[]` | `TABLE(conversation_id uuid, message_id uuid, text text, image_url text, created_at timestamp with time zone, author_id uuid)` | 0 | False | yes/yes/yes |
| `get_inbox_latest_group_messages` | `_group_ids uuid[]` | `TABLE(group_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, author_display_name text)` | 0 | False | yes/yes/yes |
| `get_inbox_latest_team_messages` | `_team_ids uuid[]` | `TABLE(team_id uuid, message_id uuid, text text, created_at timestamp with time zone, image_url text, author_id uuid, is_club_announcement boolean, club_announcement_name text, author_display_name text)` | 0 | False | yes/yes/yes |
| `get_manual_group_participants` | `p_group_id uuid` | `TABLE(user_id uuid, display_name text, avatar_url text, is_creator boolean)` | 0 | True | yes/yes/yes |
| `get_members_events_enabled` | `member_ids uuid[]` | `TABLE(user_id uuid, events_enabled boolean)` | 0 | True | yes/yes/yes |
| `get_members_messages_enabled` | `member_ids uuid[]` | `TABLE(user_id uuid, messages_enabled boolean)` | 0 | True | yes/yes/yes |
| `get_members_push_reachable` | `member_ids uuid[]` | `TABLE(user_id uuid, has_push boolean)` | 0 | True | yes/yes/yes |
| `get_messages_page_bootstrap` | `_user_id uuid` | `jsonb` | 0 | True | yes/yes/yes |
| `get_my_accessible_chat_group_ids` | `_user_id uuid` | `uuid[]` | 0 | True | yes/yes/yes |
| `get_my_pending_eois` | `` | `SETOF eoi_submissions` | 0 | True | yes/yes/yes |
| `get_online_users_from_set` | `_user_ids uuid[]` | `TABLE(user_id uuid)` | 0 | True | yes/yes/yes |
| `get_or_create_club_admin_conversation` | `p_club_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `get_or_create_competition_admin_chat` | `p_competition_id uuid` | `uuid` | 0 | True | no/yes/yes |
| `get_or_create_competition_admin_conversation` | `p_competition_id uuid` | `uuid` | 0 | True | no/yes/yes |
| `get_or_create_dm_conversation` | `other_user_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `get_or_create_member_invite_token` | `p_team_id uuid` | `text` | 0 | True | yes/yes/yes |
| `get_or_create_member_invite_token` | `p_team_id uuid, p_role app_role` | `text` | 1 | True | yes/yes/yes |
| `get_or_create_member_invite_token` | `p_team_id uuid, p_role app_role, p_child_name text, p_child_year_of_birth integer` | `text` | 3 | True | yes/yes/yes |
| `get_pending_invite_by_token` | `_token text` | `TABLE(id uuid, team_id uuid, club_id uuid, role text, invited_label text, invited_email text, status text, team_name text, team_logo_url text, club_name text, club_logo_url text, metadata jsonb)` | 0 | True | yes/yes/yes |
| `get_photo_view_counts` | `_photo_ids uuid[]` | `TABLE(photo_id uuid, view_count bigint)` | 0 | True | yes/yes/yes |
| `get_public_eoi_config` | `_club_slug text, _season_slug text` | `TABLE(season_id uuid, season_name text, club_id uuid, club_name text, club_logo_url text, is_open boolean, opens_at timestamp with time zone, closes_at timestamp with time zone, welcome_message text, thank_you_message text, thank_you_redirect_url text, require_dob boolean, require_gender boolean, ask_preferences boolean, ask_availability boolean, ask_skill_level boolean, ask_position boolean)` | 0 | True | yes/yes/yes |
| `get_push_notification_health` | `` | `jsonb` | 0 | True | no/yes/yes |
| `get_push_subscription_health` | `p_user_id uuid` | `TABLE(endpoint text, platform text, failure_count integer, last_success_at timestamp with time zone, last_failure_at timestamp with time zone, last_failure_reason text, age_hours numeric)` | 0 | True | yes/yes/yes |
| `get_returning_players` | `_source_season_id uuid` | `TABLE(club_player_id uuid, display_name text, date_of_birth date, age_years integer, previous_team_id uuid, previous_team_name text, membership_role team_membership_role)` | 0 | True | yes/yes/yes |
| `get_targeted_event_attendance_roster` | `p_event_id uuid` | `TABLE(kind text, person_id uuid, display_name text, parent_id uuid, team_ids uuid[])` | 0 | True | no/yes/yes |
| `get_targeted_event_notification_recipients` | `p_event_id uuid` | `TABLE(user_id uuid)` | 0 | True | no/yes/yes |
| `get_team_children_for_pitch_board` | `p_team_id uuid` | `TABLE(assignment_id uuid, child_id uuid, child_name text, year_of_birth integer, parent_id uuid)` | 0 | True | yes/yes/yes |
| `get_team_competition_names` | `_team_ids uuid[]` | `TABLE(team_id uuid, competition_id uuid, competition_name text, competition_logo_url text, competition_sport text)` | 0 | True | no/yes/yes |
| `get_team_invite_by_token` | `_token text` | `TABLE(id uuid, team_id uuid, role text, token text, uses_count integer, max_uses integer, expires_at timestamp with time zone, created_at timestamp with time zone, created_by uuid, team_name text, team_logo_url text, club_id uuid, club_name text, metadata jsonb)` | 0 | True | yes/yes/yes |
| `get_team_leaderboard` | `_team_id uuid, _window text, _viewer_id uuid, _limit integer` | `TABLE(rank integer, user_id uuid, display_name text, avatar_url text, points integer, is_viewer boolean, hidden boolean)` | 0 | True | no/yes/yes |
| `get_teams_leaderboard` | `_club_id uuid, _window text, _limit integer` | `TABLE(rank integer, team_id uuid, team_name text, points integer)` | 0 | True | no/yes/yes |
| `get_unread_message_counts` | `_user_id uuid` | `jsonb` | 0 | False | yes/yes/yes |
| `get_user_by_email_for_passkey` | `lookup_email text` | `TABLE(id uuid)` | 0 | True | yes/yes/yes |
| `get_user_club_points` | `_user_id uuid, _club_id uuid` | `integer` | 0 | True | no/yes/yes |
| `get_user_emails` | `user_ids uuid[]` | `TABLE(id uuid, email text)` | 0 | True | no/no/yes |
| `get_user_emails_by_ids` | `user_ids uuid[]` | `TABLE(user_id uuid, email text)` | 0 | True | no/no/yes |
| `get_user_leaderboard_rank` | `_user_id uuid, _club_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `get_user_leaderboard_rank_all_time` | `_user_id uuid, _club_id uuid` | `TABLE(rank integer, total integer, points integer)` | 0 | True | yes/yes/yes |
| `get_user_leaderboard_rank_seasoned` | `_user_id uuid, _club_id uuid, _season_id uuid` | `TABLE(rank integer, total integer, points integer)` | 0 | True | yes/yes/yes |
| `gin_extract_query_trgm` | `text, internal, smallint, internal, internal, internal, internal` | `internal` | 0 | False | yes/yes/yes |
| `gin_extract_value_trgm` | `text, internal` | `internal` | 0 | False | yes/yes/yes |
| `gin_trgm_consistent` | `internal, smallint, text, integer, internal, internal, internal, internal` | `boolean` | 0 | False | yes/yes/yes |
| `gin_trgm_triconsistent` | `internal, smallint, text, integer, internal, internal, internal` | `"char"` | 0 | False | yes/yes/yes |
| `gtrgm_compress` | `internal` | `internal` | 0 | False | yes/yes/yes |
| `gtrgm_consistent` | `internal, text, smallint, oid, internal` | `boolean` | 0 | False | yes/yes/yes |
| `gtrgm_decompress` | `internal` | `internal` | 0 | False | yes/yes/yes |
| `gtrgm_distance` | `internal, text, smallint, oid, internal` | `double precision` | 0 | False | yes/yes/yes |
| `gtrgm_in` | `cstring` | `gtrgm` | 0 | False | yes/yes/yes |
| `gtrgm_options` | `internal` | `void` | 0 | False | yes/yes/yes |
| `gtrgm_out` | `gtrgm` | `cstring` | 0 | False | yes/yes/yes |
| `gtrgm_penalty` | `internal, internal, internal` | `internal` | 0 | False | yes/yes/yes |
| `gtrgm_picksplit` | `internal, internal` | `internal` | 0 | False | yes/yes/yes |
| `gtrgm_same` | `gtrgm, gtrgm, internal` | `internal` | 0 | False | yes/yes/yes |
| `gtrgm_union` | `internal, internal` | `gtrgm` | 0 | False | yes/yes/yes |
| `guard_competition_contact_members` | `` | `trigger` | 0 | True | no/no/yes |
| `guard_external_competition_match_edits` | `` | `trigger` | 0 | False | yes/yes/yes |
| `handle_new_user` | `` | `trigger` | 0 | True | yes/yes/yes |
| `hard_delete_club` | `_club_id uuid` | `void` | 0 | True | yes/yes/yes |
| `has_active_pro_for_club` | `_club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `has_active_pro_for_team` | `_team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `has_role` | `_user_id uuid, _role app_role, _club_id uuid, _team_id uuid` | `boolean` | 2 | True | yes/yes/yes |
| `has_valid_team_invite_for_role` | `_team_id uuid, _role app_role` | `boolean` | 0 | True | yes/yes/yes |
| `hash_email` | `email text` | `text` | 0 | True | yes/yes/yes |
| `heartbeat_presence` | `_platform text, _user_agent text` | `void` | 2 | True | yes/yes/yes |
| `increment_child_club_points` | `_child_id uuid, _club_id uuid, _amount integer` | `integer` | 0 | True | no/yes/yes |
| `increment_child_ignite_points` | `_child_id uuid, _amount integer` | `integer` | 0 | True | yes/yes/yes |
| `increment_child_ignite_points` | `_child_id uuid, _amount integer, _club_id uuid` | `integer` | 0 | True | no/yes/yes |
| `increment_ignite_points` | `_user_id uuid, _amount integer` | `integer` | 0 | True | yes/yes/yes |
| `increment_ignite_points` | `_user_id uuid, _amount integer, _club_id uuid` | `integer` | 0 | True | no/yes/yes |
| `increment_user_club_points` | `_user_id uuid, _club_id uuid, _amount integer` | `integer` | 0 | True | no/yes/yes |
| `inherit_parent_event_scope` | `` | `trigger` | 0 | True | yes/yes/yes |
| `insert_engagement_reminders_atomic` | `p_rows jsonb` | `integer` | 0 | True | no/no/yes |
| `internal_functions_base_url` | `` | `text` | 0 | True | no/no/yes |
| `internal_service_role_key` | `` | `text` | 0 | True | no/no/yes |
| `invite_competition_official` | `p_competition_id uuid, p_email text, p_name text, p_role text` | `jsonb` | 0 | True | no/yes/yes |
| `invite_shell_team_to_competition` | `p_competition_id uuid, p_team_name text, p_club_name text, p_contact_name text, p_contact_email text, p_division_id uuid` | `TABLE(team_id uuid, club_id uuid, token uuid)` | 1 | True | yes/yes/yes |
| `invite_token_has_existing_account` | `_token text` | `boolean` | 0 | True | yes/yes/yes |
| `is_any_mini_league_admin` | `_user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_association_admin` | `_user_id uuid, _association_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_blocked_by` | `_blocker_id uuid, _blocked_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_child_guardian` | `_user_id uuid, _child_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_club_admin` | `_user_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_club_admin_conversation_participant` | `p_conversation_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_club_admin_for` | `_club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_club_chat_author_visible` | `_viewer_id uuid, _profile_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_club_member` | `_user_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_competition_admin` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_competition_audience` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `is_competition_league_admin` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_competition_member` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `is_competition_official` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `is_competition_role_admin` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `is_eligible_competition_owner` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_group_captain_member` | `_user_id uuid, _group_id uuid` | `boolean` | 0 | True | no/no/yes |
| `is_group_member` | `_group_id uuid, _user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_guardian_of_child` | `_user_id uuid, _child_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_guardian_visible_in_club` | `_guardian_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_league_admin` | `p_user_id uuid, p_mini_league_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_league_admin_for_competition` | `_user_id uuid, _competition_id uuid` | `boolean` | 0 | True | no/yes/yes |
| `is_league_parent` | `p_user_id uuid, p_mini_league_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_parent_of_child` | `_user_id uuid, _child_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_photo_commenter_visible` | `_viewer_id uuid, _profile_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_photo_uploader_visible` | `_viewer_id uuid, _profile_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_season_editable` | `_season_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_season_eoi_open` | `_season_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_subs_manager_for_event` | `_user_id uuid, _event_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_team_admin_for_entry` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_team_captain` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_team_member` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_team_or_club_pro` | `_team_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `is_vault_admin` | `_user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `join_competition_with_token` | `p_token uuid, p_team_id uuid, p_division_id uuid` | `TABLE(competition_id uuid, entry_id uuid)` | 1 | True | yes/yes/yes |
| `join_open_chat_group` | `_group_id uuid` | `uuid` | 0 | True | no/yes/yes |
| `link_existing_child_as_guardian` | `p_child_id uuid, p_relationship text` | `jsonb` | 1 | True | yes/yes/yes |
| `list_club_parents_for_team` | `p_team_id uuid` | `TABLE(user_id uuid, display_name text, avatar_url text, role text)` | 0 | True | yes/yes/yes |
| `list_competition_coordinators` | `_competition_id uuid` | `TABLE(user_id uuid, role text, display_name text, avatar_url text, created_at timestamp with time zone)` | 0 | True | yes/yes/yes |
| `list_contactable_competitions` | `p_club_id uuid` | `TABLE(id uuid, name text, logo_url text)` | 1 | True | no/yes/yes |
| `list_divisions_by_join_token` | `p_token uuid` | `TABLE(id uuid, name text, age_group text, gender text, skill_level text, sort_order integer)` | 0 | True | yes/yes/yes |
| `list_entered_team_ids_by_join_token` | `p_token uuid` | `TABLE(team_id uuid, status text)` | 0 | True | yes/yes/yes |
| `list_leaderboard_teams` | `_club_id uuid` | `TABLE(id uuid, name text)` | 0 | True | no/yes/yes |
| `log_active_game_write` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_broadcast_message_deletion` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_club_message_deletion` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_group_message_deletion` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_role_change` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_rsvp_change` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_team_message_deletion` | `` | `trigger` | 0 | True | yes/yes/yes |
| `log_user_deletion` | `` | `trigger` | 0 | True | yes/yes/yes |
| `lookup_invitable_user_by_email` | `_email text, _club_id uuid, _team_id uuid, _mini_league_id uuid` | `TABLE(user_id uuid, display_name text, avatar_url text, already_in_club boolean, already_in_team boolean, already_in_mini_league boolean)` | 3 | True | yes/yes/yes |
| `manage_coach_attendance_duty` | `` | `trigger` | 0 | True | yes/yes/yes |
| `mark_chat_scope_notifications_read` | `_user_id uuid, _scope_kind text, _scope_id uuid` | `integer` | 1 | False | yes/yes/yes |
| `mark_gallery_card_push_sent` | `_card_id uuid` | `void` | 0 | True | yes/yes/yes |
| `mark_message_reads` | `_message_type text, _message_ids uuid[]` | `void` | 0 | True | yes/yes/yes |
| `mark_pending_invite_accepted` | `` | `trigger` | 0 | True | yes/yes/yes |
| `mark_read_on_reaction` | `` | `trigger` | 0 | True | yes/yes/yes |
| `mask_email` | `_email text` | `text` | 0 | False | yes/yes/yes |
| `match_scores_hidden` | `_match_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `message_reads_compute_scope_key` | `_row message_reads` | `text` | 0 | True | yes/yes/yes |
| `mirror_competition_photo_to_vault` | `_photo_id uuid` | `uuid` | 0 | True | no/no/yes |
| `move_child_to_team` | `p_child_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid` | `void` | 0 | True | yes/yes/yes |
| `move_event_group_player` | `p_player_id uuid, p_from_group_id uuid, p_to_group_id uuid, p_to_team text` | `void` | 0 | False | no/yes/yes |
| `move_member_to_team` | `p_user_id uuid, p_from_team_id uuid, p_to_team_id uuid, p_club_id uuid` | `void` | 0 | True | yes/yes/yes |
| `my_chat_group_ids` | `` | `SETOF uuid` | 0 | True | no/yes/yes |
| `notify_admins_new_member` | `` | `trigger` | 0 | True | yes/yes/yes |
| `notify_all_users` | `_exclude_user_id uuid, _type text, _message text, _related_id uuid` | `void` | 1 | True | yes/yes/yes |
| `notify_club_members` | `_club_id uuid, _exclude_user_id uuid, _type text, _message text, _related_id uuid` | `void` | 1 | True | yes/yes/yes |
| `notify_club_news` | `_news_id uuid, _send_push boolean` | `integer` | 1 | True | yes/yes/yes |
| `notify_enrolment_email` | `` | `trigger` | 0 | True | yes/yes/yes |
| `notify_formation_change` | `_recipient_ids uuid[], _message text, _related_id text` | `void` | 0 | True | yes/yes/yes |
| `notify_new_club_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `notify_new_member_upcoming_events` | `` | `trigger` | 0 | True | yes/yes/yes |
| `notify_new_mini_league_assignment` | `` | `trigger` | 0 | True | yes/yes/yes |
| `notify_season_archived` | `_season_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `notify_season_published` | `_season_id uuid` | `integer` | 0 | True | yes/yes/yes |
| `notify_team_members` | `_team_id uuid, _exclude_user_id uuid, _type text, _message text, _related_id uuid` | `void` | 1 | True | yes/yes/yes |
| `on_broadcast_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_chat_group_create_vault_folder` | `` | `trigger` | 0 | True | no/no/yes |
| `on_chat_group_deleted_archive_vault_folder` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_chat_group_hard_deleted_archive_vault_folder` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_chat_group_renamed_sync_vault_folder` | `` | `trigger` | 0 | True | no/no/yes |
| `on_club_admin_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_club_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_competition_admin_message_created` | `` | `trigger` | 0 | True | no/no/yes |
| `on_direct_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_duty_assigned` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_event_auto_chat_post` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_event_cancelled` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_event_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_event_updated` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_group_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_message_reaction_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_pending_invite_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_photo_comment_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_photo_comment_reaction_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_photo_reaction_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_photo_uploaded` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_role_request_created` | `` | `trigger` | 0 | True | no/no/yes |
| `on_role_request_processed` | `` | `trigger` | 0 | True | no/no/yes |
| `on_rsvp_notify_admins` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_team_message_created` | `` | `trigger` | 0 | True | yes/yes/yes |
| `on_user_blocked` | `` | `trigger` | 0 | True | yes/yes/yes |
| `playhq_touch_updated_at` | `` | `trigger` | 0 | False | yes/yes/yes |
| `points_history_attach_season` | `` | `trigger` | 0 | True | yes/yes/yes |
| `post_chat_photo_gallery_reminder` | `_team_id uuid, _author_id uuid, _system_user_id uuid, _photo_count integer` | `uuid` | 0 | True | yes/yes/yes |
| `post_membership_system_message` | `` | `trigger` | 0 | True | yes/yes/yes |
| `post_or_update_team_gallery_card` | `_team_id uuid, _photo_ids uuid[], _hero_photo_id uuid, _hero_image_url text, _event_id uuid` | `TABLE(card_id uuid, message_id uuid, total_count integer, was_new boolean)` | 1 | True | yes/yes/yes |
| `post_team_gallery_prompt` | `_team_id uuid, _event_id uuid, _system_user_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `prevent_duplicate_child_for_parent` | `` | `trigger` | 0 | True | yes/yes/yes |
| `prevent_duplicate_child_on_team` | `` | `trigger` | 0 | True | yes/yes/yes |
| `profile_team_history` | `_profile_id uuid` | `TABLE(membership_id uuid, team_id uuid, team_name text, team_level_age text, club_id uuid, club_name text, season_id uuid, season_name text, season_status season_status, season_start_date date, season_end_date date, joined_at timestamp with time zone)` | 0 | True | yes/yes/yes |
| `promote_waitlisted_on_withdrawal` | `` | `trigger` | 0 | True | yes/yes/yes |
| `protect_role_folders` | `` | `trigger` | 0 | False | yes/yes/yes |
| `provision_invite_children` | `_invite_id uuid, _guardian_id uuid` | `jsonb` | 0 | True | no/yes/yes |
| `provision_invite_children` | `p_invite_id uuid` | `jsonb` | 0 | True | no/yes/yes |
| `prune_active_games_write_log` | `` | `void` | 0 | True | yes/yes/yes |
| `prune_cron_run_history` | `p_retain_days integer, p_batch_size integer, p_max_batches integer` | `jsonb` | 3 | True | no/no/yes |
| `prune_old_diagnostic_logs` | `` | `TABLE(push_logs_deleted bigint, activity_logs_deleted bigint)` | 0 | True | no/no/yes |
| `prune_telemetry_tables` | `p_perf_retain_days integer, p_analytics_retain_days integer, p_batch_size integer, p_max_batches integer` | `jsonb` | 4 | True | yes/yes/yes |
| `publish_season` | `_season_id uuid` | `void` | 0 | True | yes/yes/yes |
| `purge_old_client_perf_log` | `` | `void` | 0 | True | yes/yes/yes |
| `push_delivery_cron_failures` | `p_limit integer` | `TABLE(run_start timestamp with time zone, status text, return_message text)` | 1 | True | no/no/yes |
| `push_delivery_preflight` | `` | `TABLE(check_name text, ok boolean, detail text)` | 0 | True | no/no/yes |
| `push_delivery_queue_stats` | `` | `TABLE(status text, jobs bigint, oldest_created_at timestamp with time zone)` | 0 | True | no/no/yes |
| `push_delivery_queue_touch` | `` | `trigger` | 0 | False | yes/yes/yes |
| `push_delivery_queue_validate` | `` | `trigger` | 0 | False | yes/yes/yes |
| `quick_rsvp_from_dm` | `_event_id uuid, _status text` | `TABLE(inserted_count integer)` | 0 | True | no/yes/yes |
| `reconcile_chat_group_unread` | `` | `TABLE(group_id uuid, user_id uuid, cached integer, actual integer)` | 0 | True | yes/yes/yes |
| `reconcile_notification_dispatch_log` | `` | `integer` | 0 | True | yes/yes/yes |
| `reconcile_pending_invites` | `_team_id uuid, _club_id uuid` | `TABLE(reconciled_count integer, skipped_count integer)` | 2 | True | yes/yes/yes |
| `record_notification_dispatch` | `_request_id bigint, _message_type text, _message_id uuid, _error_detail text, _target_function text` | `void` | 2 | True | yes/yes/yes |
| `record_push_failure` | `p_endpoint text, p_reason text` | `void` | 1 | True | yes/yes/yes |
| `record_push_success` | `p_endpoint text` | `void` | 0 | True | yes/yes/yes |
| `redeem_club_reward` | `_reward_id uuid, _child_id uuid, _idempotency_key text` | `jsonb` | 2 | True | no/yes/yes |
| `refresh_competition_event_titles_on_team_rename` | `` | `trigger` | 0 | True | no/no/yes |
| `regenerate_competition_join_token` | `p_competition_id uuid` | `uuid` | 0 | True | yes/yes/yes |
| `reject_chat_group_join_request` | `_request_id uuid` | `void` | 0 | True | yes/yes/yes |
| `release_cron_lock` | `p_key text` | `void` | 0 | True | no/no/yes |
| `remove_club_member` | `_club_id uuid, _user_id uuid` | `jsonb` | 0 | True | no/yes/yes |
| `remove_team_member` | `_team_id uuid, _user_id uuid` | `jsonb` | 0 | True | no/yes/yes |
| `rename_competition_chat` | `_group_id uuid, _name text` | `void` | 0 | True | no/yes/yes |
| `repair_event_push_queue` | `p_event_id uuid, p_dry_run boolean` | `TABLE(candidate_count bigint, queued_count bigint)` | 1 | True | no/no/yes |
| `repair_placeholder_member_names` | `` | `trigger` | 0 | True | yes/yes/yes |
| `replace_event_groups` | `p_event_id uuid, p_groups jsonb, p_delete_existing boolean` | `uuid[]` | 1 | False | no/yes/yes |
| `request_join_chat_group` | `_group_id uuid, _message text` | `uuid` | 1 | True | yes/yes/yes |
| `require_app_admin` | `` | `boolean` | 0 | True | yes/yes/yes |
| `require_club_admin` | `p_club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `reserve_vault_storage` | `_club_id uuid, _bytes bigint` | `TABLE(reservation_id uuid, limit_bytes bigint, used_bytes bigint)` | 0 | True | no/yes/yes |
| `resolve_actor_display_name` | `p_user_id uuid` | `text` | 0 | True | yes/yes/yes |
| `resolve_invite_short_code` | `_code text` | `text` | 0 | True | yes/yes/yes |
| `resolve_vault_record_scope` | `_kind text, _record_id uuid` | `TABLE(found boolean, reason text, effective_club_id uuid, team_id uuid, mini_league_id uuid, owner_id uuid, file_url text, image_url text, file_size bigint, created_at timestamp with time zone, storage_bucket text, storage_path text)` | 0 | True | no/no/yes |
| `resync_competition_scores_on_hide_toggle` | `` | `trigger` | 0 | True | yes/yes/yes |
| `resync_division_scores_on_hide_toggle` | `` | `trigger` | 0 | True | yes/yes/yes |
| `rsvps_fill_child_from_mlp` | `` | `trigger` | 0 | True | yes/yes/yes |
| `scheduled_messages_validate` | `` | `trigger` | 0 | False | yes/yes/yes |
| `search_club_children_for_team` | `p_team_id uuid, p_query text` | `TABLE(child_id uuid, name text, year_of_birth integer, team_names text[], guardian_names text[], on_this_team boolean)` | 0 | True | no/yes/yes |
| `search_competition_coordinator_candidates` | `_competition_id uuid, _query text` | `TABLE(user_id uuid, display_name text, avatar_url text, source text, masked_email text)` | 1 | True | yes/yes/yes |
| `search_invitable_profiles` | `_query text, _limit integer, _club_id uuid` | `TABLE(id uuid, display_name text, avatar_url text, masked_email text)` | 2 | True | no/yes/yes |
| `season_orphan_events` | `_club_id uuid` | `TABLE(event_id uuid, title text, event_date date, team_id uuid, team_name text)` | 0 | True | yes/yes/yes |
| `season_player_stats` | `_season_id uuid, _team_id uuid` | `TABLE(club_player_id uuid, player_name text, events_total integer, events_attended integer, attendance_pct numeric, games_played integer)` | 0 | True | yes/yes/yes |
| `season_team_summary` | `_season_id uuid` | `TABLE(team_id uuid, team_name text, events_count integer, avg_attendance_pct numeric, roster_size integer)` | 0 | True | yes/yes/yes |
| `seed_active_club_theme_from_invite` | `` | `trigger` | 0 | True | yes/yes/yes |
| `self_heal_dispatch_credentials` | `` | `text` | 0 | True | no/no/yes |
| `send_duty_notification_email` | `p_recipient_user_id uuid, p_duty_name text, p_event_id uuid, p_event_title text, p_event_date text, p_event_time text, p_team_name text, p_club_name text, p_club_logo_url text` | `void` | 0 | True | yes/yes/yes |
| `send_fixture_import_summary` | `p_event_ids uuid[]` | `void` | 0 | True | no/yes/yes |
| `send_game_stats_email_rpc` | `_event_id uuid, _team_id uuid, _event_title text, _event_date text, _opponent text, _total_players integer, _total_game_time text` | `void` | 0 | True | yes/yes/yes |
| `send_message_notification_email` | `p_recipient_user_id uuid, p_sender_user_id uuid, p_message_text text, p_message_type text, p_context_id uuid, p_context_name text, p_message_id uuid, p_has_image boolean` | `void` | 1 | True | yes/yes/yes |
| `send_photo_notification_email` | `p_recipient_user_id uuid, p_uploader_user_id uuid, p_photo_id uuid, p_context_type text, p_context_id uuid, p_context_name text` | `void` | 0 | True | yes/yes/yes |
| `send_pitch_board_notification_email_rpc` | `_recipient_user_id uuid, _team_id uuid, _team_name text, _notification_type text, _notification_message text, _event_id uuid` | `void` | 1 | True | yes/yes/yes |
| `send_push_notification` | `` | `trigger` | 0 | True | yes/yes/yes |
| `send_reward_redeemed_email_rpc` | `_reward_name text, _points_spent integer, _remaining_points integer, _club_name text, _reward_description text, _sponsor_name text, _show_qr_code boolean, _club_logo_url text, _reward_logo_url text, _redeemed_for_child_name text` | `void` | 6 | True | yes/yes/yes |
| `set_chat_group_join_policy_default` | `` | `trigger` | 0 | False | yes/yes/yes |
| `set_internal_dispatch_credentials` | `_service_role_key text, _functions_base_url text` | `jsonb` | 0 | True | yes/yes/yes |
| `set_legal_reacceptance` | `_required boolean, _confirmation text, _version text, _summary text` | `jsonb` | 3 | True | no/yes/yes |
| `set_limit` | `real` | `real` | 0 | False | yes/yes/yes |
| `set_message_reads_scope_key` | `` | `trigger` | 0 | True | yes/yes/yes |
| `set_notification_club_id` | `` | `trigger` | 0 | True | yes/yes/yes |
| `set_playhq_player_links_updated_at` | `` | `trigger` | 0 | False | yes/yes/yes |
| `set_profile_email_hash` | `` | `trigger` | 0 | True | yes/yes/yes |
| `settle_vault_storage` | `_reservation_id uuid, _committed boolean` | `text` | 0 | True | no/yes/yes |
| `shares_team_or_club_with` | `_viewer_id uuid, _profile_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `show_limit` | `` | `real` | 0 | False | yes/yes/yes |
| `show_trgm` | `text` | `text[]` | 0 | False | yes/yes/yes |
| `similarity` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `similarity_dist` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `similarity_op` | `text, text` | `boolean` | 0 | False | yes/yes/yes |
| `skip_duplicate_message_reads` | `` | `trigger` | 0 | True | yes/yes/yes |
| `skip_duplicate_rsvps` | `` | `trigger` | 0 | True | yes/yes/yes |
| `stamp_competition_admin_reply` | `` | `trigger` | 0 | True | no/no/yes |
| `strict_word_similarity` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `strict_word_similarity_commutator_op` | `text, text` | `boolean` | 0 | False | yes/yes/yes |
| `strict_word_similarity_dist_commutator_op` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `strict_word_similarity_dist_op` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `strict_word_similarity_op` | `text, text` | `boolean` | 0 | False | yes/yes/yes |
| `stripe_event_is_stale` | `p_subscription_id text, p_event_at timestamp with time zone` | `boolean` | 0 | True | no/no/yes |
| `suggest_eoi_teams` | `_season_id uuid` | `TABLE(age_group text, player_count bigint, avg_skill numeric, submission_ids uuid[])` | 0 | True | yes/yes/yes |
| `swap_event_group_players` | `p_player1_id uuid, p_player1_group_id uuid, p_player1_team text, p_player2_id uuid, p_player2_group_id uuid, p_player2_team text` | `void` | 0 | False | no/yes/yes |
| `sync_album_aggregates` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_child_parent_to_guardian` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_club_is_pro` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_club_pro_status` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_club_pro_status_on_delete` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_competition_contact_chat_members` | `_group_id uuid` | `void` | 0 | True | no/no/yes |
| `sync_competition_coord_chat_members` | `_competition_id uuid` | `void` | 0 | True | yes/yes/yes |
| `sync_competition_match_events` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_competition_member_chat_members` | `_competition_id uuid` | `void` | 0 | True | yes/yes/yes |
| `sync_competition_result_to_events` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_competition_role_chat_members` | `_competition_id uuid, _scope text` | `void` | 0 | True | yes/yes/yes |
| `sync_event_duties` | `p_event_id uuid, p_delete_ids uuid[], p_duties jsonb` | `jsonb` | 2 | False | yes/yes/yes |
| `sync_mini_league_chat_group_name` | `` | `trigger` | 0 | True | yes/yes/yes |
| `sync_team_captain_role` | `` | `trigger` | 0 | True | yes/yes/yes |
| `team_has_club_pro_access` | `_team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `team_has_club_pro_football_access` | `_team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `tg_club_messages_update_parent_preview` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_create_coord_chat` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_enforce_owner` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_ensure_vault` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_competition_entries_sync_contact_chats` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_competition_entry_sync_chat` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_member_chat_toggle` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_publish_fixtures` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_competition_rename_coord_chat` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_role_sync_chat` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_role_sync_contact_chats` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_competition_roles_enforce_owner` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_competition_row_ensure_vault` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_group_messages_update_parent_preview` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_league_admin_enforce_competition_owner` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_photos_mirror_competition_vault` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_stamp_message_edited_at` | `` | `trigger` | 0 | False | yes/yes/yes |
| `tg_team_admin_sync_competition_chats` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_team_messages_update_parent_preview` | `` | `trigger` | 0 | True | yes/yes/yes |
| `tg_user_roles_sync_contact_chats` | `` | `trigger` | 0 | True | no/no/yes |
| `tg_vault_file_stamp_competition` | `` | `trigger` | 0 | True | no/no/yes |
| `touch_chat_group_join_requests_updated_at` | `` | `trigger` | 0 | False | yes/yes/yes |
| `touch_training_default_confirmation` | `` | `trigger` | 0 | True | yes/yes/yes |
| `track_user_activity_start` | `_page_path text, _page_label text, _session_id text, _club_id uuid` | `uuid` | 1 | True | yes/yes/yes |
| `trg_seed_club_role_folders` | `` | `trigger` | 0 | True | yes/yes/yes |
| `trg_seed_team_role_folders` | `` | `trigger` | 0 | True | yes/yes/yes |
| `try_award_streak_bonus` | `_user_id uuid, _club_id uuid, _streak_length integer, _bonus_points integer` | `boolean` | 0 | True | yes/yes/yes |
| `try_cron_lock` | `p_key text, p_ttl_seconds integer` | `boolean` | 1 | True | no/no/yes |
| `try_insert_points_cooldown` | `_user_id uuid, _action_type text, _scope_id text, _awarded_date date, _points_awarded integer, _club_id uuid, _daily_cap integer` | `boolean` | 0 | True | yes/yes/yes |
| `update_club_storage_on_file_change` | `` | `trigger` | 0 | True | yes/yes/yes |
| `update_club_storage_on_photo_change` | `` | `trigger` | 0 | True | yes/yes/yes |
| `update_dm_conversation_timestamp` | `` | `trigger` | 0 | True | yes/yes/yes |
| `update_event_series` | `p_event_id uuid, p_updates jsonb, p_selected_event_date timestamp with time zone, p_selected_start_time timestamp with time zone, p_selected_end_time timestamp with time zone` | `void` | 0 | True | yes/yes/yes |
| `update_updated_at_column` | `` | `trigger` | 0 | False | yes/yes/yes |
| `update_user_activity_duration` | `_activity_log_id uuid, _duration_seconds integer` | `void` | 0 | True | yes/yes/yes |
| `upsert_child_for_guardian` | `p_name text, p_year_of_birth integer, p_guardian_user_id uuid, p_relationship text, p_club_id uuid` | `jsonb` | 4 | True | yes/yes/yes |
| `user_email_matches_invite` | `_user_id uuid, _invited_email text` | `boolean` | 0 | True | yes/yes/yes |
| `user_has_any_club_pro` | `_user_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `user_has_any_club_role` | `_user_id uuid, _club_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `user_matches_folder_role` | `_user_id uuid, _club_id uuid, _team_id uuid, _restricted_roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `validate_class_enrolment_participant` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_club_news_audience` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_competition_division_weekdays` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_eoi_webhook_token` | `_club_id uuid, _token text` | `boolean` | 0 | True | yes/yes/yes |
| `validate_event_duty_team` | `` | `trigger` | 0 | True | no/no/yes |
| `validate_event_rsvp_grouping` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_event_target_team_ids` | `` | `trigger` | 0 | True | yes/yes/yes |
| `validate_event_team_club_scope` | `` | `trigger` | 0 | True | yes/yes/yes |
| `validate_match_message_sender_type` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_points_history_amount` | `` | `trigger` | 0 | False | yes/yes/yes |
| `validate_promo_code` | `_code text, _club_id uuid` | `TABLE(id uuid, is_valid boolean, expires_at timestamp with time zone, access_level text, club_id uuid)` | 1 | True | yes/yes/yes |
| `validate_team_captain` | `` | `trigger` | 0 | True | yes/yes/yes |
| `vault_user_has_club_role_scope` | `_user_id uuid, _club_id uuid, _roles text[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_club_role_scope` | `_user_id uuid, _club_id uuid, _team_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_club_scope` | `_user_id uuid, _club_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_club_scope` | `_user_id uuid, _club_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_file_club_role_scope` | `_user_id uuid, _club_id uuid, _team_id uuid, _folder_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_file_team_role_scope` | `_user_id uuid, _team_id uuid, _folder_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_mini_league_role_scope` | `_user_id uuid, _mini_league_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_team_role_scope` | `_user_id uuid, _team_id uuid, _roles app_role[]` | `boolean` | 0 | True | yes/yes/yes |
| `vault_user_has_team_scope` | `_user_id uuid, _team_id uuid` | `boolean` | 0 | True | yes/yes/yes |
| `verify_dispatch_credential_repair` | `` | `text` | 0 | True | no/no/yes |
| `word_similarity` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `word_similarity_commutator_op` | `text, text` | `boolean` | 0 | False | yes/yes/yes |
| `word_similarity_dist_commutator_op` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `word_similarity_dist_op` | `text, text` | `real` | 0 | False | yes/yes/yes |
| `word_similarity_op` | `text, text` | `boolean` | 0 | False | yes/yes/yes |

## 3. RLS policies and grants
**Expected-by-code:** Membership/club/team scoping must fail closed, hidden scores must remain protected, client access limited to intended rows/actions.

**Found-in-this-DB:** All 199 base tables have RLS enabled. service_role has BYPASSRLS; anon/authenticated do not. Per-relation effective privileges and every policy are below.

**GAP (essential blocker):** Unconditional public SELECT policies on playhq_fixtures/playhq_ladder/playhq_player_stats, broad teams SELECT, and broad storage access need scope/privacy review before claiming score-hiding and club isolation. Missing protected RPCs cannot be replaced by unsafe raw reads.

**DIFFERENCE (non-blocking):** Broad grants are not automatically broad row access with RLS; however TRUNCATE is not subject to RLS. 195 public relations grant anon TRUNCATE (table-level privilege), an unsafe privilege posture even where standard PostgREST does not expose TRUNCATE. Do not infer network exploitability without interface review.

RLS-enabled tables with zero policies (normal service-only deny-all for client roles): `cron_locks`, `default_rollover_log`, `dispatch_bootstrap_tokens`, `dispatch_repair_attempts`, `event_default_confirm_log`, `push_delivery_queue`, `stripe_notification_outbox`, `stripe_subscription_event_state`, `stripe_webhook_events`, `vault_deletion_jobs`, `vault_storage_reservations`.

Views: `public_clubs` has `security_invoker=true`; `competition_ladder` has no security_invoker option and uses owner semantics. Its definition explicitly filters hidden scores and hidden ladders with auth-aware predicates, but view-owner semantics must be reviewed for unrelated-competition access. Views do not have table RLS flags; do not misreport them as unprotected base tables.

Unconditional SELECT policies: `app_settings / Authenticated users can read app settings`, `club_dm_settings / Authenticated users can read club DM settings`, `dm_attachment_restrictions / anyone authenticated can read dm restrictions`, `photo_views / Authenticated users can read photo views`, `playhq_fixtures / playhq_fixtures public read`, `playhq_grades / playhq_grades public read`, `playhq_ladder / playhq_ladder public read`, `playhq_player_stats / playhq_player_stats public read`, `playhq_sync_log / playhq_sync_log read`, `teams / Authenticated users can view all teams for join requests`. Some are intentional app/public settings; score/stat and all-team reads are higher risk.

### Per-relation grants and complete policies
Privileges below are effective (including inherited/PUBLIC grants). Policy role `public` applies to all roles; permissive policies OR together. `service` means `service_role`, which bypasses RLS.

#### active_games — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can view all active games`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Controllers can create team active games`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) = user_id) AND (team_id IS NOT NULL) AND can_control_pitch_board(team_id, (NULLIF((pitch_state ->> 'linkedEventId'::text), ''::text))::uuid))`.
- Policy `Controllers can update team active games`: PERMISSIVE UPDATE TO `public`; USING `((team_id IS NOT NULL) AND can_control_pitch_board(team_id, (NULLIF((pitch_state ->> 'linkedEventId'::text), ''::text))::uuid))`; WITH CHECK `((team_id IS NOT NULL) AND can_control_pitch_board(team_id, (NULLIF((pitch_state ->> 'linkedEventId'::text), ''::text))::uuid))`.
- Policy `Owners can create personal active games`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) = user_id) AND (team_id IS NULL))`.
- Policy `Owners can update their personal active games`: PERMISSIVE UPDATE TO `public`; USING `((( SELECT auth.uid() AS uid) = user_id) AND (team_id IS NULL))`; WITH CHECK `((( SELECT auth.uid() AS uid) = user_id) AND (team_id IS NULL))`.
- Policy `Team members can view team games`: PERMISSIVE SELECT TO `public`; USING `((( SELECT auth.uid() AS uid) = user_id) OR ((team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), team_id)))`; WITH CHECK `<none>`.

#### active_games_write_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can view write log`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.

#### admin_alerts — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can view admin alerts`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.

#### admob_config — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can insert admob config`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`.
- Policy `App admins can update admob config`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Only app admins can view admob config`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.

#### app_ad_analytics — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can manage ad analytics`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own ad views`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) OR (user_id IS NULL))`.

#### app_ad_settings — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can manage ad settings`: PERMISSIVE ALL TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`; WITH CHECK `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`.
- Policy `Authenticated users can view ad settings`: PERMISSIVE SELECT TO `public`; USING `(( SELECT ( SELECT auth.uid() AS uid) AS uid) IS NOT NULL)`; WITH CHECK `<none>`.

#### app_ads — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Anyone can view active ads`: PERMISSIVE SELECT TO `public`; USING `((is_active = true) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `App admins can manage ads`: PERMISSIVE ALL TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.

#### app_settings — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can manage app settings`: PERMISSIVE ALL TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`.
- Policy `Authenticated users can read app settings`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.

#### app_stripe_config — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can only read app stripe config`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `false`.
- Policy `Deny anon access to app stripe config`: PERMISSIVE ALL TO `anon`; USING `false`; WITH CHECK `false`.
- Policy `No direct client SELECT on app stripe config`: PERMISSIVE SELECT TO `public`; USING `false`; WITH CHECK `<none>`.
- Policy `No direct deletes to app stripe config`: PERMISSIVE DELETE TO `public`; USING `false`; WITH CHECK `<none>`.
- Policy `No direct updates to app stripe config`: PERMISSIVE UPDATE TO `public`; USING `false`; WITH CHECK `false`.

#### association_broadcasts — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Association admins can insert broadcasts`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_association_admin(( SELECT auth.uid() AS uid), association_id)`.
- Policy `Association admins can view broadcasts`: PERMISSIVE SELECT TO `authenticated`; USING `is_association_admin(( SELECT auth.uid() AS uid), association_id)`; WITH CHECK `<none>`.
- Policy `Recipient team members can view association broadcasts`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = ANY (association_broadcasts.team_ids)))))`; WITH CHECK `<none>`.

#### audit_logs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can insert audit logs`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`.
- Policy `App admins can view audit logs`: PERMISSIVE SELECT TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.

#### blocked_users — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can block others`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) = blocker_id) AND (blocker_id <> blocked_id))`.
- Policy `Users can unblock`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = blocker_id)`; WITH CHECK `<none>`.
- Policy `Users can view their own blocks`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = blocker_id)`; WITH CHECK `<none>`.

#### broadcast_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can delete broadcast messages`: PERMISSIVE DELETE TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `App admins can send broadcast messages`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`.
- Policy `Authors can delete their own broadcast messages`: PERMISSIVE DELETE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Authors can update their own broadcast messages`: PERMISSIVE UPDATE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view broadcast messages targeted to them`: PERMISSIVE SELECT TO `authenticated`; USING `((author_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR broadcast_visible_to_user(target_club_ids, created_at, ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.

#### business_matches — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can view their matches`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = business_matches.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM business_profiles bp   WHERE ((bp.id = business_matches.business_profile_id) AND (bp.user_id = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `<none>`.
- Policy `Sponsors can view own matches`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM business_profiles   WHERE ((business_profiles.id = business_matches.business_profile_id) AND (business_profiles.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### business_profiles — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can view visible sponsor profiles`: PERMISSIVE SELECT TO `authenticated`; USING `(is_visible = true)`; WITH CHECK `<none>`.
- Policy `Sponsors can insert own profile`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Sponsors can update own profile`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Sponsors can view own profile`: PERMISSIVE SELECT TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### business_shortlist — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can delete shortlist`: PERMISSIVE DELETE TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = business_shortlist.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Club admins can insert shortlist`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = business_shortlist.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`.
- Policy `Club admins can view shortlist`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = business_shortlist.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.

#### chat_group_join_requests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Group members can view requests for their group`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM group_members gm   WHERE ((gm.group_id = chat_group_join_requests.group_id) AND (gm.user_id = auth.uid()))))`; WITH CHECK `<none>`.
- Policy `Requester can view own requests`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = auth.uid())`; WITH CHECK `<none>`.

#### chat_group_unread — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users read their own unread counts`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = auth.uid())`; WITH CHECK `<none>`.

#### chat_groups — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can delete any chat group`: PERMISSIVE DELETE TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `App admins can manage all chat groups`: PERMISSIVE UPDATE TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`; WITH CHECK `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`.
- Policy `App admins can view all chat groups`: PERMISSIVE SELECT TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Club admins can create club groups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND (club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = chat_groups.club_id) AND (user_roles.role = 'club_admin'::app_role)))))`.
- Policy `Club admins can rename club-member groups`: PERMISSIVE UPDATE TO `authenticated`; USING `club_admin_can_rename_group(( SELECT auth.uid() AS uid), id, club_id)`; WITH CHECK `club_admin_can_rename_group(( SELECT auth.uid() AS uid), id, club_id)`.
- Policy `Club admins can restore deleted club chat groups`: PERMISSIVE UPDATE TO `public`; USING `((club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (user_roles.club_id = chat_groups.club_id) AND (user_roles.role = 'club_admin'::app_role)))))`; WITH CHECK `((club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (user_roles.club_id = chat_groups.club_id) AND (user_roles.role = 'club_admin'::app_role)))))`.
- Policy `Club admins can view deleted club chat groups`: PERMISSIVE SELECT TO `public`; USING `((deleted_at IS NOT NULL) AND (club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (user_roles.club_id = chat_groups.club_id) AND (user_roles.role = 'club_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Club members can discover open groups`: PERMISSIVE SELECT TO `public`; USING `((deleted_at IS NULL) AND (join_policy = ANY (ARRAY['open_to_club'::text, 'request_to_join'::text])) AND (club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = chat_groups.club_id)))))`; WITH CHECK `<none>`.
- Policy `Creators can manage their groups`: PERMISSIVE ALL TO `public`; USING `(created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `(created_by = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`.
- Policy `Team admins can create team groups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND (team_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = chat_groups.team_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`.
- Policy `Users can access mini league chats`: PERMISSIVE SELECT TO `authenticated`; USING `((deleted_at IS NULL) AND (mini_league_id IS NOT NULL) AND (id IN ( SELECT my_chat_group_ids() AS my_chat_group_ids)))`; WITH CHECK `<none>`.
- Policy `Users can create personal group chats`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND (club_id IS NULL) AND (team_id IS NULL))`.
- Policy `Users can view accessible groups`: PERMISSIVE SELECT TO `authenticated`; USING `((deleted_at IS NULL) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (id IN ( SELECT my_chat_group_ids() AS my_chat_group_ids))))`; WITH CHECK `<none>`.

#### chat_mute_preferences — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own mute preferences`: PERMISSIVE ALL TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### chat_notification_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `No direct client access to chat notification log`: PERMISSIVE SELECT TO `authenticated`; USING `false`; WITH CHECK `<none>`.
- Policy `No direct client insert to chat notification log`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `false`.

#### chat_open_perf — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins read chat perf`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users insert own chat perf`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### chat_photo_gallery_reminders — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors read own chat-photo reminders`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = author_id)`; WITH CHECK `<none>`.

#### chat_pinned_vault — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can insert pinned vault`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((set_by = ( SELECT auth.uid() AS uid)) AND (((chat_type = 'team'::text) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = chat_pinned_vault.chat_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((chat_type = 'club'::text) AND is_club_admin(( SELECT auth.uid() AS uid), chat_id)) OR ((chat_type = 'group'::text) AND (EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = chat_pinned_vault.chat_id) AND ((cg.created_by = ( SELECT auth.uid() AS uid)) OR ((cg.club_id IS NOT NULL) AND is_club_admin(( SELECT auth.uid() AS uid), cg.club_id)) OR ((cg.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = cg.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))))))))))`.
- Policy `Admins can update pinned vault`: PERMISSIVE UPDATE TO `authenticated`; USING `(((chat_type = 'team'::text) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = chat_pinned_vault.chat_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((chat_type = 'club'::text) AND is_club_admin(( SELECT auth.uid() AS uid), chat_id)) OR ((chat_type = 'group'::text) AND (EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = chat_pinned_vault.chat_id) AND ((cg.created_by = ( SELECT auth.uid() AS uid)) OR ((cg.club_id IS NOT NULL) AND is_club_admin(( SELECT auth.uid() AS uid), cg.club_id)) OR ((cg.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = cg.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))))))))`; WITH CHECK `<none>`.
- Policy `Admins or author can delete pinned vault`: PERMISSIVE DELETE TO `public`; USING `((set_by = ( SELECT auth.uid() AS uid)) OR ((chat_type = 'team'::text) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = chat_pinned_vault.chat_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((chat_type = 'club'::text) AND is_club_admin(( SELECT auth.uid() AS uid), chat_id)) OR ((chat_type = 'group'::text) AND (EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = chat_pinned_vault.chat_id) AND ((cg.created_by = ( SELECT auth.uid() AS uid)) OR ((cg.club_id IS NOT NULL) AND is_club_admin(( SELECT auth.uid() AS uid), cg.club_id)) OR ((cg.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = cg.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))))))))`; WITH CHECK `<none>`.
- Policy `Members can view pinned vault for accessible chats`: PERMISSIVE SELECT TO `authenticated`; USING `(((chat_type = 'team'::text) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = chat_pinned_vault.chat_id))))) OR ((chat_type = 'club'::text) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = chat_pinned_vault.chat_id))))) OR ((chat_type = 'group'::text) AND can_access_chat_group(( SELECT auth.uid() AS uid), chat_id)))`; WITH CHECK `<none>`.

#### chat_summaries — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users delete own chat summaries`: PERMISSIVE DELETE TO `authenticated`; USING `(user_id = auth.uid())`; WITH CHECK `<none>`.
- Policy `Users insert own chat summaries`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(user_id = auth.uid())`.
- Policy `Users view own chat summaries`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = auth.uid())`; WITH CHECK `<none>`.

#### child_club_points — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club staff view club child points`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = child_club_points.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'coach'::app_role, 'team_admin'::app_role]))))))`; WITH CHECK `<none>`.
- Policy `Parents view children club points`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM children c   WHERE ((c.id = child_club_points.child_id) AND (c.parent_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### child_guardians — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can insert child guardians for their teams`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])))))`.
- Policy `Admins can view child guardians in their teams`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (child_team_assignments cta      JOIN user_roles ur ON ((ur.team_id = cta.team_id)))   WHERE ((cta.child_id = child_guardians.child_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Club admins can view child guardians in their clubs`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM ((child_team_assignments cta      JOIN teams t ON ((t.id = cta.team_id)))      JOIN user_roles ur ON ((ur.club_id = t.club_id)))   WHERE ((cta.child_id = child_guardians.child_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'club_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Guardians can remove themselves`: PERMISSIVE DELETE TO `public`; USING `(guardian_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Guardians can view their child relationships`: PERMISSIVE SELECT TO `public`; USING `(guardian_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `League admins can view mini league child guardians`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM child_mini_league_assignments cmla   WHERE ((cmla.child_id = child_guardians.child_id) AND is_league_admin(( SELECT auth.uid() AS uid), cmla.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `Primary parent can add guardians`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM children c   WHERE ((c.id = child_guardians.child_id) AND (c.parent_id = ( SELECT auth.uid() AS uid)))))`.
- Policy `Primary parent can remove guardians`: PERMISSIVE DELETE TO `public`; USING `(EXISTS ( SELECT 1    FROM children c   WHERE ((c.id = child_guardians.child_id) AND (c.parent_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Primary parent can view child guardians`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM children c   WHERE ((c.id = child_guardians.child_id) AND (c.parent_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Team members can view child guardians on their teams`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM (child_team_assignments cta      JOIN user_roles ur ON ((ur.team_id = cta.team_id)))   WHERE ((cta.child_id = child_guardians.child_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### child_mini_league_assignments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete league assignments`: PERMISSIVE DELETE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League admins can insert league assignments`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`.
- Policy `League admins can update league assignments`: PERMISSIVE UPDATE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League admins can view league assignments`: PERMISSIVE SELECT TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `Parents can view their children's league assignments`: PERMISSIVE SELECT TO `public`; USING `is_child_guardian(( SELECT auth.uid() AS uid), child_id)`; WITH CHECK `<none>`.

#### child_team_assignments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Guardians can view assignments for linked children`: PERMISSIVE SELECT TO `public`; USING `is_guardian_of_child(( SELECT auth.uid() AS uid), child_id)`; WITH CHECK `<none>`.
- Policy `Parents can insert their children's assignments`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(child_id IN ( SELECT children.id    FROM children   WHERE (children.parent_id = ( SELECT auth.uid() AS uid))))`.
- Policy `Parents can view their children's assignments`: PERMISSIVE SELECT TO `authenticated`; USING `is_parent_of_child(( SELECT auth.uid() AS uid), child_id)`; WITH CHECK `<none>`.
- Policy `Team admins can manage assignments`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])) AND ((user_roles.team_id = child_team_assignments.team_id) OR (user_roles.club_id IN ( SELECT t.club_id            FROM teams t           WHERE (t.id = child_team_assignments.team_id)))))))`; WITH CHECK `<none>`.
- Policy `Team members can view assignments on their team`: PERMISSIVE SELECT TO `authenticated`; USING `is_team_member(( SELECT auth.uid() AS uid), team_id)`; WITH CHECK `<none>`.

#### child_training_defaults — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `ctd_delete`: PERMISSIVE DELETE TO `authenticated`; USING `(((child_id IS NOT NULL) AND is_parent_of_child(( SELECT auth.uid() AS uid), child_id)) OR ((user_id IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid))))`; WITH CHECK `<none>`.
- Policy `ctd_insert`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND (((child_id IS NOT NULL) AND is_parent_of_child(( SELECT auth.uid() AS uid), child_id)) OR ((user_id IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid)))))`.
- Policy `ctd_select`: PERMISSIVE SELECT TO `authenticated`; USING `((deleted_at IS NULL) AND (((child_id IS NOT NULL) AND is_parent_of_child(( SELECT auth.uid() AS uid), child_id)) OR ((user_id IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid))) OR can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT teams.club_id    FROM teams   WHERE (teams.id = child_training_defaults.team_id)), NULL::uuid)))`; WITH CHECK `<none>`.
- Policy `ctd_update`: PERMISSIVE UPDATE TO `authenticated`; USING `(((child_id IS NOT NULL) AND is_parent_of_child(( SELECT auth.uid() AS uid), child_id)) OR ((user_id IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid))))`; WITH CHECK `<none>`.

#### children — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can create children for team members`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role, 'league_admin'::app_role]))))) OR is_any_mini_league_admin(( SELECT auth.uid() AS uid)))`.
- Policy `Admins can update children on their teams`: PERMISSIVE UPDATE TO `public`; USING `can_admin_view_child(id, ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `can_admin_view_child(id, ( SELECT ( SELECT auth.uid() AS uid) AS uid))`.
- Policy `Admins can view children of club parents`: PERMISSIVE SELECT TO `authenticated`; USING `can_admin_view_child_of_parent(( SELECT auth.uid() AS uid), parent_id)`; WITH CHECK `<none>`.
- Policy `Admins can view children on their teams`: PERMISSIVE SELECT TO `public`; USING `can_admin_view_child(id, ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Guardians can view linked children`: PERMISSIVE SELECT TO `public`; USING `is_guardian_of_child(( SELECT ( SELECT auth.uid() AS uid) AS uid), id)`; WITH CHECK `<none>`.
- Policy `League admins can view children in their leagues`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM child_mini_league_assignments a   WHERE ((a.child_id = children.id) AND is_league_admin(( SELECT auth.uid() AS uid), a.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `Parents can manage own children`: PERMISSIVE ALL TO `public`; USING `(parent_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Parents can view own children`: PERMISSIVE SELECT TO `public`; USING `(parent_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Team members can view children on their teams`: PERMISSIVE SELECT TO `public`; USING `can_view_child_via_team(id, ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.

#### class_attendance — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage attendance`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM (user_roles ur      JOIN teams t ON ((t.id = class_attendance.team_id)))   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (((ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])) AND (ur.club_id = t.club_id)) OR ((ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])) AND (ur.team_id = class_attendance.team_id))))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM (user_roles ur      JOIN teams t ON ((t.id = class_attendance.team_id)))   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (((ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])) AND (ur.club_id = t.club_id)) OR ((ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])) AND (ur.team_id = class_attendance.team_id))))))`.
- Policy `Parents can view own children attendance`: PERMISSIVE SELECT TO `authenticated`; USING `((child_id IN ( SELECT children.id    FROM children   WHERE (children.parent_id = ( SELECT auth.uid() AS uid)))) OR (user_id = ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.

#### class_enrolments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Guardians can enrol children`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((child_id IS NOT NULL) AND is_child_guardian(( SELECT auth.uid() AS uid), child_id))`.
- Policy `Guardians can update own child enrolments`: PERMISSIVE UPDATE TO `public`; USING `((child_id IS NOT NULL) AND is_child_guardian(( SELECT auth.uid() AS uid), child_id))`; WITH CHECK `<none>`.
- Policy `Guardians can view child enrolments`: PERMISSIVE SELECT TO `public`; USING `((child_id IS NOT NULL) AND is_child_guardian(( SELECT auth.uid() AS uid), child_id))`; WITH CHECK `<none>`.
- Policy `Team admins can manage enrolments`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (((ur.team_id = class_enrolments.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))) OR ((ur.club_id IN ( SELECT t.club_id            FROM teams t           WHERE (t.id = class_enrolments.team_id))) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])))))))`; WITH CHECK `<none>`.
- Policy `Users can enrol themselves`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can update own enrolments`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view own enrolments`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### client_perf_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `perf_log_admin_select`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `perf_log_insert_self`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((user_id IS NULL) OR (user_id = ( SELECT auth.uid() AS uid)))`.

#### club_admin_conversations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can create club admin conversations`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(member_user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Participants can update club admin conversations`: PERMISSIVE UPDATE TO `authenticated`; USING `is_club_admin_conversation_participant(id)`; WITH CHECK `<none>`.
- Policy `Users can view their own club admin conversations`: PERMISSIVE SELECT TO `authenticated`; USING `is_club_admin_conversation_participant(id)`; WITH CHECK `<none>`.

#### club_admin_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors can delete their own club admin messages`: PERMISSIVE DELETE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Authors can update their own club admin messages`: PERMISSIVE UPDATE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Participants can send club admin messages`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((author_id = ( SELECT auth.uid() AS uid)) AND is_club_admin_conversation_participant(conversation_id))`.
- Policy `Participants can view club admin messages`: PERMISSIVE SELECT TO `authenticated`; USING `is_club_admin_conversation_participant(conversation_id)`; WITH CHECK `<none>`.

#### club_dm_settings — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can read club DM settings`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.
- Policy `Club admins can manage their club DM settings`: PERMISSIVE ALL TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`.

#### club_invites — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage invites`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = club_invites.club_id) AND (user_roles.role = 'club_admin'::app_role))))`; WITH CHECK `<none>`.

#### club_join_requests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can update join requests`: PERMISSIVE UPDATE TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = club_join_requests.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Club admins can view join requests`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = club_join_requests.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Users can create join requests`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view own join requests`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### club_links — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can delete club links`: PERMISSIVE DELETE TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `<none>`.
- Policy `Club admins can insert club links`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_club_admin_for(club_id)`.
- Policy `Club admins can update club links`: PERMISSIVE UPDATE TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `is_club_admin_for(club_id)`.
- Policy `Club admins can view all club links`: PERMISSIVE SELECT TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `<none>`.
- Policy `Club members can view active club links`: PERMISSIVE SELECT TO `authenticated`; USING `(is_active AND (is_club_member(auth.uid(), club_id) OR is_club_admin_for(club_id)))`; WITH CHECK `<none>`.

#### club_member_exclusions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins view club exclusions`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(auth.uid(), 'app_admin'::app_role) OR has_role(auth.uid(), 'club_admin'::app_role, club_id))`; WITH CHECK `<none>`.

#### club_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors can delete their own club messages`: PERMISSIVE DELETE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Club admins can delete club messages`: PERMISSIVE DELETE TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `Club members and team members can send club messages`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid) OR (EXISTS ( SELECT 1    FROM (user_roles ur      JOIN teams t ON ((t.id = ur.team_id)))   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (t.club_id = club_messages.club_id)))))`.
- Policy `Club members can view club messages`: PERMISSIVE SELECT TO `public`; USING `is_club_member(( SELECT auth.uid() AS uid), club_id)`; WITH CHECK `<none>`.
- Policy `Users can update their own club messages`: PERMISSIVE UPDATE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.

#### club_news — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can delete club news`: PERMISSIVE DELETE TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `<none>`.
- Policy `Club admins can insert club news`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_club_admin_for(club_id)`.
- Policy `Club admins can update club news`: PERMISSIVE UPDATE TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `is_club_admin_for(club_id)`.
- Policy `Club admins can view all club news`: PERMISSIVE SELECT TO `authenticated`; USING `is_club_admin_for(club_id)`; WITH CHECK `<none>`.
- Policy `Club members can view audience news`: PERMISSIVE SELECT TO `authenticated`; USING `(is_published AND (published_at <= now()) AND (((target_competition_id IS NULL) AND (target_mini_league_id IS NULL) AND is_club_member(auth.uid(), club_id) AND ((target_team_ids IS NULL) OR (cardinality(target_team_ids) = 0) OR (EXISTS ( SELECT 1    FROM unnest(club_news.target_team_ids) t(team_id)   WHERE is_team_member(auth.uid(), t.team_id))))) OR ((target_mini_league_id IS NOT NULL) AND can_view_mini_league(auth.uid(), target_mini_league_id)) OR ((target_competition_id IS NOT NULL) AND is_competition_audience(auth.uid(), target_competition_id))))`; WITH CHECK `<none>`.
- Policy `Competition admins can delete competition news`: PERMISSIVE DELETE TO `authenticated`; USING `((target_competition_id IS NOT NULL) AND is_competition_role_admin(auth.uid(), target_competition_id))`; WITH CHECK `<none>`.
- Policy `Competition admins can insert competition news`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((target_competition_id IS NOT NULL) AND is_competition_role_admin(auth.uid(), target_competition_id))`.
- Policy `Competition admins can update competition news`: PERMISSIVE UPDATE TO `authenticated`; USING `((target_competition_id IS NOT NULL) AND is_competition_role_admin(auth.uid(), target_competition_id))`; WITH CHECK `((target_competition_id IS NOT NULL) AND is_competition_role_admin(auth.uid(), target_competition_id))`.
- Policy `Competition admins can view competition news`: PERMISSIVE SELECT TO `authenticated`; USING `((target_competition_id IS NOT NULL) AND is_competition_role_admin(auth.uid(), target_competition_id))`; WITH CHECK `<none>`.

#### club_players — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins and coaches can create club players`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(is_club_admin(( SELECT auth.uid() AS uid), club_id) OR (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = club_players.club_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`.
- Policy `Club admins and coaches can update club players`: PERMISSIVE UPDATE TO `authenticated`; USING `(is_club_admin(( SELECT auth.uid() AS uid), club_id) OR (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = club_players.club_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`; WITH CHECK `<none>`.
- Policy `Club admins can delete club players`: PERMISSIVE DELETE TO `authenticated`; USING `is_club_admin(( SELECT auth.uid() AS uid), club_id)`; WITH CHECK `<none>`.
- Policy `Club members can view club players`: PERMISSIVE SELECT TO `authenticated`; USING `(is_club_member(( SELECT auth.uid() AS uid), club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `<none>`.

#### club_rewards — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage rewards`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Club members can view rewards`: PERMISSIVE SELECT TO `public`; USING `is_club_member(( SELECT auth.uid() AS uid), club_id)`; WITH CHECK `<none>`.
- Policy `Team admins can manage team-specific rewards`: PERMISSIVE ALL TO `authenticated`; USING `((team_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = club_rewards.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`; WITH CHECK `((team_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = club_rewards.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`.

#### club_stripe_configs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Deny anon access to club stripe configs`: PERMISSIVE ALL TO `anon`; USING `false`; WITH CHECK `false`.
- Policy `No direct client SELECT on club stripe configs`: PERMISSIVE SELECT TO `public`; USING `false`; WITH CHECK `<none>`.
- Policy `No direct deletes to club stripe config`: PERMISSIVE DELETE TO `public`; USING `false`; WITH CHECK `<none>`.
- Policy `No direct inserts to club stripe config`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `false`.
- Policy `No direct updates to club stripe config`: PERMISSIVE UPDATE TO `public`; USING `false`; WITH CHECK `false`.

#### club_subscriptions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage club subscriptions`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (((user_roles.role = 'club_admin'::app_role) AND (user_roles.club_id = club_subscriptions.club_id)) OR (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Club members can view club subscription`: PERMISSIVE SELECT TO `public`; USING `(is_club_member(( SELECT auth.uid() AS uid), club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### clubs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can create clubs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) IS NOT NULL) AND ((created_by = ( SELECT auth.uid() AS uid)) OR (created_by IS NULL)))`.
- Policy `Authenticated users can view clubs for discovery`: PERMISSIVE SELECT TO `public`; USING `((( SELECT auth.uid() AS uid) IS NOT NULL) AND (listed_on_marketplace = true))`; WITH CHECK `<none>`.
- Policy `Club admins can delete their clubs`: PERMISSIVE DELETE TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Club admins can update their clubs`: PERMISSIVE UPDATE TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Club members can view their clubs`: PERMISSIVE SELECT TO `public`; USING `(is_club_member(( SELECT auth.uid() AS uid), id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Creators can view their clubs`: PERMISSIVE SELECT TO `authenticated`; USING `(created_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### comment_reports — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can update comment reports`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `App admins can view all comment reports`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Users can create comment reports`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = reporter_id)`.
- Policy `Users can view own comment reports`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = reporter_id)`; WITH CHECK `<none>`.

#### competition_admin_conversations — RLS True; kind=r
- anon: .
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Member or competition admins view conversation`: PERMISSIVE SELECT TO `authenticated`; USING `((member_user_id = auth.uid()) OR is_competition_role_admin(auth.uid(), competition_id) OR has_role(auth.uid(), 'app_admin'::app_role))`; WITH CHECK `<none>`.

#### competition_admin_messages — RLS True; kind=r
- anon: .
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors delete own messages`: PERMISSIVE DELETE TO `authenticated`; USING `(author_id = auth.uid())`; WITH CHECK `<none>`.
- Policy `Participants send messages`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((author_id = auth.uid()) AND can_access_competition_admin_conversation(auth.uid(), conversation_id))`.
- Policy `Participants view messages`: PERMISSIVE SELECT TO `authenticated`; USING `can_access_competition_admin_conversation(auth.uid(), conversation_id)`; WITH CHECK `<none>`.

#### competition_broadcasts — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Competition admins can insert broadcasts`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `Competition admins can view broadcasts`: PERMISSIVE SELECT TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.
- Policy `Recipient team members can view broadcasts`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = ANY (competition_broadcasts.team_ids)))))`; WITH CHECK `<none>`.

#### competition_divisions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Manage divisions`: PERMISSIVE ALL TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `View divisions`: PERMISSIVE SELECT TO `authenticated`; USING `can_view_competition(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.

#### competition_entries — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins delete entries`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.
- Policy `Admins invite teams`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `Manage entries`: PERMISSIVE UPDATE TO `authenticated`; USING `(is_competition_admin(( SELECT auth.uid() AS uid), competition_id) OR is_team_admin_for_entry(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.
- Policy `View entries`: PERMISSIVE SELECT TO `authenticated`; USING `(can_view_competition(( SELECT auth.uid() AS uid), competition_id) OR is_team_admin_for_entry(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.

#### competition_ladder — RLS False; kind=v
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### competition_match_results — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `comp admins delete scores`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`; WITH CHECK `<none>`.
- Policy `comp admins enter scores`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_competition_admin(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`.
- Policy `comp admins update scores`: PERMISSIVE UPDATE TO `authenticated`; USING `is_competition_admin(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`; WITH CHECK `is_competition_admin(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`.
- Policy `officials enter scores`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_competition_official(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`.
- Policy `officials update scores`: PERMISSIVE UPDATE TO `authenticated`; USING `is_competition_official(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`; WITH CHECK `is_competition_official(auth.uid(), ( SELECT m.competition_id    FROM competition_matches m   WHERE (m.id = competition_match_results.match_id)))`.
- Policy `scores readable unless division hides them`: PERMISSIVE SELECT TO `public`; USING `((NOT match_scores_hidden(match_id)) OR is_competition_admin(auth.uid(), ( SELECT m2.competition_id    FROM competition_matches m2   WHERE (m2.id = competition_match_results.match_id))))`; WITH CHECK `<none>`.

#### competition_matches — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can delete matches`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.
- Policy `Admins can insert matches`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `Admins can update matches`: PERMISSIVE UPDATE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `Officials can update score and status`: PERMISSIVE UPDATE TO `authenticated`; USING `is_competition_official(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `is_competition_official(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `Public can view matches of public competitions`: PERMISSIVE SELECT TO `anon,authenticated`; USING `(EXISTS ( SELECT 1    FROM competitions c   WHERE ((c.id = competition_matches.competition_id) AND (c.visibility = 'public'::text))))`; WITH CHECK `<none>`.
- Policy `View matches if can view competition`: PERMISSIVE SELECT TO `authenticated`; USING `can_view_competition(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.

#### competition_role_invites — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Competition admins cancel role invites`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.
- Policy `Competition admins view role invites`: PERMISSIVE SELECT TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.

#### competition_role_links — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Competition admins create role links`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND is_competition_admin(( SELECT auth.uid() AS uid), competition_id))`.
- Policy `Competition admins revoke role links`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.
- Policy `Competition admins view role links`: PERMISSIVE SELECT TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.

#### competition_roles — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Manage competition roles`: PERMISSIVE ALL TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `is_competition_admin(( SELECT auth.uid() AS uid), competition_id)`.
- Policy `View competition roles`: PERMISSIVE SELECT TO `authenticated`; USING `can_view_competition(( SELECT auth.uid() AS uid), competition_id)`; WITH CHECK `<none>`.

#### competitions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Anyone can view public competitions`: PERMISSIVE SELECT TO `anon,authenticated`; USING `(visibility = 'public'::text)`; WITH CHECK `<none>`.
- Policy `Create competitions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND can_organise_competition(( SELECT auth.uid() AS uid), organizer_club_id))`.
- Policy `Delete competitions`: PERMISSIVE DELETE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), id)`; WITH CHECK `<none>`.
- Policy `Update competitions`: PERMISSIVE UPDATE TO `authenticated`; USING `is_competition_admin(( SELECT auth.uid() AS uid), id)`; WITH CHECK `<none>`.
- Policy `View competitions`: PERMISSIVE SELECT TO `public`; USING `((created_by = ( SELECT auth.uid() AS uid)) OR can_view_competition(( SELECT auth.uid() AS uid), id))`; WITH CHECK `<none>`.

#### cron_locks — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### default_rollover_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### direct_conversations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can create conversations they are part of`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) = participant_1) OR (( SELECT auth.uid() AS uid) = participant_2))`.
- Policy `Users can view their own conversations`: PERMISSIVE SELECT TO `public`; USING `((( SELECT auth.uid() AS uid) = participant_1) OR (( SELECT auth.uid() AS uid) = participant_2))`; WITH CHECK `<none>`.

#### direct_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can delete their own messages`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = author_id)`; WITH CHECK `<none>`.
- Policy `Users can send messages in their conversations`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) = author_id) AND (EXISTS ( SELECT 1    FROM direct_conversations dc   WHERE ((dc.id = direct_messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = dc.participant_1) OR (( SELECT auth.uid() AS uid) = dc.participant_2))))))`.
- Policy `Users can update their own messages`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = author_id)`; WITH CHECK `<none>`.
- Policy `Users can view messages in their conversations`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM direct_conversations dc   WHERE ((dc.id = direct_messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = dc.participant_1) OR (( SELECT auth.uid() AS uid) = dc.participant_2)))))`; WITH CHECK `<none>`.

#### dispatch_bootstrap_tokens — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### dispatch_repair_attempts — RLS True; kind=r
- anon: .
- authenticated: .
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### dm_attachment_restrictions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `anyone authenticated can read dm restrictions`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.
- Policy `app admins can delete dm restrictions`: PERMISSIVE DELETE TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `app admins can insert dm restrictions`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`.

#### drill_frames — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Frames: editors delete`: PERMISSIVE DELETE TO `public`; USING `can_edit_drill(drill_id, ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Frames: editors insert`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `can_edit_drill(drill_id, ( SELECT auth.uid() AS uid))`.
- Policy `Frames: editors update`: PERMISSIVE UPDATE TO `public`; USING `can_edit_drill(drill_id, ( SELECT auth.uid() AS uid))`; WITH CHECK `can_edit_drill(drill_id, ( SELECT auth.uid() AS uid))`.
- Policy `Frames: viewers select`: PERMISSIVE SELECT TO `public`; USING `can_view_drill(drill_id, ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### drill_recent_uses — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Recent: own delete`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Recent: own insert`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Recent: own select`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Recent: own update`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### drills — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Drills: anyone views official`: PERMISSIVE SELECT TO `authenticated`; USING `(is_official = true)`; WITH CHECK `<none>`.
- Policy `Drills: app admins view all`: PERMISSIVE SELECT TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Drills: club members view club drills`: PERMISSIVE SELECT TO `public`; USING `((visibility = 'club'::text) AND (club_id IS NOT NULL) AND is_club_member(( SELECT auth.uid() AS uid), club_id))`; WITH CHECK `<none>`.
- Policy `Drills: editors delete`: PERMISSIVE DELETE TO `public`; USING `can_edit_drill(id, ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Drills: editors update`: PERMISSIVE UPDATE TO `public`; USING `can_edit_drill(id, ( SELECT auth.uid() AS uid))`; WITH CHECK `can_edit_drill(id, ( SELECT auth.uid() AS uid))`.
- Policy `Drills: owners insert own`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = owner_user_id)`.
- Policy `Drills: owners view own`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = owner_user_id)`; WITH CHECK `<none>`.
- Policy `Drills: team members view team drills`: PERMISSIVE SELECT TO `public`; USING `((visibility = 'team'::text) AND (team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.

#### duties — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage duties`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = duties.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`; WITH CHECK `<none>`.
- Policy `Assigned users can update duties`: PERMISSIVE UPDATE TO `public`; USING `(assigned_to = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Members can view duties for their events`: PERMISSIVE SELECT TO `public`; USING `((EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = duties.event_id) AND (((e.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), e.team_id)) OR is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))))) OR (assigned_to = ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.

#### engagement_reminder_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Service role only`: PERMISSIVE ALL TO `public`; USING `false`; WITH CHECK `<none>`.

#### eoi_form_views — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Anyone can record EOI form view`: PERMISSIVE INSERT TO `anon,authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM seasons s   WHERE ((s.id = eoi_form_views.season_id) AND (s.club_id = eoi_form_views.club_id) AND (s.eoi_enabled = true))))`.
- Policy `Club managers read EOI form views`: PERMISSIVE SELECT TO `authenticated`; USING `can_manage_club_eois(club_id)`; WITH CHECK `<none>`.

#### eoi_submissions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club managers can delete club EOIs`: PERMISSIVE DELETE TO `authenticated`; USING `can_manage_club_eois(club_id)`; WITH CHECK `<none>`.
- Policy `Club managers can insert EOIs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `can_manage_club_eois(club_id)`.
- Policy `Club managers can update club EOIs`: PERMISSIVE UPDATE TO `authenticated`; USING `can_manage_club_eois(club_id)`; WITH CHECK `can_manage_club_eois(club_id)`.
- Policy `Club managers can view club EOIs`: PERMISSIVE SELECT TO `authenticated`; USING `can_manage_club_eois(club_id)`; WITH CHECK `<none>`.
- Policy `Parent can update own submission before close`: PERMISSIVE UPDATE TO `authenticated`; USING `(((parent_user_id = ( SELECT auth.uid() AS uid)) OR (lower(parent_email) = lower(COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text)))) AND is_season_eoi_open(season_id))`; WITH CHECK `((parent_user_id = ( SELECT auth.uid() AS uid)) OR (lower(parent_email) = lower(COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text))))`.
- Policy `Parent user can view own submission`: PERMISSIVE SELECT TO `authenticated`; USING `((parent_user_id = ( SELECT auth.uid() AS uid)) OR (lower(parent_email) = lower(COALESCE((( SELECT auth.jwt() AS jwt) ->> 'email'::text), ''::text))))`; WITH CHECK `<none>`.
- Policy `Public can submit EOI when season is open`: PERMISSIVE INSERT TO `anon,authenticated`; USING `<none>`; WITH CHECK `(is_season_eoi_open(season_id) AND (source = ANY (ARRAY['website'::eoi_source, 'app'::eoi_source])))`.

#### event_auto_dm_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can view auto-DM log for their events`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM (events e      LEFT JOIN user_roles ur ON ((ur.user_id = ( SELECT auth.uid() AS uid))))   WHERE ((e.id = event_auto_dm_log.event_id) AND ((ur.role = 'app_admin'::app_role) OR ((ur.team_id = e.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))) OR ((ur.club_id = e.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'league_admin'::app_role, 'committee_member'::app_role])))))))`; WITH CHECK `<none>`.

#### event_auto_push_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `auto_push_log_no_client_access`: PERMISSIVE ALL TO `authenticated`; USING `false`; WITH CHECK `false`.

#### event_default_confirm_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### event_group_duties — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Managers can manage event group duties`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_duties.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_duties.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`.
- Policy `Managers can view event group duties`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_duties.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`; WITH CHECK `<none>`.
- Policy `Users can view event group duties`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (event_groups eg      JOIN events e ON ((e.id = eg.event_id)))   WHERE ((eg.id = event_group_duties.group_id) AND (is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR (EXISTS ( SELECT 1            FROM mini_league_players mlp           WHERE ((mlp.mini_league_id = e.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))))))`; WITH CHECK `<none>`.

#### event_group_players — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Managers can delete event group players`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_players.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`; WITH CHECK `<none>`.
- Policy `Managers can insert event group players`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_players.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id)))) AND event_group_player_scope_ok(group_id, player_id))`.
- Policy `Managers can update event group players`: PERMISSIVE UPDATE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_players.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`; WITH CHECK `((EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_players.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id)))) AND event_group_player_scope_ok(group_id, player_id))`.
- Policy `Managers can view event group players`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM event_groups eg   WHERE ((eg.id = event_group_players.group_id) AND can_manage_event_groups(auth.uid(), eg.event_id))))`; WITH CHECK `<none>`.
- Policy `Users can view event group players`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (event_groups eg      JOIN events e ON ((e.id = eg.event_id)))   WHERE ((eg.id = event_group_players.group_id) AND (is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR (EXISTS ( SELECT 1            FROM mini_league_players mlp           WHERE ((mlp.mini_league_id = e.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))))))`; WITH CHECK `<none>`.

#### event_groups — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Managers can delete event groups`: PERMISSIVE DELETE TO `authenticated`; USING `can_manage_event_groups(auth.uid(), event_id)`; WITH CHECK `<none>`.
- Policy `Managers can insert event groups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `can_manage_event_groups(auth.uid(), event_id)`.
- Policy `Managers can update event groups`: PERMISSIVE UPDATE TO `authenticated`; USING `can_manage_event_groups(auth.uid(), event_id)`; WITH CHECK `can_manage_event_groups(auth.uid(), event_id)`.
- Policy `Managers can view event groups`: PERMISSIVE SELECT TO `authenticated`; USING `can_manage_event_groups(auth.uid(), event_id)`; WITH CHECK `<none>`.
- Policy `Users can view event groups for events they can access`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_groups.event_id) AND (is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR (EXISTS ( SELECT 1            FROM mini_league_players mlp           WHERE ((mlp.mini_league_id = e.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))))))`; WITH CHECK `<none>`.

#### event_guests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can remove any guest`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM (events e      JOIN user_roles ur ON ((ur.club_id = e.club_id)))   WHERE ((e.id = event_guests.event_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Members can view event guests`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_guests.event_id) AND (((e.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), e.team_id)) OR is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.
- Policy `Users can add their own guests`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(added_by = ( SELECT auth.uid() AS uid))`.
- Policy `Users can remove their own guests`: PERMISSIVE DELETE TO `authenticated`; USING `(added_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### event_lineups — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Board controllers can create event lineups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(can_control_pitch_board(team_id, event_id) OR can_manage_team_roster(auth.uid(), team_id))`.
- Policy `Board controllers can delete event lineups`: PERMISSIVE DELETE TO `authenticated`; USING `(can_control_pitch_board(team_id, event_id) OR can_manage_team_roster(auth.uid(), team_id))`; WITH CHECK `<none>`.
- Policy `Board controllers can update event lineups`: PERMISSIVE UPDATE TO `authenticated`; USING `(can_control_pitch_board(team_id, event_id) OR can_manage_team_roster(auth.uid(), team_id))`; WITH CHECK `(can_control_pitch_board(team_id, event_id) OR can_manage_team_roster(auth.uid(), team_id))`.
- Policy `Team members and board controllers can view event lineups`: PERMISSIVE SELECT TO `authenticated`; USING `(is_team_member(auth.uid(), team_id) OR can_control_pitch_board(team_id, event_id) OR has_role(auth.uid(), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### event_payments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage event payments`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM (events e      JOIN user_roles ur ON (((ur.club_id = e.club_id) AND (ur.role = 'club_admin'::app_role))))   WHERE ((e.id = event_payments.event_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own payments`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view their own payments`: PERMISSIVE SELECT TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### event_reminder_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Event admins can view reminder log`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_reminder_log.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (((ur.club_id = e.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role, 'league_admin'::app_role, 'committee_member'::app_role]))) OR ((e.team_id IS NOT NULL) AND (ur.team_id = e.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))))))))`; WITH CHECK `<none>`.

#### event_session_drills — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Manage event drills as staff`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_session_drills.event_id) AND ((e.created_by = ( SELECT auth.uid() AS uid)) OR has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'app_admin'::app_role) OR ((e.club_id IS NOT NULL) AND is_club_admin(_user_id => ( SELECT auth.uid() AS uid), _club_id => e.club_id)) OR ((e.team_id IS NOT NULL) AND has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'team_admin'::app_role, _team_id => e.team_id)) OR ((e.team_id IS NOT NULL) AND has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'coach'::app_role, _team_id => e.team_id))))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_session_drills.event_id) AND ((e.created_by = ( SELECT auth.uid() AS uid)) OR has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'app_admin'::app_role) OR ((e.club_id IS NOT NULL) AND is_club_admin(_user_id => ( SELECT auth.uid() AS uid), _club_id => e.club_id)) OR ((e.team_id IS NOT NULL) AND has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'team_admin'::app_role, _team_id => e.team_id)) OR ((e.team_id IS NOT NULL) AND has_role(_user_id => ( SELECT auth.uid() AS uid), _role => 'coach'::app_role, _team_id => e.team_id))))))`.
- Policy `View event drills if event visible`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE (e.id = event_session_drills.event_id)))`; WITH CHECK `<none>`.

#### event_sponsors — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage event sponsors`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM (events e      JOIN user_roles ur ON ((((ur.team_id = e.team_id) OR (ur.club_id = e.club_id)) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])))))   WHERE ((e.id = event_sponsors.event_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Members can view event sponsors`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (events e      LEFT JOIN user_roles ur ON (((ur.team_id = e.team_id) OR (ur.club_id = e.club_id))))   WHERE ((e.id = event_sponsors.event_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### event_views — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can view event views for their events`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = event_views.event_id) AND ((EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))) OR (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = e.club_id) AND (ur.role = 'club_admin'::app_role)))) OR ((e.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = e.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((e.mini_league_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = e.club_id) AND (ur.role = ANY (ARRAY['league_admin'::app_role, 'club_admin'::app_role]))))))))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own event views`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view their own event views`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### events — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins/coaches can create events`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid)) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, club_id, NULL::uuid)) OR (has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid) AND (team_id IS NULL) AND (type = ANY (ARRAY['social'::event_type, 'game'::event_type]))))`.
- Policy `Admins/coaches can delete events`: PERMISSIVE DELETE TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid)) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, club_id, NULL::uuid)) OR (has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid) AND (team_id IS NULL) AND (type = ANY (ARRAY['social'::event_type, 'game'::event_type]))))`; WITH CHECK `<none>`.
- Policy `Admins/coaches can update events`: PERMISSIVE UPDATE TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid)) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, club_id, NULL::uuid)) OR (has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid) AND (team_id IS NULL) AND (type = ANY (ARRAY['social'::event_type, 'game'::event_type]))))`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid)) OR ((mini_league_id IS NOT NULL) AND has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, club_id, NULL::uuid)) OR (has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid) AND (team_id IS NULL) AND (type = ANY (ARRAY['social'::event_type, 'game'::event_type]))))`.
- Policy `Competition audience can view competition-wide events`: PERMISSIVE SELECT TO `authenticated`; USING `((competition_id IS NOT NULL) AND (team_id IS NULL) AND can_view_competition_wide_event(( SELECT auth.uid() AS uid), id))`; WITH CHECK `<none>`.
- Policy `Competition organisers can delete competition-wide events`: PERMISSIVE DELETE TO `authenticated`; USING `((competition_id IS NOT NULL) AND (team_id IS NULL) AND can_create_competition_event(( SELECT auth.uid() AS uid), competition_id))`; WITH CHECK `<none>`.
- Policy `Competition organisers can update competition-wide events`: PERMISSIVE UPDATE TO `authenticated`; USING `((competition_id IS NOT NULL) AND (team_id IS NULL) AND can_create_competition_event(( SELECT auth.uid() AS uid), competition_id))`; WITH CHECK `((competition_id IS NOT NULL) AND (team_id IS NULL) AND can_create_competition_event(( SELECT auth.uid() AS uid), competition_id))`.
- Policy `Competition-wide events limited to competition audience`: RESTRICTIVE SELECT TO `authenticated`; USING `((competition_id IS NULL) OR (team_id IS NOT NULL) OR can_view_competition_wide_event(( SELECT auth.uid() AS uid), id))`; WITH CHECK `<none>`.
- Policy `League admins can view competition fixture events`: PERMISSIVE SELECT TO `authenticated`; USING `((team_id IS NOT NULL) AND (((competition_id IS NOT NULL) AND is_league_admin_for_competition(( SELECT auth.uid() AS uid), competition_id)) OR ((competition_match_id IS NOT NULL) AND can_view_competition_match_event(( SELECT auth.uid() AS uid), competition_match_id))))`; WITH CHECK `<none>`.
- Policy `Members can view events`: PERMISSIVE SELECT TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR ((team_id IS NULL) AND (mini_league_id IS NULL) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'committee_member'::app_role, club_id, NULL::uuid))) OR ((mini_league_id IS NOT NULL) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid) OR (EXISTS ( SELECT 1    FROM mini_league_admins mla   WHERE ((mla.mini_league_id = events.mini_league_id) AND (mla.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.mini_league_id = events.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid))))))) OR ((mini_league_id IS NULL) AND (team_id IS NULL) AND is_club_member(( SELECT auth.uid() AS uid), club_id) AND ((restricted_to_roles IS NULL) OR (cardinality(restricted_to_roles) = 0) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = events.club_id) AND (ur.role = ANY (events.restricted_to_roles)))))) AND ((target_team_ids IS NULL) OR can_access_targeted_event(( SELECT auth.uid() AS uid), id))) OR ((team_id IS NOT NULL) AND (is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))))`; WITH CHECK `<none>`.

#### favorite_event_titles — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own favorite titles`: PERMISSIVE ALL TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### favorite_opponents — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own favorite opponents`: PERMISSIVE ALL TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### fcm_tokens — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Service role can access all FCM tokens`: PERMISSIVE ALL TO `public`; USING `(( SELECT auth.role() AS role) = 'service_role'::text)`; WITH CHECK `<none>`.
- Policy `Users can delete their own FCM tokens`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can insert their own FCM tokens`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can update their own FCM tokens`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view their own FCM tokens`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### feedback — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can delete feedback`: PERMISSIVE DELETE TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `App admins can update feedback`: PERMISSIVE UPDATE TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `Users can create feedback`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) IS NOT NULL) AND (user_id = ( SELECT auth.uid() AS uid)))`.
- Policy `Users can view their own feedback`: PERMISSIVE SELECT TO `public`; USING `((user_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### file_deletion_logs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can insert file deletion logs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = ANY (ARRAY['app_admin'::app_role, 'club_admin'::app_role])))))`.
- Policy `App admins can view all file deletion logs`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Club admins can view their club file deletion logs`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'club_admin'::app_role) AND (user_roles.club_id = file_deletion_logs.club_id))))`; WITH CHECK `<none>`.

#### gallery_chat_cards — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `No direct writes`: PERMISSIVE ALL TO `authenticated`; USING `false`; WITH CHECK `false`.
- Policy `Team members can view gallery cards`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = gallery_chat_cards.team_id)))) OR (EXISTS ( SELECT 1    FROM (teams t      JOIN user_roles ur ON ((ur.club_id = t.club_id)))   WHERE ((t.id = gallery_chat_cards.team_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role, 'committee_member'::app_role]))))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `<none>`.

#### game_player_stats — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage game stats`: PERMISSIVE ALL TO `authenticated`; USING `can_manage_team_roster(auth.uid(), team_id)`; WITH CHECK `can_manage_team_roster(auth.uid(), team_id)`.
- Policy `Team members can view game stats`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = game_player_stats.team_id))))`; WITH CHECK `<none>`.

#### game_results — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins and savers can delete game results`: PERMISSIVE DELETE TO `authenticated`; USING `((saved_by = ( SELECT auth.uid() AS uid)) OR can_manage_game_result(( SELECT auth.uid() AS uid), team_id, event_id))`; WITH CHECK `<none>`.
- Policy `Admins, coaches and subs manager can save game results`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((saved_by = ( SELECT auth.uid() AS uid)) AND can_manage_game_result(( SELECT auth.uid() AS uid), team_id, event_id))`.
- Policy `Admins, savers and subs manager can update game results`: PERMISSIVE UPDATE TO `authenticated`; USING `((saved_by = ( SELECT auth.uid() AS uid)) OR can_manage_game_result(( SELECT auth.uid() AS uid), team_id, event_id))`; WITH CHECK `((saved_by = ( SELECT auth.uid() AS uid)) OR can_manage_game_result(( SELECT auth.uid() AS uid), team_id, event_id))`.
- Policy `Team members can view game results`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = game_results.team_id)))) OR can_manage_game_result(( SELECT auth.uid() AS uid), team_id, event_id))`; WITH CHECK `<none>`.

#### game_summaries — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage game summaries`: PERMISSIVE ALL TO `authenticated`; USING `can_manage_team_roster(auth.uid(), team_id)`; WITH CHECK `can_manage_team_roster(auth.uid(), team_id)`.
- Policy `Team members can view game summaries`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = game_summaries.team_id))))`; WITH CHECK `<none>`.

#### group_members — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Group creators can manage members`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM chat_groups   WHERE ((chat_groups.id = group_members.group_id) AND (chat_groups.created_by = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM chat_groups   WHERE ((chat_groups.id = group_members.group_id) AND (chat_groups.created_by = ( SELECT auth.uid() AS uid)))))`.
- Policy `Members can add people to personal groups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = group_members.group_id) AND (cg.team_id IS NULL) AND (cg.club_id IS NULL) AND (cg.mini_league_id IS NULL)))) AND is_group_member(group_id, ( SELECT auth.uid() AS uid)) AND (added_by = ( SELECT auth.uid() AS uid)))`.
- Policy `Members can add to open club groups`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((added_by = auth.uid()) AND is_group_member(group_id, auth.uid()) AND (EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = group_members.group_id) AND (cg.club_id IS NOT NULL) AND (cg.team_id IS NULL) AND (cg.mini_league_id IS NULL) AND (cg.join_policy = ANY (ARRAY['open_to_club'::text, 'request_to_join'::text])) AND (cg.category = ANY (ARRAY['Operations'::text, 'Volunteers'::text])) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = group_members.user_id) AND (ur.club_id = cg.club_id))))))))`.
- Policy `Members can view group members`: PERMISSIVE SELECT TO `authenticated`; USING `((user_id = ( SELECT auth.uid() AS uid)) OR is_group_member(group_id, ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.
- Policy `Users can join groups`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM chat_groups   WHERE ((chat_groups.id = group_members.group_id) AND (chat_groups.created_by = ( SELECT auth.uid() AS uid))))))`.
- Policy `Users can leave personal groups`: PERMISSIVE DELETE TO `authenticated`; USING `((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1    FROM chat_groups cg   WHERE ((cg.id = group_members.group_id) AND (cg.team_id IS NULL) AND (cg.club_id IS NULL) AND (cg.mini_league_id IS NULL)))))`; WITH CHECK `<none>`.

#### group_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Group members can send group messages`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(can_access_chat_group(( SELECT auth.uid() AS uid), group_id) AND (author_id = ( SELECT auth.uid() AS uid)) AND can_post_in_chat_group(( SELECT auth.uid() AS uid), group_id))`.
- Policy `Group members can view group messages`: PERMISSIVE SELECT TO `public`; USING `can_access_chat_group(( SELECT auth.uid() AS uid), group_id)`; WITH CHECK `<none>`.
- Policy `Users can delete their own group messages`: PERMISSIVE DELETE TO `public`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Users can update their own group messages`: PERMISSIVE UPDATE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.

#### hidden_chat_groups — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can hide groups for themselves`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can unhide their own groups`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can update their own hidden groups`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view their own hidden groups`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### hidden_dm_conversations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can hide conversations`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can unhide conversations`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view their own hidden conversations`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### home_open_perf — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins view home perf`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(auth.uid(), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users insert own home perf`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(auth.uid() = user_id)`.

#### iap_transactions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can insert own IAP transactions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view own IAP transactions`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### inbox_open_perf — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins view inbox perf`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(auth.uid(), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users insert own inbox perf`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(auth.uid() = user_id)`.

#### match_captains — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins and coaches can manage captain`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = match_captains.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = match_captains.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`.
- Policy `Users can view captain for accessible events`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = match_captains.event_id) AND (is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR ((e.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), e.team_id)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.

#### match_goalkeepers — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins manage match goalkeepers - delete`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = match_goalkeepers.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR ((e.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = e.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((e.club_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = e.club_id) AND (ur.role = 'club_admin'::app_role)))))))))`; WITH CHECK `<none>`.
- Policy `Admins manage match goalkeepers - insert`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = match_goalkeepers.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR ((e.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = e.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((e.club_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = e.club_id) AND (ur.role = 'club_admin'::app_role)))))))))`.
- Policy `View match goalkeepers for accessible events`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE (e.id = match_goalkeepers.event_id)))`; WITH CHECK `<none>`.

#### match_message_reads — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can update own reads`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can upsert own reads`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view own reads`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### match_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Match participants can insert messages`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = sender_id)`.
- Policy `Match participants can view messages`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM business_matches bm   WHERE ((bm.id = match_messages.match_id) AND ((EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = bm.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1            FROM business_profiles bp           WHERE ((bp.id = bm.business_profile_id) AND (bp.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role))))))))`; WITH CHECK `<none>`.

#### member_referrals — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can update team referrals`: PERMISSIVE UPDATE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = member_referrals.team_id) AND (user_roles.role = ANY (ARRAY['club_admin'::app_role, 'coach'::app_role, 'team_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Admins can view team referrals`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = member_referrals.team_id) AND (user_roles.role = ANY (ARRAY['club_admin'::app_role, 'coach'::app_role, 'team_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Members can create referrals for their teams`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((referred_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = member_referrals.team_id)))))`.
- Policy `Members can view own referrals`: PERMISSIVE SELECT TO `authenticated`; USING `(referred_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### member_subscription_payments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage subscription payments`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = member_subscription_payments.club_id) AND (user_roles.role = 'club_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Users can view their own subscription payments`: PERMISSIVE SELECT TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### message_deletions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can view message deletions`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = ANY (ARRAY['app_admin'::app_role, 'club_admin'::app_role])))))`; WITH CHECK `<none>`.

#### message_digests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Members read digests for accessible chats`: PERMISSIVE SELECT TO `authenticated`; USING ` CASE message_type     WHEN 'group'::message_digest_source THEN can_access_chat_group(chat_scope_id, auth.uid())     WHEN 'club'::message_digest_source THEN (has_role(auth.uid(), 'app_admin'::app_role) OR (EXISTS ( SELECT 1        FROM (team_memberships tm          JOIN club_players cp ON ((cp.id = tm.club_player_id)))       WHERE ((cp.profile_id = auth.uid()) AND (cp.club_id = message_digests.chat_scope_id) AND (tm.status = 'active'::team_membership_status)))))     WHEN 'team'::message_digest_source THEN (has_role(auth.uid(), 'app_admin'::app_role) OR (EXISTS ( SELECT 1        FROM (team_memberships tm          JOIN club_players cp ON ((cp.id = tm.club_player_id)))       WHERE ((cp.profile_id = auth.uid()) AND (tm.team_id = message_digests.chat_scope_id) AND (tm.status = 'active'::team_membership_status)))))     ELSE NULL::boolean END`; WITH CHECK `<none>`.

#### message_reactions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can add message reactions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can remove their own message reactions`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can update their own message reactions`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view reactions on accessible messages`: PERMISSIVE SELECT TO `public`; USING `(((team_message_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM team_messages tm   WHERE ((tm.id = message_reactions.team_message_id) AND (is_team_member(( SELECT auth.uid() AS uid), tm.team_id) OR (EXISTS ( SELECT 1            FROM teams t           WHERE ((t.id = tm.team_id) AND has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid))))))))) OR ((club_message_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM club_messages cm   WHERE ((cm.id = message_reactions.club_message_id) AND is_club_member(( SELECT auth.uid() AS uid), cm.club_id))))) OR ((broadcast_message_id IS NOT NULL) AND (( SELECT auth.uid() AS uid) IS NOT NULL)) OR ((group_message_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM group_messages gm   WHERE ((gm.id = message_reactions.group_message_id) AND can_access_chat_group(( SELECT auth.uid() AS uid), gm.group_id))))) OR ((direct_message_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM (direct_messages dm      JOIN direct_conversations dc ON ((dc.id = dm.conversation_id)))   WHERE ((dm.id = message_reactions.direct_message_id) AND ((dc.participant_1 = ( SELECT auth.uid() AS uid)) OR (dc.participant_2 = ( SELECT auth.uid() AS uid))))))) OR ((club_admin_message_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM club_admin_messages cam   WHERE ((cam.id = message_reactions.club_admin_message_id) AND is_club_admin_conversation_participant(cam.conversation_id))))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### message_reads — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can delete their own reads`: PERMISSIVE DELETE TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Users can insert their own reads`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view others reads in shared threads`: PERMISSIVE SELECT TO `authenticated`; USING `((user_id <> ( SELECT auth.uid() AS uid)) AND can_view_message_read(( SELECT auth.uid() AS uid), team_message_id, club_message_id, broadcast_message_id, group_message_id, direct_message_id, club_admin_message_id))`; WITH CHECK `<none>`.
- Policy `Users can view their own message reads`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### message_reports — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can update message reports`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `App admins can view all message reports`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Users can create message reports`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = reporter_id)`.
- Policy `Users can view own message reports`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = reporter_id)`; WITH CHECK `<none>`.

#### mini_league_admins — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can grant mini-league admin`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM mini_leagues ml   WHERE ((ml.id = mini_league_admins.mini_league_id) AND is_club_admin(( SELECT auth.uid() AS uid), ml.club_id))))`.
- Policy `Club admins can revoke mini-league admin`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM mini_leagues ml   WHERE ((ml.id = mini_league_admins.mini_league_id) AND is_club_admin(( SELECT auth.uid() AS uid), ml.club_id))))`; WITH CHECK `<none>`.
- Policy `Club members can view mini-league admins`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM (mini_leagues ml      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((ml.id = mini_league_admins.mini_league_id) AND (ur.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.

#### mini_league_group_duties — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can manage group duties`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM (((mini_league_groups mlg      JOIN mini_league_sessions mls ON ((mls.id = mlg.session_id)))      JOIN mini_leagues ml ON ((ml.id = mls.mini_league_id)))      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((mlg.id = mini_league_group_duties.group_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'league_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `League parents can view group duties`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM ((mini_league_groups mlg      JOIN mini_league_sessions mls ON ((mls.id = mlg.session_id)))      JOIN mini_league_players mlp ON ((mlp.mini_league_id = mls.mini_league_id)))   WHERE ((mlg.id = mini_league_group_duties.group_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### mini_league_group_players — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete group players`: PERMISSIVE DELETE TO `public`; USING `(EXISTS ( SELECT 1    FROM (mini_league_groups g      JOIN mini_league_sessions s ON ((s.id = g.session_id)))   WHERE ((g.id = mini_league_group_players.group_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League admins can insert group players`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM (mini_league_groups g      JOIN mini_league_sessions s ON ((s.id = g.session_id)))   WHERE ((g.id = mini_league_group_players.group_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`.
- Policy `League admins can update group players`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM (mini_league_groups g      JOIN mini_league_sessions s ON ((s.id = g.session_id)))   WHERE ((g.id = mini_league_group_players.group_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League members can view group players`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (mini_league_groups g      JOIN mini_league_sessions s ON ((s.id = g.session_id)))   WHERE ((g.id = mini_league_group_players.group_id) AND (is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id) OR is_league_parent(( SELECT auth.uid() AS uid), s.mini_league_id)))))`; WITH CHECK `<none>`.

#### mini_league_groups — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete groups`: PERMISSIVE DELETE TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_groups.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League admins can insert groups`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_groups.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`.
- Policy `League admins can update groups`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_groups.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League members can view groups`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_groups.session_id) AND (is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id) OR is_league_parent(( SELECT auth.uid() AS uid), s.mini_league_id)))))`; WITH CHECK `<none>`.

#### mini_league_players — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete players`: PERMISSIVE DELETE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League admins can insert players`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`.
- Policy `League admins can update players`: PERMISSIVE UPDATE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League members can view players`: PERMISSIVE SELECT TO `public`; USING `(is_league_admin(( SELECT auth.uid() AS uid), mini_league_id) OR is_league_parent(( SELECT auth.uid() AS uid), mini_league_id))`; WITH CHECK `<none>`.

#### mini_league_session_availability — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete availability`: PERMISSIVE DELETE TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_session_availability.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League admins can insert availability`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_session_availability.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id)))) OR (EXISTS ( SELECT 1    FROM (mini_league_sessions s      JOIN mini_league_players p ON ((p.mini_league_id = s.mini_league_id)))   WHERE ((s.id = mini_league_session_availability.session_id) AND (p.id = mini_league_session_availability.player_id) AND (p.parent_user_id = ( SELECT auth.uid() AS uid))))))`.
- Policy `League admins can update availability`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_session_availability.session_id) AND is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id))))`; WITH CHECK `<none>`.
- Policy `League members can view availability`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_sessions s   WHERE ((s.id = mini_league_session_availability.session_id) AND (is_league_admin(( SELECT auth.uid() AS uid), s.mini_league_id) OR is_league_parent(( SELECT auth.uid() AS uid), s.mini_league_id)))))`; WITH CHECK `<none>`.
- Policy `Parents can update their child availability`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM mini_league_players p   WHERE ((p.id = mini_league_session_availability.player_id) AND (p.parent_user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### mini_league_sessions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can delete sessions`: PERMISSIVE DELETE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League admins can insert sessions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`.
- Policy `League admins can update sessions`: PERMISSIVE UPDATE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), mini_league_id)`; WITH CHECK `<none>`.
- Policy `League members can view sessions`: PERMISSIVE SELECT TO `public`; USING `(is_league_admin(( SELECT auth.uid() AS uid), mini_league_id) OR is_league_parent(( SELECT auth.uid() AS uid), mini_league_id))`; WITH CHECK `<none>`.

#### mini_leagues — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `League admins can create mini leagues`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'league_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`.
- Policy `League admins can delete mini leagues`: PERMISSIVE DELETE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), id)`; WITH CHECK `<none>`.
- Policy `League admins can update mini leagues`: PERMISSIVE UPDATE TO `public`; USING `is_league_admin(( SELECT auth.uid() AS uid), id)`; WITH CHECK `<none>`.
- Policy `Users can view mini leagues they have access to`: PERMISSIVE SELECT TO `public`; USING `can_view_mini_league(( SELECT auth.uid() AS uid), id)`; WITH CHECK `<none>`.

#### notification_dispatch_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can read dispatch log`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(auth.uid(), 'app_admin'::app_role)`; WITH CHECK `<none>`.

#### notification_preferences — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own notification preferences`: PERMISSIVE ALL TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### notifications — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can insert notifications for their members`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM (user_roles admin_role      JOIN user_roles member_role ON ((admin_role.club_id = member_role.club_id)))   WHERE ((admin_role.user_id = ( SELECT auth.uid() AS uid)) AND (admin_role.role = 'club_admin'::app_role) AND (member_role.user_id = notifications.user_id)))) OR (EXISTS ( SELECT 1    FROM (user_roles admin_role      JOIN user_roles member_role ON ((admin_role.team_id = member_role.team_id)))   WHERE ((admin_role.user_id = ( SELECT auth.uid() AS uid)) AND (admin_role.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])) AND (member_role.user_id = notifications.user_id)))))`.
- Policy `Users can delete their own notifications`: PERMISSIVE DELETE TO `public`; USING `(user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Users can insert their own notifications`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can notify members in shared org scope`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((user_id <> ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1    FROM (user_roles me      JOIN user_roles them ON (((me.club_id = them.club_id) AND (me.club_id IS NOT NULL))))   WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND (them.user_id = notifications.user_id)))) OR (EXISTS ( SELECT 1    FROM (user_roles me      JOIN user_roles them ON (((me.team_id = them.team_id) AND (me.team_id IS NOT NULL))))   WHERE ((me.user_id = ( SELECT auth.uid() AS uid)) AND (them.user_id = notifications.user_id))))))`.
- Policy `Users can update their own notifications`: PERMISSIVE UPDATE TO `public`; USING `(user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Users can view their own notifications`: PERMISSIVE SELECT TO `public`; USING `(user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.

#### pending_invites — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage pending invites`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid))`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid))`.
- Policy `Club admins can view club pending invites`: PERMISSIVE SELECT TO `public`; USING `has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `League admins can manage league pending invites`: PERMISSIVE ALL TO `authenticated`; USING `((metadata ? 'mini_league_id'::text) AND is_league_admin(( SELECT auth.uid() AS uid), ((metadata ->> 'mini_league_id'::text))::uuid))`; WITH CHECK `((metadata ? 'mini_league_id'::text) AND is_league_admin(( SELECT auth.uid() AS uid), ((metadata ->> 'mini_league_id'::text))::uuid) AND (invited_by_user_id = ( SELECT auth.uid() AS uid)))`.
- Policy `Team members can view pending invites for their team`: PERMISSIVE SELECT TO `authenticated`; USING `((team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.
- Policy `Team staff can view club pending invites`: PERMISSIVE SELECT TO `public`; USING `((club_id IS NOT NULL) AND (has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid)))`; WITH CHECK `<none>`.
- Policy `Users can accept their own pending invites`: PERMISSIVE UPDATE TO `public`; USING `((invited_user_id = ( SELECT auth.uid() AS uid)) OR ((invited_email IS NOT NULL) AND user_email_matches_invite(( SELECT auth.uid() AS uid), invited_email)))`; WITH CHECK `((status = 'accepted'::text) AND (accepted_at IS NOT NULL))`.
- Policy `Users can insert pending invites`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(invited_by_user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view invites they sent or received`: PERMISSIVE SELECT TO `public`; USING `((invited_by_user_id = ( SELECT auth.uid() AS uid)) OR (invited_user_id = ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.
- Policy `Users can view their own pending invites`: PERMISSIVE SELECT TO `public`; USING `((invited_user_id = ( SELECT auth.uid() AS uid)) OR ((invited_email IS NOT NULL) AND user_email_matches_invite(( SELECT auth.uid() AS uid), invited_email)))`; WITH CHECK `<none>`.

#### photo_albums — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Albums are viewable in scope`: PERMISSIVE SELECT TO `authenticated`; USING `can_view_album(id)`; WITH CHECK `<none>`.
- Policy `Uploaders can delete their own albums`: PERMISSIVE DELETE TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = uploader_id)`; WITH CHECK `<none>`.
- Policy `Uploaders can update their own albums`: PERMISSIVE UPDATE TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = uploader_id)`; WITH CHECK `<none>`.
- Policy `Users can create their own albums`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = uploader_id)`.

#### photo_comment_reactions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can add comment reactions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can remove their own comment reactions`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can update their own comment reactions`: PERMISSIVE UPDATE TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view reactions on accessible comments`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (photo_comments pc      JOIN photos p ON ((p.id = pc.photo_id)))   WHERE ((pc.id = photo_comment_reactions.comment_id) AND (p.deleted_at IS NULL) AND (((p.club_id IS NOT NULL) AND is_club_member(( SELECT auth.uid() AS uid), p.club_id)) OR ((p.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), p.team_id)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.

#### photo_comments — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can add comments to photos`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can delete their own comments`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can update their own comments`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view comments on accessible photos`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM photos p   WHERE ((p.id = photo_comments.photo_id) AND (p.deleted_at IS NULL) AND (((p.club_id IS NOT NULL) AND is_club_member(( SELECT auth.uid() AS uid), p.club_id)) OR ((p.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), p.team_id)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.

#### photo_deletion_logs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can insert photo deletion logs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = ANY (ARRAY['app_admin'::app_role, 'club_admin'::app_role])))))`.
- Policy `App admins can view all deletion logs`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Club admins can view their club deletion logs`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'club_admin'::app_role) AND (user_roles.club_id = photo_deletion_logs.club_id))))`; WITH CHECK `<none>`.

#### photo_reactions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can add reactions to photos`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can remove their own reactions`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can view reactions on accessible photos`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM photos p   WHERE ((p.id = photo_reactions.photo_id) AND (p.deleted_at IS NULL) AND (((p.club_id IS NOT NULL) AND is_club_member(( SELECT auth.uid() AS uid), p.club_id)) OR ((p.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), p.team_id)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.

#### photo_reports — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can update reports`: PERMISSIVE UPDATE TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `App admins can view all reports`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `Users can create photo reports`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = reporter_id)`.
- Policy `Users can view their own reports`: PERMISSIVE SELECT TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = reporter_id)`; WITH CHECK `<none>`.

#### photo_views — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can read photo views`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.
- Policy `Users can record their own photo views`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### photos — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Competition members can upload competition media`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((competition_id IS NOT NULL) AND (team_id IS NULL) AND (club_id IS NULL) AND (mini_league_id IS NULL) AND (uploader_id = ( SELECT auth.uid() AS uid)) AND is_competition_member(( SELECT auth.uid() AS uid), competition_id))`.
- Policy `Competition members can view competition media`: PERMISSIVE SELECT TO `authenticated`; USING `((competition_id IS NOT NULL) AND is_competition_member(( SELECT auth.uid() AS uid), competition_id))`; WITH CHECK `<none>`.
- Policy `Members can view photos`: PERMISSIVE SELECT TO `public`; USING `(((team_id IS NOT NULL) AND (is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))) OR ((team_id IS NULL) AND (is_club_member(( SELECT auth.uid() AS uid), club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))))`; WITH CHECK `<none>`.
- Policy `Scoped role-checked photo uploads`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((( SELECT auth.uid() AS uid) IS NOT NULL) AND (uploader_id = ( SELECT auth.uid() AS uid)) AND (((team_id IS NULL) AND (mini_league_id IS NULL) AND (club_id IS NOT NULL) AND can_publish_club_wide_photo(( SELECT auth.uid() AS uid), club_id)) OR ((team_id IS NOT NULL) AND (mini_league_id IS NULL) AND (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = photos.team_id) AND ((photos.club_id IS NULL) OR (t.club_id = photos.club_id))))) AND (is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = photos.team_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))))))) OR ((mini_league_id IS NOT NULL) AND (team_id IS NULL) AND (EXISTS ( SELECT 1    FROM mini_leagues ml   WHERE ((ml.id = photos.mini_league_id) AND ((photos.club_id IS NULL) OR (ml.club_id = photos.club_id))))) AND ((EXISTS ( SELECT 1    FROM (user_roles ur      JOIN mini_leagues ml ON ((ml.club_id = ur.club_id)))   WHERE ((ml.id = photos.mini_league_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['league_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.mini_league_id = photos.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))))))`.
- Policy `Uploaders and admins can delete competition media`: PERMISSIVE DELETE TO `authenticated`; USING `((competition_id IS NOT NULL) AND ((uploader_id = ( SELECT auth.uid() AS uid)) OR can_manage_competition_media(( SELECT auth.uid() AS uid), competition_id)))`; WITH CHECK `<none>`.
- Policy `Uploaders and admins can delete photos`: PERMISSIVE DELETE TO `public`; USING `((uploader_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Uploaders and admins can update competition media`: PERMISSIVE UPDATE TO `authenticated`; USING `((competition_id IS NOT NULL) AND ((uploader_id = ( SELECT auth.uid() AS uid)) OR can_manage_competition_media(( SELECT auth.uid() AS uid), competition_id)))`; WITH CHECK `(competition_id IS NOT NULL)`.
- Policy `Uploaders and admins can update photos`: PERMISSIVE UPDATE TO `public`; USING `((uploader_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Users can delete mini-league photos`: PERMISSIVE DELETE TO `public`; USING `((mini_league_id IS NOT NULL) AND ((uploader_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM (user_roles ur      JOIN mini_leagues ml ON ((ml.club_id = ur.club_id)))   WHERE ((ml.id = photos.mini_league_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['league_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])))))))`; WITH CHECK `<none>`.
- Policy `Users can update mini-league photos`: PERMISSIVE UPDATE TO `public`; USING `((mini_league_id IS NOT NULL) AND ((uploader_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM (user_roles ur      JOIN mini_leagues ml ON ((ml.club_id = ur.club_id)))   WHERE ((ml.id = photos.mini_league_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['league_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])))))))`; WITH CHECK `<none>`.
- Policy `Users can view mini-league photos`: PERMISSIVE SELECT TO `public`; USING `((mini_league_id IS NOT NULL) AND ((EXISTS ( SELECT 1    FROM (user_roles ur      JOIN mini_leagues ml ON ((ml.club_id = ur.club_id)))   WHERE ((ml.id = photos.mini_league_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['league_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.mini_league_id = photos.mini_league_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid)))))))`; WITH CHECK `<none>`.

#### pinned_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Members can pin messages in their chats`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((pinned_by = ( SELECT auth.uid() AS uid)) AND can_access_chat(chat_type, chat_id))`.
- Policy `Members can unpin messages in their chats`: PERMISSIVE DELETE TO `authenticated`; USING `can_access_chat(chat_type, chat_id)`; WITH CHECK `<none>`.
- Policy `Members can view pins in their chats`: PERMISSIVE SELECT TO `authenticated`; USING `can_access_chat(chat_type, chat_id)`; WITH CHECK `<none>`.

#### pitch_formations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their formations`: PERMISSIVE ALL TO `public`; USING `((( SELECT auth.uid() AS uid) = user_id) OR is_team_member(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.

#### player_of_match — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage player of match`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = player_of_match.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`; WITH CHECK `<none>`.
- Policy `Team admins can manage player of match`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM (events e      JOIN user_roles ur ON ((((ur.team_id = e.team_id) AND (ur.team_id IS NOT NULL)) OR (ur.club_id = e.club_id))))   WHERE ((e.id = player_of_match.event_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Team members can view player of match`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = player_of_match.event_id) AND (is_team_member(( SELECT auth.uid() AS uid), e.team_id) OR is_club_member(( SELECT auth.uid() AS uid), e.club_id)))))`; WITH CHECK `<none>`.
- Policy `Users can view player of match for accessible events`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = player_of_match.event_id) AND (is_club_member(( SELECT auth.uid() AS uid), e.club_id) OR ((e.team_id IS NOT NULL) AND is_team_member(( SELECT auth.uid() AS uid), e.team_id)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))))`; WITH CHECK `<none>`.

#### playhq_fixtures — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `playhq_fixtures public read`: PERMISSIVE SELECT TO `public`; USING `true`; WITH CHECK `<none>`.
- Policy `playhq_fixtures service write`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### playhq_grades — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `playhq_grades public read`: PERMISSIVE SELECT TO `public`; USING `true`; WITH CHECK `<none>`.
- Policy `playhq_grades service write`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### playhq_ladder — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `playhq_ladder public read`: PERMISSIVE SELECT TO `public`; USING `true`; WITH CHECK `<none>`.
- Policy `playhq_ladder service write`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### playhq_player_links — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Claimer can remove their own link`: PERMISSIVE DELETE TO `authenticated`; USING `(claimed_by = auth.uid())`; WITH CHECK `<none>`.
- Policy `Users can claim a player link for themselves or their child`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((claimed_by = auth.uid()) AND ((user_id = auth.uid()) OR ((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = playhq_player_links.child_id) AND (cg.guardian_id = auth.uid())))))))`.
- Policy `Users can view their own player links`: PERMISSIVE SELECT TO `authenticated`; USING `((claimed_by = auth.uid()) OR (user_id = auth.uid()) OR ((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = playhq_player_links.child_id) AND (cg.guardian_id = auth.uid()))))))`; WITH CHECK `<none>`.

#### playhq_player_stats — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `playhq_player_stats public read`: PERMISSIVE SELECT TO `public`; USING `true`; WITH CHECK `<none>`.
- Policy `playhq_player_stats service write`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### playhq_sync_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `playhq_sync_log read`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.
- Policy `playhq_sync_log service write`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### points_cooldowns — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can insert own cooldowns`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can read own cooldowns`: PERMISSIVE SELECT TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### points_history — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can view club member points history`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = points_history.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `App admins can view all points history`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `Users and admins can insert points history`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) OR ((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM children c   WHERE ((c.id = points_history.child_id) AND (c.parent_id = ( SELECT auth.uid() AS uid)))))) OR ((created_by = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'app_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = points_history.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role]))))))))`.
- Policy `Users can view own points history`: PERMISSIVE SELECT TO `public`; USING `((( SELECT auth.uid() AS uid) = user_id) OR (( SELECT auth.uid() AS uid) IN ( SELECT children.parent_id    FROM children   WHERE (children.id = points_history.child_id))))`; WITH CHECK `<none>`.

#### poll_options — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Poll creator can delete options`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM polls p   WHERE ((p.id = poll_options.poll_id) AND (p.created_by = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Poll creator can insert options`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM polls p   WHERE ((p.id = poll_options.poll_id) AND (p.created_by = ( SELECT auth.uid() AS uid)))))`.
- Policy `View options for accessible polls`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM polls p   WHERE ((p.id = poll_options.poll_id) AND can_access_poll_chat(p.chat_type, p.chat_id, ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### poll_votes — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Members can cast their own votes in accessible, open polls`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1    FROM polls p   WHERE ((p.id = poll_votes.poll_id) AND can_access_poll_chat(p.chat_type, p.chat_id, ( SELECT auth.uid() AS uid)) AND ((p.chat_type <> 'group'::poll_chat_type) OR can_post_in_chat_group(( SELECT auth.uid() AS uid), p.chat_id)) AND (p.closed_at IS NULL) AND ((p.closes_at IS NULL) OR (p.closes_at > now()))))))`.
- Policy `Members can remove their own votes`: PERMISSIVE DELETE TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `View votes for accessible polls`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM polls p   WHERE ((p.id = poll_votes.poll_id) AND can_access_poll_chat(p.chat_type, p.chat_id, ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### polls — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Creators can delete their polls`: PERMISSIVE DELETE TO `authenticated`; USING `(created_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Creators can update their polls`: PERMISSIVE UPDATE TO `authenticated`; USING `(created_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `(created_by = ( SELECT auth.uid() AS uid))`.
- Policy `Members can create polls in their chats`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND can_access_poll_chat(chat_type, chat_id, ( SELECT auth.uid() AS uid)) AND ((chat_type <> 'group'::poll_chat_type) OR can_post_in_chat_group(( SELECT auth.uid() AS uid), chat_id)))`.
- Policy `Members can view polls in their chats`: PERMISSIVE SELECT TO `authenticated`; USING `can_access_poll_chat(chat_type, chat_id, ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### profiles — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can update any profile`: PERMISSIVE UPDATE TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `App admins can view all profiles`: PERMISSIVE SELECT TO `public`; USING `has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)`; WITH CHECK `<none>`.
- Policy `DM participants can view each other profiles`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM direct_conversations dc   WHERE (((dc.participant_1 = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (dc.participant_2 = profiles.id)) OR ((dc.participant_2 = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (dc.participant_1 = profiles.id)))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own profile`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT ( SELECT auth.uid() AS uid) AS uid) = id)`.
- Policy `Users can update their own profile`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT ( SELECT auth.uid() AS uid) AS uid) = id)`; WITH CHECK `<none>`.
- Policy `Users can view profiles of club chat message authors`: PERMISSIVE SELECT TO `public`; USING `is_club_chat_author_visible(( SELECT ( SELECT auth.uid() AS uid) AS uid), id)`; WITH CHECK `<none>`.
- Policy `Users can view profiles of photo commenters in shared clubs/tea`: PERMISSIVE SELECT TO `public`; USING `is_photo_commenter_visible(( SELECT ( SELECT auth.uid() AS uid) AS uid), id)`; WITH CHECK `<none>`.
- Policy `Users can view profiles of photo uploaders in shared clubs/team`: PERMISSIVE SELECT TO `public`; USING `is_photo_uploader_visible(( SELECT ( SELECT auth.uid() AS uid) AS uid), id)`; WITH CHECK `<none>`.
- Policy `Users can view profiles of users they share a team/club with`: PERMISSIVE SELECT TO `public`; USING `shares_team_or_club_with(( SELECT ( SELECT auth.uid() AS uid) AS uid), id)`; WITH CHECK `<none>`.
- Policy `Users can view their own profile`: PERMISSIVE SELECT TO `public`; USING `(( SELECT ( SELECT auth.uid() AS uid) AS uid) = id)`; WITH CHECK `<none>`.

#### promo_codes — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage promo codes`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND ((user_roles.role = 'app_admin'::app_role) OR ((user_roles.role = 'club_admin'::app_role) AND ((promo_codes.club_id IS NULL) OR (promo_codes.club_id = user_roles.club_id)))))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND ((user_roles.role = 'app_admin'::app_role) OR ((user_roles.role = 'club_admin'::app_role) AND ((promo_codes.club_id IS NULL) OR (promo_codes.club_id = user_roles.club_id)))))))`.

#### public_clubs — RLS False; kind=v
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### push_alert_settings — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can update push alert settings`: PERMISSIVE UPDATE TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.
- Policy `App admins can view push alert settings`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role))))`; WITH CHECK `<none>`.

#### push_delivery_queue — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### push_notification_logs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Service role can insert push logs`: PERMISSIVE INSERT TO `service_role`; USING `<none>`; WITH CHECK `true`.
- Policy `Users can view their own push logs`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### push_subscriptions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can delete their own push subscriptions`: PERMISSIVE DELETE TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Users can insert their own push subscriptions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can update their own push subscriptions`: PERMISSIVE UPDATE TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Users can view their own push subscriptions`: PERMISSIVE SELECT TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### rate_limits — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Deny authenticated user access to rate_limits`: PERMISSIVE ALL TO `authenticated`; USING `false`; WITH CHECK `false`.
- Policy `Service role can manage rate limits`: PERMISSIVE ALL TO `service_role`; USING `true`; WITH CHECK `true`.

#### realtime_perf_samples — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins read all perf samples`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users insert their own perf samples`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### reward_redemptions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can update club redemptions`: PERMISSIVE UPDATE TO `public`; USING `(reward_id IN ( SELECT cr.id    FROM club_rewards cr   WHERE (cr.club_id IN ( SELECT ur.club_id            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'club_admin'::app_role) AND (ur.club_id IS NOT NULL))))))`; WITH CHECK `<none>`.
- Policy `Club admins can view club redemptions`: PERMISSIVE SELECT TO `public`; USING `(reward_id IN ( SELECT cr.id    FROM club_rewards cr   WHERE (cr.club_id IN ( SELECT ur.club_id            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = 'club_admin'::app_role) AND (ur.club_id IS NOT NULL))))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own redemptions`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) OR (child_id IN ( SELECT children.id    FROM children   WHERE (children.parent_id = ( SELECT auth.uid() AS uid)))))`.
- Policy `Users can update their own redemptions`: PERMISSIVE UPDATE TO `public`; USING `((user_id = ( SELECT auth.uid() AS uid)) OR (child_id IN ( SELECT children.id    FROM children   WHERE (children.parent_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.
- Policy `Users can view their own redemptions`: PERMISSIVE SELECT TO `public`; USING `((user_id = ( SELECT auth.uid() AS uid)) OR (child_id IN ( SELECT children.id    FROM children   WHERE (children.parent_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### role_requests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage role requests`: PERMISSIVE ALL TO `public`; USING `((EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.role = 'app_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = role_requests.club_id) AND (user_roles.role = 'club_admin'::app_role)))) OR (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = role_requests.team_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))`; WITH CHECK `<none>`.
- Policy `Users can insert their own role requests`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view their own role requests`: PERMISSIVE SELECT TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### rsvp_audit_log — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Audit log viewable by event admins or actor`: PERMISSIVE SELECT TO `authenticated`; USING `((actor_user_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR ((club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = rsvp_audit_log.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'committee_member'::app_role])))))) OR ((team_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = rsvp_audit_log.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role])))))) OR ((mini_league_id IS NOT NULL) AND ((EXISTS ( SELECT 1    FROM mini_league_admins mla   WHERE ((mla.mini_league_id = rsvp_audit_log.mini_league_id) AND (mla.user_id = ( SELECT auth.uid() AS uid))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = rsvp_audit_log.club_id) AND (ur.role = 'league_admin'::app_role)))))))`; WITH CHECK `<none>`.
- Policy `No direct inserts`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `false`.

#### rsvps — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can delete RSVPs`: PERMISSIVE DELETE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`; WITH CHECK `<none>`.
- Policy `Admins can delete mini league player RSVPs`: PERMISSIVE DELETE TO `authenticated`; USING `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM ((mini_league_players mlp      JOIN mini_leagues ml ON ((ml.id = mlp.mini_league_id)))      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role]))))))`; WITH CHECK `<none>`.
- Policy `Admins can insert RSVPs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`.
- Policy `Admins can insert mini league player RSVPs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM ((mini_league_players mlp      JOIN mini_leagues ml ON ((ml.id = mlp.mini_league_id)))      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role]))))))`.
- Policy `Admins can update RSVPs`: PERMISSIVE UPDATE TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, e.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, e.team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, e.team_id)))))`.
- Policy `Admins can update mini league player RSVPs`: PERMISSIVE UPDATE TO `authenticated`; USING `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM ((mini_league_players mlp      JOIN mini_leagues ml ON ((ml.id = mlp.mini_league_id)))      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role]))))))`; WITH CHECK `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM ((mini_league_players mlp      JOIN mini_leagues ml ON ((ml.id = mlp.mini_league_id)))      JOIN user_roles ur ON ((ur.club_id = ml.club_id)))   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'team_admin'::app_role, 'coach'::app_role]))))))`.
- Policy `Competition audience can view competition-wide RSVPs`: PERMISSIVE SELECT TO `authenticated`; USING `can_view_competition_wide_event(( SELECT auth.uid() AS uid), event_id)`; WITH CHECK `<none>`.
- Policy `Competition organisers can manage competition-wide RSVPs`: PERMISSIVE ALL TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (e.competition_id IS NOT NULL) AND (e.team_id IS NULL) AND can_create_competition_event(( SELECT auth.uid() AS uid), e.competition_id))))`; WITH CHECK `(EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND (e.competition_id IS NOT NULL) AND (e.team_id IS NULL) AND can_create_competition_event(( SELECT auth.uid() AS uid), e.competition_id))))`.
- Policy `Guardians can delete child RSVPs`: PERMISSIVE DELETE TO `authenticated`; USING `((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = rsvps.child_id) AND (cg.guardian_id = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `<none>`.
- Policy `Guardians can insert child RSVPs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = rsvps.child_id) AND (cg.guardian_id = ( SELECT auth.uid() AS uid))))))`.
- Policy `Guardians can update child RSVPs`: PERMISSIVE UPDATE TO `authenticated`; USING `((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = rsvps.child_id) AND (cg.guardian_id = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `((child_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM child_guardians cg   WHERE ((cg.child_id = rsvps.child_id) AND (cg.guardian_id = ( SELECT auth.uid() AS uid))))))`.
- Policy `Parents can delete league player RSVPs`: PERMISSIVE DELETE TO `authenticated`; USING `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `<none>`.
- Policy `Parents can insert league player RSVPs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid))))))`.
- Policy `Parents can update league player RSVPs`: PERMISSIVE UPDATE TO `authenticated`; USING `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `((mini_league_player_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM mini_league_players mlp   WHERE ((mlp.id = rsvps.mini_league_player_id) AND (mlp.parent_user_id = ( SELECT auth.uid() AS uid))))))`.
- Policy `Targeted event RSVPs require access (delete)`: RESTRICTIVE DELETE TO `public`; USING `((NOT event_has_target_team_restriction(event_id)) OR can_access_targeted_event(( SELECT auth.uid() AS uid), event_id))`; WITH CHECK `<none>`.
- Policy `Targeted event RSVPs require access (insert)`: RESTRICTIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((NOT event_has_target_team_restriction(event_id)) OR can_access_targeted_event(( SELECT auth.uid() AS uid), event_id))`.
- Policy `Targeted event RSVPs require access (select)`: RESTRICTIVE SELECT TO `public`; USING `((NOT event_has_target_team_restriction(event_id)) OR can_access_targeted_event(( SELECT auth.uid() AS uid), event_id))`; WITH CHECK `<none>`.
- Policy `Targeted event RSVPs require access (update)`: RESTRICTIVE UPDATE TO `public`; USING `((NOT event_has_target_team_restriction(event_id)) OR can_access_targeted_event(( SELECT auth.uid() AS uid), event_id))`; WITH CHECK `((NOT event_has_target_team_restriction(event_id)) OR can_access_targeted_event(( SELECT auth.uid() AS uid), event_id))`.
- Policy `Users can delete their own RSVPs`: PERMISSIVE DELETE TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.
- Policy `Users can insert their own RSVPs`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can update their own RSVPs`: PERMISSIVE UPDATE TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `(user_id = ( SELECT auth.uid() AS uid))`.
- Policy `Users can view RSVPs for events they can see`: PERMISSIVE SELECT TO `public`; USING `((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) OR (EXISTS ( SELECT 1    FROM events e   WHERE ((e.id = rsvps.event_id) AND ((EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (ur.club_id = e.club_id)))) OR ((e.team_id IS NOT NULL) AND (EXISTS ( SELECT 1            FROM user_roles ur           WHERE ((ur.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) AND (ur.team_id = e.team_id))))) OR ((e.mini_league_id IS NOT NULL) AND ((EXISTS ( SELECT 1            FROM mini_league_admins mla           WHERE ((mla.mini_league_id = e.mini_league_id) AND (mla.user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))) OR (EXISTS ( SELECT 1            FROM mini_league_players mlp           WHERE ((mlp.mini_league_id = e.mini_league_id) AND (mlp.parent_user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))))))))))))`; WITH CHECK `<none>`.

#### saved_locations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own saved locations`: PERMISSIVE ALL TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### schedule_broadcasts — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can broadcast schedule refresh`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((bumped_by = ( SELECT auth.uid() AS uid)) AND ((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.role = ANY (ARRAY['app_admin'::app_role, 'league_admin'::app_role]))))) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = schedule_broadcasts.club_id) AND (ur.role = 'club_admin'::app_role)))) OR ((team_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = schedule_broadcasts.team_id) AND (ur.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role]))))))))`.
- Policy `Members can read their club's schedule broadcasts`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = schedule_broadcasts.club_id))))`; WITH CHECK `<none>`.

#### schedule_open_perf — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins view schedule perf`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(auth.uid(), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users insert own schedule perf`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(auth.uid() = user_id)`.

#### scheduled_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors can create their own scheduled messages`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.
- Policy `Authors can delete their own pending scheduled messages`: PERMISSIVE DELETE TO `authenticated`; USING `((author_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::scheduled_message_status))`; WITH CHECK `<none>`.
- Policy `Authors can update their own pending scheduled messages`: PERMISSIVE UPDATE TO `authenticated`; USING `((author_id = ( SELECT auth.uid() AS uid)) AND (status = 'pending'::scheduled_message_status))`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.
- Policy `Authors can view their own scheduled messages`: PERMISSIVE SELECT TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### seasons — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can create seasons`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `is_club_admin(( SELECT auth.uid() AS uid), club_id)`.
- Policy `Club admins can delete draft seasons`: PERMISSIVE DELETE TO `authenticated`; USING `(is_club_admin(( SELECT auth.uid() AS uid), club_id) AND (status = 'draft'::season_status))`; WITH CHECK `<none>`.
- Policy `Club admins can update seasons`: PERMISSIVE UPDATE TO `authenticated`; USING `is_club_admin(( SELECT auth.uid() AS uid), club_id)`; WITH CHECK `is_club_admin(( SELECT auth.uid() AS uid), club_id)`.
- Policy `Club members can view seasons`: PERMISSIVE SELECT TO `authenticated`; USING `(is_club_member(( SELECT auth.uid() AS uid), club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `<none>`.

#### sponsor_analytics — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can insert sponsor analytics`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) IS NOT NULL)`.
- Policy `Club admins can view sponsor analytics`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM (sponsors s      JOIN user_roles ur ON (((ur.club_id = s.club_id) AND (ur.role = 'club_admin'::app_role))))   WHERE ((s.id = sponsor_analytics.sponsor_id) AND (ur.user_id = ( SELECT auth.uid() AS uid)))))`; WITH CHECK `<none>`.

#### sponsors — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage sponsors`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Members can view sponsors`: PERMISSIVE SELECT TO `public`; USING `(is_club_member(( SELECT auth.uid() AS uid), club_id) OR is_team_member(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### sponsorship_packages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Anyone can view active sponsorship packages`: PERMISSIVE SELECT TO `public`; USING `(is_active = true)`; WITH CHECK `<none>`.

#### stripe_notification_outbox — RLS True; kind=r
- anon: .
- authenticated: .
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### stripe_subscription_event_state — RLS True; kind=r
- anon: .
- authenticated: .
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### stripe_webhook_events — RLS True; kind=r
- anon: .
- authenticated: .
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### system_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can update their own system messages`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view their own system messages`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### team_captains — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can assign team captains`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `can_manage_team_captains(( SELECT auth.uid() AS uid), team_id)`.
- Policy `Admins can remove team captains`: PERMISSIVE DELETE TO `authenticated`; USING `can_manage_team_captains(( SELECT auth.uid() AS uid), team_id)`; WITH CHECK `<none>`.
- Policy `Team members can view team captains`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = team_captains.team_id)))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_captains.team_id) AND has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid)))))`; WITH CHECK `<none>`.

#### team_creation_requests — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can create requests`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(requested_by = ( SELECT auth.uid() AS uid))`.
- Policy `Club admins can update requests`: PERMISSIVE UPDATE TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = team_creation_requests.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `<none>`.
- Policy `Club admins can view club requests`: PERMISSIVE SELECT TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = team_creation_requests.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role]))))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `<none>`.
- Policy `Users can view own requests`: PERMISSIVE SELECT TO `authenticated`; USING `(requested_by = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### team_folders — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage team folders`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = team_folders.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Club members can view team folders`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = team_folders.club_id))))`; WITH CHECK `<none>`.
- Policy `Team admins can manage folders`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id))`; WITH CHECK `<none>`.
- Policy `Team members can view folders`: PERMISSIVE SELECT TO `public`; USING `is_team_member(( SELECT auth.uid() AS uid), team_id)`; WITH CHECK `<none>`.

#### team_invites — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins and creators can view team invites`: PERMISSIVE SELECT TO `public`; USING `((created_by = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT t.club_id    FROM teams t   WHERE (t.id = team_invites.team_id)), NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Comp admins and captains can create player invite links`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((created_by = ( SELECT auth.uid() AS uid)) AND (role = ANY (ARRAY['player'::app_role, 'parent'::app_role])) AND can_invite_players_to_team(( SELECT auth.uid() AS uid), team_id))`.
- Policy `Comp admins and captains can view player invite links`: PERMISSIVE SELECT TO `authenticated`; USING `((role = ANY (ARRAY['player'::app_role, 'parent'::app_role])) AND can_invite_players_to_team(( SELECT auth.uid() AS uid), team_id))`; WITH CHECK `<none>`.
- Policy `Team and club admins can manage invites`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT t.club_id    FROM teams t   WHERE (t.id = team_invites.team_id)), NULL::uuid) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_invites.team_id) AND (t.created_by = ( SELECT auth.uid() AS uid))))))`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT t.club_id    FROM teams t   WHERE (t.id = team_invites.team_id)), NULL::uuid) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_invites.team_id) AND (t.created_by = ( SELECT auth.uid() AS uid))))))`.

#### team_member_exclusions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins view team exclusions`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(auth.uid(), 'app_admin'::app_role) OR has_role(auth.uid(), 'team_admin'::app_role, NULL::uuid, team_id) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_member_exclusions.team_id) AND has_role(auth.uid(), 'club_admin'::app_role, t.club_id)))))`; WITH CHECK `<none>`.

#### team_memberships — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club members can view team memberships`: PERMISSIVE SELECT TO `authenticated`; USING `(EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_memberships.team_id) AND (is_club_member(( SELECT auth.uid() AS uid), t.club_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- Policy `Roster managers can create memberships in editable seasons`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) AND is_season_editable(season_id))`.
- Policy `Roster managers can delete memberships in editable seasons`: PERMISSIVE DELETE TO `authenticated`; USING `(can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) AND is_season_editable(season_id))`; WITH CHECK `<none>`.
- Policy `Roster managers can update memberships in editable seasons`: PERMISSIVE UPDATE TO `authenticated`; USING `(can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) AND is_season_editable(season_id))`; WITH CHECK `<none>`.

#### team_messages — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authors can update own team messages`: PERMISSIVE UPDATE TO `authenticated`; USING `(author_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `(author_id = ( SELECT auth.uid() AS uid))`.
- Policy `Team members can delete own or admin delete team messages`: PERMISSIVE DELETE TO `authenticated`; USING `((author_id = ( SELECT auth.uid() AS uid)) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_messages.team_id) AND has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid)))))`; WITH CHECK `<none>`.
- Policy `Team members can send team messages`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((author_id = ( SELECT auth.uid() AS uid)) AND (is_team_member(( SELECT auth.uid() AS uid), team_id) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_messages.team_id) AND has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid)))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid)))`.
- Policy `Team members can view team messages`: PERMISSIVE SELECT TO `authenticated`; USING `(is_team_member(( SELECT auth.uid() AS uid), team_id) OR (EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_messages.team_id) AND has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid)))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### team_player_positions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage player positions`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = team_player_positions.team_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Team members can view player positions`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = team_player_positions.team_id))))`; WITH CHECK `<none>`.

#### team_sponsor_allocations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Anyone can view team sponsor allocations`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) IS NOT NULL)`; WITH CHECK `<none>`.
- Policy `Team admins can manage allocations`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM teams t   WHERE ((t.id = team_sponsor_allocations.team_id) AND (has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, t.club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, t.id)))))`; WITH CHECK `<none>`.

#### team_sponsors — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can manage team sponsors`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = team_sponsors.team_id) AND (user_roles.role = ANY (ARRAY['team_admin'::app_role, 'coach'::app_role, 'club_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Team members can view team sponsors`: PERMISSIVE SELECT TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.team_id = team_sponsors.team_id))))`; WITH CHECK `<none>`.

#### team_subscriptions — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Team admins and coaches can manage subscriptions`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'coach'::app_role, NULL::uuid, team_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`.
- Policy `Team members can view subscriptions`: PERMISSIVE SELECT TO `public`; USING `is_team_member(( SELECT auth.uid() AS uid), team_id)`; WITH CHECK `<none>`.

#### team_training_pauses — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `ttp_modify`: PERMISSIVE ALL TO `authenticated`; USING `(can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT teams.club_id    FROM teams   WHERE (teams.id = team_training_pauses.team_id)), NULL::uuid))`; WITH CHECK `(can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT teams.club_id    FROM teams   WHERE (teams.id = team_training_pauses.team_id)), NULL::uuid))`.
- Policy `ttp_select`: PERMISSIVE SELECT TO `authenticated`; USING `(is_team_member(( SELECT auth.uid() AS uid), team_id) OR can_manage_team_roster(( SELECT auth.uid() AS uid), team_id) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, ( SELECT teams.club_id    FROM teams   WHERE (teams.id = team_training_pauses.team_id)), NULL::uuid))`; WITH CHECK `<none>`.

#### teams — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Authenticated users can view all teams for join requests`: PERMISSIVE SELECT TO `authenticated`; USING `true`; WITH CHECK `<none>`.
- Policy `Club admins can create teams`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`.
- Policy `Club admins can delete teams`: PERMISSIVE DELETE TO `public`; USING `(has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Team admins can update teams`: PERMISSIVE UPDATE TO `authenticated`; USING `((EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.team_id = teams.id) AND (ur.role = 'team_admin'::app_role) AND (ur.via_captain = false)))) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### terms — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage terms`: PERMISSIVE ALL TO `public`; USING `(EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = ( SELECT auth.uid() AS uid)) AND (user_roles.club_id = terms.club_id) AND (user_roles.role = ANY (ARRAY['club_admin'::app_role, 'app_admin'::app_role])))))`; WITH CHECK `<none>`.
- Policy `Club members can view terms`: PERMISSIVE SELECT TO `public`; USING `is_club_member(( SELECT auth.uid() AS uid), club_id)`; WITH CHECK `<none>`.

#### training_session_drills — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Session drills: own delete`: PERMISSIVE DELETE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Session drills: own insert`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Session drills: own select`: PERMISSIVE SELECT TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Session drills: own update`: PERMISSIVE UPDATE TO `public`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### user_activity_logs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can read all activity`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users can insert own activity`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can read own activity`: PERMISSIVE SELECT TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.
- Policy `Users can update own activity`: PERMISSIVE UPDATE TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

#### user_club_points — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club staff view club user points`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR (EXISTS ( SELECT 1    FROM user_roles ur   WHERE ((ur.user_id = ( SELECT auth.uid() AS uid)) AND (ur.club_id = user_club_points.club_id) AND (ur.role = ANY (ARRAY['club_admin'::app_role, 'coach'::app_role, 'team_admin'::app_role]))))))`; WITH CHECK `<none>`.
- Policy `Users view own club points`: PERMISSIVE SELECT TO `authenticated`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### user_passkeys — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Users can manage their own passkeys`: PERMISSIVE ALL TO `public`; USING `(user_id = ( SELECT auth.uid() AS uid))`; WITH CHECK `<none>`.

#### user_presence — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `App admins can view all presence`: PERMISSIVE SELECT TO `authenticated`; USING `has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role)`; WITH CHECK `<none>`.
- Policy `Users can update own presence`: PERMISSIVE UPDATE TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can upsert own presence`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.
- Policy `Users can view own presence`: PERMISSIVE SELECT TO `authenticated`; USING `(( SELECT auth.uid() AS uid) = user_id)`; WITH CHECK `<none>`.

#### user_roles — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can manage roles`: PERMISSIVE ALL TO `public`; USING `(has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'club_admin'::app_role, club_id, NULL::uuid) OR has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'team_admin'::app_role, NULL::uuid, team_id) OR has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.
- Policy `Club creators can assign themselves as admin`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) AND (role = 'club_admin'::app_role) AND (club_id IS NOT NULL) AND (EXISTS ( SELECT 1    FROM clubs   WHERE ((clubs.id = user_roles.club_id) AND (clubs.created_by = ( SELECT auth.uid() AS uid))))))`.
- Policy `Comp admins and captains can add players to team`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((team_id IS NOT NULL) AND (role = ANY (ARRAY['player'::app_role, 'parent'::app_role])) AND (club_id = ( SELECT t.club_id    FROM teams t   WHERE (t.id = user_roles.team_id))) AND can_invite_players_to_team(( SELECT auth.uid() AS uid), team_id))`.
- Policy `Users can add roles via valid club invite`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) AND (club_id IS NOT NULL) AND (team_id IS NULL) AND ((EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.club_id = user_roles.club_id) AND (pi.role = user_roles.role) AND (pi.team_id IS NULL) AND (pi.invited_user_id = ( SELECT auth.uid() AS uid)) AND (pi.status = 'pending'::text)))) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.club_id = user_roles.club_id) AND (pi.role = user_roles.role) AND (pi.team_id IS NULL) AND (pi.invited_email IS NOT NULL) AND user_email_matches_invite(( SELECT auth.uid() AS uid), pi.invited_email) AND (pi.status = 'pending'::text)))) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.club_id = user_roles.club_id) AND (pi.role = user_roles.role) AND (pi.team_id IS NULL) AND ((pi.invited_user_id = ( SELECT auth.uid() AS uid)) OR user_email_matches_invite(( SELECT auth.uid() AS uid), pi.invited_email)) AND (pi.status = 'accepted'::text) AND (pi.accepted_at > (now() - '00:02:00'::interval)))))))`.
- Policy `Users can add roles via valid team invite`: PERMISSIVE INSERT TO `public`; USING `<none>`; WITH CHECK `((user_id = ( SELECT auth.uid() AS uid)) AND (team_id IS NOT NULL) AND (has_valid_team_invite_for_role(team_id, role) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.team_id = user_roles.team_id) AND (pi.role = user_roles.role) AND (pi.invited_user_id = ( SELECT auth.uid() AS uid)) AND (pi.status = 'pending'::text)))) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.team_id = user_roles.team_id) AND (pi.role = user_roles.role) AND (pi.invited_email IS NOT NULL) AND user_email_matches_invite(( SELECT auth.uid() AS uid), pi.invited_email) AND (pi.status = 'pending'::text)))) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.team_id = user_roles.team_id) AND (pi.role = user_roles.role) AND (pi.invited_user_id = ( SELECT auth.uid() AS uid)) AND (pi.status = 'accepted'::text) AND (pi.accepted_at > (now() - '00:02:00'::interval))))) OR (EXISTS ( SELECT 1    FROM pending_invites pi   WHERE ((pi.team_id = user_roles.team_id) AND (pi.role = user_roles.role) AND (pi.invited_email IS NOT NULL) AND user_email_matches_invite(( SELECT auth.uid() AS uid), pi.invited_email) AND (pi.status = 'accepted'::text) AND (pi.accepted_at > (now() - '00:02:00'::interval)))))))`.
- Policy `Users can delete their own roles`: PERMISSIVE DELETE TO `public`; USING `(user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid))`; WITH CHECK `<none>`.
- Policy `Users can view roles in their clubs/teams`: PERMISSIVE SELECT TO `public`; USING `((user_id = ( SELECT ( SELECT auth.uid() AS uid) AS uid)) OR is_club_member(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id) OR is_team_member(( SELECT ( SELECT auth.uid() AS uid) AS uid), team_id) OR has_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), 'app_admin'::app_role, NULL::uuid, NULL::uuid))`; WITH CHECK `<none>`.

#### vault_deletion_jobs — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### vault_drive_links — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins can create drive links`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `((has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role)) AND (created_by = ( SELECT auth.uid() AS uid)))`.
- Policy `Club admins can delete drive links`: PERMISSIVE DELETE TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role))`; WITH CHECK `<none>`.
- Policy `Club admins can update drive links`: PERMISSIVE UPDATE TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role))`; WITH CHECK `<none>`.
- Policy `Club admins can view drive links`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role) OR (created_by = ( SELECT auth.uid() AS uid)))`; WITH CHECK `<none>`.

#### vault_files — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins and committee can manage club vault files`: PERMISSIVE ALL TO `public`; USING `vault_user_has_file_club_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, folder_id, ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role])`; WITH CHECK `vault_user_has_file_club_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, folder_id, ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role])`.
- Policy `Competition admins manage competition vault files`: PERMISSIVE ALL TO `authenticated`; USING `((competition_id IS NOT NULL) AND is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id))`; WITH CHECK `((competition_id IS NOT NULL) AND is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id))`.
- Policy `Competition vault files restricted to competition admins`: RESTRICTIVE ALL TO `authenticated`; USING `(((competition_id IS NULL) AND ((folder_id IS NULL) OR (NOT (EXISTS ( SELECT 1    FROM vault_folders vf   WHERE ((vf.id = vault_files.folder_id) AND (vf.competition_id IS NOT NULL))))))) OR is_competition_role_admin(( SELECT auth.uid() AS uid), COALESCE(competition_id, ( SELECT vf.competition_id    FROM vault_folders vf   WHERE (vf.id = vault_files.folder_id)))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `(((competition_id IS NULL) AND ((folder_id IS NULL) OR (NOT (EXISTS ( SELECT 1    FROM vault_folders vf   WHERE ((vf.id = vault_files.folder_id) AND (vf.competition_id IS NOT NULL))))))) OR is_competition_role_admin(( SELECT auth.uid() AS uid), COALESCE(competition_id, ( SELECT vf.competition_id    FROM vault_folders vf   WHERE (vf.id = vault_files.folder_id)))) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`.
- Policy `League admins can manage mini league vault files`: PERMISSIVE ALL TO `public`; USING `((mini_league_id IS NOT NULL) AND vault_user_has_mini_league_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), mini_league_id, ARRAY['league_admin'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]))`; WITH CHECK `((mini_league_id IS NOT NULL) AND vault_user_has_mini_league_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), mini_league_id, ARRAY['league_admin'::app_role, 'club_admin'::app_role, 'app_admin'::app_role]))`.
- Policy `Members can view vault files`: PERMISSIVE SELECT TO `public`; USING `((vault_user_has_club_scope(( SELECT auth.uid() AS uid), club_id, team_id) OR ((team_id IS NOT NULL) AND vault_user_has_team_scope(( SELECT auth.uid() AS uid), team_id))) AND ((folder_id IS NULL) OR is_vault_admin(( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1    FROM vault_folders vf   WHERE ((vf.id = vault_files.folder_id) AND ((vf.restricted_roles IS NULL) OR (array_length(vf.restricted_roles, 1) IS NULL) OR user_matches_folder_role(( SELECT auth.uid() AS uid), vf.club_id, vf.team_id, vf.restricted_roles)) AND ((vf.chat_group_id IS NULL) OR can_access_chat_group(( SELECT auth.uid() AS uid), vf.chat_group_id)))))))`; WITH CHECK `<none>`.
- Policy `Team admins and coaches can manage team vault files`: PERMISSIVE ALL TO `public`; USING `(vault_user_has_file_team_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), team_id, folder_id, ARRAY['team_admin'::app_role, 'coach'::app_role]) AND ((folder_id IS NULL) OR (EXISTS ( SELECT 1    FROM vault_folders vf   WHERE ((vf.id = vault_files.folder_id) AND ((vf.restricted_roles IS NULL) OR (array_length(vf.restricted_roles, 1) IS NULL) OR user_matches_folder_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), vf.club_id, vf.team_id, vf.restricted_roles)) AND ((vf.chat_group_id IS NULL) OR can_access_chat_group(( SELECT ( SELECT auth.uid() AS uid) AS uid), vf.chat_group_id)))))))`; WITH CHECK `(vault_user_has_file_team_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), team_id, folder_id, ARRAY['team_admin'::app_role, 'coach'::app_role]) AND ((folder_id IS NULL) OR (EXISTS ( SELECT 1    FROM vault_folders vf   WHERE ((vf.id = vault_files.folder_id) AND ((vf.restricted_roles IS NULL) OR (array_length(vf.restricted_roles, 1) IS NULL) OR user_matches_folder_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), vf.club_id, vf.team_id, vf.restricted_roles)) AND ((vf.chat_group_id IS NULL) OR can_access_chat_group(( SELECT ( SELECT auth.uid() AS uid) AS uid), vf.chat_group_id)))))))`.

#### vault_folders — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Club admins and committee can manage club vault folders`: PERMISSIVE ALL TO `public`; USING `vault_user_has_club_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role])`; WITH CHECK `vault_user_has_club_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, ARRAY['club_admin'::app_role, 'committee_member'::app_role, 'app_admin'::app_role])`.
- Policy `Competition admins manage competition vault folders`: PERMISSIVE ALL TO `authenticated`; USING `((competition_id IS NOT NULL) AND is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id))`; WITH CHECK `((competition_id IS NOT NULL) AND is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id))`.
- Policy `Competition vault folders restricted to competition admins`: RESTRICTIVE ALL TO `authenticated`; USING `((competition_id IS NULL) OR is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`; WITH CHECK `((competition_id IS NULL) OR is_competition_role_admin(( SELECT auth.uid() AS uid), competition_id) OR has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role))`.
- Policy `Members can view vault folders`: PERMISSIVE SELECT TO `public`; USING `((vault_user_has_club_scope(( SELECT auth.uid() AS uid), club_id, team_id) OR ((team_id IS NOT NULL) AND vault_user_has_team_scope(( SELECT auth.uid() AS uid), team_id))) AND ((restricted_roles IS NULL) OR (array_length(restricted_roles, 1) IS NULL) OR is_vault_admin(( SELECT auth.uid() AS uid)) OR user_matches_folder_role(( SELECT auth.uid() AS uid), club_id, team_id, restricted_roles)) AND ((chat_group_id IS NULL) OR is_vault_admin(( SELECT auth.uid() AS uid)) OR can_access_chat_group(( SELECT auth.uid() AS uid), chat_group_id)))`; WITH CHECK `<none>`.
- Policy `Team admins and coaches can manage team vault folders`: PERMISSIVE ALL TO `public`; USING `((team_id IS NOT NULL) AND vault_user_has_team_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), team_id, ARRAY['team_admin'::app_role, 'coach'::app_role]) AND ((restricted_roles IS NULL) OR (array_length(restricted_roles, 1) IS NULL) OR user_matches_folder_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, restricted_roles)) AND ((chat_group_id IS NULL) OR can_access_chat_group(( SELECT ( SELECT auth.uid() AS uid) AS uid), chat_group_id)))`; WITH CHECK `((team_id IS NOT NULL) AND vault_user_has_team_role_scope(( SELECT ( SELECT auth.uid() AS uid) AS uid), team_id, ARRAY['team_admin'::app_role, 'coach'::app_role]) AND ((restricted_roles IS NULL) OR (array_length(restricted_roles, 1) IS NULL) OR user_matches_folder_role(( SELECT ( SELECT auth.uid() AS uid) AS uid), club_id, team_id, restricted_roles)) AND ((chat_group_id IS NULL) OR can_access_chat_group(( SELECT ( SELECT auth.uid() AS uid) AS uid), chat_group_id)))`.

#### vault_storage_reservations — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- No policies (views use underlying/view semantics; RLS tables deny client row access).

#### web_vitals — RLS True; kind=r
- anon: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- authenticated: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- service_role: DELETE, INSERT, SELECT, UPDATE, TRIGGER, TRUNCATE, REFERENCES.
- Policy `Admins can read vitals`: PERMISSIVE SELECT TO `authenticated`; USING `(has_role(( SELECT auth.uid() AS uid), 'app_admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'club_admin'::app_role))`; WITH CHECK `<none>`.
- Policy `Anon can insert vitals`: PERMISSIVE INSERT TO `anon`; USING `<none>`; WITH CHECK `(user_id IS NULL)`.
- Policy `Users can insert own vitals`: PERMISSIVE INSERT TO `authenticated`; USING `<none>`; WITH CHECK `(( SELECT auth.uid() AS uid) = user_id)`.

## 4. Storage
**Expected-by-code:** Literal/static expected bucket names: `app-ads`, `audit-log-exports`, `avatars`, `backups`, `chat-attachments`, `club-logos`, `competition-documents`, `competition-vault`, `photos`, `sponsor-logos`. Dynamic upload service also selects competition-vault for competition scope.

**Found-in-this-DB:** 8 buckets; metadata below. storage.objects/buckets have RLS; anon/authenticated/service have effective CRUD grants, with policies restricting object operations.

**GAP (essential blocker):** `competition-vault` absent: competition Vault uploads, signing and deletes fail. `audit-log-exports` absent and `write_audit_log` absent: optional audit exporter cannot run. Backups upload has no client INSERT policy; client-direct upload would fail.

**DIFFERENCE (non-blocking):** No bucket MIME allowlist configured. Public buckets bypass object SELECT policy for public delivery. Broad ownership-insufficient permissive policies permit much more than their names imply; uploads were not attempted.

| Bucket | Public | Max bytes | Expected |
|---|---|---|---|
| `app-ads` | True | not configured | frontend/src/pages/ManageAdsPage.tsx:132; frontend/src/pages/ManageAdsPage.tsx:136 |
| `avatars` | True | not configured | supabase/functions/admin-delete-account/index.ts:521; supabase/functions/cleanup-deleted-accounts/index.ts:231; frontend/src/pages/EditProfilePage.tsx:128 |
| `backups` | False | 5368709120 | supabase/functions/scheduled-backup/index.ts:71; supabase/functions/scheduled-backup/index.ts:98; supabase/functions/vault-backup-list/index.ts:77 |
| `chat-attachments` | False | not configured | supabase/functions/vault-backup-restore/index.ts:253; supabase/functions/vault-backup-restore/index.ts:262; frontend/src/components/chat/ChatImageInput.tsx:340 |
| `club-logos` | True | not configured | supabase/functions/permanent-delete-entity/index.ts:417; frontend/src/components/ClubRewardsManager.tsx:645; frontend/src/components/ClubRewardsManager.tsx:651 |
| `competition-documents` | False | 10485760 | supabase/functions/send-email/index.ts:152 |
| `photos` | False | not configured | supabase/functions/admin-delete-account/index.ts:472; supabase/functions/auto-purge-trash/index.ts:76; supabase/functions/cleanup-deleted-accounts/index.ts:184 |
| `sponsor-logos` | True | not configured | frontend/src/components/SponsorsManager.tsx:474; frontend/src/components/SponsorsManager.tsx:480 |

Per-bucket policy implications:
- `photos`: any authenticated user can read/update/delete all objects under several permissive policies; owner-scoped alternative DELETE does not narrow them. `avatars` similar broad update/delete; avatars are public.
- `chat-attachments`: “Authenticated users can upload chat attachments” has only bucket equality and role PUBLIC, with no auth check; because anon has INSERT grant, catalog predicates permit unauthenticated insert into that bucket (not exercised). Read uses `can_access_chat_attachment(name)`; delete has both broad authenticated and owner-scoped policies.
- `club-logos`: authenticated upload/update/delete without club ownership; public read. `sponsor-logos`: policies named Club admins only check non-null auth UID; UPDATE lacks a policy, so upsert-overwrite requiring UPDATE may fail.
- `competition-documents`: admin-only paths require first folder segment to be competition UUID; non-admin ordinary-member reads/signing fail. Maximum 10 MiB. `competition-vault` cannot be silently substituted with this bucket: path and audience contracts differ.
- `app-ads`: app-admin mutation predicates; public assets. `backups`: app-admin read/delete only, no client upload/update policy.

### Every storage policy
- `objects / App admins can delete ad images`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'app-ads'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / App admins can delete backups`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'backups'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / App admins can download backups`: SELECT TO `public` PERMISSIVE; USING `((bucket_id = 'backups'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / App admins can update ad images`: UPDATE TO `public` PERMISSIVE; USING `((bucket_id = 'app-ads'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / App admins can upload ad images`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'app-ads'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`.
- `objects / App admins can view ad images`: SELECT TO `authenticated` PERMISSIVE; USING `((bucket_id = 'app-ads'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / App admins can view backups`: SELECT TO `public` PERMISSIVE; USING `((bucket_id = 'backups'::text) AND (EXISTS ( SELECT 1    FROM user_roles   WHERE ((user_roles.user_id = auth.uid()) AND (user_roles.role = 'app_admin'::app_role)))))`; WITH CHECK `<none>`.
- `objects / Authenticated users can access avatars`: SELECT TO `public` PERMISSIVE; USING `((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Authenticated users can access photos`: SELECT TO `public` PERMISSIVE; USING `((bucket_id = 'photos'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Authenticated users can delete club logos`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'club-logos'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Authenticated users can update club logos`: UPDATE TO `public` PERMISSIVE; USING `((bucket_id = 'club-logos'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Authenticated users can upload avatars`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text))`.
- `objects / Authenticated users can upload chat attachments`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `(bucket_id = 'chat-attachments'::text)`.
- `objects / Authenticated users can upload chat-attachments`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'chat-attachments'::text) AND (auth.role() = 'authenticated'::text))`.
- `objects / Authenticated users can upload club logos`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'club-logos'::text) AND (auth.role() = 'authenticated'::text))`.
- `objects / Authenticated users can upload photos`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'photos'::text) AND (auth.role() = 'authenticated'::text))`.
- `objects / Authenticated users can view club logos`: SELECT TO `authenticated` PERMISSIVE; USING `(bucket_id = 'club-logos'::text)`; WITH CHECK `<none>`.
- `objects / Authenticated users can view photos`: SELECT TO `public` PERMISSIVE; USING `((bucket_id = 'photos'::text) AND (auth.uid() IS NOT NULL))`; WITH CHECK `<none>`.
- `objects / Authenticated users can view sponsor logos`: SELECT TO `authenticated` PERMISSIVE; USING `(bucket_id = 'sponsor-logos'::text)`; WITH CHECK `<none>`.
- `objects / Club admins can delete sponsor logos`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'sponsor-logos'::text) AND (auth.uid() IS NOT NULL))`; WITH CHECK `<none>`.
- `objects / Club admins can upload sponsor logos`: INSERT TO `public` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'sponsor-logos'::text) AND (auth.uid() IS NOT NULL))`.
- `objects / Competition admins delete competition documents`: DELETE TO `authenticated` PERMISSIVE; USING `((bucket_id = 'competition-documents'::text) AND is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid))`; WITH CHECK `<none>`.
- `objects / Competition admins read competition documents`: SELECT TO `authenticated` PERMISSIVE; USING `((bucket_id = 'competition-documents'::text) AND is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid))`; WITH CHECK `<none>`.
- `objects / Competition admins update competition documents`: UPDATE TO `authenticated` PERMISSIVE; USING `((bucket_id = 'competition-documents'::text) AND is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid))`; WITH CHECK `<none>`.
- `objects / Competition admins upload competition documents`: INSERT TO `authenticated` PERMISSIVE; USING `<none>`; WITH CHECK `((bucket_id = 'competition-documents'::text) AND is_competition_admin(auth.uid(), ((storage.foldername(name))[1])::uuid))`.
- `objects / Users can delete avatars`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Users can delete chat-attachments`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'chat-attachments'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Users can delete own chat attachments`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'chat-attachments'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))`; WITH CHECK `<none>`.
- `objects / Users can delete own photos`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'photos'::text) AND ((auth.uid())::text = (storage.foldername(name))[1]))`; WITH CHECK `<none>`.
- `objects / Users can delete photos`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'photos'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Users can delete their own avatars`: DELETE TO `public` PERMISSIVE; USING `((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL))`; WITH CHECK `<none>`.
- `objects / Users can update avatars`: UPDATE TO `public` PERMISSIVE; USING `((bucket_id = 'avatars'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Users can update photos`: UPDATE TO `public` PERMISSIVE; USING `((bucket_id = 'photos'::text) AND (auth.role() = 'authenticated'::text))`; WITH CHECK `<none>`.
- `objects / Users can update their own avatars`: UPDATE TO `public` PERMISSIVE; USING `((bucket_id = 'avatars'::text) AND (auth.uid() IS NOT NULL))`; WITH CHECK `<none>`.
- `objects / Users can view chat attachments in their clubs`: SELECT TO `authenticated` PERMISSIVE; USING `((bucket_id = 'chat-attachments'::text) AND can_access_chat_attachment(name))`; WITH CHECK `<none>`.

## 5. Realtime
**Expected-by-code:** Actual parsed `.on("postgres_changes",...)` literal subscriptions: `active_games`, `app_settings`, `broadcast_messages`, `chat_group_unread`, `chat_pinned_vault`, `club_admin_messages`, `club_messages`, `club_subscriptions`, `competition_admin_messages`, `direct_messages`, `group_messages`, `member_payments`, `message_reactions`, `message_reads`, `notifications`, `photo_comments`, `photo_reactions`, `photo_views`, `photos`, `pinned_messages`, `poll_votes`, `polls`, `schedule_broadcasts`, `team_messages`. Dynamic/shared abstraction targets require further runtime resolution.

**Found-in-this-DB:** supabase_realtime publication contains exactly 20 tables: `app_settings`, `broadcast_messages`, `chat_group_unread`, `club_admin_messages`, `club_messages`, `competition_admin_messages`, `direct_messages`, `group_messages`, `message_reactions`, `message_reads`, `notifications`, `photo_comments`, `photo_reactions`, `photo_views`, `photos`, `pinned_messages`, `poll_votes`, `polls`, `schedule_broadcasts`, `team_messages`.

**GAP (essential blocker):** Subscribed tables not published: `active_games`, `chat_pinned_vault`, `club_subscriptions`, `member_payments`. active_games affects live pitch-board updates; chat_pinned_vault and club_subscriptions affect immediate state propagation. member_payments is also missing as a DB table; inspect legacy callback before activation.

**DIFFERENCE (non-blocking):** Hybrid also has a custom ICP/WebSocket transport (`live/wsRealtime.ts`); publication gaps apply to Supabase provider, not proof that canister transport fails. Poll/chat core subscriptions are published. No realtime messages were generated.

| Subscription | Published | Source |
|---|---|---|
| `active_games` | **NO** | frontend/src/components/chat/BoardLinkCard.tsx:39; frontend/src/hooks/useRemoteFillInSync.ts:133; frontend/src/pages/AdminActiveGamesPage.tsx:257 |
| `app_settings` | yes | frontend/src/hooks/useChatBasicChunkSize.ts:56; frontend/src/hooks/useChatRecapGloballyEnabled.ts:48; frontend/src/hooks/useChatVirtualizationEnabled.ts:62; frontend/src/hooks/useFreeClubPollingEnabled.ts:45; frontend/src/lib/notificationPrefetchFlag.ts:58 |
| `broadcast_messages` | yes | frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/MessagesPage.tsx:1351 |
| `chat_group_unread` | yes | frontend/src/hooks/useGroupChatUnreadCache.ts:84 |
| `chat_pinned_vault` | **NO** | frontend/src/hooks/useChatPinnedVault.ts:94 |
| `club_admin_messages` | yes | frontend/src/pages/ClubAdminChatPage.tsx:1246; frontend/src/pages/ClubAdminChatPage.tsx:1246 |
| `club_messages` | yes | frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/MessagesPage.tsx:1351 |
| `club_subscriptions` | **NO** | frontend/src/pages/ClubUpgradePage.tsx:348 |
| `competition_admin_messages` | yes | frontend/src/pages/CompetitionAdminChatPage.tsx:90 |
| `direct_messages` | yes | frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/MessagesPage.tsx:1351 |
| `group_messages` | yes | frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/hooks/useGroupChatUnreadCache.ts:135; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/MessagesPage.tsx:1351 |
| `member_payments` | **NO** | frontend/src/lib/memberCheckout.ts:150 |
| `message_reactions` | yes | frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/features/messaging/thread/useGroupRealtimeUpdates.ts:95; frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/BroadcastChatPage.tsx:786; frontend/src/pages/ClubAdminChatPage.tsx:1246; frontend/src/pages/ClubAdminChatPage.tsx:1246; frontend/src/pages/ClubAdminChatPage.tsx:1246; frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/ClubChatPage.tsx:1282; frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/DirectMessagePage.tsx:1471; frontend/src/pages/TeamChatPage.tsx:1369; frontend/src/pages/TeamChatPage.tsx:1369; frontend/src/pages/TeamChatPage.tsx:1369 |
| `message_reads` | yes | frontend/src/hooks/useGroupChatUnreadCache.ts:145; frontend/src/hooks/useMessageReads.ts:379; frontend/src/hooks/useRealtimePerfSampler.ts:68 |
| `notifications` | yes | frontend/src/hooks/useAuth.tsx:1005; frontend/src/hooks/useAuth.tsx:1005; frontend/src/hooks/useAuth.tsx:1005; frontend/src/hooks/useRealtimePerfSampler.ts:59; frontend/src/pages/NotificationsPage.tsx:376; frontend/src/pages/NotificationsPage.tsx:376; frontend/src/pages/NotificationsPage.tsx:376 |
| `photo_comments` | yes | frontend/src/features/media/useMediaRealtime.ts:41; frontend/src/pages/MediaPage.tsx:996 |
| `photo_reactions` | yes | frontend/src/features/media/useMediaRealtime.ts:41; frontend/src/pages/MediaPage.tsx:996 |
| `photo_views` | yes | frontend/src/hooks/usePhotoViews.ts:234 |
| `photos` | yes | frontend/src/features/media/useMediaRealtime.ts:24; frontend/src/pages/MediaPage.tsx:708 |
| `pinned_messages` | yes | frontend/src/hooks/usePinnedMessages.ts:133 |
| `poll_votes` | yes | frontend/src/components/chat/PollCard.tsx:54 |
| `polls` | yes | frontend/src/components/chat/PollCard.tsx:54 |
| `schedule_broadcasts` | yes | frontend/src/lib/scheduleBroadcast.ts:96 |
| `team_messages` | yes | frontend/src/components/team/TeamChatPreview.tsx:80; frontend/src/components/team/TeamChatPreview.tsx:80; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1040; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/MessagesPage.tsx:1351; frontend/src/pages/TeamChatPage.tsx:1369; frontend/src/pages/TeamChatPage.tsx:1369; frontend/src/pages/TeamChatPage.tsx:1369 |

## 6. Auth
**Expected-by-code:** Email sign-up/sign-in/recovery and guarded Google OAuth; Google should remain default-off. Native recovery redirects to igniteclubhq.app; web uses current origin. Internet Identity is separate from Supabase providers.

**Found-in-this-DB:** Successful DEV GET /auth/v1/settings with public frontend apikey: email=true; Google key present=false; all other external provider flags below. Signup enabled; email auto-confirm false; phone auto-confirm false; SAML false.

**GAP (essential blocker):** Hosted Site URL/redirect allowlist and custom email-template names/content are UNVERIFIED; native recovery and web invite/signup redirects cannot be compatibility-cleared from source alone.

**DIFFERENCE (non-blocking):** Google is correctly present as a supported provider flag and disabled. This does NOT prove Google OAuth client credentials are configured. Email confirmation is required by current flags. No email was sent, account read or auth setting changed.

- anonymous_users: disabled.
- apple: disabled.
- azure: disabled.
- bitbucket: disabled.
- discord: disabled.
- facebook: disabled.
- snapchat: disabled.
- figma: disabled.
- fly: disabled.
- github: disabled.
- gitlab: disabled.
- google: disabled.
- keycloak: disabled.
- kakao: disabled.
- linkedin: disabled.
- linkedin_oidc: disabled.
- notion: disabled.
- spotify: disabled.
- slack: disabled.
- slack_oidc: disabled.
- workos: disabled.
- twitch: disabled.
- twitter: disabled.
- email: enabled.
- phone: disabled.
- zoom: disabled.
- `disable_signup=false`, `mailer_autoconfirm=false`, `phone_autoconfirm=false`, `saml_enabled=false`.
- Code-triggered standard Supabase email categories: signup/confirmation (`useAuth.tsx:1155`), recovery (`ResetPasswordPage.tsx:310`), verification/recovery OTP handling. These are categories, not verified hosted custom template names. Application edge emails `send-welcome-email`, `send-welcome-email-icp`, `send-eoi-invite`, `send-email` are separate from Auth templates.
- Expected redirects: web `${window.location.origin}/` and `/auth?next=…` for signup pending destinations; recovery `${window.location.origin}/verify-reset-code?email=…`; native `https://igniteclubhq.app/verify-reset-code?email=…`. Google native code contains a `https://reference.invalid` placeholder, but Google is disabled/native button hidden; non-blocking only while disabled. No real user email/query values collected.
- Hosted Site URL, additional redirect URLs, template identifiers and SMTP configuration: **not available to this read-only interface**; no secret-bearing admin settings response was fetched.

## 7. Edge functions
**Expected-by-code:** 57 literal direct frontend invoke targets plus wrapper/dynamic targets; expected source functions/env names below.

**Found-in-this-DB:** Repository source declarations are available; **deployed DEV function list and deployed-source revisions are UNVERIFIED**. SQL catalogs do not inventory Edge deployments; config.toml entries do not prove deployment.

**GAP (essential blocker):** Must obtain a redacted DEV deployment inventory and reconcile all called names before functional approval. Missing deployed functions cannot be positively named on current evidence. Missing edge SQL dependencies are confirmed below.

**DIFFERENCE (non-blocking):** Source env name requirement is not evidence that the secret is configured. No secrets endpoint was called, no env values collected, no function invoked/deployed. Canister/relay wiring likewise unverified.

### Frontend Edge call targets
- `admin-delete-account`: frontend/src/pages/ManageUsersPage.tsx:625; deployed status **UNVERIFIED**.
- `admin-set-temp-password`: frontend/src/pages/AdminTempPasswordPage.tsx:111; deployed status **UNVERIFIED**.
- `assemble-catchup`: frontend/src/hooks/useChatCatchUp.ts:287; frontend/src/components/chat/GlobalChatRecapSheet.tsx:168; deployed status **UNVERIFIED**.
- `association-create-club-event`: frontend/src/components/AssociationEventsPanel.tsx:197; deployed status **UNVERIFIED**.
- `auto-post-news-to-chat`: frontend/src/components/news/ClubNewsComposer.tsx:338; deployed status **UNVERIFIED**.
- `cancel-subscription`: frontend/src/pages/ClubDetailPage.tsx:1262; frontend/src/pages/ClubUpgradePage.tsx:499; frontend/src/pages/UpgradeProPage.tsx:386; deployed status **UNVERIFIED**.
- `chat-photo-gallery-reminders`: frontend/src/pages/AdminChatPhotoRemindersPage.tsx:148; deployed status **UNVERIFIED**.
- `check-iap-authorization`: frontend/src/hooks/useInAppPurchase.ts:80; deployed status **UNVERIFIED**.
- `check-pending-subs`: frontend/src/lib/triggerPitchCheck.ts:45; frontend/src/components/pitch/GlobalSubMonitor.tsx:246; deployed status **UNVERIFIED**.
- `cleanup-push-subscriptions`: frontend/src/pages/PushAnalyticsPage.tsx:339; deployed status **UNVERIFIED**.
- `confirm-event-payment`: frontend/src/hooks/useEventPaymentFlow.ts:117; deployed status **UNVERIFIED**.
- `create-storage-checkout`: frontend/src/components/StoragePurchaseDialog.tsx:114; deployed status **UNVERIFIED**.
- `create-subscription-checkout`: frontend/src/pages/ClubUpgradePage.tsx:634; frontend/src/pages/UpgradeProPage.tsx:485; deployed status **UNVERIFIED**.
- `delete-account`: frontend/src/pages/AccountPage.tsx:71; deployed status **UNVERIFIED**.
- `drive-folder-sync`: frontend/src/components/vault/LinkDriveFolderDialog.tsx:249; frontend/src/components/vault/LinkDriveFolderDialog.tsx:352; frontend/src/components/vault/LinkDriveFolderDialog.tsx:387; deployed status **UNVERIFIED**.
- `get-signed-photo-url`: frontend/src/hooks/useSignedPhotoUrl.ts:152; deployed status **UNVERIFIED**.
- `google-places-search`: frontend/src/components/AddressAutocomplete.tsx:188; frontend/src/components/AddressAutocomplete.tsx:241; frontend/src/components/AddressAutocomplete.tsx:396; deployed status **UNVERIFIED**.
- `manage-stripe-config`: frontend/src/pages/AppStripeSettingsPage.tsx:70; frontend/src/pages/AppStripeSettingsPage.tsx:97; frontend/src/pages/AppStripeSettingsPage.tsx:124; deployed status **UNVERIFIED**.
- `notify-event-note`: frontend/src/components/event/EventNoteSection.tsx:169; deployed status **UNVERIFIED**.
- `notify-join-request-decision`: frontend/src/components/chat/ChatGroupJoinRequests.tsx:85; frontend/src/components/chat/ChatGroupJoinRequests.tsx:113; deployed status **UNVERIFIED**.
- `passkey-authenticate`: frontend/src/hooks/usePasskey.ts:419; frontend/src/hooks/usePasskey.ts:458; deployed status **UNVERIFIED**.
- `passkey-register`: frontend/src/hooks/usePasskey.ts:285; frontend/src/hooks/usePasskey.ts:329; deployed status **UNVERIFIED**.
- `permanent-delete-entity`: frontend/src/pages/ClubDetailPage.tsx:1518; frontend/src/pages/TeamDetailPage.tsx:1467; deployed status **UNVERIFIED**.
- `permanent-delete-photos`: frontend/src/lib/vaultDelete.ts:120; frontend/src/features/vault/vaultMutationRepository.ts:312; frontend/src/features/vault/vaultMutationRepository.ts:335; deployed status **UNVERIFIED**.
- `pitch-timer-event`: frontend/src/lib/serverTimer.ts:186; deployed status **UNVERIFIED**.
- `playhq-materialise-team-events`: supabase/functions/playhq-sync-club/index.ts:225; supabase/functions/playhq-sync/index.ts:290; frontend/src/components/PlayHQTeamLinkCard.tsx:224; deployed status **UNVERIFIED**.
- `playhq-sync`: supabase/functions/playhq-sync-club/index.ts:134; supabase/functions/playhq-sync-cron/index.ts:37; frontend/src/features/competitions/playhqRepository.ts:21; deployed status **UNVERIFIED**.
- `post-game-photo-prompts`: frontend/src/pages/AppSettingsPage.tsx:129; deployed status **UNVERIFIED**.
- `prefetch-user-data`: frontend/src/lib/prefetchData.ts:76; deployed status **UNVERIFIED**.
- `process-message-notifications`: frontend/src/components/UploadPhotoSheet.tsx:1028; deployed status **UNVERIFIED**.
- `public-minimum-app-version`: frontend/src/components/NativeAppUpdatePrompt.tsx:64; deployed status **UNVERIFIED**.
- `realtime-stats`: frontend/src/pages/RealtimeHealthPage.tsx:121; deployed status **UNVERIFIED**.
- `recover-account`: frontend/src/components/AccountRecoveryBanner.tsx:73; deployed status **UNVERIFIED**.
- `resolve-drive-titles`: frontend/src/features/vault/vaultDriveService.ts:32; deployed status **UNVERIFIED**.
- `scheduled-messages-write`: frontend/src/hooks/useScheduledMessages.ts:247; deployed status **UNVERIFIED**.
- `send-association-broadcast`: frontend/src/pages/AssociationDetailPage.tsx:461; deployed status **UNVERIFIED**.
- `send-club-announcement`: frontend/src/components/ClubAnnouncementDialog.tsx:145; deployed status **UNVERIFIED**.
- `send-competition-broadcast`: frontend/src/pages/CompetitionDetailPage.tsx:1408; deployed status **UNVERIFIED**.
- `send-email`: supabase/functions/check-push-failure-rate/index.ts:230; supabase/functions/send-duty-notification-email/index.ts:156; supabase/functions/send-eoi-invite/index.ts:92; supabase/functions/send-event-reminders/index.ts:20; deployed status **UNVERIFIED**.
- `send-eoi-invite`: supabase/functions/eoi-webhook/index.ts:146; frontend/src/hooks/useEoiPolish.ts:17; frontend/src/hooks/useEoiPolish.ts:46; frontend/src/pages/PublicEoiFormPage.tsx:199; deployed status **UNVERIFIED**.
- `send-event-view-reminder`: frontend/src/components/event/AttendanceSection.tsx:262; deployed status **UNVERIFIED**.
- `send-fcm-notification`: supabase/functions/send-push-notification/index.ts:431; deployed status **UNVERIFIED**.
- `send-feedback-email`: frontend/src/components/FeedbackDialog.tsx:50; deployed status **UNVERIFIED**.
- `send-pitch-board-notification-email`: supabase/functions/check-pending-subs/index.ts:179; deployed status **UNVERIFIED**.
- `send-points-notification-email`: supabase/functions/process-duty-points/index.ts:186; supabase/functions/process-duty-points/index.ts:370; supabase/functions/process-duty-points/index.ts:535; frontend/src/lib/earlyRsvpPoints.ts:212; deployed status **UNVERIFIED**.
- `send-push-notification`: supabase/functions/auto-rsvp-push-cron/index.ts:245; supabase/functions/check-pending-subs/index.ts:145; supabase/functions/notify-game-kickoff/index.ts:169; supabase/functions/process-scheduled-messages/index.ts:111; deployed status **UNVERIFIED**.
- `send-update-reminder`: frontend/src/pages/SendUpdateReminderPage.tsx:371; frontend/src/pages/SendUpdateReminderPage.tsx:482; frontend/src/pages/SendUpdateReminderPage.tsx:505; frontend/src/pages/SendUpdateReminderPage.tsx:523; deployed status **UNVERIFIED**.
- `send-welcome-email`: frontend/src/pages/CompetitionDetailPage.tsx:551; frontend/src/pages/JoinTeamPage.tsx:1326; deployed status **UNVERIFIED**.
- `send-welcome-email-icp`: frontend/src/pages/CompetitionOfficialJoinPage.tsx:163; deployed status **UNVERIFIED**.
- `test-push-notification`: frontend/src/components/NativePushCard.tsx:171; frontend/src/pages/SettingsPage.tsx:474; deployed status **UNVERIFIED**.
- `vault-backup`: frontend/src/pages/ManageBackupsPage.tsx:102; deployed status **UNVERIFIED**.
- `vault-backup-list`: frontend/src/pages/ManageBackupsPage.tsx:90; deployed status **UNVERIFIED**.
- `vault-backup-restore`: frontend/src/pages/ManageBackupsPage.tsx:122; deployed status **UNVERIFIED**.
- `verify-iap-receipt`: frontend/src/components/StoragePurchaseDialog.tsx:372; frontend/src/hooks/useInAppPurchase.ts:160; frontend/src/pages/ClubUpgradePage.tsx:704; frontend/src/pages/UpgradeProPage.tsx:546; deployed status **UNVERIFIED**.
- `verify-iap-receipt-icp`: frontend/src/components/StoragePurchaseDialog.tsx:345; frontend/src/hooks/useInAppPurchase.ts:125; deployed status **UNVERIFIED**.
### Source functions and declared environment variable names (never values)
- `_shared`: `CRON_SECRET`, `OUTBOUND_COMMUNICATIONS_ENABLED`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `admin-delete-account`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `admin-set-temp-password`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `admin-update-email`: `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `assemble-catchup`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `association-create-club-event`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `audit-orphan-children`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auth-email-hook`: `LOVABLE_API_KEY`, `RESEND_API_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-default-rsvp-confirm-cron`: `AUTO_RSVP_DM_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-default-rsvp-maintenance-cron`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `SYSTEM_BOT_USER_ID`; source only, deployed status **UNVERIFIED**.
- `auto-post-event-to-chat`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-post-news-to-chat`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-purge-trash`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-rsvp-dm-cron`: `AUTO_RSVP_DM_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `auto-rsvp-push-cron`: `AUTO_RSVP_DM_CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `backfill-chat-vault-groups`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `cancel-subscription`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `chat-photo-gallery-reminders`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `check-iap-authorization`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `check-pending-subs`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `check-push-failure-rate`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `check-vapid-key`: `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; source only, deployed status **UNVERIFIED**.
- `cleanup-deleted-accounts`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `cleanup-old-notifications`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `cleanup-push-subscriptions`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `confirm-event-payment`: `IGNITE_PAYMENTS_SUPABASE_ANON_KEY`, `IGNITE_PAYMENTS_SUPABASE_SERVICE_ROLE_KEY`, `IGNITE_PAYMENTS_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `create-event-checkout`: `ALLOW_LOCAL_REDIRECTS`, `APP_ALLOWED_REDIRECT_ORIGINS`, `APP_PUBLIC_ORIGIN`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `create-member-payment-checkout`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `create-storage-checkout`: `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `create-subscription-checkout`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `delete-account`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `digest-messages`: `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `drive-folder-sync`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `eoi-webhook`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `expire-subscriptions`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `export-user-data`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `export-write-audit`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `fetch-link-preview`: no literal env getter names found; source only, deployed status **UNVERIFIED**.
- `generate-demo-data`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `get-signed-photo-url`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `giphy-search`: `GIPHY_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `google-drive-import`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `google-places-search`: `GOOGLE_PLACES_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `icp-llm-test`: no literal env getter names found; source only, deployed status **UNVERIFIED**.
- `manage-stripe-config`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `notify-event-note`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `notify-game-kickoff`: `GAME_KICKOFF_TEAM_ALLOWLIST`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `notify-join-request-decision`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `notify-new-member-events`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `passkey-authenticate`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `passkey-register`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `permanent-delete-entity`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `permanent-delete-photos`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `pitch-timer-event`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `pitch-timer-read`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `playhq-materialise-team-events`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `playhq-sync`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `playhq-sync-club`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `playhq-sync-cron`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `post-game-photo-prompts`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `prefetch-user-data`: `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-duty-points`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-event-notifications`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-message-notifications`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-push-delivery-queue`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-scheduled-messages`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-weekly-engagement-bonus`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `process-weekly-engagement-digest`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `public-club-events`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `public-club-teams`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `public-minimum-app-version`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `realtime-stats`: `SUPABASE_ANON_KEY`, `SUPABASE_PAT`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `reconcile-legacy-subscriptions`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `recover-account`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `resolve-drive-titles`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `retry-missed-push-notifications`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `scheduled-backup`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `scheduled-messages-write`: `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `secret-delete-user`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-association-broadcast`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-block-alert-email`: `RESEND_API_KEY`; source only, deployed status **UNVERIFIED**.
- `send-club-announcement`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-comment-report-email`: `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-competition-broadcast`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-duty-notification-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-email`: `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-engagement-reminders`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-enrolment-notification-email`: `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-eoi-invite`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-event-reminders`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-event-view-reminder`: `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-fcm-notification`: `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-feedback-email`: `RESEND_API_KEY`; source only, deployed status **UNVERIFIED**.
- `send-game-stats-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-invite-reminders`: `ANON_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-message-notification-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-message-report-email`: `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-new-club-alert`: `NEW_CLUB_ALERT_SECRET`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-photo-notification-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-photo-prompt-followup`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-photo-report-email`: `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-pitch-board-notification-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-points-notification-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-push-notification`: `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`; source only, deployed status **UNVERIFIED**.
- `send-renewal-reminders`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-reward-redeemed-email`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-storage-warnings`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-update-reminder`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-welcome-dm`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `send-welcome-email`: `RESEND_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `WELCOME_EMAIL_FROM`; source only, deployed status **UNVERIFIED**.
- `send-welcome-email-icp`: `CLUB_DOMAIN_CANISTER_ID`, `COMPETITION_DOMAIN_CANISTER_ID`, `ICP_HOST`, `RESEND_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `WELCOME_EMAIL_FROM`; source only, deployed status **UNVERIFIED**.
- `share-page`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `stripe-webhook`: `STRIPE_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `summarize-chat`: `GEMINI_API_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `summarize-chat-icp`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `sync-dispatch-credentials`: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `test-push-notification`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `vault-backup`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `vault-backup-list`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `vault-backup-restore`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `verify-iap-receipt`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `verify-iap-receipt-icp`: `APPLE_SHARED_SECRET`, `FCM_SERVICE_ACCOUNT_JSON`, `IAP_ATTESTATION_HMAC_SECRET`, `ICP_HOST`, `ICP_PUSH_WORKER_SEED`, `NOTIFICATION_QUEUE_CANISTER_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
- `wipe-club-vault`: `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`; source only, deployed status **UNVERIFIED**.
### Confirmed absent SQL dependencies of edge source

## 8. Triggers, extensions and custom types
**Expected-by-code:** Auth/profile lifecycle, audited hard deletes, competition result/event sync, notification dispatch, updated-at helpers and staged hybrid migrations rely on triggers/functions and enums. Backend Motoko variants are not SQL enums.

**Found-in-this-DB:** 221 non-internal public/auth-user triggers inventoried, enums below; installed extensions listed. No trigger body executed or raw body export attempted.

**GAP (essential blocker):** Missing new RPC/table support indicates staged hybrid database work is not fully represented here. Any trigger expected to support absent objects cannot be assumed installed merely because its SQL appears in source.

**DIFFERENCE (non-blocking):** Existing trigger set must be preserved; this report does not recommend deleting internal/service-only objects. Core UUID and JSON features supported; live database defaults/indexes and canister stable migrations are not exhaustively semantically verified.

### Installed extensions
- `hypopg` 1.4.1.
- `index_advisor` 0.2.0.
- `pg_cron` 1.6.4.
- `pg_net` 0.19.5.
- `pg_stat_statements` 1.11.
- `pg_trgm` 1.6.
- `pgcrypto` 1.3.
- `plpgsql` 1.0.
- `supabase_vault` 0.3.1.
- `uuid-ossp` 1.1.
### Public enums
- `app_role`: `basic_user`, `club_admin`, `team_admin`, `coach`, `player`, `parent`, `app_admin`, `league_admin`, `committee_member`, `association_admin`, `competition_admin`.
- `club_subscription_plan`: `starter`, `standard`, `unlimited`.
- `duty_status`: `open`, `completed`.
- `enrolment_status`: `enrolled`, `waitlisted`, `withdrawn`.
- `eoi_source`: `website`, `app`, `admin`.
- `eoi_status`: `invited`, `submitted`, `preferences_completed`, `allocated`, `confirmed`, `registered`, `withdrawn`.
- `event_type`: `game`, `training`, `social`, `mini_league`.
- `feedback_status`: `open`, `in_progress`, `resolved`.
- `message_digest_classification`: `action`, `question`, `decision`, `social`, `info`.
- `message_digest_source`: `club`, `team`, `group`.
- `poll_chat_type`: `team`, `club`, `group`, `broadcast`, `club_admin`.
- `role_request_status`: `pending`, `approved`, `denied`.
- `rsvp_status`: `going`, `maybe`, `not_going`.
- `scheduled_chat_type`: `team`, `club`, `group`, `direct`, `club_admin`, `broadcast`.
- `scheduled_message_recurrence`: `none`, `daily`, `weekly`, `monthly`.
- `scheduled_message_status`: `pending`, `sent`, `failed`, `cancelled`.
- `season_status`: `draft`, `active`, `closed`, `archived`.
- `sponsor_tier`: `platinum`, `gold`, `silver`, `bronze`.
- `team_lifecycle_status`: `draft`, `active`, `archived`.
- `team_membership_role`: `player`, `coach`, `team_admin`.
- `team_membership_status`: `active`, `removed`.
Generated enum-value contracts are not fully compared semantically; runtime role mapping may use strings/principals independently. No custom public domain types were returned.

### Complete trigger inventory
- `auth.users / on_auth_user_created`: enabled=O; `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()`.
- `auth.users / trg_auto_claim_eois`: enabled=O; `CREATE TRIGGER trg_auto_claim_eois AFTER INSERT OR UPDATE OF email ON auth.users FOR EACH ROW EXECUTE FUNCTION auto_claim_eois_by_email()`.
- `public.active_games / trg_log_active_game_write`: enabled=O; `CREATE TRIGGER trg_log_active_game_write AFTER INSERT OR UPDATE ON public.active_games FOR EACH ROW EXECUTE FUNCTION log_active_game_write()`.
- `public.admob_config / update_admob_config_updated_at`: enabled=O; `CREATE TRIGGER update_admob_config_updated_at BEFORE UPDATE ON public.admob_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.app_ads / trg_app_ads_validate_payload`: enabled=O; `CREATE TRIGGER trg_app_ads_validate_payload BEFORE INSERT OR UPDATE ON public.app_ads FOR EACH ROW EXECUTE FUNCTION app_ads_validate_payload()`.
- `public.app_settings / update_app_settings_updated_at`: enabled=O; `CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON public.app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.blocked_users / on_user_blocked_trigger`: enabled=O; `CREATE TRIGGER on_user_blocked_trigger AFTER INSERT ON public.blocked_users FOR EACH ROW EXECUTE FUNCTION on_user_blocked()`.
- `public.broadcast_messages / on_broadcast_message_created_trigger`: enabled=O; `CREATE TRIGGER on_broadcast_message_created_trigger AFTER INSERT ON public.broadcast_messages FOR EACH ROW EXECUTE FUNCTION on_broadcast_message_created()`.
- `public.broadcast_messages / on_broadcast_message_deleted`: enabled=O; `CREATE TRIGGER on_broadcast_message_deleted BEFORE DELETE ON public.broadcast_messages FOR EACH ROW EXECUTE FUNCTION log_broadcast_message_deletion()`.
- `public.broadcast_messages / tg_broadcast_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_broadcast_messages_stamp_edited_at BEFORE UPDATE OF text ON public.broadcast_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.business_matches / update_sponsor_matches_updated_at`: enabled=O; `CREATE TRIGGER update_sponsor_matches_updated_at BEFORE UPDATE ON public.business_matches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.business_profiles / update_sponsor_profiles_updated_at`: enabled=O; `CREATE TRIGGER update_sponsor_profiles_updated_at BEFORE UPDATE ON public.business_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.chat_group_join_requests / trg_touch_chat_group_join_requests`: enabled=O; `CREATE TRIGGER trg_touch_chat_group_join_requests BEFORE UPDATE ON public.chat_group_join_requests FOR EACH ROW EXECUTE FUNCTION touch_chat_group_join_requests_updated_at()`.
- `public.chat_groups / on_chat_group_created_add_creator`: enabled=O; `CREATE TRIGGER on_chat_group_created_add_creator AFTER INSERT ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION add_creator_to_personal_group()`.
- `public.chat_groups / on_chat_group_created_make_vault_folder`: enabled=O; `CREATE TRIGGER on_chat_group_created_make_vault_folder AFTER INSERT ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION on_chat_group_create_vault_folder()`.
- `public.chat_groups / on_chat_group_deleted_archive_vault_folder`: enabled=O; `CREATE TRIGGER on_chat_group_deleted_archive_vault_folder AFTER UPDATE OF deleted_at ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION on_chat_group_deleted_archive_vault_folder()`.
- `public.chat_groups / on_chat_group_hard_deleted_archive_vault_folder`: enabled=O; `CREATE TRIGGER on_chat_group_hard_deleted_archive_vault_folder BEFORE DELETE ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION on_chat_group_hard_deleted_archive_vault_folder()`.
- `public.chat_groups / on_chat_group_renamed_sync_vault_folder`: enabled=O; `CREATE TRIGGER on_chat_group_renamed_sync_vault_folder AFTER UPDATE OF name ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION on_chat_group_renamed_sync_vault_folder()`.
- `public.chat_groups / trg_chat_groups_join_policy_default`: enabled=O; `CREATE TRIGGER trg_chat_groups_join_policy_default BEFORE INSERT OR UPDATE OF category, membership_mode, club_id, team_id, mini_league_id, join_policy ON public.chat_groups FOR EACH ROW EXECUTE FUNCTION set_chat_group_join_policy_default()`.
- `public.chat_pinned_vault / chat_pinned_vault_set_updated_at`: enabled=O; `CREATE TRIGGER chat_pinned_vault_set_updated_at BEFORE UPDATE ON public.chat_pinned_vault FOR EACH ROW EXECUTE FUNCTION chat_pinned_vault_touch_updated_at()`.
- `public.child_mini_league_assignments / trg_notify_new_mini_league_assignment`: enabled=O; `CREATE TRIGGER trg_notify_new_mini_league_assignment AFTER INSERT ON public.child_mini_league_assignments FOR EACH ROW EXECUTE FUNCTION notify_new_mini_league_assignment()`.
- `public.child_team_assignments / trg_prevent_duplicate_child_on_team`: enabled=O; `CREATE TRIGGER trg_prevent_duplicate_child_on_team BEFORE INSERT ON public.child_team_assignments FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_child_on_team()`.
- `public.child_training_defaults / trg_apply_training_default_forward`: enabled=O; `CREATE TRIGGER trg_apply_training_default_forward AFTER INSERT OR UPDATE OF default_status, deleted_at ON public.child_training_defaults FOR EACH ROW EXECUTE FUNCTION apply_training_default_forward()`.
- `public.child_training_defaults / trg_child_training_defaults_updated`: enabled=O; `CREATE TRIGGER trg_child_training_defaults_updated BEFORE UPDATE ON public.child_training_defaults FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.children / prevent_duplicate_child_for_parent_trg`: enabled=O; `CREATE TRIGGER prevent_duplicate_child_for_parent_trg BEFORE INSERT ON public.children FOR EACH ROW EXECUTE FUNCTION prevent_duplicate_child_for_parent()`.
- `public.children / trg_sync_child_parent_to_guardian`: enabled=O; `CREATE TRIGGER trg_sync_child_parent_to_guardian AFTER INSERT OR UPDATE OF parent_id ON public.children FOR EACH ROW EXECUTE FUNCTION sync_child_parent_to_guardian()`.
- `public.class_enrolments / on_class_enrolment_notify`: enabled=O; `CREATE TRIGGER on_class_enrolment_notify AFTER INSERT OR UPDATE OF status ON public.class_enrolments FOR EACH ROW EXECUTE FUNCTION notify_enrolment_email()`.
- `public.class_enrolments / trg_promote_waitlisted_on_withdrawal`: enabled=O; `CREATE TRIGGER trg_promote_waitlisted_on_withdrawal AFTER UPDATE ON public.class_enrolments FOR EACH ROW EXECUTE FUNCTION promote_waitlisted_on_withdrawal()`.
- `public.class_enrolments / trg_validate_class_enrolment_participant`: enabled=O; `CREATE TRIGGER trg_validate_class_enrolment_participant BEFORE INSERT OR UPDATE ON public.class_enrolments FOR EACH ROW EXECUTE FUNCTION validate_class_enrolment_participant()`.
- `public.class_enrolments / update_class_enrolments_updated_at`: enabled=O; `CREATE TRIGGER update_class_enrolments_updated_at BEFORE UPDATE ON public.class_enrolments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_admin_messages / on_club_admin_message_created_trigger`: enabled=O; `CREATE TRIGGER on_club_admin_message_created_trigger AFTER INSERT ON public.club_admin_messages FOR EACH ROW EXECUTE FUNCTION on_club_admin_message_created()`.
- `public.club_admin_messages / tg_club_admin_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_club_admin_messages_stamp_edited_at BEFORE UPDATE OF text ON public.club_admin_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.club_dm_settings / update_club_dm_settings_updated_at`: enabled=O; `CREATE TRIGGER update_club_dm_settings_updated_at BEFORE UPDATE ON public.club_dm_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_join_requests / update_club_join_requests_updated_at`: enabled=O; `CREATE TRIGGER update_club_join_requests_updated_at BEFORE UPDATE ON public.club_join_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_links / club_links_set_updated_at`: enabled=O; `CREATE TRIGGER club_links_set_updated_at BEFORE UPDATE ON public.club_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_messages / club_messages_preview_after_delete`: enabled=O; `CREATE TRIGGER club_messages_preview_after_delete AFTER DELETE ON public.club_messages FOR EACH ROW EXECUTE FUNCTION tg_club_messages_update_parent_preview()`.
- `public.club_messages / club_messages_update_parent_preview`: enabled=O; `CREATE TRIGGER club_messages_update_parent_preview AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.club_messages FOR EACH ROW EXECUTE FUNCTION tg_club_messages_update_parent_preview()`.
- `public.club_messages / on_club_message_created_trigger`: enabled=O; `CREATE TRIGGER on_club_message_created_trigger AFTER INSERT ON public.club_messages FOR EACH ROW EXECUTE FUNCTION on_club_message_created()`.
- `public.club_messages / on_club_message_deleted`: enabled=O; `CREATE TRIGGER on_club_message_deleted BEFORE DELETE ON public.club_messages FOR EACH ROW EXECUTE FUNCTION log_club_message_deletion()`.
- `public.club_messages / tg_club_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_club_messages_stamp_edited_at BEFORE UPDATE OF text ON public.club_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.club_news / trg_validate_club_news_audience`: enabled=O; `CREATE TRIGGER trg_validate_club_news_audience BEFORE INSERT OR UPDATE ON public.club_news FOR EACH ROW EXECUTE FUNCTION validate_club_news_audience()`.
- `public.club_news / update_club_news_updated_at`: enabled=O; `CREATE TRIGGER update_club_news_updated_at BEFORE UPDATE ON public.club_news FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_players / update_club_players_updated_at`: enabled=O; `CREATE TRIGGER update_club_players_updated_at BEFORE UPDATE ON public.club_players FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.club_stripe_configs / encrypt_stripe_keys_trigger`: enabled=O; `CREATE TRIGGER encrypt_stripe_keys_trigger BEFORE INSERT OR UPDATE ON public.club_stripe_configs FOR EACH ROW EXECUTE FUNCTION encrypt_club_stripe_keys()`.
- `public.club_subscriptions / sync_club_pro_status_on_delete_trigger`: enabled=O; `CREATE TRIGGER sync_club_pro_status_on_delete_trigger AFTER DELETE ON public.club_subscriptions FOR EACH ROW EXECUTE FUNCTION sync_club_pro_status_on_delete()`.
- `public.club_subscriptions / sync_club_pro_status_trigger`: enabled=O; `CREATE TRIGGER sync_club_pro_status_trigger AFTER INSERT OR UPDATE ON public.club_subscriptions FOR EACH ROW EXECUTE FUNCTION sync_club_pro_status()`.
- `public.club_subscriptions / trigger_sync_club_is_pro`: enabled=O; `CREATE TRIGGER trigger_sync_club_is_pro AFTER INSERT OR UPDATE OF is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at ON public.club_subscriptions FOR EACH ROW EXECUTE FUNCTION sync_club_is_pro()`.
- `public.clubs / on_club_created_create_default_chats`: enabled=O; `CREATE TRIGGER on_club_created_create_default_chats AFTER INSERT ON public.clubs FOR EACH ROW EXECUTE FUNCTION create_default_club_chats()`.
- `public.clubs / seed_club_role_folders_trg`: enabled=O; `CREATE TRIGGER seed_club_role_folders_trg AFTER INSERT ON public.clubs FOR EACH ROW EXECUTE FUNCTION trg_seed_club_role_folders()`.
- `public.clubs / trg_cascade_club_soft_delete`: enabled=O; `CREATE TRIGGER trg_cascade_club_soft_delete AFTER UPDATE OF deleted_at, purged_at ON public.clubs FOR EACH ROW EXECUTE FUNCTION cascade_club_soft_delete()`.
- `public.clubs / trg_notify_new_club_created`: enabled=O; `CREATE TRIGGER trg_notify_new_club_created AFTER INSERT ON public.clubs FOR EACH ROW EXECUTE FUNCTION notify_new_club_created()`.
- `public.clubs / update_clubs_updated_at`: enabled=O; `CREATE TRIGGER update_clubs_updated_at BEFORE UPDATE ON public.clubs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.comment_reports / update_comment_reports_updated_at`: enabled=O; `CREATE TRIGGER update_comment_reports_updated_at BEFORE UPDATE ON public.comment_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_admin_messages / on_competition_admin_message_created`: enabled=O; `CREATE TRIGGER on_competition_admin_message_created AFTER INSERT ON public.competition_admin_messages FOR EACH ROW EXECUTE FUNCTION on_competition_admin_message_created()`.
- `public.competition_admin_messages / stamp_competition_admin_reply`: enabled=O; `CREATE TRIGGER stamp_competition_admin_reply BEFORE INSERT ON public.competition_admin_messages FOR EACH ROW EXECUTE FUNCTION stamp_competition_admin_reply()`.
- `public.competition_divisions / trg_competition_divisions_updated_at`: enabled=O; `CREATE TRIGGER trg_competition_divisions_updated_at BEFORE UPDATE ON public.competition_divisions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_divisions / trg_resync_division_scores`: enabled=O; `CREATE TRIGGER trg_resync_division_scores AFTER UPDATE OF hide_scores ON public.competition_divisions FOR EACH ROW EXECUTE FUNCTION resync_division_scores_on_hide_toggle()`.
- `public.competition_divisions / trg_validate_competition_division_weekdays`: enabled=O; `CREATE TRIGGER trg_validate_competition_division_weekdays BEFORE INSERT OR UPDATE ON public.competition_divisions FOR EACH ROW EXECUTE FUNCTION validate_competition_division_weekdays()`.
- `public.competition_entries / trg_competition_entries_sync_contact_chats`: enabled=O; `CREATE TRIGGER trg_competition_entries_sync_contact_chats AFTER INSERT OR DELETE OR UPDATE OF status, team_id ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION tg_competition_entries_sync_contact_chats()`.
- `public.competition_entries / trg_competition_entries_updated_at`: enabled=O; `CREATE TRIGGER trg_competition_entries_updated_at BEFORE UPDATE ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_entries / trg_competition_entry_ensure_vault`: enabled=O; `CREATE TRIGGER trg_competition_entry_ensure_vault AFTER INSERT OR UPDATE OF status ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION tg_competition_ensure_vault()`.
- `public.competition_entries / trg_competition_entry_sync_chat`: enabled=O; `CREATE TRIGGER trg_competition_entry_sync_chat AFTER INSERT OR DELETE OR UPDATE ON public.competition_entries FOR EACH ROW EXECUTE FUNCTION tg_competition_entry_sync_chat()`.
- `public.competition_match_results / trg_sync_competition_result_events`: enabled=O; `CREATE TRIGGER trg_sync_competition_result_events AFTER INSERT OR UPDATE ON public.competition_match_results FOR EACH ROW EXECUTE FUNCTION sync_competition_result_to_events()`.
- `public.competition_match_results / update_competition_match_results_updated_at`: enabled=O; `CREATE TRIGGER update_competition_match_results_updated_at BEFORE UPDATE ON public.competition_match_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_matches / trg_guard_external_match_edits`: enabled=O; `CREATE TRIGGER trg_guard_external_match_edits BEFORE UPDATE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION guard_external_competition_match_edits()`.
- `public.competition_matches / trg_sync_competition_match_events`: enabled=O; `CREATE TRIGGER trg_sync_competition_match_events AFTER INSERT OR DELETE OR UPDATE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION sync_competition_match_events()`.
- `public.competition_matches / trg_sync_competition_match_events_d`: enabled=O; `CREATE TRIGGER trg_sync_competition_match_events_d AFTER DELETE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION sync_competition_match_events()`.
- `public.competition_matches / trg_sync_competition_match_events_iu`: enabled=O; `CREATE TRIGGER trg_sync_competition_match_events_iu BEFORE UPDATE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION sync_competition_match_events()`.
- `public.competition_matches / update_competition_matches_updated_at`: enabled=O; `CREATE TRIGGER update_competition_matches_updated_at BEFORE UPDATE ON public.competition_matches FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_role_invites / competition_role_invites_updated_at`: enabled=O; `CREATE TRIGGER competition_role_invites_updated_at BEFORE UPDATE ON public.competition_role_invites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competition_roles / trg_competition_role_sync_chat`: enabled=O; `CREATE TRIGGER trg_competition_role_sync_chat AFTER INSERT OR DELETE OR UPDATE ON public.competition_roles FOR EACH ROW EXECUTE FUNCTION tg_competition_role_sync_chat()`.
- `public.competition_roles / trg_competition_role_sync_contact_chats`: enabled=O; `CREATE TRIGGER trg_competition_role_sync_contact_chats AFTER INSERT OR DELETE OR UPDATE ON public.competition_roles FOR EACH ROW EXECUTE FUNCTION tg_competition_role_sync_contact_chats()`.
- `public.competition_roles / trg_competition_roles_enforce_owner`: enabled=O; `CREATE TRIGGER trg_competition_roles_enforce_owner AFTER INSERT OR DELETE OR UPDATE ON public.competition_roles FOR EACH ROW EXECUTE FUNCTION tg_competition_roles_enforce_owner()`.
- `public.competitions / trg_competition_club_enforce_owner`: enabled=O; `CREATE TRIGGER trg_competition_club_enforce_owner AFTER UPDATE OF organizer_club_id ON public.competitions FOR EACH ROW WHEN ((new.organizer_club_id IS DISTINCT FROM old.organizer_club_id)) EXECUTE FUNCTION tg_competition_enforce_owner()`.
- `public.competitions / trg_competition_create_coord_chat`: enabled=O; `CREATE TRIGGER trg_competition_create_coord_chat AFTER INSERT ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_create_coord_chat()`.
- `public.competitions / trg_competition_enforce_owner`: enabled=O; `CREATE TRIGGER trg_competition_enforce_owner AFTER INSERT ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_enforce_owner()`.
- `public.competitions / trg_competition_member_chat_toggle`: enabled=O; `CREATE TRIGGER trg_competition_member_chat_toggle AFTER UPDATE OF member_chat_enabled ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_member_chat_toggle()`.
- `public.competitions / trg_competition_publish_fixtures`: enabled=O; `CREATE TRIGGER trg_competition_publish_fixtures AFTER UPDATE OF status ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_publish_fixtures()`.
- `public.competitions / trg_competition_rename_coord_chat`: enabled=O; `CREATE TRIGGER trg_competition_rename_coord_chat AFTER UPDATE OF name ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_rename_coord_chat()`.
- `public.competitions / trg_competition_row_ensure_vault`: enabled=O; `CREATE TRIGGER trg_competition_row_ensure_vault AFTER INSERT OR UPDATE OF name, organizer_club_id, code_of_conduct_path, code_of_conduct_name ON public.competitions FOR EACH ROW EXECUTE FUNCTION tg_competition_row_ensure_vault()`.
- `public.competitions / trg_competitions_create_owner_role`: enabled=O; `CREATE TRIGGER trg_competitions_create_owner_role AFTER INSERT ON public.competitions FOR EACH ROW EXECUTE FUNCTION create_competition_owner_role()`.
- `public.competitions / trg_competitions_updated_at`: enabled=O; `CREATE TRIGGER trg_competitions_updated_at BEFORE UPDATE ON public.competitions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.competitions / trg_resync_competition_scores_on_hide_toggle`: enabled=O; `CREATE TRIGGER trg_resync_competition_scores_on_hide_toggle AFTER UPDATE OF hide_scores ON public.competitions FOR EACH ROW EXECUTE FUNCTION resync_competition_scores_on_hide_toggle()`.
- `public.direct_messages / on_direct_message_created_trigger`: enabled=O; `CREATE TRIGGER on_direct_message_created_trigger AFTER INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION on_direct_message_created()`.
- `public.direct_messages / tg_direct_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_direct_messages_stamp_edited_at BEFORE UPDATE OF text ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.direct_messages / update_dm_conversation_on_message`: enabled=O; `CREATE TRIGGER update_dm_conversation_on_message AFTER INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION update_dm_conversation_timestamp()`.
- `public.drill_frames / update_drill_frames_updated_at`: enabled=O; `CREATE TRIGGER update_drill_frames_updated_at BEFORE UPDATE ON public.drill_frames FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.drills / update_drills_updated_at`: enabled=O; `CREATE TRIGGER update_drills_updated_at BEFORE UPDATE ON public.drills FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.duties / on_duty_assigned_trigger`: enabled=O; `CREATE TRIGGER on_duty_assigned_trigger AFTER UPDATE ON public.duties FOR EACH ROW EXECUTE FUNCTION on_duty_assigned()`.
- `public.duties / update_duties_updated_at`: enabled=O; `CREATE TRIGGER update_duties_updated_at BEFORE UPDATE ON public.duties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.eoi_submissions / detect_returning_eoi_player_trg`: enabled=O; `CREATE TRIGGER detect_returning_eoi_player_trg BEFORE INSERT ON public.eoi_submissions FOR EACH ROW EXECUTE FUNCTION detect_returning_eoi_player()`.
- `public.eoi_submissions / trg_eoi_submissions_updated_at`: enabled=O; `CREATE TRIGGER trg_eoi_submissions_updated_at BEFORE UPDATE ON public.eoi_submissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.event_group_duties / update_event_group_duties_updated_at`: enabled=O; `CREATE TRIGGER update_event_group_duties_updated_at BEFORE UPDATE ON public.event_group_duties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.event_group_players / trg_enforce_unique_event_player_assignment`: enabled=O; `CREATE TRIGGER trg_enforce_unique_event_player_assignment BEFORE INSERT OR UPDATE OF group_id, player_id, event_id ON public.event_group_players FOR EACH ROW EXECUTE FUNCTION enforce_unique_event_player_assignment()`.
- `public.event_groups / update_event_groups_updated_at`: enabled=O; `CREATE TRIGGER update_event_groups_updated_at BEFORE UPDATE ON public.event_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.event_lineups / event_lineups_set_updated_at`: enabled=O; `CREATE TRIGGER event_lineups_set_updated_at BEFORE UPDATE ON public.event_lineups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.events / events_inherit_parent_scope`: enabled=O; `CREATE TRIGGER events_inherit_parent_scope BEFORE INSERT OR UPDATE OF parent_event_id ON public.events FOR EACH ROW EXECUTE FUNCTION inherit_parent_event_scope()`.
- `public.events / events_validate_target_team_ids`: enabled=O; `CREATE TRIGGER events_validate_target_team_ids BEFORE INSERT OR UPDATE OF target_team_ids, team_id, type, club_id ON public.events FOR EACH ROW EXECUTE FUNCTION validate_event_target_team_ids()`.
- `public.events / on_event_cancelled_trigger`: enabled=O; `CREATE TRIGGER on_event_cancelled_trigger AFTER UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION on_event_cancelled()`.
- `public.events / on_event_created_trigger`: enabled=O; `CREATE TRIGGER on_event_created_trigger AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION on_event_created()`.
- `public.events / on_event_updated_trigger`: enabled=O; `CREATE TRIGGER on_event_updated_trigger AFTER UPDATE ON public.events FOR EACH ROW WHEN ((old.is_cancelled = false)) EXECUTE FUNCTION on_event_updated()`.
- `public.events / trg_apply_training_defaults_on_event`: enabled=O; `CREATE TRIGGER trg_apply_training_defaults_on_event AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION apply_training_defaults_on_event()`.
- `public.events / trg_default_competition_event_reminder`: enabled=O; `CREATE TRIGGER trg_default_competition_event_reminder BEFORE INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION default_competition_event_reminder()`.
- `public.events / trg_event_auto_chat_post_ins`: enabled=O; `CREATE TRIGGER trg_event_auto_chat_post_ins AFTER INSERT ON public.events FOR EACH ROW EXECUTE FUNCTION on_event_auto_chat_post()`.
- `public.events / trg_event_auto_chat_post_upd`: enabled=O; `CREATE TRIGGER trg_event_auto_chat_post_upd AFTER UPDATE OF is_cancelled ON public.events FOR EACH ROW EXECUTE FUNCTION on_event_auto_chat_post()`.
- `public.events / trg_validate_event_duty_team`: enabled=O; `CREATE TRIGGER trg_validate_event_duty_team BEFORE INSERT OR UPDATE OF duty_team_id, club_id ON public.events FOR EACH ROW EXECUTE FUNCTION validate_event_duty_team()`.
- `public.events / trg_validate_event_rsvp_grouping`: enabled=O; `CREATE TRIGGER trg_validate_event_rsvp_grouping BEFORE INSERT OR UPDATE OF rsvp_grouping, team_id ON public.events FOR EACH ROW EXECUTE FUNCTION validate_event_rsvp_grouping()`.
- `public.events / trg_validate_event_scope`: enabled=O; `CREATE TRIGGER trg_validate_event_scope BEFORE INSERT OR UPDATE OF team_id, club_id, parent_event_id ON public.events FOR EACH ROW EXECUTE FUNCTION validate_event_team_club_scope()`.
- `public.events / update_events_updated_at`: enabled=O; `CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.fcm_tokens / trg_cleanup_old_fcm_tokens`: enabled=O; `CREATE TRIGGER trg_cleanup_old_fcm_tokens AFTER INSERT OR UPDATE ON public.fcm_tokens FOR EACH ROW EXECUTE FUNCTION cleanup_old_fcm_tokens()`.
- `public.fcm_tokens / update_fcm_tokens_updated_at`: enabled=O; `CREATE TRIGGER update_fcm_tokens_updated_at BEFORE UPDATE ON public.fcm_tokens FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.gallery_chat_cards / gallery_chat_cards_set_updated_at`: enabled=O; `CREATE TRIGGER gallery_chat_cards_set_updated_at BEFORE UPDATE ON public.gallery_chat_cards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.game_results / update_game_results_updated_at`: enabled=O; `CREATE TRIGGER update_game_results_updated_at BEFORE UPDATE ON public.game_results FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.group_members / trg_guard_competition_contact_members`: enabled=O; `CREATE TRIGGER trg_guard_competition_contact_members BEFORE INSERT OR UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION guard_competition_contact_members()`.
- `public.group_messages / group_messages_preview_after_delete`: enabled=O; `CREATE TRIGGER group_messages_preview_after_delete AFTER DELETE ON public.group_messages FOR EACH ROW EXECUTE FUNCTION tg_group_messages_update_parent_preview()`.
- `public.group_messages / group_messages_update_parent_preview`: enabled=O; `CREATE TRIGGER group_messages_update_parent_preview AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.group_messages FOR EACH ROW EXECUTE FUNCTION tg_group_messages_update_parent_preview()`.
- `public.group_messages / on_group_message_created_trigger`: enabled=O; `CREATE TRIGGER on_group_message_created_trigger AFTER INSERT ON public.group_messages FOR EACH ROW EXECUTE FUNCTION on_group_message_created()`.
- `public.group_messages / on_group_message_deleted`: enabled=O; `CREATE TRIGGER on_group_message_deleted BEFORE DELETE ON public.group_messages FOR EACH ROW EXECUTE FUNCTION log_group_message_deletion()`.
- `public.group_messages / tg_group_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_group_messages_stamp_edited_at BEFORE UPDATE OF text ON public.group_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.group_messages / trg_bump_chat_group_unread`: enabled=O; `CREATE TRIGGER trg_bump_chat_group_unread AFTER INSERT ON public.group_messages FOR EACH ROW EXECUTE FUNCTION bump_chat_group_unread_on_message()`.
- `public.match_captains / update_match_captains_updated_at`: enabled=O; `CREATE TRIGGER update_match_captains_updated_at BEFORE UPDATE ON public.match_captains FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.match_goalkeepers / update_match_goalkeepers_updated_at`: enabled=O; `CREATE TRIGGER update_match_goalkeepers_updated_at BEFORE UPDATE ON public.match_goalkeepers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.match_messages / validate_sender_type`: enabled=O; `CREATE TRIGGER validate_sender_type BEFORE INSERT ON public.match_messages FOR EACH ROW EXECUTE FUNCTION validate_match_message_sender_type()`.
- `public.member_referrals / update_member_referrals_updated_at`: enabled=O; `CREATE TRIGGER update_member_referrals_updated_at BEFORE UPDATE ON public.member_referrals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.message_reactions / on_message_reaction_created_trigger`: enabled=O; `CREATE TRIGGER on_message_reaction_created_trigger AFTER INSERT ON public.message_reactions FOR EACH ROW EXECUTE FUNCTION on_message_reaction_created()`.
- `public.message_reactions / trg_mark_read_on_reaction`: enabled=O; `CREATE TRIGGER trg_mark_read_on_reaction AFTER INSERT ON public.message_reactions FOR EACH ROW EXECUTE FUNCTION mark_read_on_reaction()`.
- `public.message_reads / skip_duplicate_message_reads_before_insert`: enabled=O; `CREATE TRIGGER skip_duplicate_message_reads_before_insert BEFORE INSERT ON public.message_reads FOR EACH ROW EXECUTE FUNCTION skip_duplicate_message_reads()`.
- `public.message_reads / trg_clear_chat_group_unread`: enabled=O; `CREATE TRIGGER trg_clear_chat_group_unread AFTER INSERT ON public.message_reads FOR EACH ROW EXECUTE FUNCTION clear_chat_group_unread_on_read()`.
- `public.message_reads / trg_message_reads_set_scope_key`: enabled=O; `CREATE TRIGGER trg_message_reads_set_scope_key BEFORE INSERT ON public.message_reads FOR EACH ROW EXECUTE FUNCTION set_message_reads_scope_key()`.
- `public.message_reports / update_message_reports_updated_at`: enabled=O; `CREATE TRIGGER update_message_reports_updated_at BEFORE UPDATE ON public.message_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_league_group_duties / update_mini_league_group_duties_updated_at`: enabled=O; `CREATE TRIGGER update_mini_league_group_duties_updated_at BEFORE UPDATE ON public.mini_league_group_duties FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_league_groups / update_mini_league_groups_updated_at`: enabled=O; `CREATE TRIGGER update_mini_league_groups_updated_at BEFORE UPDATE ON public.mini_league_groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_league_players / update_mini_league_players_updated_at`: enabled=O; `CREATE TRIGGER update_mini_league_players_updated_at BEFORE UPDATE ON public.mini_league_players FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_league_session_availability / update_mini_league_session_availability_updated_at`: enabled=O; `CREATE TRIGGER update_mini_league_session_availability_updated_at BEFORE UPDATE ON public.mini_league_session_availability FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_league_sessions / update_mini_league_sessions_updated_at`: enabled=O; `CREATE TRIGGER update_mini_league_sessions_updated_at BEFORE UPDATE ON public.mini_league_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.mini_leagues / on_mini_league_created_create_chat`: enabled=O; `CREATE TRIGGER on_mini_league_created_create_chat AFTER INSERT ON public.mini_leagues FOR EACH ROW EXECUTE FUNCTION create_mini_league_chat()`.
- `public.mini_leagues / trg_create_mini_league_chat_group`: enabled=O; `CREATE TRIGGER trg_create_mini_league_chat_group AFTER INSERT ON public.mini_leagues FOR EACH ROW EXECUTE FUNCTION create_mini_league_chat_group()`.
- `public.mini_leagues / trg_sync_mini_league_chat_group_name`: enabled=O; `CREATE TRIGGER trg_sync_mini_league_chat_group_name AFTER UPDATE ON public.mini_leagues FOR EACH ROW EXECUTE FUNCTION sync_mini_league_chat_group_name()`.
- `public.mini_leagues / update_mini_leagues_updated_at`: enabled=O; `CREATE TRIGGER update_mini_leagues_updated_at BEFORE UPDATE ON public.mini_leagues FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.notification_dispatch_log / trg_ndl_updated_at`: enabled=O; `CREATE TRIGGER trg_ndl_updated_at BEFORE UPDATE ON public.notification_dispatch_log FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.notifications / on_notification_created`: enabled=O; `CREATE TRIGGER on_notification_created AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION send_push_notification()`.
- `public.notifications / trg_set_notification_club_id`: enabled=O; `CREATE TRIGGER trg_set_notification_club_id BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION set_notification_club_id()`.
- `public.pending_invites / on_pending_invite_created`: enabled=O; `CREATE TRIGGER on_pending_invite_created AFTER INSERT ON public.pending_invites FOR EACH ROW EXECUTE FUNCTION on_pending_invite_created()`.
- `public.pending_invites / trigger_generate_invite_short_code`: enabled=O; `CREATE TRIGGER trigger_generate_invite_short_code BEFORE INSERT ON public.pending_invites FOR EACH ROW EXECUTE FUNCTION generate_invite_short_code()`.
- `public.photo_albums / trg_photo_albums_updated_at`: enabled=O; `CREATE TRIGGER trg_photo_albums_updated_at BEFORE UPDATE ON public.photo_albums FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.photo_comment_reactions / on_photo_comment_reaction_created_trigger`: enabled=O; `CREATE TRIGGER on_photo_comment_reaction_created_trigger AFTER INSERT ON public.photo_comment_reactions FOR EACH ROW EXECUTE FUNCTION on_photo_comment_reaction_created()`.
- `public.photo_comments / on_photo_comment_created_trigger`: enabled=O; `CREATE TRIGGER on_photo_comment_created_trigger AFTER INSERT ON public.photo_comments FOR EACH ROW EXECUTE FUNCTION on_photo_comment_created()`.
- `public.photo_comments / trg_cleanup_notifications_on_comment_delete`: enabled=O; `CREATE TRIGGER trg_cleanup_notifications_on_comment_delete AFTER DELETE ON public.photo_comments FOR EACH ROW EXECUTE FUNCTION cleanup_notifications_for_deleted_comment()`.
- `public.photo_reactions / on_photo_reaction_created_trigger`: enabled=O; `CREATE TRIGGER on_photo_reaction_created_trigger AFTER INSERT ON public.photo_reactions FOR EACH ROW EXECUTE FUNCTION on_photo_reaction_created()`.
- `public.photo_reports / update_photo_reports_updated_at`: enabled=O; `CREATE TRIGGER update_photo_reports_updated_at BEFORE UPDATE ON public.photo_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.photos / enforce_photo_storage_prefix_trigger`: enabled=O; `CREATE TRIGGER enforce_photo_storage_prefix_trigger BEFORE INSERT OR UPDATE OF image_url ON public.photos FOR EACH ROW EXECUTE FUNCTION enforce_photo_storage_prefix()`.
- `public.photos / on_photo_uploaded_trigger`: enabled=O; `CREATE TRIGGER on_photo_uploaded_trigger AFTER INSERT ON public.photos FOR EACH ROW EXECUTE FUNCTION on_photo_uploaded()`.
- `public.photos / trg_cleanup_notifications_on_photo_hard_delete`: enabled=O; `CREATE TRIGGER trg_cleanup_notifications_on_photo_hard_delete AFTER DELETE ON public.photos FOR EACH ROW EXECUTE FUNCTION cleanup_notifications_for_deleted_photo()`.
- `public.photos / trg_cleanup_notifications_on_photo_soft_delete`: enabled=O; `CREATE TRIGGER trg_cleanup_notifications_on_photo_soft_delete AFTER UPDATE OF deleted_at ON public.photos FOR EACH ROW EXECUTE FUNCTION cleanup_notifications_for_deleted_photo()`.
- `public.photos / trg_photos_mirror_competition_vault`: enabled=O; `CREATE TRIGGER trg_photos_mirror_competition_vault AFTER INSERT ON public.photos FOR EACH ROW EXECUTE FUNCTION tg_photos_mirror_competition_vault()`.
- `public.photos / trg_photos_sync_album_aggregates`: enabled=O; `CREATE TRIGGER trg_photos_sync_album_aggregates AFTER INSERT OR DELETE OR UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION sync_album_aggregates()`.
- `public.photos / update_club_storage_on_photo_change_trigger`: enabled=O; `CREATE TRIGGER update_club_storage_on_photo_change_trigger AFTER INSERT OR DELETE ON public.photos FOR EACH ROW EXECUTE FUNCTION update_club_storage_on_photo_change()`.
- `public.pinned_messages / pinned_messages_enforce_limit`: enabled=O; `CREATE TRIGGER pinned_messages_enforce_limit BEFORE INSERT ON public.pinned_messages FOR EACH ROW EXECUTE FUNCTION enforce_pin_limit()`.
- `public.playhq_fixtures / trg_playhq_fixtures_updated`: enabled=O; `CREATE TRIGGER trg_playhq_fixtures_updated BEFORE UPDATE ON public.playhq_fixtures FOR EACH ROW EXECUTE FUNCTION playhq_touch_updated_at()`.
- `public.playhq_grades / trg_playhq_grades_updated`: enabled=O; `CREATE TRIGGER trg_playhq_grades_updated BEFORE UPDATE ON public.playhq_grades FOR EACH ROW EXECUTE FUNCTION playhq_touch_updated_at()`.
- `public.playhq_player_links / trg_playhq_player_links_updated_at`: enabled=O; `CREATE TRIGGER trg_playhq_player_links_updated_at BEFORE UPDATE ON public.playhq_player_links FOR EACH ROW EXECUTE FUNCTION set_playhq_player_links_updated_at()`.
- `public.playhq_player_stats / trg_playhq_player_stats_updated`: enabled=O; `CREATE TRIGGER trg_playhq_player_stats_updated BEFORE UPDATE ON public.playhq_player_stats FOR EACH ROW EXECUTE FUNCTION playhq_touch_updated_at()`.
- `public.points_history / trg_points_history_attach_season`: enabled=O; `CREATE TRIGGER trg_points_history_attach_season BEFORE INSERT ON public.points_history FOR EACH ROW EXECUTE FUNCTION points_history_attach_season()`.
- `public.points_history / validate_points_history_amount_trigger`: enabled=O; `CREATE TRIGGER validate_points_history_amount_trigger BEFORE INSERT ON public.points_history FOR EACH ROW EXECUTE FUNCTION validate_points_history_amount()`.
- `public.poll_votes / trg_enforce_single_choice_poll`: enabled=O; `CREATE TRIGGER trg_enforce_single_choice_poll BEFORE INSERT ON public.poll_votes FOR EACH ROW EXECUTE FUNCTION enforce_single_choice_poll()`.
- `public.polls / update_polls_updated_at`: enabled=O; `CREATE TRIGGER update_polls_updated_at BEFORE UPDATE ON public.polls FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.profiles / claim_competition_role_invites_on_profile_create_trigger`: enabled=O; `CREATE TRIGGER claim_competition_role_invites_on_profile_create_trigger AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION claim_competition_role_invites_on_profile_create()`.
- `public.profiles / claim_pending_invites_on_profile_create_trigger`: enabled=O; `CREATE TRIGGER claim_pending_invites_on_profile_create_trigger AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION claim_pending_invites_on_profile_create()`.
- `public.profiles / log_user_deletion_trigger`: enabled=O; `CREATE TRIGGER log_user_deletion_trigger BEFORE DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION log_user_deletion()`.
- `public.profiles / on_profile_create_notification_prefs`: enabled=O; `CREATE TRIGGER on_profile_create_notification_prefs AFTER INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION create_default_notification_preferences()`.
- `public.profiles / seed_active_club_theme_from_invite_trigger`: enabled=O; `CREATE TRIGGER seed_active_club_theme_from_invite_trigger BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION seed_active_club_theme_from_invite()`.
- `public.profiles / set_email_hash_on_insert`: enabled=O; `CREATE TRIGGER set_email_hash_on_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_profile_email_hash()`.
- `public.profiles / trg_repair_placeholder_member_names`: enabled=O; `CREATE TRIGGER trg_repair_placeholder_member_names AFTER UPDATE OF display_name ON public.profiles FOR EACH ROW EXECUTE FUNCTION repair_placeholder_member_names()`.
- `public.profiles / update_profiles_updated_at`: enabled=O; `CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.push_delivery_queue / trg_push_delivery_queue_touch`: enabled=O; `CREATE TRIGGER trg_push_delivery_queue_touch BEFORE UPDATE ON public.push_delivery_queue FOR EACH ROW EXECUTE FUNCTION push_delivery_queue_touch()`.
- `public.push_delivery_queue / trg_push_delivery_queue_validate`: enabled=O; `CREATE TRIGGER trg_push_delivery_queue_validate BEFORE INSERT OR UPDATE ON public.push_delivery_queue FOR EACH ROW EXECUTE FUNCTION push_delivery_queue_validate()`.
- `public.role_requests / on_role_request_created_trigger`: enabled=O; `CREATE TRIGGER on_role_request_created_trigger AFTER INSERT ON public.role_requests FOR EACH ROW EXECUTE FUNCTION on_role_request_created()`.
- `public.role_requests / on_role_request_processed_trigger`: enabled=O; `CREATE TRIGGER on_role_request_processed_trigger AFTER UPDATE ON public.role_requests FOR EACH ROW EXECUTE FUNCTION on_role_request_processed()`.
- `public.rsvps / enforce_child_event_audience_trg`: enabled=O; `CREATE TRIGGER enforce_child_event_audience_trg BEFORE INSERT OR UPDATE OF child_id, event_id ON public.rsvps FOR EACH ROW EXECUTE FUNCTION enforce_child_event_audience()`.
- `public.rsvps / manage_coach_attendance_duty_trigger`: enabled=O; `CREATE TRIGGER manage_coach_attendance_duty_trigger AFTER INSERT OR DELETE OR UPDATE ON public.rsvps FOR EACH ROW EXECUTE FUNCTION manage_coach_attendance_duty()`.
- `public.rsvps / on_rsvp_notify_admins_trigger`: enabled=O; `CREATE TRIGGER on_rsvp_notify_admins_trigger AFTER INSERT OR UPDATE OF status ON public.rsvps FOR EACH ROW EXECUTE FUNCTION on_rsvp_notify_admins()`.
- `public.rsvps / skip_duplicate_rsvps_trigger`: enabled=O; `CREATE TRIGGER skip_duplicate_rsvps_trigger BEFORE INSERT ON public.rsvps FOR EACH ROW EXECUTE FUNCTION skip_duplicate_rsvps()`.
- `public.rsvps / trg_enforce_rsvp_role_restriction`: enabled=O; `CREATE TRIGGER trg_enforce_rsvp_role_restriction BEFORE INSERT OR UPDATE OF child_id, mini_league_player_id, event_id ON public.rsvps FOR EACH ROW EXECUTE FUNCTION enforce_rsvp_role_restriction()`.
- `public.rsvps / trg_log_rsvp_change`: enabled=O; `CREATE TRIGGER trg_log_rsvp_change AFTER INSERT OR DELETE OR UPDATE ON public.rsvps FOR EACH ROW EXECUTE FUNCTION log_rsvp_change()`.
- `public.rsvps / trg_rsvps_fill_child_from_mlp`: enabled=O; `CREATE TRIGGER trg_rsvps_fill_child_from_mlp BEFORE INSERT OR UPDATE ON public.rsvps FOR EACH ROW EXECUTE FUNCTION rsvps_fill_child_from_mlp()`.
- `public.rsvps / trg_touch_training_default_confirmation`: enabled=O; `CREATE TRIGGER trg_touch_training_default_confirmation AFTER INSERT OR UPDATE OF status, source ON public.rsvps FOR EACH ROW EXECUTE FUNCTION touch_training_default_confirmation()`.
- `public.rsvps / update_rsvps_updated_at`: enabled=O; `CREATE TRIGGER update_rsvps_updated_at BEFORE UPDATE ON public.rsvps FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.scheduled_messages / scheduled_messages_validate_trg`: enabled=O; `CREATE TRIGGER scheduled_messages_validate_trg BEFORE INSERT OR UPDATE ON public.scheduled_messages FOR EACH ROW EXECUTE FUNCTION scheduled_messages_validate()`.
- `public.seasons / update_seasons_updated_at`: enabled=O; `CREATE TRIGGER update_seasons_updated_at BEFORE UPDATE ON public.seasons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.sponsorship_packages / update_sponsorship_packages_updated_at`: enabled=O; `CREATE TRIGGER update_sponsorship_packages_updated_at BEFORE UPDATE ON public.sponsorship_packages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.team_captains / trg_sync_team_captain_role_del`: enabled=O; `CREATE TRIGGER trg_sync_team_captain_role_del AFTER DELETE ON public.team_captains FOR EACH ROW EXECUTE FUNCTION sync_team_captain_role()`.
- `public.team_captains / trg_sync_team_captain_role_ins`: enabled=O; `CREATE TRIGGER trg_sync_team_captain_role_ins AFTER INSERT ON public.team_captains FOR EACH ROW EXECUTE FUNCTION sync_team_captain_role()`.
- `public.team_captains / trg_team_captains_updated_at`: enabled=O; `CREATE TRIGGER trg_team_captains_updated_at BEFORE UPDATE ON public.team_captains FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.team_captains / trg_validate_team_captain`: enabled=O; `CREATE TRIGGER trg_validate_team_captain BEFORE INSERT ON public.team_captains FOR EACH ROW EXECUTE FUNCTION validate_team_captain()`.
- `public.team_creation_requests / update_team_creation_requests_updated_at`: enabled=O; `CREATE TRIGGER update_team_creation_requests_updated_at BEFORE UPDATE ON public.team_creation_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.team_memberships / update_team_memberships_updated_at`: enabled=O; `CREATE TRIGGER update_team_memberships_updated_at BEFORE UPDATE ON public.team_memberships FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.team_messages / on_team_message_created_trigger`: enabled=O; `CREATE TRIGGER on_team_message_created_trigger AFTER INSERT ON public.team_messages FOR EACH ROW EXECUTE FUNCTION on_team_message_created()`.
- `public.team_messages / on_team_message_deleted`: enabled=O; `CREATE TRIGGER on_team_message_deleted BEFORE DELETE ON public.team_messages FOR EACH ROW EXECUTE FUNCTION log_team_message_deletion()`.
- `public.team_messages / team_messages_preview_after_delete`: enabled=O; `CREATE TRIGGER team_messages_preview_after_delete AFTER DELETE ON public.team_messages FOR EACH ROW EXECUTE FUNCTION tg_team_messages_update_parent_preview()`.
- `public.team_messages / team_messages_update_parent_preview`: enabled=O; `CREATE TRIGGER team_messages_update_parent_preview AFTER INSERT OR UPDATE OF deleted_at, text, image_url ON public.team_messages FOR EACH ROW EXECUTE FUNCTION tg_team_messages_update_parent_preview()`.
- `public.team_messages / tg_team_messages_stamp_edited_at`: enabled=O; `CREATE TRIGGER tg_team_messages_stamp_edited_at BEFORE UPDATE OF text ON public.team_messages FOR EACH ROW EXECUTE FUNCTION tg_stamp_message_edited_at()`.
- `public.team_training_pauses / trg_team_training_pauses_updated`: enabled=O; `CREATE TRIGGER trg_team_training_pauses_updated BEFORE UPDATE ON public.team_training_pauses FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.teams / seed_team_role_folders_trg`: enabled=O; `CREATE TRIGGER seed_team_role_folders_trg AFTER INSERT ON public.teams FOR EACH ROW EXECUTE FUNCTION trg_seed_team_role_folders()`.
- `public.teams / trg_cascade_team_soft_delete`: enabled=O; `CREATE TRIGGER trg_cascade_team_soft_delete AFTER UPDATE OF deleted_at ON public.teams FOR EACH ROW EXECUTE FUNCTION cascade_team_soft_delete()`.
- `public.teams / trg_refresh_competition_event_titles`: enabled=O; `CREATE TRIGGER trg_refresh_competition_event_titles AFTER UPDATE OF name ON public.teams FOR EACH ROW EXECUTE FUNCTION refresh_competition_event_titles_on_team_rename()`.
- `public.teams / update_teams_updated_at`: enabled=O; `CREATE TRIGGER update_teams_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.terms / update_terms_updated_at`: enabled=O; `CREATE TRIGGER update_terms_updated_at BEFORE UPDATE ON public.terms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.user_roles / log_role_change_trigger`: enabled=O; `CREATE TRIGGER log_role_change_trigger AFTER INSERT OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION log_role_change()`.
- `public.user_roles / on_new_member_notify_admins`: enabled=O; `CREATE TRIGGER on_new_member_notify_admins AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION notify_admins_new_member()`.
- `public.user_roles / trg_auto_accept_pending_invites`: enabled=O; `CREATE TRIGGER trg_auto_accept_pending_invites AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION auto_accept_pending_invites_on_role()`.
- `public.user_roles / trg_clear_member_exclusion_on_role_insert`: enabled=O; `CREATE TRIGGER trg_clear_member_exclusion_on_role_insert AFTER INSERT ON public.user_roles FOR EACH ROW EXECUTE FUNCTION clear_member_exclusion_on_role_insert()`.
- `public.user_roles / trg_league_admin_enforce_competition_owner`: enabled=O; `CREATE TRIGGER trg_league_admin_enforce_competition_owner AFTER INSERT OR DELETE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION tg_league_admin_enforce_competition_owner()`.
- `public.user_roles / trg_post_membership_system_message_del`: enabled=O; `CREATE TRIGGER trg_post_membership_system_message_del AFTER DELETE ON public.user_roles FOR EACH ROW WHEN ((old.team_id IS NOT NULL)) EXECUTE FUNCTION post_membership_system_message()`.
- `public.user_roles / trg_post_membership_system_message_ins`: enabled=O; `CREATE TRIGGER trg_post_membership_system_message_ins AFTER INSERT ON public.user_roles FOR EACH ROW WHEN ((new.team_id IS NOT NULL)) EXECUTE FUNCTION post_membership_system_message()`.
- `public.user_roles / trg_post_membership_system_message_upd`: enabled=O; `CREATE TRIGGER trg_post_membership_system_message_upd AFTER UPDATE OF role, team_id ON public.user_roles FOR EACH ROW WHEN (((new.team_id IS NOT NULL) AND ((new.role IS DISTINCT FROM old.role) OR (new.team_id IS DISTINCT FROM old.team_id)))) EXECUTE FUNCTION post_membership_system_message()`.
- `public.user_roles / trg_team_admin_sync_competition_chats`: enabled=O; `CREATE TRIGGER trg_team_admin_sync_competition_chats AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION tg_team_admin_sync_competition_chats()`.
- `public.user_roles / trg_user_roles_sync_contact_chats`: enabled=O; `CREATE TRIGGER trg_user_roles_sync_contact_chats AFTER INSERT OR DELETE OR UPDATE OF team_id, user_id ON public.user_roles FOR EACH ROW EXECUTE FUNCTION tg_user_roles_sync_contact_chats()`.
- `public.vault_drive_links / update_vault_drive_links_updated_at`: enabled=O; `CREATE TRIGGER update_vault_drive_links_updated_at BEFORE UPDATE ON public.vault_drive_links FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()`.
- `public.vault_files / trg_vault_file_stamp_competition`: enabled=O; `CREATE TRIGGER trg_vault_file_stamp_competition BEFORE INSERT OR UPDATE OF folder_id ON public.vault_files FOR EACH ROW EXECUTE FUNCTION tg_vault_file_stamp_competition()`.
- `public.vault_files / update_club_storage_on_file_change_trigger`: enabled=O; `CREATE TRIGGER update_club_storage_on_file_change_trigger AFTER INSERT OR DELETE OR UPDATE ON public.vault_files FOR EACH ROW EXECUTE FUNCTION update_club_storage_on_file_change()`.
- `public.vault_folders / protect_role_folders_trg`: enabled=O; `CREATE TRIGGER protect_role_folders_trg BEFORE DELETE OR UPDATE ON public.vault_folders FOR EACH ROW EXECUTE FUNCTION protect_role_folders()`.

## 9. Version differences
**Expected-by-code:** Generated Supabase types specify PostgrestVersion "14.5". Code uses JSONB, uuid, RLS/SECURITY DEFINER functions, named RPC arguments, schema-cache PGRST202 handling, publication subscriptions and signed storage URLs. Motoko/Internet Identity needs separate deployments.

**Found-in-this-DB:** DEV PostgreSQL **17.6**; installed extensions above. Hosted PostgREST version, Supabase gateway/storage/realtime release versions and Edge Deno runtime are not exposed by available safe reads.

**GAP (essential blocker):** No demonstrated PostgreSQL-version blocker. Signature/schema gaps are confirmed regardless of server version. Confirm runtime gateway/cache semantics for the legacy competition-event PGRST202 fallback and hosted Edge versions.

**DIFFERENCE (non-blocking):** Generated PostgREST version is a type-generation marker, not proof of live 14.5. PostgreSQL 17 supports the audited ordinary UUID/JSON/RLS/view features. Internet Computer actor contracts cannot be validated by the Supabase version/catalog.

## Essential blockers before merging integration-hybrid into main
These are **compatibility/activation gates**, not instructions to modify DEV or production. A source-only default-off merge may be administratively acceptable, but it is not safe to advertise this code as working against DEV until these pass.
1. History/results/fixture SQL contracts: missing read_game_history, read_game_result, save_game_history, read_history_player_stats, read_history_report_events, read_history_summary, get_my_viewable_competition_match_ids, read_competition_playhq and save_competition_match_result; preserve hard score hiding and scope checks.
2. Competition email invitations: missing competition_role_email_invites and create/status/accept/revoke RPCs. Existing share-link functions alone do not cover this code.
3. Active hard scalar mismatches: clubs.home_country, club_subscriptions.pricing_version, mini_leagues.status; fix or explicitly gate their dependent enforcement/upload/news flows. Membership lookup user_id references conflict with club_player_id/profile_id schema; do not silently drop legitimate memberships.
4. Competition Vault: competition-vault bucket and can_access_competition_vault RPC absent. Do not fall back to broadly-readable photos or admin-only competition-documents.
5. Welcome/invite/settings and optional services: missing club_invite_message_defaults, welcome_email_settings, canister_memory_reports and edge claim/finish/payment/measured-media RPC dependencies; gate genuinely optional features or reconcile contracts before enabling.
6. Safety review: broad storage predicates and public PlayHQ score/stat reads/all-team read need intended-access validation; excessive anon/authenticated privileges (especially TRUNCATE) and owner-semantics ladder view must not be mistaken for fail-closed isolation.
7. Realtime: active_games/chat_pinned_vault/club_subscriptions/member_payments subscriptions do not broadcast from this publication; verify intended fallback/polling or gate the affected experience.
8. Hosted evidence still missing: redacted DEV Edge deployment list/source revision, Site URL/redirect allowlist and custom template identifiers; canister queue deployment/version/worker wiring if ICP paths enabled.
9. Pin final merge SHAs/tree again if branches change; ensure default-off workflows and DEV-only safeguards remain intact. No production compatibility conclusion is authorized or possible from this report.

## Safe to merge once these pass
- [ ] Re-pin main and integration-hybrid; confirm merge-result tree matches the audited snapshot or re-audit differences.
- [ ] Each enabled Supabase frontend flow has compatible tables/columns, complete RPC parameter/return contracts and grants/policies.
- [ ] History/results/fixture and invitation contracts pass metadata checks; score hiding and membership isolation remain fail-closed.
- [ ] Competition/media upload limits and bucket authorization match code; no public/private bucket substitution.
- [ ] Every enabled Edge call maps to a deployed DEV function at the expected revision; env NAMES only verified separately, no values exported.
- [ ] DEV auth redirects/templates checked through redacted configuration; Google remains present/default-off.
- [ ] Realtime publication or documented fallback covers every enabled subscription.
- [ ] ICP notification/schedule/update-reminder principal/scoping contracts and separate deployment wiring verified if activated.
- [ ] Optional unsupported features are explicitly default-off rather than silently broken.
- [ ] No automatic migrations/deployments/workflows or production routing will be triggered by the merge; reviewed independently without running them.
- [ ] Any later behavioral tests or remediation obtain separate authorization; this read-only audit itself makes no changes.
