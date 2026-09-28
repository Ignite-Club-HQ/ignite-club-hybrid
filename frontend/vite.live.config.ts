import path from "node:path";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

if (process.env.IGNITE_LIVE_BUILD !== "1") {
  throw new Error("Live builds must use the guarded build:live script");
}

const root = process.cwd();

export default defineConfig({
  envDir: false,
  envPrefix: "IGNITE_LIVE_",
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: [
      {
        find: "@/integrations/supabase/client",
        replacement: path.resolve(root, "src/integrations/supabase/liveClient.ts"),
      },
      {
        // Swaps the lab-only (localhost-restricted) Internet Identity auth
        // module for the live mainnet/Cloud Engine one, without touching
        // `IcpAuthProvider` in `src/hooks/useAuth.tsx`, which dynamically
        // imports this specifier either way.
        find: "@/lab/internetIdentityAuth",
        replacement: path.resolve(root, "src/live/internetIdentityAuth.ts"),
      },
      {
        // Every page and shared data-layer module hardcodes
        // `resolveLocalAuthMode(search, true)`, which forces fixture/ICP-lab
        // data and Internet-Identity-only auth (via `App.tsx`'s
        // `useIcpAuth`) unconditionally. This swap makes the live build
        // default to the real Supabase client/auth instead, since none of
        // the ~100+ call sites can be edited individually to pass a
        // live-specific flag. See `src/live/localRuntimeMode.ts` for detail.
        find: "@/lab/localRuntimeMode",
        replacement: path.resolve(root, "src/live/localRuntimeMode.ts"),
      },
      {
        find: /^@\/lab\/(fixtureDataLayer|localActor|localCompetitionService|localEventsService|localIdentityAccess|localMediaMetadata|localMessagingService|syntheticIdentities\.mjs)$/,
        replacement: path.resolve(root, "src/live/disabledLabRuntime.ts"),
      },
      { find: "@", replacement: path.resolve(root, "src") },
    ],
  },
  plugins: [
    {
      // The live entry point is live-index.html (not the default index.html),
      // so rewrite the root URL in dev — otherwise the dev server 404s on "/".
      name: "ignite-live-index-rewrite",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const path = (req.url || "/").split("?")[0];
          // SPA fallback: every page route (no file extension) must serve
          // live-index.html, otherwise deep links like /auth 404. Vite
          // internals (/@vite/client, /@id/...), source modules and other
          // assets must pass through untouched.
          const isInternal =
            path.startsWith("/@") ||
            path.startsWith("/src/") ||
            path.startsWith("/node_modules/");
          if (!isInternal && !path.includes(".")) {
            const query = req.url!.includes("?") ? req.url!.slice(req.url!.indexOf("?")) : "";
            req.url = "/live-index.html" + query;
          }
          next();
        });
      },
    },
    visualizer({
      filename: "dist-live/bundle-analysis.html",
      template: "treemap",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
    visualizer({
      filename: "dist-live/bundle-analysis.json",
      template: "raw-data",
      gzipSize: true,
      brotliSize: true,
      open: false,
    }),
  ],
  build: {
    outDir: "dist-live",
    emptyOutDir: true,
    target: ["es2020", "safari15"],
    sourcemap: false,
    rollupOptions: {
      input: "live-index.html",
    },
  },
});
