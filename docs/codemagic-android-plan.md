# Codemagic Android build — implementation plan

Status: workflow set up (2026-10-09). Waiting on Codemagic account hookup and signing secrets.

## What was set up in this repo

- `frontend/capacitor.config.ts` — appId `com.igniteclubhq.app`, appName "Ignite Club HQ",
  webDir `dist-live` (matches the live build output).
- `frontend/package.json` — added devDependencies `@capacitor/cli` and `@capacitor/android` (v8,
  matching the already-installed Capacitor runtime plugins).
- `codemagic.yaml` (repo root) — two workflows:
  - `android-debug`: unsigned debug APK, no secrets. Run this first.
  - `android-release`: signed AAB for Google Play, needs the secrets below.

## Design decisions

- The `android/` native project is **not committed**. Codemagic scaffolds it fresh each build
  (`npx cap add android` + `npx cap sync android`) after building the web app. Keeps the repo
  clean; native config lives in `capacitor.config.ts`.
- Web build uses the existing pipeline: `node scripts/ensure-frontend-deps.mjs` then
  `npm run build:live` (never bare `npm ci`).
- The app already detects native platforms (`Capacitor.isNativePlatform()`) and tolerates a
  missing `google-services.json`, so the debug build works before Firebase is wired in.
- appId `com.igniteclubhq.app` is **locked forever once uploaded to Google Play** — change it in
  `capacitor.config.ts` before the first upload if you want a different one.

## What you need to do in Codemagic

1. Sign up at codemagic.io, connect the GitHub repo, pick "codemagic.yaml" as the config source.
2. First run: trigger **Android debug APK** — proves the pipeline with zero secrets.
3. For Play Store releases, create an environment variable group `android_release` with:
   - `CM_KEYSTORE` — base64 of your upload keystore:
     `base64 -i upload-keystore.jks | pbcopy`
     (create the keystore once with:
     `keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias ignite`)
   - `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS` (e.g. `ignite`), `CM_KEY_PASSWORD`
   - `GOOGLE_SERVICES_JSON` — base64 of `google-services.json` from the Firebase project
     (same project the push worker uses; package name must match the appId above).
4. Trigger **Android release AAB**; the `.aab` appears in the build artifacts.
5. Upload the AAB to Google Play Console (Internal testing track first).

## Notes / open items

- Push notifications on the Android app need the Firebase google-services.json in the release
  workflow (step 3) plus the FCM backend secrets already discussed for ICP-mode push.
- iOS can be added later as a third workflow (macOS instance, Xcode, Apple signing certs) —
  not covered here.
- Deep links / invite links: the app already handles them via DeepLinkGate; the Android
  App Links intent filters will need the published domain added to the scaffolded
  `AndroidManifest.xml` when you get to store release — flag it then.
