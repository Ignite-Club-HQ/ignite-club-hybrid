# Roadmap

## Club creation / "Club not found" (ICP mode)
- [x] Verified user's club "Dingo" (ee23c110-6332-4913-a54e-df704956dcc3) exists on club_domain canister — creation succeeded
- [x] "Club not found" dead-end now has a "Back to Clubs & Teams" link (ClubDetailPage)
- [x] Club creation failures now log the real error to console (CreateClubPage) for telemetry
- [ ] Root-cause: preview repro shows create_club failing for a brand-new II user ("Failed to create club" toast, no message) — needs the new console error from a real attempt
- [ ] Root-cause: setup-wizard team creation failed silently in preview repro — same logging gap
- [ ] Stale activeClubTheme (deleted Test club id) is the likely cause of the user's "Club not found" — consider auto-clearing the filter when the club can't be loaded
- [ ] ICP-mode Supabase leaks (PostgREST 400s, principal-as-UUID): InviteAutoAccept, profileCache batch, club-backend enforcement

## Pending user actions (from earlier work)
- Deploy `send-email` edge function (paste /mnt/documents/send-email-supabase-function.ts, Verify JWT OFF, RESEND_API_KEY)
- Re-run "Deploy ICP mainnet" workflow (invites, media tagging, news publishing, app settings)
