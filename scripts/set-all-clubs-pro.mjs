// Ignite Club HQ — turn Pro on for every live club on the ICP backend.
//
// Run by .github/workflows/set-clubs-pro.yml with the governor (deployer) key.
// save_club_subscription is governor/app-admin only, so this must run with the
// DEPLOYER_PEM identity — the same key the deploy workflow uses.
//
// Usage: DEPLOYER_PEM="$(cat key.pem)" node scripts/set-all-clubs-pro.mjs
import { createPrivateKey } from "node:crypto";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Principal } from "@icp-sdk/core/principal";

const CLUB_DOMAIN = "mzzzv-taaaa-aaaal-qxlrq-cai";

function loadIdentity() {
  const pemRaw = process.env.DEPLOYER_PEM;
  if (!pemRaw) throw new Error("DEPLOYER_PEM is not set");
  const pem = pemRaw.replace(/\r/g, "").replace(/\\n/g, "\n");
  const key = createPrivateKey(pem);
  const jwk = key.export({ format: "jwk" });
  if (jwk.kty !== "OKP" || !jwk.d) {
    throw new Error("DEPLOYER_PEM is not an Ed25519 key");
  }
  const seed = Buffer.from(jwk.d, "base64url");
  return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(seed));
}

const opt = (t) => IDL.Opt(t);
const Club = IDL.Record({ id: IDL.Text, name: IDL.Text, deleted_at_ms: opt(IDL.Nat64) });
const ClubSubscription = IDL.Record({
  club_id: IDL.Text,
  is_pro: IDL.Bool,
  is_pro_football: IDL.Bool,
  admin_pro_override: IDL.Bool,
  admin_pro_football_override: IDL.Bool,
  expires_at_ms: opt(IDL.Nat64),
  plan: IDL.Text,
  team_limit: opt(IDL.Nat32),
  trial_ends_at_ms: opt(IDL.Nat64),
  is_trial: IDL.Bool,
  cancelled_at_ms: opt(IDL.Nat64),
  activated_at_ms: opt(IDL.Nat64),
});
const Result = (ok) => IDL.Variant({ Ok: ok, Err: IDL.Text });

const idl = ({ IDL }) =>
  IDL.Service({
    list_clubs: IDL.Func([opt(IDL.Text), IDL.Nat16], [Result(IDL.Vec(Club))], ["query"]),
    get_club_subscriptions: IDL.Func([IDL.Vec(IDL.Text)], [Result(IDL.Vec(ClubSubscription))], ["query"]),
    save_club_subscription: IDL.Func([ClubSubscription], [Result(ClubSubscription)], []),
  });

const identity = loadIdentity();
console.log("==> Governor principal:", identity.getPrincipal().toText());

const agent = await HttpAgent.create({ host: "https://icp0.io", identity });
const clubDomain = Actor.createActor(idl, { agent, canisterId: Principal.fromText(CLUB_DOMAIN) });

const clubsRes = await clubDomain.list_clubs([], 100);
if ("Err" in clubsRes) throw new Error(`list_clubs failed: ${clubsRes.Err}`);
const live = clubsRes.Ok.filter((c) => c.deleted_at_ms.length === 0);
console.log(`==> ${live.length} live clubs`);

const subsRes = await clubDomain.get_club_subscriptions(live.map((c) => c.id));
if ("Err" in subsRes) throw new Error(`get_club_subscriptions failed: ${subsRes.Err}`);
const byClub = new Map(subsRes.Ok.map((s) => [s.club_id, s]));

const nowMs = BigInt(Date.now());
for (const club of live) {
  const existing = byClub.get(club.id);
  const record = existing
    ? { ...existing, is_pro: true, admin_pro_override: true }
    : {
        club_id: club.id,
        is_pro: true,
        is_pro_football: false,
        admin_pro_override: true,
        admin_pro_football_override: false,
        expires_at_ms: [],
        plan: "pro",
        team_limit: [],
        trial_ends_at_ms: [],
        is_trial: false,
        cancelled_at_ms: [],
        activated_at_ms: [nowMs],
      };
  if (record.activated_at_ms.length === 0) record.activated_at_ms = [nowMs];
  const res = await clubDomain.save_club_subscription(record);
  if ("Err" in res) throw new Error(`save_club_subscription(${club.name}) failed: ${res.Err}`);
  console.log(`   ✓ ${club.name} (${club.id}) → Pro on`);
}
console.log("==> Done. All live clubs are Pro.");
