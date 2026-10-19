// Ignite Club HQ — canister health report.
//
// Asks every deployed mainnet canister for its own real fuel and memory
// through the public `cycles_balance` / `memory_stats` queries, over HTTPS and
// with an anonymous identity — so this report needs no deploy key and can
// never be fooled by management-canister settings (a 5T reserved-cycles
// default or a 0-byte memory allocation is not usage).
//
//   - balance below LOW_BALANCE_T trillion cycles (1T ≈ US$1.30) is flagged
//   - total memory above WARN_MEMORY_GB is advisory only, not the
//     application's tested usable capacity
//
// Run it weekly from the canister-health GitHub workflow, or locally:
//   NODE_PATH=<dir containing @dfinity/agent> node scripts/canister-health.mjs
// Any canister whose fuel or memory cannot be read fails the run — an
// unreadable service is never reported as healthy.

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

// ESM ignores NODE_PATH, so load the client through require, which honours it.
const require = createRequire(import.meta.url);
const { HttpAgent, Actor, AnonymousIdentity } = require("@dfinity/agent");
const { IDL } = require("@dfinity/candid");
const { Principal } = require("@dfinity/principal");

const LOW_BALANCE_T = 1;
const WARN_MEMORY_GB = 3;
// The web-app (asset) canister has no cycles_balance query of its own, so its
// balance is read through club_domain's canister_cycles proxy (club_domain is
// added as a controller by the frontend deploy workflow).
const FRONTEND_CANISTER_ID = "proe7-kqaaa-aaaas-qg6gq-cai";

const cyclesIdl = ({ IDL }) =>
  IDL.Service({
    cycles_balance: IDL.Func([], [IDL.Nat], ["query"]),
    memory_stats: IDL.Func(
      [],
      [IDL.Record({ heap_bytes: IDL.Nat, memory_bytes: IDL.Nat, stable_bytes: IDL.Nat })],
      ["query"],
    ),
  });

const usageIdl = ({ IDL }) =>
  IDL.Service({
    usage_stats: IDL.Func([], [IDL.Record({ accounts: IDL.Nat, clubs: IDL.Nat, news_posts: IDL.Nat, teams: IDL.Nat })], ["query"]),
  });

const proxyIdl = ({ IDL }) =>
  IDL.Service({ canister_cycles: IDL.Func([IDL.Principal], [IDL.Nat], []) });

// A service answers with a raw Nat. A missing reply must never become 0T.
export function cyclesT(balance) {
  return typeof balance === "bigint" ? Number(balance) / 1e12 : null;
}

export function memoryMB(stats) {
  return stats && typeof stats.memory_bytes === "bigint" ? Number(stats.memory_bytes) / 1e6 : null;
}

// One row's verdict. Unreadable values count as problems: no reading, no health.
export function rowNote({ cyclesT: balanceT, memoryMB: memMB, requireMemory = true }) {
  const notes = [];
  let problems = 0;
  if (balanceT == null) {
    notes.push("could not read fuel");
    problems++;
  } else if (balanceT < LOW_BALANCE_T) {
    notes.push(`LOW FUEL — top up (under ${LOW_BALANCE_T}T)`);
    problems++;
  }
  if (requireMemory) {
    if (memMB == null) {
      notes.push("could not read memory");
      problems++;
    } else if (memMB > WARN_MEMORY_GB * 1000) {
      notes.push(`HIGH MEMORY — over ${WARN_MEMORY_GB} GB`);
      problems++;
    }
  }
  return { note: notes.join("; "), problems };
}

export async function main() {
  const root = process.env.GITHUB_WORKSPACE || join(dirname(fileURLToPath(import.meta.url)), "..");
  const ids = JSON.parse(readFileSync(join(root, "deploy/mainnet/.icp/data/mappings/ic.ids.json"), "utf8"));
  const agent = new HttpAgent({
    host: "https://ic0.app",
    identity: new AnonymousIdentity(),
    shouldSyncTime: true,
    retryTimes: 1,
  });

  const keys = Object.keys(ids).sort();
  const settled = await Promise.allSettled(
    keys.map(async (key) => {
      const actor = Actor.createActor(cyclesIdl, { agent, canisterId: Principal.fromText(ids[key]) });
      const [balance, stats] = await Promise.all([
        actor.cycles_balance(),
        actor.memory_stats().catch(() => null),
      ]);
      return { key, id: ids[key], cyclesT: cyclesT(balance), memoryMB: memoryMB(stats), requireMemory: true };
    }),
  );
  const rows = settled.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { key: keys[i], id: ids[keys[i]], cyclesT: null, memoryMB: null, requireMemory: true },
  );

  // Web-app canister via the club_domain proxy; it is never in the ID table.
  const frontend = {
    key: "frontend (web app)",
    id: FRONTEND_CANISTER_ID,
    cyclesT: null,
    memoryMB: null,
    requireMemory: false,
  };
  if (ids.club_domain) {
    try {
      const proxy = Actor.createActor(proxyIdl, {
        agent,
        canisterId: Principal.fromText(ids.club_domain),
      });
      frontend.cyclesT = cyclesT(await proxy.canister_cycles(Principal.fromText(FRONTEND_CANISTER_ID)));
    } catch {
      // Stays unreadable, which fails the run below.
    }
  }
  rows.push(frontend);

  // Live club count from club_domain's public usage_stats (counts only, no PII).
  let clubCount = null;
  if (ids.club_domain) {
    try {
      const usage = Actor.createActor(usageIdl, { agent, canisterId: Principal.fromText(ids.club_domain) });
      const stats = await usage.usage_stats();
      if (typeof stats.clubs === "bigint") clubCount = Number(stats.clubs);
    } catch {
      // Unreadable: the capacity job falls back to the recorded count.
    }
  }

  let problems = 0;
  console.log("Canister health — live fuel and memory read from each service");
  console.log("=".repeat(88));
  for (const r of rows) {
    const { note, problems: p } = rowNote(r);
    problems += p;
    const bal = r.cyclesT == null ? "   ?" : `${r.cyclesT.toFixed(2)}T`.padStart(7);
    const mem = !r.requireMemory ? "     n/a" : r.memoryMB == null ? "      ?" : `${r.memoryMB.toFixed(1)} MB`.padStart(9);
    console.log(`${r.key.padEnd(24)} ${bal} cycles  ${mem}  ${note}`);
    if (note) console.log(`::warning::${r.key}: ${note}`);
  }
  console.log("=".repeat(88));
  console.log(`Clubs on ICP: ${clubCount ?? "could not read"}`);
  console.log(
    problems === 0
      ? "All canisters look healthy."
      : `${problems} canister(s) need attention — see warnings above.`,
  );

  // Hand the readings to the memory-analysis step when the workflow asks.
  if (process.env.HEALTH_JSON_OUT) {
    writeFileSync(
      process.env.HEALTH_JSON_OUT,
      JSON.stringify(
        rows.map((r) => ({
          name: r.key,
          memory_mb: r.memoryMB == null ? null : Math.round(r.memoryMB),
          cycles_t: r.cyclesT,
          ...(r.key === "club_domain" && clubCount != null ? { clubs: clubCount } : {}),
        })),
      ),
    );
  }
  // Read failures must not produce a green workflow claiming health.
  if (rows.some((r) => r.cyclesT == null || (r.requireMemory && r.memoryMB == null))) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
