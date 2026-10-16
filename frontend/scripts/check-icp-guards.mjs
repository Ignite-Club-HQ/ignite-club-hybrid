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
  /\.functions\s*\.\s*invoke\s*\(/, // tolerant of line breaks: .functions\n.invoke(
  /\.storage\s*\.\s*from\s*\(/, // tolerant of line breaks: .storage\n.from(
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

// Vault is a fully dual-backend (Supabase / ICP canister) feature: any direct
// supabase.from(/supabase.rpc( read or write in vault code must also be
// guarded (or explicitly allowlisted), the same as edge-function/storage calls.
const vaultCallPatterns = [
  /\bsupabase\s*\.\s*from\s*\(/,
  /\bsupabase\s*\.\s*rpc\s*\(/,
  /\bclient\s*\.\s*from\s*\(/,
  /\bclient\s*\.\s*rpc\s*\(/,
];

const vaultPathPatterns = [
  new RegExp(`^features${path.sep}vault${path.sep}`),
  /^lib[/\\]vault.*\.ts$/,
  new RegExp(`^components.*${path.sep}Vault[^${path.sep}]*\.tsx$`),
];

function isVaultFile(relativePath) {
  return vaultPathPatterns.some((pattern) => pattern.test(relativePath));
}

for (const filePath of filesUnder(srcRoot)) {
  if (!/\.(?:ts|tsx)$/.test(filePath)) continue;
  if (/\.test\.tsx?$/.test(filePath)) continue;
  if (filePath.includes(`${path.sep}lab${path.sep}`)) continue;
  const relativePath = path.relative(srcRoot, filePath);
  if (!isVaultFile(relativePath)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  if (!vaultCallPatterns.some((pattern) => pattern.test(text))) continue;
  if (guardPatterns.some((pattern) => pattern.test(text))) continue;
  if (allowPattern.test(text)) continue;
  console.error(`${relativePath}: Supabase from()/rpc() call in Vault code without an ICP-mode guard`);
  failed = true;
}

if (failed) {
  throw new Error(
    "Unguarded Supabase call sites found. Add a guard " +
      "(withFeatureBackend / assertSupabaseWritePath / isFeatureRoutedToIcp / resolveAuthBackend / isIcpMediaUploadUnavailable) " +
      "or an explicit '// icp-guard: allow <reason>' comment for a by-design exception.",
  );
}

console.log("ICP-mode guard check passed: all Supabase edge-function/storage/Vault call sites are guarded or explicitly allowed.");
