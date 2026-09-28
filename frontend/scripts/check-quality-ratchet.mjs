import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const baselinePath = path.join(root, "quality-baseline.json");
const updateBaseline = process.argv.includes("--update-baseline");

const excludedFiles = new Set([
  "src/integrations/supabase/types.ts",
  "src/lib/observability/logger.ts",
]);

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(file);
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) return [];
    const relative = path.relative(root, file).replaceAll(path.sep, "/");
    return excludedFiles.has(relative) ? [] : [relative];
  });
}

const files = collectFiles(sourceRoot);
const metrics = {
  files: files.length,
  asAny: 0,
  consoleCalls: 0,
  directSupabaseImports: 0,
};

for (const relative of files) {
  const text = fs.readFileSync(path.join(root, relative), "utf8");
  metrics.asAny += (text.match(/\bas\s+any\b/g) ?? []).length;
  metrics.consoleCalls += (text.match(/\bconsole\.(debug|error|info|log|warn)\b/g) ?? []).length;
  metrics.directSupabaseImports += (
    text.match(/from\s+["'][^"']*integrations\/supabase\/client["']/g) ?? []
  ).length;
}

if (updateBaseline) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`Updated ${path.relative(root, baselinePath)}`);
  console.log(JSON.stringify(metrics, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const failures = Object.entries(metrics)
  .filter(([key]) => key !== "files")
  .filter(([key, value]) => value > baseline[key])
  .map(([key, value]) => `${key} increased from ${baseline[key]} to ${value}`);

console.log(JSON.stringify({ baseline, current: metrics }, null, 2));
if (failures.length > 0) {
  console.error(`Quality ratchet failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
