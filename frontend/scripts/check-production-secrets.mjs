import fs from "node:fs";
import path from "node:path";

const bundleRoot = path.resolve(process.cwd(), "dist-live");
if (!fs.existsSync(bundleRoot)) {
  throw new Error("dist-live is missing; run npm run build first.");
}

const forbiddenPatterns = [
  /sb_secret_[A-Za-z0-9_-]+/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /STRIPE_(SECRET|WEBHOOK_SECRET|API_KEY)/i,
  /RESEND_API_KEY/i,
  /VAPID_PRIVATE_KEY/i,
  /FCM_(SERVICE_ACCOUNT|.*PRIVATE_KEY)/i,
  /GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_CLIENT_SECRET/i,
  /SENDGRID_API_KEY|TWILIO_AUTH_TOKEN|AUTH0_CLIENT_SECRET|OPENAI_API_KEY|GEMINI_API_KEY|LOVABLE_API_KEY/i,
  /NETLIFY_AUTH_TOKEN/i,
  /identity-link-target|PUBLIC TEST SEEDS|Local synthetic data ONLY/i,
  /src\/lab\/(localActor|fixtureDataLayer|syntheticIdentities)/i,
];

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(entryPath) : [entryPath];
  });
}

let failed = false;
for (const filePath of filesUnder(bundleRoot)) {
  if (!/\.(?:html|js|css|json|map)$/i.test(filePath)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  const matches = forbiddenPatterns.filter((pattern) => pattern.test(text));
  if (matches.length === 0) continue;
  console.error(`${path.relative(bundleRoot, filePath)} matched: ${matches.join(", ")}`);
  failed = true;
}

const jwtPattern = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\b/g;
for (const filePath of filesUnder(bundleRoot)) {
  if (!/\.(?:html|js|json|map)$/i.test(filePath)) continue;
  const text = fs.readFileSync(filePath, "utf8");
  for (const token of text.match(jwtPattern) ?? []) {
    try {
      const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      if (decoded.role !== "service_role") continue;
      console.error(`${path.relative(bundleRoot, filePath)} contains a service-role JWT.`);
      failed = true;
    } catch {
      // Ignore non-JWT text that happens to match the token shape.
    }
  }
}

if (failed) {
  throw new Error("Live bundle contains forbidden secret or lab-runtime material.");
}

console.log("Live bundle guard passed: no forbidden secrets or lab-runtime material detected.");
