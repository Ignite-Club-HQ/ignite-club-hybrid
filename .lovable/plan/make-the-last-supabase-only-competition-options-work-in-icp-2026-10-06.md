# Make the last Supabase-only competition options work in ICP mode

Four competition features still only work on Supabase. In ICP mode they are hidden right now. This plan makes each one work on the canisters, with the same screens Supabase users see.

## What you'll get
1. **Broadcast** (competition detail page): organisers send a message to every team in the competition. Members get a push notification and see it in the broadcasts badge and list.
2. **Hide ladder per division** (settings page): the per-division switch saves, and the ladder page respects it.
3. **Competition admins** (settings page): add or remove extra admins. They can then manage the competition the same way the organiser club's admins can.
4. **Competition chat toggle** (settings page): turning it on creates the competition group chat for entered teams' staff. Turning it off archives the chat.

## Technical details
- **competition_domain**: a new, later-dated migration (applied migration files stay unchanged) adds:
  - `divisionSettings` (competition, division → hide_ladder)
  - `competitionAdmins` (competition → principals)
  - `chatEnabled` / `chat_group_id`
  - a `broadcasts` log
- **New methods:** `set_division_hide_ladder`, `add_competition_admin`, `remove_competition_admin`, `list_competition_admins`, `set_competition_chat`, `send_competition_broadcast`, `list_competition_broadcasts`.
- **Who can manage:** the governor, the organiser club's admins (checked live on club_domain), or anyone listed as a competition admin.
- **Broadcast delivery:** recipients come from the club_domain members of entered teams and are sent through the existing notification_queue fan-out. This needs a new deploy-script wiring call, `competition_domain.set_notification_queue_canister` + `set_club_domain_canister`, and stays fail-closed while those are unset.
- **Chat:** set up through messaging_domain (create/archive group). This adds `competition_domain.set_messaging_domain_canister` to the deploy script.
- **Updates to existing pieces:**
  - Regenerated Candid and bindings, plus the drift check.
  - The frontend helpers in `live/features/competitions.ts`.
  - The ICP branches in CompetitionSettingsPage, BroadcastPanel and BroadcastsHeaderBadge, and the ICP branch for the ladder page.
- **Backend AGENTS.md:** add the new wiring rule.
- **To go live:** this needs a mainnet canister redeploy and then a publish. The photo-access canister must be topped up first.
