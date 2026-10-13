# ICP mode — off-chain gaps register

Audit date: 2026-10-14. Rule: in ICP mode everything except payments runs on-chain.

## Intentionally off-chain (by decision)
- Payments (Stripe, promo codes, storage purchases; only iOS IAP verification path)
- Email delivery, phone push delivery (queued on-chain, delivered by worker)
- PlayHQ import/stats, Google Drive linking, address search/maps
- Password / forgot-password / passkey settings
- Post-game photo prompts worker
- Competition-admin search by email (paste II principal instead)

## Open gaps (2026-10-14 deep audit)
| # | Area | Location | Status |
|---|------|----------|--------|
| 1 | Parent team-invite: child from invite metadata not created | pages/JoinTeamPage.tsx (~1300) | open |
| 2 | Team chat member tap: roles read from Supabase (always empty) | components/chat/ChatParticipantsList.tsx handleMemberTap | open |
| 3 | Start New Season wizard step 3 carry-over uses Supabase RPC | components/seasons/StartNewSeasonWizard.tsx carryOverMut | open |
| 4 | Public EOI form shows placeholder in ICP | pages/PublicEoiFormPage.tsx | open |
| 5 | Team chat remove member / remove role blocked | pages/TeamChatPage.tsx (~410, ~439) | open |
| 6 | Recently removed clubs (restore / hard delete) hidden | pages/ClubsPage.tsx | open |
| 7 | Event page extras disabled (reminder cooldown, child-roster duty/attendance reads) | pages/EventDetailPage.tsx (isIcpAuthBackend gates) | open |

## Not yet audited line-by-line
HomePage, ClubDetailPage, CompetitionDetailPage, CreateTeamPage, DirectMessagePage; components/vault, pitch, eoi, news subtrees.

## Closed (recent)
- Association club linking/unlinking + rollup (club_domain set_club_parent_org, migration 20261019)
- Duty unassign on-chain; engagement Competitions card on-chain
- App settings: AI recap, free-club polling, notification prefetch, legal re-acceptance on-chain
