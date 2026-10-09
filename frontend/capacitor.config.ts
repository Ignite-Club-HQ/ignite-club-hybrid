import type { CapacitorConfig } from "@capacitor/cli";

// Native shell config for the Codemagic Android/iOS builds.
// The app loads the LIVE web copy (frontend canister) instead of the bundled
// files, so Placement Settings routing (email/Supabase vs blockchain) behaves
// exactly as in the browser and Internet Identity derives the SAME account as
// the website (sign-in origin = the canister's https address). dist-live is
// still bundled as Capacitor's required webDir / offline fallback asset set.
// Override the address per build with IGNITE_NATIVE_APP_URL (e.g. an engine copy).
// appId is locked forever once uploaded to Google Play — change before first upload if needed.
const LIVE_APP_URL =
  process.env.IGNITE_NATIVE_APP_URL || "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io";

const config: CapacitorConfig = {
  appId: "com.igniteclubhq.app",
  appName: "Ignite Club HQ",
  webDir: "dist-live",
  android: {
    // Mixed content off: all traffic is https (Supabase, ICP boundary nodes).
    allowMixedContent: false,
  },
  server: {
    url: LIVE_APP_URL,
    androidScheme: "https",
    cleartext: false,
    // Keep sign-in pages inside the app so the login result returns to it.
    allowNavigation: [
      "proe7-kqaaa-aaaas-qg6gq-cai.icp0.io",
      "*.icp0.io",
      "*.icp.net",
      "*.ic0.app",
      "id.ai",
      "*.id.ai",
      "identity.ic0.app",
      "identity.internetcomputer.org",
      "*.supabase.co",
      "accounts.google.com",
    ],
  },
};

export default config;
