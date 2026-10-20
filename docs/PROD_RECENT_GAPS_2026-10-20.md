# Recent Production Additions Gap Review

Comparison date: 2026-10-20  
Production source: `Ignite-Club-HQ/ignite-club_hq-prod` `main`, current at `f0699409` (2026-10-19)  
Compared with: `Ignite-Club-HQ/ignite-club-hybrid` current `main` checkout  
Window reviewed: 2026-10-18 through 2026-10-19

This is a focused follow-up to the [2026-10-07 production gap review](PROD_ENHANCEMENTS_GAP_REVIEW_2026-10-07.md). The drill/training subsystem was explicitly excluded from this scan. Production uses Supabase while hybrid uses ICP canisters for many features; the items below describe behavior to assess and implement in the hybrid architecture, not production SQL to copy verbatim.

## Candidate Work To Bring Into Hybrid

### Competition Score Privacy and Result Storage

Production added competition-wide and per-division `hide_scores` controls, moved scores out of `competition_matches` into `competition_match_results`, and updated result reads/writes, public/detail/ladder presentation, RLS, and PlayHQ score synchronization. The production change spans the October 18 competition migrations and `CompetitionFixturesPanel`, `CompetitionSettingsPage`, `CompetitionDetailPage`, and `PublicCompetitionPage`.

Hybrid currently stores `home_score` and `away_score` directly on `competition_domain.Match`; its types and frontend have no matching hidden-score policy. Hybrid also has no production `playhq-sync` Supabase Edge Function: PlayHQ integration is routed through `events_domain`. This is therefore a feature-level gap requiring an ICP-native design, not a port of the eight SQL migrations.

**Build in hybrid:**

- Add competition-wide and division-level hidden-score settings with appropriate manager-only writes.
- Enforce score visibility at the canister/API boundary so unauthorized callers do not receive hidden scores; hiding values only in the UI is insufficient.
- Keep authorized manager views able to inspect and enter results, while public/member fixture and ladder views obey the policy.
- Adapt every result path, including PlayHQ refresh/import where applicable, so external sync cannot reveal or overwrite protected results.
- Define how this interacts with the current match record and its history/revision model before changing the Candid contract.
- Add canister authorization tests and frontend tests for managers, ordinary members, anonymous/public viewers, competition-wide settings, division overrides, ladder visibility, and PlayHQ updates.

Production references: score-table/privacy commits `d272ba08`, `422351da`, `2af795fc`, `a859338e`, and follow-up visibility changes through `7833b8b5`; merged by PR #1406 (`1cd8d0d1`).

### Competition Analytics Completion Semantics

Production changed the Competition panel's “Results entered” count to count matches whose status is `completed`. Hybrid's [ClubEngagementAnalyticsPage.tsx](../frontend/src/pages/ClubEngagementAnalyticsPage.tsx) still counts matches with non-null home and away scores. Those conditions may diverge for incomplete, cancelled, or partially entered matches.

**Build in hybrid:** use the canonical `competition_domain` match status for the metric, and add tests proving that only completed matches count, including matches with scores but a non-completed status and completed matches with unusual score values if the domain permits them.

Production reference: `2ef8f2a4` (2026-10-18).

### Lovable Preview Authentication Recovery

Production updated `src/integrations/supabase/previewAuthStorage.ts` so a newly opened preview tab can seed its local session from the editor's brokered session, sends the local value with broker get/remove requests, and tolerates blocked third-party localStorage access. Hybrid's [previewAuthStorage.ts](../frontend/src/integrations/supabase/previewAuthStorage.ts) does not include those behaviors. In the hybrid file, the fallback editor-origin list also uses `reference.invalid`; verify and correct the intended trusted origins as part of this work.

**Build in hybrid:** preserve the existing trusted-origin checks; make storage reads/writes resilient when browser privacy settings block localStorage; let a new preview tab recover a brokered session; and ensure logout tombstones do not resurrect stale local sessions. Add tests for first-tab and new-tab recovery, storage exceptions, retry behavior, logout, and rejection of untrusted message origins.

Production reference: `879b2895` and its follow-up within the October 18–19 production history.

## Not A Direct Port

- Production's `playhq-sync` change writes scores to its new Supabase results table. Hybrid has no matching edge function and uses the events canister for PlayHQ integration; account for this under the score-privacy work rather than copying the Edge Function.
- Production's October 19 Codemagic workflow and `codemagicLockedInstall.test.ts` target that repository's package/lockfile layout. Hybrid already uses `scripts/ensure-frontend-deps.mjs` and its own monorepo build workflow. Do not replace the hybrid install flow with production's `npm ci`; only bring over a separately justified workflow assertion if it matches hybrid's pipeline.
- Drill/training additions are intentionally outside this review, per request.

## Scope And Caveats

This review covered production `main` changes dated October 18–19 and the directly corresponding hybrid source. It is not a full repository-wide parity audit. No implementation was changed while preparing this document.