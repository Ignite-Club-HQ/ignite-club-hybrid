# One app, backend chosen by the club's home country

## Goal
A single iOS/Android/web app. Each club's data lives on the backend that fits its jurisdiction. The app works out where to load from on its own. Users never pick a backend, and the rule stays the same no matter which page they're on.

## The rule
```text
club.home_country  --(country map, set once at creation)-->  club.backend (supabase | icp | engine id)
user signs in      --> the account system for their *home region*
every page         --> loads club data from that club's backend (nothing else matters)
```
- **A club's backend is fixed when the club is created**, based on the country it chooses. After that it only changes through a deliberate migration, never through a toggle.
- **Users** belong to one account system, picked from their country at sign-up. A user whose clubs sit on a different backend still sees them. That works because a club page always reads from the club's own backend.
- **Default for countries with no rule:** Supabase, until the blockchain side has been proven with real clubs.
- Strict-residency countries (from the existing list) are pinned to a regional backend. They never fall back to the public blockchain.

## Phases
1. **Clean up (now)**
   - Remove the per-club override setting and the Bridgewater pin from Placement Settings and the routing config.
   - Rule for the meantime: email sign-in uses Supabase and secure sign-in uses the blockchain. This ends the "not found" and blank-page bugs.
2. **Record the club's home**
   - The club creation wizard asks for the club's country (pre-filled from the device's country).
   - The backend is worked out from the country map and saved on the club. Admins can see it but not edit it.
   - Existing Supabase clubs get their country filled in and are marked "supabase".
3. **Route by club**
   - One shared check, "backend for club X", returns the saved backend. Club, team, messages, media, events and vault pages all use only this check.
   - It stops looking at the device's saved sign-in, the URL setting and the selected-club guesswork.
4. **Account system by region**
   - The sign-in screen is chosen from the user's country (existing country routing). `?auth=` links stay as an admin/testing escape hatch.
5. **Later: regional backends**
   - When you launch in the US or EU, deploy that region's backend (a cloud engine or mainnet), add it to the country map, and new clubs there land on it automatically.

## Out of scope for now
- Moving existing clubs between backends (needs its own migration tool).
- Sharing one account across both account systems (needs the custom-domain sign-in work).

## Technical details
- `backendRouting.ts`: drop `clubBackendOverrides` from parsing and defaults, and ignore the key in stored config for backward compatibility. Add `resolveBackendForCountry(code)` that reuses `countryRules`/`countryTargets`.
- Supabase: add `clubs.home_country text` and `clubs.backend text`, plus a backfill migration. On the canister side, add the same fields to club_domain through a new later-timestamped migration.
- New `live/clubBackend.ts`: `getClubBackend(clubId)`, cached, which replaces the `isFeatureRoutedToIcp`/`withFeatureBackend` club logic. Remove the club-pin enforcement branches in `ClubBackendEnforcement.tsx` and `loadBackendRouting.ts`.
- Keep the `isSignedInWithEmail` guard during phase 1 only. Replace it with the club-based check in phase 3.
- Tests: a routing test for each phase (an email user in a blockchain-country club, a secure-sign-in user in a Supabase club, a strict-residency country never reaching mainnet).
