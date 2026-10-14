# Production Enhancements Gap Review (Baseline)

Comparison date: 2026-10-07
Window reviewed: 2026-09-07 through 2026-10-07
Repositories: `Ignite-Club-HQ/ignite-club_hq-prod` (`main`) and this `ignite-club-hybrid` checkout (`main`, `98c4342`).

This is a feature-level comparison of current source and meaningful production commits. Repeated `Changes` commits, routine fixes, and implementation details that do not add user-facing behavior are consolidated or omitted. Production uses Supabase; hybrid routes features through its live backend architecture, so these are behavior gaps, not recommendations to copy the production implementation verbatim.

This is the original 2026-10-07 gap inventory, before the implementation work began. For current completion and remaining blockers, see [the implementation plan status](PROD_ENHANCEMENTS_IMPLEMENTATION_PLAN_2026-10-07.md#status-2026-10-10).

## Missing or Incomplete Enhancements

### Match-Day and Event Operations

- **Create one event for all entered competition teams.** Competition admins can create a social, training, or game event from the competition page; production fans it out to accepted teams' schedules and invites their members. Hybrid has competition broadcasts, but no equivalent event-creation-and-invite flow. Production: `aa1713c8`, `CreateCompetitionEventButton.tsx`, `create_competition_event` migration.
- **Assign a team to run an event duty.** Production adds an optional team-on-duty field, independent of the event's host team. It selects active teams and notifies that team's members and parents, while retaining individual duty assignments. Hybrid supports individual duties but has no team-wide duty assignment. Production: `bae11899`, `DutyTeamPicker.tsx`.
- **Broader scheduled reminder coverage.** Hybrid already supports configurable scheduled RSVP reminders through `events_domain.set_event_auto_reminder` and its 15-minute sweep. Production adds early RSVP/points reminders and 24-hour individual-duty reminders; the team-on-duty feature also notifies the whole assigned team. Those reminder types and recipients are the gaps, not the underlying scheduler. Production: `7e03302e`, `bae11899`, `send-event-reminders/index.ts`.
- **Season-captain fallback on match details.** Production displays the team's season captain when no match-specific captain is set and lets admins change the match captain. Hybrid's current `MatchCaptainSelector` omits the season-captain lookup and fallback; its canister model has no matching season-captain store. Production: `b363f574`, `MatchCaptainSelector.tsx`.

### Competition Fixtures and Setup

- **PlayHQ cricket fixture import.** Production adds a cricket/PlayHQ advanced-export adapter and integrates fixture import into competition management. Hybrid has standard CSV/XLSX and Dribl import paths, but no PlayHQ cricket adapter or equivalent competition-page importer. Production: `1565d681`, `db654aab`, `ImportFixturesMenuItem.tsx`, `playhqFixtureImport.ts`.
- **Real-world fixture import handling.** Production's import workflow covers multi-day and multi-date rows, TBD teams, round/grade/finals labels, duplicate detection, skipped-row explanations, and hiding import after publication. Hybrid's generic importer does not provide the PlayHQ-specific normalization and competition import safeguards as a complete workflow. Production follow-ups include `b797b675`, `da107cef`, `3198538b`, `012f4276`, `e6f6c411`, `18513d3c`, and `ee99d135`.
- **One control to hide the whole competition ladder.** Production can hide the ladder for an entire competition. Hybrid supports hiding ladders per division, but has no whole-competition setting. Production: `24b6e052`.
- **Competition-specific officials roster and duty access.** Production provides competition official management for referee/committee roles and allows officials to appear in duty assignment. Hybrid has club committee roles, competition admins, and general duties, but no equivalent competition officials roster with that role-to-duty workflow. Production: `51d71be1`, `d9ddadb3`, `CompetitionOfficialsCard.tsx`.

### Competition Communication and Media

- **Competition admin contact inbox.** Production lets members contact competition admins through a dedicated inbox/conversation flow and gives admins a cross-chat list for their competition. Hybrid has competition member-chat/settings support, but no equivalent private contact-admin inbox and consolidated competition chat-management view. Production: `b2d86d15`, `03c521bf`, `fb436133`, `1496f774`.
- **Competition-scoped media gallery.** Production adds an upload, browse, and manage gallery on competition pages. Hybrid's media model can represent competition-scoped metadata, but the competition gallery UI and its member/admin workflow are absent. Production: `8a457393`, `CompetitionMediaPanel.tsx`.
- **Competition vault folders.** Production provisions and saves files into competition-specific folders, including the associated storage-folder synchronization. Hybrid has vault support, but no competition-folder workflow. Production: `3263443b`, `cefc7158`.
- **League-targeted club news.** Production expands news targeting to teams and leagues. Hybrid already targets club news to selected teams, but has no league audience selector/fan-out. Production: `64ac61ce`.

### Invitations and Welcome Messages

- **Saved default invitation-message settings.** Production adds reusable default invite-copy controls and applies custom copy through team/competition invite flows. Hybrid supports one-off custom text in its invite flow, but lacks equivalent saved default-message settings. Production: `e79b8a32`, `InviteMessageDefaultCard.tsx`.
- **Branded team and competition welcome emails across invite roles.** Production adds team welcome email delivery, competition welcome-email controls, and broader invite-email role coverage. Hybrid's one-off invite text is not equivalent to these persisted welcome-email templates and delivery flows. Production: `511e97c0`, `0ee0f75e`, `CompetitionWelcomeEmailCard.tsx`, `sendCompetitionWelcomeEmail.ts`.

## Production-Only Operations Work

- **Supabase function deployment and promotion automation.** Production adds GitHub Actions for deploying functions and promoting changes; hybrid's workflows are centered on ICP/canister deployment and do not provide the same Supabase promotion path. Production: `4db1143f`, `.github/workflows/deploy-dev-function.yml`, `.github/workflows/promote-to-prod.yml`.
- **Production storage-folder synchronization and email-function deployment.** Production adds workflows/code to synchronize storage folders and deploy the email function. These are operational additions, not app features. Production: `042e5a5c`, `bfa4be8f`, `5e2fd114`.

## Already Present or Partially Present in Hybrid

- Standard CSV/XLSX and Dribl fixture imports exist; the PlayHQ cricket parser and its integrated competition-import workflow are the gaps.
- Competition broadcasts, member chat/settings, and competition chat posting scopes exist; the admin contact inbox and aggregate admin chat view are the gaps.
- Team-targeted club news exists; league-targeted news is missing.
- Individual event duties, manual reminder actions, and configurable scheduled RSVP reminders exist; team-wide duty assignment plus scheduled early RSVP/points and duty reminders are missing.
- Per-division ladder visibility and optional divisions exist; the whole-competition ladder toggle is missing.
- General custom invite text, QR downloads, existing-member checks, child/parent linking during team join, and admin group renaming exist; reusable message defaults and the production welcome-email flows are the gaps.
- Competition-scoped media metadata is supported in the backend model; the competition gallery UI and competition vault folders are missing.

## Not Ported as Gaps

Production changes that are fixes or polish rather than distinct additions were not listed as missing enhancements: fixture display/import bug fixes beyond the capabilities summarized above, chat push batching fixes, club filtering corrections, time formatting, and version-string updates. Division-optional support, QR invitations, child-link onboarding, and admin group renaming were checked and found already represented in hybrid.
