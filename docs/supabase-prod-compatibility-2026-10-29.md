# Supabase compatibility before the prod merge

## Result

**Confirmed code differences have been repaired locally. Live prod compatibility is not yet certified.**

This review changed no database, secrets, prod branch, repository settings or deployed service. The copied prod `hybrid` branch has not been resynchronized with these new local repairs.

## Evidence and limits

- Hybrid's connected database: `cdrxmelhysdqrccttsjg`; read-only inventory found 203 public tables and two views, with RLS on the 203 tables.
- Prod target: `ecsdwrarzfexssxtrymj`, confirmed from the prod project's saved configuration.
- Prod evidence is a read-only source snapshot at `96642d0750e03d933b68957d61999de3ae983b9c`, not a query of the live prod database.
- Saved generated types contain 198 hybrid / 199 prod tables and 326 hybrid / 355 prod functions. These counts are not live inventories: custom migrations contain functions absent from generated types.
- Storage bucket names found in `.storage.from(...)` are not missing database tables. Retired drills/pitch were excluded. Existing production services and database setup are not assumed missing merely because the repositories differ.

## Essential code repairs completed

1. **Committee official links:** prod returns `committee`; the join screen now maps it to the existing `committee_member` display role. Unsupported roles remain refused and acceptance still runs through server authorization.
2. **Exhausted links and sign-in:** prod's `used_up` status displays as used, and email verification mode survives the sign-in redirect.
3. **Competition-wide event creation:** the competition button supports hybrid's receipt-aware signature and prod's existing `p_type/p_event_date/p_end_time` signature. Only an exact PostgREST `PGRST202` signature miss permits the alternate request. Permission refusals, ambiguous results, timeouts and network errors never replay a write. The existing general Create Event page already uses prod's signature.
4. **Contact competition admins:** Supabase now calls prod's existing `get_or_create_competition_admin_chat(p_competition_id)` and opens the resulting group chat. ICP dispatch is unchanged.

## Essential live requirements to verify, not blindly install

| Feature | Required evidence from prod | Local evidence |
| --- | --- | --- |
| Competition official email codes | `create_competition_role_email_invite`, `revoke_competition_role_email_invite`, `get_competition_role_email_invite_status`, `accept_competition_role_email_invite`, their tables, grants and policies | Hybrid `20261014030000_email_bound_official_invites.sql`; no matching saved prod definitions. Older role invitations are not a safe replacement for code verification. |
| Protected game History / reports / result saves | `read_game_result`, `save_game_history`, `read_game_history`, `read_history_player_stats`, `read_history_summary`, `read_history_report_events`, `save_competition_match_result` | Hybrid history migrations `20261021003048...sql` and `20261021003143...sql`. No raw-table fallback was introduced. |
| Competition schedule visibility | `get_my_viewable_competition_match_ids` and its authorization rules | Hybrid `20261014010000_allow_competition_fixture_read.sql`. |
| Competition Vault | `can_access_competition_vault`, competition-scoped folders/files and policies | Hybrid `20261012000000_add_competition_vault_access.sql` and later welcome-contract migration. |
| News notifications | `notify_mini_league_news`, `notify_competition_news` and actual scoped delivery | Hybrid `20261010010000_mini_league_news_audience.sql`. |
| Required columns | Whether runtime needs `competition_matches.home_score/away_score`, `duties.duty_team_id`, and event reminder flags on target | Present in hybrid saved types, absent from prod saved types. Confirm deployed column use before selecting any additive migration. |
| Invite/welcome settings | `club_invite_message_defaults`, `welcome_email_settings` or existing equivalent service contract | Some reads already existed in prod source; absent saved types alone do not establish absence. |

`can_create_competition_event` appears in saved prod definitions but was absent in hybrid's live database: it is not evidence of a target-side gap. PlayHQ sync remains deferred; `read_competition_playhq` is not a current release blocker.

## Required next step

From the Lovable project connected to prod, request a **read-only schema/configuration report**, not a data export or secrets:

> Check the live database against this compatibility report. Report public table columns, foreign keys, relevant function signatures/definitions and EXECUTE grants, RLS policies and table grants, Storage bucket policies, Realtime publications, and sign-in/provider settings. Do not change the database or export personal records, keys or secrets. Identify only absent or incompatible requirements for the active code, then propose the smallest additive changes for separate approval.

After reviewing that report, test the repaired code against an isolated target copy, including ordinary-member/admin access refusals, official joins, event creation, History, media/Vault uploads and existing payment fulfillment. Preserve prod Supabase settings and never replay the entire migration history. Future database changes and releases require their own approval.

## Verification

- Eight focused test files, **42 tests passed in Supabase mode and 42 in ICP mode**: official roles/redirects, email helper, both event contracts, denied/unknown write behavior, History/report repositories, schedule reads and match workflows.
- Preview build log: `build OK` after the code changes.
- Live signed-in prod acceptance and hosted auth/Storage/provider settings were unavailable here; no end-to-end prod claim is made.