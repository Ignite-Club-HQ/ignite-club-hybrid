# ICP mode — off-chain gaps register

Audit date: 2026-10-14. Rule: in ICP mode everything except payments runs on-chain.

## Intentionally off-chain (by decision)
- Payments (Stripe card payments, storage purchases; only iOS IAP verification path). Promo codes moved on-chain 2026-10-14 (club_domain create/list/toggle/delete_promo_code, redeem_team_promo_code; migration 20261021). Paid-status records (team/club subscriptions) were already on club_domain. Storage promo redemption moved on-chain 2026-10-14 (club_domain redeem_club_storage_promo_code + get_club_storage_purchased; migration 20261022); vault reads the add-on GB on-chain. The "Sign up for Pro" wizard is not reachable for Internet Identity users (redirects home), so its Supabase redemption is email-account only; II users redeem team codes on the Upgrade page (on-chain).
- Email delivery, phone push delivery (queued on-chain, delivered by worker)
- PlayHQ import/stats, Google Drive linking, address search/maps
- Password / forgot-password / passkey settings
- ~~Post-game photo prompts worker~~ — moved on-chain (events_domain sweep, migration 20261020_000000; needs events_domain redeploy)
- Competition-admin search: ICP now searches by name (on-chain profiles); email search stays off-chain because emails are never stored readable on-chain

## Open gaps (2026-10-14 deep audit)
| # | Area | Location | Status |
|---|------|----------|--------|
| 1 | Parent team-invite: child from invite metadata not created | pages/JoinTeamPage.tsx (~1300) | fixed 2026-10-14 (untested on device) |
| 2 | Team chat member tap: roles read from Supabase (always empty) | components/chat/ChatParticipantsList.tsx handleMemberTap | fixed 2026-10-14 (untested on device) |
| 3 | Start New Season wizard step 3 carry-over uses Supabase RPC | components/seasons/StartNewSeasonWizard.tsx carryOverMut | fixed 2026-10-14 (untested on device) |
| 4 | Public EOI form shows placeholder in ICP | pages/PublicEoiFormPage.tsx | fixed 2026-10-14 (untested on device) |
| 5 | Team chat remove member / remove role blocked | pages/TeamChatPage.tsx (~410, ~439) | fixed 2026-10-14 (untested on device) |
| 6 | Recently removed clubs (restore / hard delete) hidden | pages/ClubsPage.tsx | fixed 2026-10-14 (untested on device) |
| 7 | Event page extras disabled (reminder cooldown, child-roster duty/attendance reads) | pages/EventDetailPage.tsx (isIcpAuthBackend gates) | fixed 2026-10-14 (untested on device) |

## Remaining known gaps
- FIXED 2026-10-14: live game spectator view uses the on-chain match timer + active-game pitch positions.
- Form-view tracking: Supabase-only insert, but no screen reads eoi_form_views in either mode — no user-visible gap.
- Public EOI form: no "send magic-link invite" email after an ICP submission (email delivery is off-chain by design); no form-view tracking.
- FIXED 2026-10-14: public EOI copy auto-republished when an admin opens the season's EOI card (no manual re-save).

## Not yet audited line-by-line
HomePage, ClubDetailPage, CompetitionDetailPage, CreateTeamPage, DirectMessagePage; components/vault, pitch, eoi, news subtrees.

## Closed (recent)
- Association club linking/unlinking + rollup (club_domain set_club_parent_org, migration 20261019)
- Duty unassign on-chain; engagement Competitions card on-chain
- App settings: AI recap, free-club polling, notification prefetch, legal re-acceptance on-chain


## PlayHQ (2026-10-14)
- Moved on-chain: team fixture import (events_domain import_playhq_team_fixtures, HTTPS outcall; creates/updates/cancels game events), auto-sync every 6 h (set_playhq_team_sync + recurring timer), PlayHQ key setup in the Internet Identity app settings page (governor only; get_playhq_config_status never returns the key). Migration events_domain 20261022.
- Limits: start times without an explicit offset use Australian/NZ zone offsets with approximate DST rules; games default to 90 minutes; JSON parsing is tolerant/flat (unusual payload shapes may import nothing — the call reports "No fixtures found").
- Still off-chain: association-linked PlayHQ competitions (mirrored ladder/fixtures/results on the association page) and PlayHQ player stats/claims (hidden in ICP mode).
