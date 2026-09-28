// Phase 4 opt-in live smoke test (docs/PRODUCTION_LAUNCH_PLAN.md).
//
// Validates one real Supabase-backed read and one real ICP-backed query
// call, side by side, against whatever live target this repo is currently
// configured for. This is deliberately NOT part of `npm test`/`npm run
// test:all` — it requires real network access and real credentials
// (a live Supabase anon key, and once deployed, real mainnet canister IDs),
// so it must be run explicitly and opted into.
//
// Usage:
//   IGNITE_LIVE_SMOKE_TEST=1 \
//   IGNITE_LIVE_SUPABASE_URL=https://<project>.supabase.co \
//   IGNITE_LIVE_SUPABASE_ANON_KEY=<anon-key> \
//   IGNITE_LIVE_ICP_HOST=https://icp-api.io \
//   IGNITE_LIVE_ICP_CANISTER_IDS_JSON='{"club_domain":"<canister-id>"}' \
//   node scripts/test-live-smoke.mjs
//
// The ICP half is skipped (not failed) if IGNITE_LIVE_ICP_CANISTER_IDS_JSON
// has no `club_domain` entry yet, since the Phase 3 mainnet deploy is a
// separate, explicit, cycles-funded user action documented in the plan.
// This script never writes to the configured Supabase project — it only
// performs read-only queries, since autonomously writing synthetic rows
// into a real (even dev-tier) database without the operator present is
// out of scope for an opt-in smoke check.

import { createClient } from "@supabase/supabase-js";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";

if (process.env.IGNITE_LIVE_SMOKE_TEST !== "1") {
  console.error(
    "Refusing to run: this smoke test touches real infrastructure. " +
      "Set IGNITE_LIVE_SMOKE_TEST=1 to opt in explicitly.",
  );
  process.exit(1);
}

const results = { supabase: null, icp: null };
let failed = false;

// --- Supabase-backed read flow -------------------------------------------
try {
  const url = process.env.IGNITE_LIVE_SUPABASE_URL;
  const anonKey = process.env.IGNITE_LIVE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "IGNITE_LIVE_SUPABASE_URL and IGNITE_LIVE_SUPABASE_ANON_KEY are required.",
    );
  }

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
  });

  // A read-only, RLS-safe probe: select a single column with a row limit
  // from a table this frontend already reads elsewhere (see
  // src/features/media/mediaAccessRepository.ts). An empty result (RLS
  // denying anonymous access, or an empty table) is still evidence the
  // project/connection/auth handshake works; only a thrown/network error
  // is treated as a failed connection.
  const { error } = await supabase.from("clubs").select("id").limit(1);
  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }

  results.supabase = { status: "PASS", url };
  console.log(`[supabase] connected and queried ${url} successfully.`);
} catch (error) {
  failed = true;
  results.supabase = { status: "FAIL", error: error.message };
  console.error(`[supabase] FAILED: ${error.message}`);
}

// --- ICP-backed query flow -------------------------------------------------
try {
  const host = process.env.IGNITE_LIVE_ICP_HOST || "https://icp-api.io";
  const canisterIdsJson = process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON;
  const canisterIds = canisterIdsJson ? JSON.parse(canisterIdsJson) : {};
  const canisterId = canisterIds.club_domain;

  if (!canisterId) {
    results.icp = {
      status: "SKIPPED",
      reason:
        "No club_domain canister ID configured yet (IGNITE_LIVE_ICP_CANISTER_IDS_JSON). " +
        "This is expected until the Phase 3 mainnet deploy has been run — see " +
        "docs/PRODUCTION_LAUNCH_PLAN.md Phase 3.",
    };
    console.log(`[icp] SKIPPED: ${results.icp.reason}`);
  } else {
    const { idlFactory } = await import(
      "../src/lab/bindings/club_domain/declarations/club_domain.did.js"
    );

    // Anonymous identity, mainnet host, no root key pinned or fetched —
    // mainnet's root key ships baked into @icp-sdk/core (see
    // src/live/icpAgent.ts for the same rule applied in the app itself).
    const agent = await HttpAgent.create({
      host,
      shouldFetchRootKey: false,
      shouldSyncTime: true,
    });
    const actor = Actor.createActor(idlFactory, { agent, canisterId });

    // whoami is a read-only query returning `variant { Ok : Account; Err :
    // text }`. Either outcome proves the canister is live and answering
    // calls over the public network (an anonymous caller with no
    // registered account legitimately gets Err, not a transport failure) —
    // only a thrown/network error below counts as a failed connection.
    const whoami = await actor.whoami();
    const outcome = "Ok" in whoami ? { ok: whoami.Ok } : { err: whoami.Err };
    results.icp = { status: "PASS", host, canisterId, whoami: outcome };
    console.log(`[icp] connected to ${canisterId} at ${host}: whoami() -> ${JSON.stringify(outcome)}`);
  }
} catch (error) {
  failed = true;
  results.icp = { status: "FAIL", error: error.message };
  console.error(`[icp] FAILED: ${error.message}`);
}

console.log(JSON.stringify({ status: failed ? "FAIL" : "PASS", results }, null, 2));
process.exit(failed ? 1 : 0);
