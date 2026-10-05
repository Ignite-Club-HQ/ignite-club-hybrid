# Roadmap

## Club creation / "Club not found" (ICP mode)
- [x] Verified user's club "Dingo" (ee23c110-6332-4913-a54e-df704956dcc3) exists on club_domain canister — creation succeeded
- [x] "Club not found" dead-end now has a "Back to Clubs & Teams" link (ClubDetailPage)
- [x] Club creation failures now log the real error to console (CreateClubPage) for telemetry
- [ ] Root-cause: preview repro shows create_club failing for a brand-new II user ("Failed to create club" toast, no message) — needs the new console error from a real attempt
- [ ] Root-cause: setup-wizard team creation failed silently in preview repro — same logging gap
- [ ] Stale activeClubTheme (deleted Test club id) is the likely cause of the user's "Club not found" — consider auto-clearing the filter when the club can't be loaded
- [ ] ICP-mode Supabase leaks (PostgREST 400s, principal-as-UUID): InviteAutoAccept, profileCache batch, club-backend enforcement

## Team chat send fails in ICP mode ("Failed to send message")
- [x] Root-caused: live canisters predate the chat-provisioning code. Probed mainnet: messaging_domain has no `ensure_conversation`, club_domain has no `ensure_club_conversations` (also missing: `get_pending_invite`, `accept_team_invite_link`). Frontend sends with conversation id = team id, old canister has no such conversation -> `send_message` returns "Conversation access forbidden" -> generic toast.
- [x] Verified no code fix needed: frontend already self-heals (ensure-before-send), deploy script wires club_domain<->messaging_domain both ways, isMember passes for the club creator, `icp deploy` upgrades in place (Dingo club + messages survive).
- [ ] User: re-run "Deploy ICP mainnet" workflow — ships the chat provisioning (fixes this), plus invites/media-tagging/news methods.

## Pending user actions (from earlier work)
- Deploy `send-email` edge function (paste /mnt/documents/send-email-supabase-function.ts, Verify JWT OFF, RESEND_API_KEY)
- Re-run "Deploy ICP mainnet" workflow (chat provisioning, invites, media tagging, news publishing, app settings) — CONFIRMED the cause of the team-chat send failure; nothing else will fix it
