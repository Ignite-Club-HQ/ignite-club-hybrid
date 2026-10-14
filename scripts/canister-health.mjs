// Ignite Club HQ — canister health report.
//
// Prints one line per deployed mainnet canister with its cycle balance and
// memory size, plus warnings when either needs attention:
//   - balance below LOW_BALANCE_T trillion cycles (1T ≈ US$1.30)
//   - memory above WARN_MEMORY_GB (the per-canister heap ceiling is 4 GB;
//     photo storage is the only state that grows meaningfully)
//
// Run it weekly from the canister-health GitHub workflow, or locally:
//   node scripts/canister-health.mjs
// Requires the icp CLI with the deployer identity selected.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LOW_BALANCE_T = 1;
const WARN_MEMORY_GB = 3;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const idsPath = join(root, "deploy/mainnet/.icp/data/mappings/ic.ids.json");
const ids = JSON.parse(readFileSync(idsPath, "utf8"));

function parseBytes(text) {
  // Matches "Memory Size: 12.34 MB" style lines, any unit.
  const m = text.match(/memory[^\n]*?([\d.]+)\s*(B|KB|MB|GB|TB)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = m[2].toUpperCase();
  const factor = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[unit];
  return n * factor;
}

function parseCyclesT(text) {
  // Matches "Balance: 3.21 TCycles" / "3.21 T" style lines.
  const m = text.match(/([\d.]+)\s*T\s*(?:Cycles)?/i);
  return m ? parseFloat(m[1]) : null;
}

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
    out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    rows.push({ name, id, balanceT: null, memoryGB: null, note: "status query failed" });
    problems++;
    continue;
  }
  const balanceT = parseCyclesT(out);
  const bytes = parseBytes(out);
  const memoryGB = bytes == null ? null : bytes / 1e9;
  let note = "";
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
  const mem = r.memoryGB == null ? "   ?" : `${r.memoryGB.toFixed(2)} GB`.padStart(8);
  console.log(`${r.name.padEnd(24)} ${bal} cycles  ${mem}  ${r.note}`);
  if (r.note) console.log(`::warning::${r.name}: ${r.note}`);
}
console.log("=".repeat(88));
console.log(
  problems === 0
    ? "All canisters look healthy."
    : `${problems} canister(s) need attention — see warnings above.`,
);
