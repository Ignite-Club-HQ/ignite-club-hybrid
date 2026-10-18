// Turns the live build (dist-live) into the folder the ICP frontend canister
// serves (dist-canister): index.html entry, SPA fallback (_redirects) and the
// security/cache headers Netlify used to apply (_headers). Read by the
// @dfinity/static-site recipe; see deploy/frontend/icp.yaml.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
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
        "https://www.igniteclubhq.com",
        "https://ignite-club-heart.lovable.app",
        "https://pjx2u-tiaaa-aaaac-qhj3a-cai.icp0.io",
        "https://id-preview--4b755d42-e84b-4c9c-a8c7-5afa433410a4.lovable.app",
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
  JSON.stringify({ callbacks: callbackHosts.flatMap((h) => ["/auth", "/native-sign-in.html", "/native-sign-in"].map((p) => `https://${frontendCanisterId}.${h}${p}`)) }, null, 2) + "\n",
);

// ICP MCP Layer 1 (required): the canister manifest AI agents use to
// discover this app (docs.internetcomputer.org/guides/frontends/
// service-discoverability). Served as real JSON at the extensionless path;
// real files win over the /* SPA rewrite on the static-site recipe.
// Canister IDs come from the same sources the app itself uses: the
// IGNITE_LIVE_ICP_CANISTER_IDS_JSON build env, falling back to the deployed
// mainnet ID table committed at deploy/mainnet/.icp/data/mappings/ic.ids.json.

const CANISTER_ROLES = {
  club_domain: ["clubs", "Clubs, teams, memberships and role grants. Call getApiDoc() first."],
  events_domain: ["events", "Club/team events, RSVPs, attendance and fixtures. Call getApiDoc() first."],
  messaging_domain: ["messaging", "Club/team conversations and messages; participant-scoped."],
  vault_domain: ["vault", "Club file vault: folders, files and backups; role-scoped."],
  competition_domain: ["competitions", "Competitions, seasons, matches and public competition pages."],
  notification_queue: ["notifications", "Per-account notification inbox; reads are owner-only."],
  insights_domain: ["insights", "Club engagement analytics; club-admin scoped."],
  mini_league_domain: ["mini-leagues", "Mini leagues, sessions, players and duties."],
  club_points_domain: ["rewards", "Club points, leaderboards and rewards."],
  media_metadata: ["media", "Media asset metadata, galleries, reactions and comments."],
  media_blob_store: ["media-blobs", "Encrypted media blob storage; serves ciphertext only."],
  pii_access_control: ["pii-access", "Encrypted PII access control and vetKey derivation grants."],
  identity_access: ["identity", "Account/principal binding, profiles and entitlements."],
  secret_workload_identity: ["workload-identity", "Internal workload secrets; governor-only."],
  migration_coordinator: ["migration", "Backend migration coordination; public status only."],
  shard_router: ["shard-router", "Internal shard routing."],
  timer_jobs: ["timer-jobs", "Internal scheduled jobs."],
  placement_registry: ["placement", "Internal placement registry."],
};

function loadCanisterIds() {
  if (process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON) {
    return JSON.parse(process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON);
  }
  const tablePath = `${root}../deploy/mainnet/.icp/data/mappings/ic.ids.json`;
  if (existsSync(tablePath)) return JSON.parse(readFileSync(tablePath, "utf8"));
  return {};
}

const canisterIds = loadCanisterIds();
const manifest = {
  version: "1.0.0",
  canisters: [
    { id: frontendCanisterId, name: "frontend", role: "the frontend" },
    ...Object.entries(canisterIds).map(([key, id]) => {
      const [name, description] = CANISTER_ROLES[key] ?? [key, undefined];
      return description ? { id, name, role: "backend", description } : { id, name, role: "backend" };
    }),
  ],
};
writeFileSync(`${out}/.well-known/ic-architecture`, JSON.stringify(manifest, null, 2) + "\n");

// ICP MCP Layer 5: every address of this canister derives Internet Identity
// principals against the canonical icp0.io origin (see
// resolveDerivationOriginFor in src/live/internetIdentityAuth.ts), so agents
// must request derivations for that origin to get the user's real principal.
writeFileSync(`${out}/.well-known/ii-derivation-origin`, `https://${frontendCanisterId}.icp0.io\n`);

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

/.well-known/ii-auth-callbacks
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/.well-known/ic-architecture
  Access-Control-Allow-Origin: *
  Content-Type: application/json

/.well-known/ii-derivation-origin
  Access-Control-Allow-Origin: *
  Content-Type: text/plain

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
console.log("dist-canister ready");
