import fs from "node:fs";
import path from "node:path";

// ICP-mode guard lint: every Supabase edge-function or storage call site in the
// production frontend must be guarded for Internet Identity users. A file passes
// when it contains at least one recognized guard, or an explicit allowlist
// comment: // icp-guard: allow <reason>
// Allowlist is for by-design exceptions only (push delivery, Drive import,
// media bytes, iOS IAP, welcome DM, passkey/auth). Test files are exempt.

const srcRoot = path.resolve(import.meta.dirname, "../src");

const callPatterns = [
  /\binvokeFunction\s*\(/, // edge functions via helper
  /\.functions\.invoke\s*\(/,
  /\.storage\.from\s*\(/,
];

const guardPatterns = [
  /\bwithFeatureBackend\s*\(/,
  /\bassertSupabaseWritePath\s*\(/,
  /\bisFeatureRoutedToIcp\s*\(/,
  /\bresolveAuthBackend\s*\(/,
  /\bisIcpMediaUploadUnavailable\s*\(/,
];

const allowPattern = /\/\/\s*icp-guard:\s*allow\s+\S+/;

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

let failed = false;
for (const filePath of filesUnder(srcRoot)) {
  if (!/\.(?:ts|tsx)$/.test(filePath)) continue;
  if (/\.test\.tsx?$/.test(filePath)) continue;
  if (filePath.includes(`${path.sep}lab${path.sep}`)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  if (!callPatterns.some((pattern) => pattern.test(text))) continue;
  if (guardPatterns.some((pattern) => pattern.test(text))) continue;
  if (allowPattern.test(text)) continue;
  console.error(`${path.relative(srcRoot, filePath)}: Supabase edge-function/storage call without an ICP-mode guard`);
  failed = true;
}

if (failed) {
  throw new Error(
    "Unguarded Supabase edge-function/storage call sites found. Add a guard " +
      "(withFeatureBackend / assertSupabaseWritePath / isFeatureRoutedToIcp / resolveAuthBackend / isIcpMediaUploadUnavailable) " +
      "or an explicit '// icp-guard: allow <reason>' comment for a by-design exception.",
  );
}

console.log("ICP-mode guard check passed: all Supabase edge-function/storage call sites are guarded or explicitly allowed.");
