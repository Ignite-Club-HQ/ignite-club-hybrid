// Turns the live build (dist-live) into the folder the ICP frontend canister
// serves (dist-canister): index.html entry, SPA fallback (_redirects) and the
// security/cache headers Netlify used to apply (_headers). Read by the
// @dfinity/static-site recipe; see deploy/frontend/icp.yaml.
import { cpSync, existsSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
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

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log("dist-canister ready");
