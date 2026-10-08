// Ignite Club HQ — permanently delete every ICP club except the one named in KEEP_CLUB,
// and print who holds admin roles on the kept club. Governor-only (DEPLOYER_PEM).
// Dry run unless CONFIRM=yes.
import { createPrivateKey } from "node:crypto";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";

const CLUB_DOMAIN = "mzzzv-taaaa-aaaal-qxlrq-cai";
const IDENTITY = "mq2sj-fiaaa-aaaal-qxlqa-cai";
const KEEP = (process.env.KEEP_CLUB || "Chick Burgers").trim().toLowerCase();
const CONFIRM = process.env.CONFIRM === "yes";

const pem = (process.env.DEPLOYER_PEM || "").replace(/\r/g, "").replace(/\\n/g, "\n");
if (!pem) throw new Error("DEPLOYER_PEM is not set");
const jwk = createPrivateKey(pem).export({ format: "jwk" });
const identity = Ed25519KeyIdentity.fromSecretKey(new Uint8Array(Buffer.from(jwk.d, "base64url")));

const clubIdl = ({ IDL }) => {
  const R = (t) => IDL.Variant({ Ok: t, Err: IDL.Text });
  const Club = IDL.Record({ id: IDL.Text, name: IDL.Text, deleted_at_ms: IDL.Opt(IDL.Nat64) });
  const Role = IDL.Record({ account_id: IDL.Text, club: IDL.Opt(IDL.Text), role: IDL.Text, team: IDL.Opt(IDL.Text) });
  return IDL.Service({
    list_clubs: IDL.Func([IDL.Opt(IDL.Text), IDL.Nat16], [R(IDL.Vec(Club))], ["query"]),
    list_role_grants: IDL.Func([IDL.Text], [R(IDL.Vec(Role))], ["query"]),
    soft_delete_club: IDL.Func([IDL.Text, IDL.Bool], [R(Club)], []),
    delete_club_permanent: IDL.Func([IDL.Text], [R(IDL.Null)], []),
  });
};
const idIdl = ({ IDL }) =>
  IDL.Service({
    search_profiles: IDL.Func([IDL.Text, IDL.Nat32], [IDL.Vec(IDL.Record({ account_id: IDL.Text, principal: IDL.Principal, display_name: IDL.Text }))], ["query"]),
  });

const agent = await HttpAgent.create({ host: "https://icp0.io", identity });
const club = Actor.createActor(clubIdl, { agent, canisterId: CLUB_DOMAIN });
const ident = Actor.createActor(idIdl, { agent, canisterId: IDENTITY });

const res = await club.list_clubs([], 500);
if ("Err" in res) throw new Error(res.Err);
const keep = res.Ok.filter((c) => c.name.trim().toLowerCase() === KEEP && c.deleted_at_ms.length === 0);
if (keep.length !== 1) throw new Error(`Expected exactly one live club named "${KEEP}", found ${keep.length}`);
const kept = keep[0];

console.log(`==> Keeping: ${kept.name} (${kept.id})`);
const roles = await club.list_role_grants(kept.id);
if ("Err" in roles) console.log("   could not read roles:", roles.Err);
else {
  let profiles = [];
  try { profiles = await ident.search_profiles("", 500); } catch { /* optional */ }
  const byAcct = new Map(profiles.map((p) => [p.account_id, p]));
  for (const r of roles.Ok.filter((r) => r.club.length && r.club[0] === kept.id)) {
    const p = byAcct.get(r.account_id);
    console.log(`   ${r.role}: account ${r.account_id}${p ? ` — ${p.display_name} — principal ${p.principal.toText()}` : ""}`);
  }
}

for (const c of res.Ok.filter((c) => c.id !== kept.id)) {
  if (!CONFIRM) { console.log(`   would delete: ${c.name} (${c.id})`); continue; }
  if (c.deleted_at_ms.length === 0) {
    const s = await club.soft_delete_club(c.id, true);
    if ("Err" in s) { console.log(`   FAILED soft delete ${c.name}: ${s.Err}`); continue; }
  }
  const d = await club.delete_club_permanent(c.id);
  console.log("Err" in d ? `   FAILED ${c.name}: ${d.Err}` : `   deleted: ${c.name} (${c.id})`);
}
if (!CONFIRM) console.log("==> Dry run. Re-run with confirm = yes to delete.");
