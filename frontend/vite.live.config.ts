import path from "node:path";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
// @ts-expect-error plain-JS Netlify function handlers have no type declarations
import giphySearchHandler from "./netlify/functions/giphy-search.mjs";
// @ts-expect-error plain-JS Netlify function handlers have no type declarations
import fetchLinkPreviewHandler from "./netlify/functions/fetch-link-preview.mjs";
// @ts-expect-error plain-JS Netlify function handlers have no type declarations
import registerClubBackendHandler from "./netlify/functions/register-club-backend.mjs";

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
      // Serves the same-origin /api endpoints in the preview that Netlify
      // Functions serve in production (frontend/netlify/functions/*). Must be
      // registered before ignite-live-index-rewrite, which would otherwise
      // rewrite these extensionless paths to live-index.html.
      name: "ignite-live-api",
      configureServer(server) {
        const routes: Record<string, (req: Request) => Promise<Response>> = {
          "/api/giphy-search": giphySearchHandler,
          "/api/fetch-link-preview": fetchLinkPreviewHandler,
          "/api/register-club-backend": registerClubBackendHandler,
        };
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url || "/").split("?")[0];
          const handler = routes[path];
          if (!handler) return next();
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks);
            const request = new Request(`http://localhost${path}`, {
              method: req.method ?? "GET",
              headers: {
                "content-type": req.headers["content-type"] ?? "application/json",
                ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
              },
              body: body.length > 0 ? body : undefined,
            });
            const response = await handler(request);
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end(Buffer.from(await response.arrayBuffer()));
          } catch {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: "Internal error" }));
          }
        });
      },
    },
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
