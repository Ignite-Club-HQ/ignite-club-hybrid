// Erase duplicate Internet Identity accounts on identity_access that share a
// display name, keeping the listed principal(s). Governor-only
// (erase_account), so it runs from .github/workflows/erase-duplicate-profiles.yml
// with DEPLOYER_PEM. Without CONFIRM=yes it only lists what it would erase.
import { createPrivateKey } from "node:crypto";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Secp256k1KeyIdentity } from "@icp-sdk/core/identity/secp256k1";

const IDENTITY_ACCESS = "mq2sj-fiaaa-aaaal-qxlqa-cai";
const name = (process.env.DISPLAY_NAME || "").trim();
const keepRaw = (process.env.KEEP_PRINCIPALS || "").trim();
const eraseAll = keepRaw.toLowerCase() === "none";
const keep = new Set(eraseAll ? [] : keepRaw.split(/[\s,]+/).filter(Boolean));
const confirm = process.env.CONFIRM === "yes";
if (!name) throw new Error("DISPLAY_NAME is required");

const pem = process.env.DEPLOYER_PEM.replace(/\r/g, "").replace(/\\n/g, "\n");
const jwk = createPrivateKey(pem).export({ format: "jwk" });
const identity = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(Buffer.from(jwk.d, "base64url")));

const Res = (t) => IDL.Variant({ Ok: t, Err: IDL.Text });
const idl = IDL.Service({
  search_profiles: IDL.Func([IDL.Text, IDL.Nat16], [Res(IDL.Vec(IDL.Record({
    account_id: IDL.Text, principal: IDL.Principal, avatar_ref: IDL.Opt(IDL.Text), display_name: IDL.Text,
  })))], ["query"]),
  erase_account: IDL.Func([IDL.Text], [Res(IDL.Null)], []),
});
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
const actor = Actor.createActor(() => idl, { agent, canisterId: IDENTITY_ACCESS });

const res = await actor.search_profiles(name, 200);
if ("Err" in res) throw new Error(res.Err);
const matches = res.Ok.filter((p) => p.display_name.trim().toLowerCase() === name.toLowerCase());
console.log(`Found ${matches.length} account(s) named "${name}":`);
for (const p of matches) console.log(`  ${p.principal.toText()}  (account ${p.account_id})${keep.has(p.principal.toText()) ? "  KEEP" : ""}`);
if (keep.size === 0 && !eraseAll) { console.log("\nNo principals to keep given — listing only. Re-run with keep_principals set to the one to keep, or \"none\" to erase them all."); process.exit(0); }
const missing = [...keep].filter((k) => !matches.some((p) => p.principal.toText() === k));
if (missing.length) throw new Error(`Keep principal(s) not found among matches: ${missing.join(", ")}`);
const targets = matches.filter((p) => !keep.has(p.principal.toText()));
if (!confirm) { console.log(`\nDry run: would erase ${targets.length}. Re-run with confirm = yes.`); process.exit(0); }
for (const p of targets) {
  const r = await actor.erase_account(p.account_id);
  console.log(`${"Err" in r ? "FAILED" : "erased"} ${p.principal.toText()}${"Err" in r ? ": " + r.Err : ""}`);
}
