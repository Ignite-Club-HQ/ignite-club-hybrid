const required = [
  "IGNITE_LIVE_SUPABASE_URL",
  "IGNITE_LIVE_SUPABASE_ANON_KEY",
];

for (const name of required) {
  if (!process.env[name]?.trim()) {
    throw new Error(`${name} is required for a live build.`);
  }
}

const supabaseUrl = new URL(process.env.IGNITE_LIVE_SUPABASE_URL);
if (supabaseUrl.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(supabaseUrl.hostname)) {
  throw new Error("IGNITE_LIVE_SUPABASE_URL must use HTTPS, except localhost development URLs.");
}

const anonKey = process.env.IGNITE_LIVE_SUPABASE_ANON_KEY;
const [, payload] = anonKey.split(".");
if (payload) {
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    if (parsed.role === "service_role") {
      throw new Error("IGNITE_LIVE_SUPABASE_ANON_KEY must not be a service-role key.");
    }
  } catch (error) {
    if (error.message.includes("service-role")) throw error;
  }
}

const icpHost = process.env.IGNITE_LIVE_ICP_HOST;
if (icpHost) {
  const parsedIcpHost = new URL(icpHost);
  if (parsedIcpHost.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(parsedIcpHost.hostname)) {
    throw new Error("IGNITE_LIVE_ICP_HOST must use HTTPS, except localhost development gateways.");
  }
}

const icpCanisterIdsJson = process.env.IGNITE_LIVE_ICP_CANISTER_IDS_JSON;
if (icpCanisterIdsJson) {
  let parsedCanisterIds;
  try {
    parsedCanisterIds = JSON.parse(icpCanisterIdsJson);
  } catch {
    throw new Error("IGNITE_LIVE_ICP_CANISTER_IDS_JSON must be valid JSON.");
  }
  if (typeof parsedCanisterIds !== "object" || parsedCanisterIds === null || Array.isArray(parsedCanisterIds)) {
    throw new Error("IGNITE_LIVE_ICP_CANISTER_IDS_JSON must be a JSON object mapping domain names to canister IDs.");
  }
  const principalPattern = /^[a-z0-9]{1,5}(-[a-z0-9]{1,5}){0,9}$/i;
  for (const [name, canisterId] of Object.entries(parsedCanisterIds)) {
    if (typeof canisterId !== "string" || !principalPattern.test(canisterId)) {
      throw new Error(`IGNITE_LIVE_ICP_CANISTER_IDS_JSON.${name} is not a valid canister ID.`);
    }
  }
}

// Never accept a PEM-shaped value (deployment identity private key material)
// anywhere in the live env — this build is browser-facing config only.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith("IGNITE_LIVE_") && typeof value === "string" && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value)) {
    throw new Error(`${name} looks like PEM private key material, which must never be part of the live browser config.`);
  }
}

console.log("Live config check passed: required public Supabase target values are present and no service-role key was detected.");
