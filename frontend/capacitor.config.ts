import type { CapacitorConfig } from "@capacitor/cli";

// Native shell config for the Codemagic Android/iOS builds.
// webDir must match the live build output (frontend/scripts/build-live.mjs -> dist-live).
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
    // Production build loads the bundled web app; never point this at a dev URL.
    androidScheme: "https",
  },
};

export default config;
