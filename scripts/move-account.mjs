// Move one person's account from an old Internet Identity sign-in ID to a new
// one, across every blockchain canister that stores who they are. Calls the
// governor-only `rekey_principal(old, new, dry_run)` on each canister, so it
// runs from .github/workflows/move-account.yml with DEPLOYER_PEM.
//
// Always dry-runs EVERY canister first; if any refuses (e.g. the new ID
// already has data there) nothing is written. Only with CONFIRM=yes does it
// then write, domain canisters first and identity_access last, so a partial
// failure can simply be re-run (already-moved canisters report 0).
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Principal } from "@icp-sdk/core/principal";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Secp256k1KeyIdentity } from "@icp-sdk/core/identity/secp256k1";

const oldText = (process.env.OLD_PRINCIPAL || "").trim();
const newText = (process.env.NEW_PRINCIPAL || "").trim();
const confirm = (process.env.CONFIRM || "").trim().toLowerCase() === "yes";
// MERGE=yes: allowed even when the new ID already has data; both IDs' records
// end up under the new one. Only these canisters can refuse, so only they need it.
const merge = (process.env.MERGE || "").trim().toLowerCase() === "yes";
const MERGE_CANISTERS = new Set(["club_domain", "events_domain", "messaging_domain", "notification_queue", "pii_access_control", "media_blob_store", "media_metadata"]);
if (!oldText || !newText) throw new Error("OLD_PRINCIPAL and NEW_PRINCIPAL are required");
const oldP = Principal.fromText(oldText);
const newP = Principal.fromText(newText);
if (oldP.toText() === newP.toText()) throw new Error("Old and new sign-in IDs are the same");

const idsPath = process.env.IDS_FILE || "deploy/mainnet/.icp/data/mappings/ic.ids.json";
const ids = JSON.parse(readFileSync(idsPath, "utf8"));
// Group 2 (and later groups) keep their own club services; move those too, before
// identity_access, so no group's access is left behind under the old sign-in ID.
const extraGroups = [];
for (const file of (process.env.GROUP_FILES || "").split(",").map((f) => f.trim()).filter(Boolean)) {
  const g = JSON.parse(readFileSync(file, "utf8"));
  extraGroups.push({ label: g.groupId || file, ids: g.canisters || {} });
}

// Order matters: identity_access last (it unlinks the old ID from the account).
const CANISTERS = [
  "club_domain",
  "events_domain",
  "messaging_domain",
  "vault_domain",
  "notification_queue",
  "pii_access_control",
  "media_blob_store",
  "media_metadata",
  "mini_league_domain",
  "competition_domain",
  "club_points_domain",
  "insights_domain",
  "identity_access",
];

const pem = process.env.DEPLOYER_PEM.replace(/\r/g, "").replace(/\\n/g, "\n");
const jwk = createPrivateKey(pem).export({ format: "jwk" });
const secret = new Uint8Array(Buffer.from(jwk.d, "base64url"));
const identity = jwk.kty === "OKP" ? Ed25519KeyIdentity.fromSecretKey(secret) : Secp256k1KeyIdentity.fromSecretKey(secret);
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
console.log(`Governor: ${identity.getPrincipal().toText()}`);
console.log(`${merge ? "Merging" : "Moving"} ${oldText}\n    -> ${newText}\n`);

const motokoIdl = () =>
  IDL.Service({
    rekey_principal: IDL.Func([IDL.Principal, IDL.Principal, IDL.Bool], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
    merge_principal: IDL.Func([IDL.Principal, IDL.Principal, IDL.Bool], [IDL.Variant({ ok: IDL.Nat, err: IDL.Text })], []),
  });
const rustIdl = () =>
  IDL.Service({
    rekey_principal: IDL.Func([IDL.Principal, IDL.Principal, IDL.Bool], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
  });

const TARGETS = [];
for (const name of CANISTERS.filter((n) => n !== "identity_access")) TARGETS.push({ name, label: `g1 ${name}`, canisterId: ids[name] });
for (const g of extraGroups) for (const name of CANISTERS.filter((n) => n !== "identity_access")) {
  if (g.ids[name]) TARGETS.push({ name, label: `${g.label} ${name}`, canisterId: g.ids[name] });
}
TARGETS.push({ name: "identity_access", label: "identity_access", canisterId: ids.identity_access });
// Optional: leave named services untouched (e.g. "g1 club_points_domain"); their
// records stay saved under the old ID and can be merged later. identity_access cannot be skipped.
const skip = new Set((process.env.SKIP_SERVICES || "").split(",").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean));
if (skip.has("identity_access")) throw new Error("identity_access cannot be skipped");
for (const t of TARGETS) if (skip.has(t.label)) t.skip = true;

async function call(target, dryRun) {
  const { name: kind, label: name, canisterId } = target;
  if (target.skip) return { name, skipped: "skipped on request; records stay under the old ID" };
  if (!canisterId) return { name, skipped: "no canister id" };
  const actor = Actor.createActor(kind === "identity_access" ? rustIdl : motokoIdl, { agent, canisterId });
  try {
    const r = merge && MERGE_CANISTERS.has(kind) ? await actor.merge_principal(oldP, newP, dryRun) : await actor.rekey_principal(oldP, newP, dryRun);
    const err = r.err ?? r.Err;
    if (err !== undefined) return { name, err };
    return { name, count: Number(r.ok ?? r.Ok) };
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (/has no update method|method not found|did not find method|no method/i.test(msg)) {
      return { name, err: "the move/merge feature is not installed yet — run the blockchain update on main first" };
    }
    return { name, err: msg.split("\n")[0].slice(0, 300) };
  }
}

function print(results, label) {
  console.log(`== ${label} ==`);
  for (const r of results) {
    if (r.skipped) console.log(`  ${r.name.padEnd(32)} skipped (${r.skipped})`);
    else if (r.err) console.log(`  ${r.name.padEnd(32)} REFUSED: ${r.err}`);
    else console.log(`  ${r.name.padEnd(32)} ${r.count} record(s)`);
  }
  console.log("");
}

const dry = [];
for (const t of TARGETS) dry.push(await call(t, true));
print(dry, "Dry run (nothing written)");
const refused = dry.filter((r) => r.err);
if (refused.length) {
  console.log(`::error::${refused.length} canister(s) refused — nothing was moved. Fix the reasons above and re-run.`);
  process.exit(1);
}
if (!confirm) {
  console.log("Dry run only. Re-run with confirm = yes to move the account.");
  process.exit(0);
}

const done = [];
for (const t of TARGETS) {
  const r = await call(t, false);
  done.push(r);
  if (r.err) {
    print(done, "Move (stopped)");
    console.log(`::error::${r.name} failed — safe to re-run; canisters already moved will report 0.`);
    process.exit(1);
  }
}
print(done, "Moved");
console.log("Done. Sign out and back in on every device; they will all open this account.");
