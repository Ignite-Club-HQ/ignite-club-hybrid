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

async function call(name, dryRun) {
  const canisterId = ids[name];
  if (!canisterId) return { name, skipped: "no canister id" };
  const actor = Actor.createActor(name === "identity_access" ? rustIdl : motokoIdl, { agent, canisterId });
  try {
    const r = merge && MERGE_CANISTERS.has(name) ? await actor.merge_principal(oldP, newP, dryRun) : await actor.rekey_principal(oldP, newP, dryRun);
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
    if (r.skipped) console.log(`  ${r.name.padEnd(20)} skipped (${r.skipped})`);
    else if (r.err) console.log(`  ${r.name.padEnd(20)} REFUSED: ${r.err}`);
    else console.log(`  ${r.name.padEnd(20)} ${r.count} record(s)`);
  }
  console.log("");
}

const dry = [];
for (const name of CANISTERS) dry.push(await call(name, true));
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
for (const name of CANISTERS) {
  const r = await call(name, false);
  done.push(r);
  if (r.err) {
    print(done, "Move (stopped)");
    console.log(`::error::${name} failed — safe to re-run; canisters already moved will report 0.`);
    process.exit(1);
  }
}
print(done, "Moved");
console.log("Done. Sign out and back in on every device; they will all open this account.");
