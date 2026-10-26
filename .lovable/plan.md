# Club migration tool: Supabase to a chosen canister group

## Recommendation: GitHub workflow, started from an admin page
- **Run in GitHub (like group upgrades).** A move needs the Supabase service key and the deploy identity. Neither may ever reach a phone or browser. A move can also take longer than a page stays open, and the existing protected-release journal already gives safe resume.
- **Start it from an admin page.** A small page, "Migrate club", inside the existing admin area. You pick a club and a target group and see a dry-run summary. The page then gives you a pre-filled workflow link, so nobody types IDs by hand. Progress and the final report appear on the same page.

## What one run does (one whole club)
1. **Check (read-only):** counts every record and file for the club. It confirms the target group is open, has room and passes its admission checks. It confirms the club isn't already on-chain anywhere. It produces a plan hash.
2. **Migrate:** requires the plan hash and typed confirmation words. Steps in order:
   - Club, teams, roles, children (names encrypted), memberships
   - Events, RSVPs, duties, captains, POTM, results
   - Chats and messages (paged), polls, scheduled messages
   - News, rewards and points history, competitions, mini-leagues, notifications
   - Photos, chat files and Vault files: downloaded from Supabase Storage, encrypted on the way in, uploaded to the group's photo store, registered for access
3. **Verify:** reads everything back from the canisters and compares counts and file hashes with the source.
4. **Route:** only after verification passes, the club's sign-in is switched to ICP (the existing per-club home country / Placement rules).
5. **Supabase copy stays untouched**, as you chose. It is never modified or deleted.

## Safety rules
- **Resume and retry:** each step is journaled. An interrupted run resumes from the last confirmed page. A step whose outcome is unknown is never replayed blindly.
- **Encrypted-media policy:** a club that already has encrypted photos in a group is refused. This follows the existing policy that photo-bearing clubs stay put.
- **No partial cut-over:** if any step or the verification fails, routing is not changed and members keep using Supabase.
- **Capacity:** refuses when the target group would pass the 80% fill threshold.

## Open decision: member accounts
Supabase members sign in by email. On-chain data belongs to Internet Identity accounts, so we must decide how each person's data finds them:
- **Proposed:** each Supabase member's data is held under a reserved placeholder. On their first Internet Identity sign-in, a one-time verified email link claims it. The link uses the existing invite/receipt flow. Children, RSVPs, points and messages then attach to that new account.
- Members who already have a linked Internet Identity account are mapped directly.

## Technical details
- New `scripts/migrate-club.mjs` and `migrate-club-plan.mjs`, plus tests, and workflow `migrate-club.yml` with check/migrate/recover actions. Inputs: club ID, target group, plan hash and confirmation.
- Uses each domain's existing `import_club_snapshot` (and the paged messaging import). Snapshots are built from Supabase with the service key, inside the workflow only.
- Media is fetched with signed Storage URLs and IBE-encrypted using the same code as `mediaUpload.ts`/`piiVetKeys.ts`. Each file goes to the target group's `media_blob_store` with its `pii_access_control` record and club read grant.
- The identity placeholder and claim need a small club_domain/identity addition, released through the protected all-group upgrade.
- Admin page: `/admin/club-migration`, app admins only. It only reads and launches; it holds no secrets.
- Retired drills/pitch data are excluded.
