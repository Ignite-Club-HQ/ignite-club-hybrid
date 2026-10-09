import type { CapacitorConfig } from "@capacitor/cli";

// Native shell config for the Codemagic Android/iOS builds.
// The app runs the BUNDLED live build (dist-live) so it works fully in-app.
// Internet Identity sign-in hops through the canister-hosted bridge page in
// the system browser and returns via the com.igniteclubhq.app:// scheme, so
// accounts match the website (see src/live/nativeInternetIdentity.ts).
// appId is locked forever once uploaded to Google Play — change before first upload if needed.
const config: CapacitorConfig = {
  appId: "com.igniteclubhq.app",
  appName: "Ignite Club HQ",
  webDir: "dist-live",
  android: {
    // Mixed content off: all traffic is https (Supabase, ICP boundary nodes).
    allowMixedContent: false,
  },
  server: {
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
