// Turns the live build (dist-live) into the folder the ICP frontend canister
// serves (dist-canister): index.html entry, SPA fallback (_redirects) and the
// security/cache headers Netlify used to apply (_headers). Read by the
// @dfinity/static-site recipe; see deploy/frontend/icp.yaml.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = `${root}dist-live`;
const out = `${root}dist-canister`;
if (!existsSync(src)) throw new Error("dist-live missing — run `npm run build:live` first");

rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });
rmSync(`${out}/bundle-analysis.html`, { force: true });
rmSync(`${out}/bundle-analysis.json`, { force: true });
if (!existsSync(`${out}/index.html`)) copyFileSync(`${out}/live-index.html`, `${out}/index.html`);

writeFileSync(`${out}/_redirects`, "/*  /index.html  200\n");

// Every address of this canister signs in to Internet Identity as
// https://<id>.icp0.io (see resolveDerivationOriginFor in
// src/live/internetIdentityAuth.ts), so the canonical address must list the
// others here — otherwise icp.net and icp0.io give one person two identities.
const frontendCanisterId = process.env.FRONTEND_CANISTER_ID || "proe7-kqaaa-aaaas-qg6gq-cai";
mkdirSync(`${out}/.well-known`, { recursive: true });
writeFileSync(
  `${out}/.well-known/ii-alternative-origins`,
  JSON.stringify(
    {
      alternativeOrigins: [
        `https://${frontendCanisterId}.icp.net`,
        `https://${frontendCanisterId}.raw.icp0.io`,
        `https://${frontendCanisterId}.raw.icp.net`,
        `https://${frontendCanisterId}.ic0.app`,
        `https://${frontendCanisterId}.raw.ic0.app`,
        // Club website (separate project) signs in as this canister too, so
        // one person gets the same principal on the app and the website.
        "https://igniteclubhq.com",
        "https://ignite-club-heart.lovable.app",
      ],
    },
    null,
    2,
  ) + "\n",
);

// Phones sign in by sending the whole page to Internet Identity and back
// (see shouldUseRedirectSignIn in src/live/internetIdentityAuth.ts). II only
// returns to an address listed here, matched exactly, for each canister host.
const callbackHosts = ["icp0.io", "raw.icp0.io", "icp.net", "raw.icp.net", "ic0.app", "raw.ic0.app"];
writeFileSync(
  `${out}/.well-known/ii-auth-callbacks`,
  JSON.stringify({ callbacks: callbackHosts.map((h) => `https://${frontendCanisterId}.${h}/auth`) }, null, 2) + "\n",
);

const csp = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self'",
  "connect-src 'self' https://api.giphy.com https://cdrxmelhysdqrccttsjg.supabase.co wss://cdrxmelhysdqrccttsjg.supabase.co https://icp-api.io https://*.icp0.io https://*.ic0.app https://*.icp.net https://id.ai https://api.country.is https://photon.komoot.io",
  "frame-src https://id.ai https://www.google.com https://www.youtube.com",
  "object-src 'none'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "media-src 'self' blob:",
].join("; ");

writeFileSync(
  `${out}/_headers`,
  `/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Content-Security-Policy: ${csp}
  Cache-Control: no-cache

/.well-known/ii-alternative-origins
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log("dist-canister ready");
