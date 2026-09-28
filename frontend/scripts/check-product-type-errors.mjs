import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const baselinePath = resolve(root, "product-type-error-baseline.json");
const shouldWriteBaseline = process.argv.includes("--write-baseline");

const result = spawnSync("npx", ["tsc", "-p", "tsconfig.app.json", "--pretty", "false"], {
  cwd: root,
  encoding: "utf8",
});

const diagnostics = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  .split(/\r?\n/)
  .map((line) => line.match(/^(.*)\((\d+),(\d+)\): error (TS\d+): (.*)$/))
  .filter(Boolean)
  .map(([, file, line, column, code, message]) => ({
    file,
    line: Number(line),
    column: Number(column),
    code,
    message,
    category: classify(file, code),
  }))
  .sort((left, right) =>
    `${left.file}:${left.line}:${left.column}:${left.code}`.localeCompare(
      `${right.file}:${right.line}:${right.column}:${right.code}`,
    ),
  );

if (shouldWriteBaseline) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({
      generatedBy: "scripts/check-product-type-errors.mjs",
      policy: "No new diagnostics may be introduced. Existing diagnostics remain explicitly inventoried until their source or dependency boundary is repaired.",
      diagnostics,
      counts: countByCategory(diagnostics),
    }, null, 2)}\n`,
  );
  console.log(`Wrote ${diagnostics.length} product TypeScript diagnostics to ${baselinePath}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
} catch (error) {
  console.error(`Unable to read ${baselinePath}: ${error.message}`);
  process.exit(1);
}

const baselineKeys = new Set(baseline.diagnostics.map(keyFor));
const currentKeys = new Set(diagnostics.map(keyFor));
const newDiagnostics = diagnostics.filter((diagnostic) => !baselineKeys.has(keyFor(diagnostic)));
const resolvedCount = [...baselineKeys].filter((key) => !currentKeys.has(key)).length;

console.log(`Product TypeScript diagnostics: ${diagnostics.length}`);
console.log(`  source-backed: ${countByCategory(diagnostics)["source-backed"] ?? 0}`);
console.log(`  missing-reference: ${countByCategory(diagnostics)["missing-reference"] ?? 0}`);
console.log(`  inert-edge-function-reference: ${countByCategory(diagnostics)["inert-edge-function-reference"] ?? 0}`);
console.log(`  resolved since baseline: ${resolvedCount}`);

if (newDiagnostics.length > 0) {
  console.error(`Product TypeScript ratchet failed with ${newDiagnostics.length} new diagnostic(s):`);
  for (const diagnostic of newDiagnostics) {
    console.error(`  ${format(diagnostic)}`);
  }
  process.exit(1);
}

if (result.status !== 0 && diagnostics.length === 0) {
  console.error("TypeScript exited non-zero without parseable diagnostics.");
  process.exit(result.status ?? 1);
}

function classify(file, code) {
  if (file.includes("/edge-functions/")) return "inert-edge-function-reference";
  if (code === "TS2307") return "missing-reference";
  return "source-backed";
}

function keyFor(diagnostic) {
  return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}:${diagnostic.code}`;
}

function format(diagnostic) {
  return `${diagnostic.file}(${diagnostic.line},${diagnostic.column}) ${diagnostic.code}: ${diagnostic.message}`;
}

function countByCategory(items) {
  return items.reduce((counts, item) => {
    counts[item.category] = (counts[item.category] ?? 0) + 1;
    return counts;
  }, {});
}
