# Plan: Ignite frontend on ICP, Netlify retired, Lovable + hybrid backend ongoing

## Target setup

```text
Lovable (build & edit) --git--> GitHub
                                  |-- GitHub Action: deploy web build -> ICP frontend canister (custom domain)
                                  |-- Codemagic: native iOS/Android (bundled build) -> stores
Browser / app --> Supabase (data, auth, storage, 2 small server endpoints)
              --> ICP canisters (club, events, messaging, media, keys, push)
```

Lovable stays the place you build and preview. Lovable publishing stays on as a backup copy of the site. The hybrid backend does not change: each club or country still uses Supabase or ICP based on Placement Settings.

## Stage 1: Move the server endpoints off Netlify
- Remove the GIPHY endpoint. The app already reads the GIPHY key from Placement Settings.
- Move link previews and club-website registration to Supabase server functions. The shared secret stays in Supabase.
- Point the app at the new addresses, keeping Netlify as a fallback for one release.
- **Your part:** deploy the two functions (one command, or a deploy step) and add `APP_BACKEND_SYNC_SECRET` to Supabase.

## Stage 2: Create the frontend canister
- Add an asset canister to the existing mainnet deploy setup.
- Every page address loads the app. This fixes refresh and links shared to a specific page.
- Copy Netlify's security headers.
- Set long cache times for app files and keep the page itself fresh, so repeat visits load from the device.
- Compress files before upload.
- Make the offline helper store app files ahead of time, so repeat loads are instant.
- **Your part:** fund the new canister (about 0.5–1T cycles to start).

## Stage 3: Keep sign-in and accounts consistent
- Add the canister address and the future custom domain to the Internet Identity allowed list. Everyone keeps one account, tied to the main web address.
- Add the same addresses to Supabase Auth's site URL and redirect list, so email links, password resets and Google sign-in work.
- Native app: no change. It keeps its bundled copy and its own sign-in identity.

## Stage 4: Automatic deploys
- A GitHub Action builds the web app from `main` and uploads it to the frontend canister, using the same deployer-key pattern as the canister workflow.
- Codemagic keeps building the native apps exactly as it does today. An optional later step can also upload the web build, so one pipeline handles both.
- **Your part:** share `codemagic.yaml` so I can confirm which lines change (I expect none for the store builds).

## Stage 5: Test side by side, then switch over
- Run Netlify and the canister in parallel for one to two weeks.
- I'll time first and repeat visits on both and check sign-in, invites, deep links, push and payments.
- Move the custom domain to the canister (DNS record plus ICP domain registration).

## Stage 6: Retire Netlify
- After a stable period with no fallback traffic: delete the Netlify site and its deploy hook, and remove the Netlify config and fallback addresses from the code.
- Rollback is still possible after this: re-upload the previous build to the canister, or point the domain back at the Lovable-published copy.

## Ongoing way of working
- Edit in Lovable → push to git → the web app deploys to the canister on its own → run Codemagic when a store release is needed.
- Backend changes: canister changes go through the existing mainnet deploy script; Supabase changes are deployed as today.
- Check cycle balances in Placement Settings → Canister balances. Add the frontend canister to that list.

## Cost
- Frontend canister: cents per year for storage, plus a small amount for each page served. Likely under $1–3 a month at current size.
- Supabase: $0 extra. Netlify: saves the account.
- Codemagic: unchanged.

## Technical details
- Files: `deploy/mainnet/icp.yaml` (asset canister and the `.ic-assets.json5` headers/cache/fallback), `scripts/deploy-mainnet.sh`, new `.github/workflows/deploy-frontend-canister.yml`, `frontend/public/.well-known/ii-alternative-origins`, endpoint base URL config, the offline helper (service worker) precache, and canister-balance list entries.
- The build keeps emitting `dist/index.html`. Root package.json stays dependency-free.
