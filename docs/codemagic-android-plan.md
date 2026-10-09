# Codemagic native build plan — Android + iOS

Status: workflows set up (2026-10-09, iOS added 2026-10-10). Waiting on Codemagic account
hookup and the signing secrets for whichever store you release to first.

## What was set up in this repo

- `frontend/capacitor.config.ts` — appId `com.igniteclubhq.app`, appName "Ignite Club HQ",
  webDir `dist-live` (matches the live build output).
- `frontend/package.json` — devDependencies `@capacitor/cli`, `@capacitor/android` and
  `@capacitor/ios` (v8, matching the already-installed Capacitor runtime plugins). The
  lockfile was refreshed so `npm ci` installs all three in CI.
- `codemagic.yaml` (repo root) — four workflows:
  - `android-debug`: unsigned debug APK, no secrets. Run this first.
  - `android-release`: signed AAB for Google Play, needs the `android_release` group.
  - `ios-debug`: unsigned **simulator** build, no Apple account needed. Proves the iOS
    toolchain only — the product cannot be installed on a real phone.
  - `ios-release`: signed App Store IPA, needs an Apple Developer Program membership plus
    the App Store Connect integration described below.

## Design decisions

- Neither native project (`android/`, `ios/`) is committed. Codemagic scaffolds them fresh
  each build (`npx cap add <platform>` + `npx cap sync <platform>`) after building the web
  app. Keeps the repo clean; native config lives in `capacitor.config.ts`.
- Web build uses the existing pipeline: `node scripts/ensure-frontend-deps.mjs` then
  `npm run build:live` (never bare `npm ci`).
- **The install step must run from the repo root.** `scripts/ensure-frontend-deps.mjs` lives
  at the repo root, not in `frontend/scripts/`, and resolves `frontend/` itself. Running it
  with `working_directory: frontend` fails with "Cannot find module" — that mistake was in
  the first draft of this file and is fixed.
- The app already detects native platforms (`Capacitor.isNativePlatform()`) and tolerates a
  missing Firebase config file, so debug builds work before Firebase is wired in.
- appId `com.igniteclubhq.app` is **locked forever once uploaded to either store** — change
  it in `capacitor.config.ts` before the first upload if you want a different one. On iOS it
  becomes the bundle identifier, and must match the App Store Connect app record.

## What you need to do in Codemagic

1. Sign up at codemagic.io, connect the GitHub repo, pick "codemagic.yaml" as the config source.
2. First run: trigger **Android debug APK** — proves the pipeline with zero secrets.
3. Then **iOS debug build (simulator)** — proves the macOS/Xcode side with zero secrets.
4. For Play Store releases, create environment variable group `android_release` with:
   - `CM_KEYSTORE` — base64 of your upload keystore:
     `base64 -i upload-keystore.jks | pbcopy`
     (create the keystore once with:
     `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ignite`)
   - `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS` (e.g. `ignite`), `CM_KEY_PASSWORD`
   - `GOOGLE_SERVICES_JSON` — base64 of `google-services.json` from the Firebase project
     (same project the push worker uses; package name must match the appId above).
5. For App Store releases:
   - Join the Apple Developer Program ($99/yr) — required, there is no free path to a
     installable iOS build.
   - In Codemagic **team settings**, add a Developer Portal / App Store Connect integration
     named `ignite` using an API key from App Store Connect -> Users and Access ->
     Integrations -> App Store Connect API (App Manager access). You need the Issuer ID, the
     Key ID, and the `.p8` file (downloadable once).
   - Create the app record in App Store Connect with bundle id `com.igniteclubhq.app`, then
     put its numeric Apple ID into `APP_STORE_APP_ID` in `codemagic.yaml`.
   - Optional group `ios_release`: `GOOGLE_SERVICE_INFO_PLIST` — base64 of
     `GoogleService-Info.plist` from the same Firebase project, for push on iOS.
6. Trigger the release workflow; the `.aab` / `.ipa` appears in the build artifacts. The iOS
   workflow also submits straight to TestFlight.

## Notes / open items

- **Push notifications are not wired natively yet.** `src/lib/nativePush.ts` loads
  `@capacitor-firebase/messaging` optionally and silently no-ops when it is absent — and it
  is not installed (`frontend/node_modules/@capacitor-firebase` does not exist). Until it is
  added, neither the Android nor the iOS app can receive pushes. Needs: install
  `@capacitor-firebase/messaging`, the Firebase config files above, and for iOS an APNs key
  uploaded to Firebase Cloud Messaging. The ICP-mode push backend (notification_queue + the
  worker) is already built and independent of this.
- iOS builds cost more in Codemagic minutes than Android ones (macOS instances are priced
  higher than Linux); the free tier is small on macOS.
- Deep links / invite links: the app handles them via DeepLinkGate. Android needs intent
  filters with the published domain added to the scaffolded `AndroidManifest.xml`, and iOS
  needs an Apple App Site Association file served from the domain plus associated-domains
  entitlement. Flag both when you get to store release.
