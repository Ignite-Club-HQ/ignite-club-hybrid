# Roadmap — ICP speed-up part 2
- [x] Match legal/contact links across sign-in modes; repair profile and internal policy destinations; 24 tests passed and all five pages plus profile policy links opened in browser (full signed-in profile/native-device check requires account/device access)
- [x] Refine login with platform-neutral embedded-browser and error guidance; text-only provider attribution retained; 29 checks and live normal/embedded-browser presentation verified
- [x] Simplify ICP login presentation without changing authentication; 49 regression checks passed; browser layouts, popup opening and cancellation verified
- [ ] Confirm real Internet Identity account sign-in on physical Android/iOS, installed apps/PWA and Facebook/Messenger — requires device access and user approval for an account sign-in
- [x] Shared batching helper (live/features/batching.ts)
- [x] Events batched reads (list_events_multi, get_event_rosters, list_duties_multi)
- [x] Messaging batched reads (mute prefs, group metadata, groups by clubs)
- [x] Names / child names — already batched + cached, no change needed
- [x] Mini-league + sponsor batching (competitions/media/vault/points had no per-item fan-out)
- [x] Optimistic RSVP on event cards (chat send/reactions already optimistic)
- [ ] Chat-open bundle (messages+reactions+pins) — low gain: those calls already run in parallel
- [ ] Idle prefetch of Schedule/Messages after Home
- [ ] Call-count instrumentation — measure after mainnet deploy
- [x] Fix Dingo U8 event create going to Supabase (II users stay on canisters)
- [x] Photo storage sharding (needs mainnet deploy for fullness limits)
- [x] ICP Children page: add/remove children, team assignment, guardians (club_domain parent self-service methods; needs mainnet redeploy)
- [x] My Roles (ICP): real club/team names, hide deleted clubs

## Frontend on ICP / retire Netlify
- [x] Remove GIPHY endpoint (app reads key from Placement Settings)
- [ ] Home for link-preview + club-website-registration endpoints — blocked: platform disallows new Supabase Edge Functions; awaiting user choice
- [x] Frontend canister config, packaging (headers, cache, SPA fallback), deploy workflow
- [x] Canister addresses sign in as the published-site account (needs canister ID added to ii-alternative-origins after first deploy)
- [ ] First deploy + fund canister (user), add canister origin to II list + Supabase Auth redirects
- [ ] Review codemagic.yaml (user to share)
- [ ] Side-by-side test, move custom domain, delete Netlify
