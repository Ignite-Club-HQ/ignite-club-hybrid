/**
 * Aggregate duplication ratchet for authored frontend source.
 *
 * Earlier refactor work tracked only per-file line reductions and typecheck
 * health, which proved local safety but never gated the thing that actually
 * matters for maintenance cost: how much duplicated code the frontend carries
 * in total. This ratchet makes that measurable and enforceable.
 *
 * Scope deliberately excludes:
 *  - tests (intentional arrange/assert repetition)
 *  - generated Supabase types and generated Candid bindings/contracts
 *  - `src/lab/**` mirrors of production modules, which are duplicated ON
 *    PURPOSE because only allowlisted isolated files may enter the lab bundle
 *    (see lab-runtime-files.json). Merging them to improve a score would
 *    break the isolation boundary.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const baselinePath = resolve(root, "duplication-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");

const IGNORE = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "src/integrations/supabase/types.ts",
  "src/lab/bindings/**",
  "src/lab/generated-contracts/**",
].join(",");

/**
 * Lab/production mirror pairs are intentionally duplicated for bundle
 * isolation. They are reported but never counted against the ratchet.
 */
function isIntentionalMirror(clone) {
  const a = clone.firstFile.name;
  const b = clone.secondFile.name;
  return a.startsWith("lab/") || b.startsWith("lab/");
}

const output = mkdtempSync(join(tmpdir(), "jscpd-ratchet-"));
try {
  const result = spawnSync(
    "npx",
    [
      "jscpd",
      "src",
      "--min-tokens",
      "50",
      "--min-lines",
      "5",
      "--ignore",
      IGNORE,
      "--reporters",
      "json",
      "--output",
      output,
      "--silent",
    ],
    { cwd: root, encoding: "utf8" },
  );

  let report;
  try {
    report = JSON.parse(readFileSync(join(output, "jscpd-report.json"), "utf8"));
  } catch (error) {
    console.error(`Unable to read jscpd report: ${error.message}`);
    console.error(result.stdout ?? "");
    console.error(result.stderr ?? "");
    process.exit(1);
  }

  const clones = report.duplicates ?? [];
  const counted = clones.filter((clone) => !isIntentionalMirror(clone));
  const mirrored = clones.length - counted.length;

  const metrics = {
    scannedLines: report.statistics.total.lines,
    countedClones: counted.length,
    countedDuplicatedLines: counted.reduce((sum, clone) => sum + clone.lines, 0),
    intentionalMirrorClones: mirrored,
  };

  if (updateBaseline) {
    writeFileSync(baselinePath, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`Updated ${baselinePath}`);
    console.log(JSON.stringify(metrics, null, 2));
    process.exit(0);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const failures = ["countedDuplicatedLines"]
    .filter((key) => metrics[key] > baseline[key])
    .map((key) => `${key} increased from ${baseline[key]} to ${metrics[key]}`);

  console.log(JSON.stringify({ baseline, current: metrics }, null, 2));

  const delta = baseline.countedDuplicatedLines - metrics.countedDuplicatedLines;
  if (delta > 0) console.log(`Removed ${delta} duplicated line(s) since baseline.`);

  if (failures.length > 0) {
    console.error(`Duplication ratchet failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
} finally {
  rmSync(output, { recursive: true, force: true });
}
