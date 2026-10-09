// Ignite Club HQ — backfill the home country on existing ICP clubs.
//
// Run by .github/workflows/backfill-club-home-countries.yml with the governor
// (deployer) key. set_club_home_country is set-once for club admins, but the
// governor can set/overwrite, so this must run with the DEPLOYER_PEM identity —
// the same key the deploy workflow uses.
//
// Only clubs with NO recorded country are touched; clubs that already have one
// are left alone, so this is safe to re-run.
//
// Usage: DEPLOYER_PEM="$(cat key.pem)" COUNTRY_CODE=AU node scripts/backfill-club-home-countries.mjs
import { createPrivateKey } from "node:crypto";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { IDL } from "@icp-sdk/core/candid";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Secp256k1KeyIdentity } from "@icp-sdk/core/identity/secp256k1";
import { Principal } from "@icp-sdk/core/principal";

const CLUB_DOMAIN = "mzzzv-taaaa-aaaal-qxlrq-cai";
const COUNTRY = (process.env.COUNTRY_CODE || "AU").trim().toUpperCase();
if (!/^[A-Z]{2}$/.test(COUNTRY)) throw new Error(`COUNTRY_CODE must be a 2-letter code, got "${COUNTRY}"`);

function loadIdentity() {
  const pemRaw = process.env.DEPLOYER_PEM;
  if (!pemRaw) throw new Error("DEPLOYER_PEM is not set");
  const pem = pemRaw.replace(/\r/g, "").replace(/\\n/g, "\n");
  const key = createPrivateKey(pem);
  const jwk = key.export({ format: "jwk" });
  if (!jwk.d) throw new Error("DEPLOYER_PEM has no private key");
  if (jwk.kty !== "OKP") return Secp256k1KeyIdentity.fromSecretKey(new Uint8Array(Buffer.from(jwk.d, "base64url")));
  const seed = Buffer.from(jwk.d, "base64url");
  return Ed25519KeyIdentity.fromSecretKey(new Uint8Array(seed));
}

const opt = (t) => IDL.Opt(t);
const Club = IDL.Record({ id: IDL.Text, name: IDL.Text, deleted_at_ms: opt(IDL.Nat64) });
const Result = (ok) => IDL.Variant({ Ok: ok, Err: IDL.Text });

const idl = ({ IDL }) =>
  IDL.Service({
    list_clubs: IDL.Func([opt(IDL.Text), IDL.Nat16], [Result(IDL.Vec(Club))], ["query"]),
    get_club_home_countries: IDL.Func([IDL.Vec(IDL.Text)], [IDL.Vec(IDL.Tuple(IDL.Text, IDL.Text))], ["query"]),
    set_club_home_country: IDL.Func([IDL.Text, IDL.Text], [Result(IDL.Null)], []),
  });

const identity = loadIdentity();
console.log("==> Governor principal:", identity.getPrincipal().toText());

const agent = await HttpAgent.create({ host: "https://icp0.io", identity });
const clubDomain = Actor.createActor(idl, { agent, canisterId: Principal.fromText(CLUB_DOMAIN) });

const clubsRes = await clubDomain.list_clubs([], 100);
if ("Err" in clubsRes) throw new Error(`list_clubs failed: ${clubsRes.Err}`);
const live = clubsRes.Ok.filter((c) => c.deleted_at_ms.length === 0);
console.log(`==> ${live.length} live clubs`);

const existing = await clubDomain.get_club_home_countries(live.map((c) => c.id));
const haveCountry = new Map(existing);
const missing = live.filter((c) => !haveCountry.has(c.id));
console.log(`==> ${haveCountry.size} already have a country, ${missing.length} missing`);

for (const club of missing) {
  const res = await clubDomain.set_club_home_country(club.id, COUNTRY);
  if ("Err" in res) throw new Error(`set_club_home_country(${club.name}) failed: ${res.Err}`);
  console.log(`   ✓ ${club.name} (${club.id}) → ${COUNTRY}`);
}
console.log(`==> Done. ${missing.length} club(s) backfilled with ${COUNTRY}.`);
