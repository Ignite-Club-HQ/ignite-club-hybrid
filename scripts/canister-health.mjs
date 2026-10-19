// Ignite Club HQ — canister health report.
//
// Prints one line per deployed mainnet canister with its cycle balance and
// memory size, plus warnings when either needs attention:
//   - balance below LOW_BALANCE_T trillion cycles (1T ≈ US$1.30)
//   - reported total memory above WARN_MEMORY_GB (an advisory warning,
//     not the application's tested usable capacity or a stable-memory ceiling)
//
// Run it weekly from the canister-health GitHub workflow, or locally:
//   node scripts/canister-health.mjs
// Requires the icp CLI with the deployer identity selected.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const LOW_BALANCE_T = 1;
const WARN_MEMORY_GB = 3;

// The workflow copies this script outside the checkout, so prefer the
// checkout path from GITHUB_WORKSPACE when it's set.

// icp CLI output varies: "Cycles: 1_234_567_890", "Balance: 3.21 TCycles",
// "Memory size: 12_345_678" or "12.3 MB". Handle all of them.
function num(s) {
  return parseFloat(String(s).replace(/[_,]/g, ""));
}
const SCALE = { "": 1, K: 1e3, M: 1e6, B: 1e9, G: 1e9, T: 1e12 };

function valueFor(text, re) {
  const lines = text.split("\n").filter((l) => re.test(l));
  // Missing/duplicate actual fields must never become healthy readings.
  return lines.length === 1 ? lines[0].replace(re, "").trim() : "";
}

export function parseBytes(text) {
  const line = valueFor(text, /^\s*Memory size\s*:\s*/i);
  const m = line.match(/^([\d][\d_.,]*)\s*(B|KB|KiB|MB|MiB|GB|GiB|TB|TiB|bytes)?\s*$/i);
  if (!m) return null;
  const u = (m[2] ?? "B").toUpperCase();
  const f = { B: 1, BYTES: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, TB: 1e12, TIB: 1024 ** 4 }[u];
  return num(m[1]) * f;
}

export function parseCyclesT(text) {
  const line = valueFor(text, /^\s*(?:Cycles|Balance)\s*:\s*/i);
  const m = line.match(/^([\d][\d_.,]*)\s*([KMBGT])?\s*(?:cycles|C)?\s*$/i);
  if (!m) return null;
  const raw = num(m[1]) * (SCALE[(m[2] ?? "").toUpperCase()] ?? 1);
  return raw / 1e12;
}

export function main() {
const root = process.env.GITHUB_WORKSPACE || join(dirname(fileURLToPath(import.meta.url)), "..");
const idsPath = join(root, "deploy/mainnet/.icp/data/mappings/ic.ids.json");
const ids = JSON.parse(readFileSync(idsPath, "utf8"));
const rows = [];
let problems = 0;

for (const [name, id] of Object.entries(ids)) {
  let out = "";
  try {
    out = execFileSync("icp", ["canister", "status", id, "-n", "ic"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    // Status output can contain environment variables; never dump it.
    console.log(`--- ${name}: status query failed (exit ${err.status ?? "unknown"}) ---`);
    rows.push({ name, id, balanceT: null, memoryGB: null, note: "status query failed" });
    problems++;
    continue;
  }
  const balanceT = parseCyclesT(out);
  const bytes = parseBytes(out);
  const memoryGB = bytes == null ? null : bytes / 1e9;
  let note = "";
  if (balanceT == null || memoryGB == null) {
    console.log(`--- ${name}: actual Cycles / Memory size fields missing or invalid ---`);
    note = "could not read status";
    problems++;
  }
  if (balanceT != null && balanceT < LOW_BALANCE_T) {
    note = `LOW CYCLES — top up (under ${LOW_BALANCE_T}T)`;
    problems++;
  }
  if (memoryGB != null && memoryGB > WARN_MEMORY_GB) {
    note = `${note}${note ? "; " : ""}HIGH MEMORY — over ${WARN_MEMORY_GB} GB`;
    problems++;
  }
  rows.push({ name, id, balanceT, memoryGB, note });
}

console.log("Canister health — cycle balances and memory");
console.log("=".repeat(88));
for (const r of rows) {
  const bal = r.balanceT == null ? "   ?" : `${r.balanceT.toFixed(2)}T`.padStart(7);
  const mem = r.memoryGB == null ? "   ?" : `${(r.memoryGB * 1000).toFixed(2)} MB`.padStart(10);
  console.log(`${r.name.padEnd(24)} ${bal} cycles  ${mem}  ${r.note}`);
  if (r.note) console.log(`::warning::${r.name}: ${r.note}`);
}
console.log("=".repeat(88));
console.log(
  problems === 0
    ? "All canisters look healthy."
    : `${problems} canister(s) need attention — see warnings above.`,
);

// Hand the readings to the memory-analysis step when the workflow asks.
if (process.env.HEALTH_JSON_OUT) {
  writeFileSync(
    process.env.HEALTH_JSON_OUT,
    JSON.stringify(rows.map((r) => ({ name: r.name, memory_mb: r.memoryGB == null ? null : Math.round(r.memoryGB * 1000), cycles_t: r.balanceT }))),
  );
}
// Read failures must not produce a green workflow claiming health.
if (rows.some((r) => r.balanceT == null || r.memoryGB == null)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
