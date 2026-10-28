// Read-only: report which account(s) each sign-in ID lands on, the account
// its ID derives to, and that account's status, roles, families and markers.
// Uses governor-only export_state (a query); writes nothing. Prints no names
// or emails — only whether a profile exists.
import { createHash, createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { Actor, HttpAgent } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { Secp256k1KeyIdentity } from "@icp-sdk/core/identity/secp256k1";

const texts = (process.env.PRINCIPALS || "").split(/[\s,]+/).filter(Boolean);
if (!texts.length) throw new Error("PRINCIPALS required");
const ids = JSON.parse(readFileSync(process.env.IDS_FILE, "utf8"));
const { idlFactory } = await import(process.env.IDL_FILE);

const pem = process.env.DEPLOYER_PEM.replace(/\r/g, "").replace(/\\n/g, "\n");
const jwk = createPrivateKey(pem).export({ format: "jwk" });
const secret = new Uint8Array(Buffer.from(jwk.d, "base64url"));
const identity = jwk.kty === "OKP" ? Ed25519KeyIdentity.fromSecretKey(secret) : Secp256k1KeyIdentity.fromSecretKey(secret);
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
const actor = Actor.createActor(idlFactory, { agent, canisterId: ids.identity_access });

const derive = (p) => {
  const h = createHash("sha256").update(Buffer.from(p.toUint8Array())).digest("hex").slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const r = await actor.export_state();
if (r.Err !== undefined) throw new Error(`export_state refused: ${r.Err}`);
const s = r.Ok;
const json = (v) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x?._isPrincipal ? x.toText() : x));
const describe = (id) => {
  const a = s.accounts.find((x) => x.id === id);
  if (!a) return { id, exists: false };
  return {
    id,
    exists: true,
    status: Object.keys(a.status)[0],
    version: a.version.toString(),
    principals: a.principals.map((p) => p.toText()),
    hasProfile: s.profiles.some((p) => p.account_id === id || p.id === id),
    roles: s.roles.filter((g) => g.account_id === id).map((g) => ({ role: g.role, club: g.club[0] ?? null, team: g.team[0] ?? null })),
    children: s.families.filter((f) => f.account_id === id).length,
    exclusions: s.exclusions.filter((e) => e.account_id === id).map((e) => e.club),
    entitlements: s.entitlements.filter((e) => json(e).includes(id)).length,
  };
};
for (const t of texts) {
  const p = Principal.fromText(t);
  const listing = s.accounts.filter((a) => a.principals.some((x) => x.toText() === t)).map((a) => a.id);
  const derived = derive(p);
  console.log(`\n=== Sign-in ID ${t}`);
  console.log(`Accounts listing it: ${listing.length ? listing.join(", ") : "none"}`);
  console.log(`Derived (original) account: ${derived}`);
  for (const id of new Set([derived, ...listing])) console.log(json(describe(id)));
}
const groups = [["g1", ids.club_domain]];
try { const g2 = JSON.parse(readFileSync(process.env.G2_FILE, "utf8")); const c = g2.canisters?.club_domain ?? g2.club_domain; if (typeof c === "string") groups.push(["g2", c]); } catch {}
const { idlFactory: clubIdl } = await import(process.env.CLUB_IDL_FILE);
let router = null;
try { const { idlFactory: routerIdl } = await import(process.env.ROUTER_IDL_FILE); router = Actor.createActor(routerIdl, { agent, canisterId: ids.shard_router }); } catch { console.log("Router check unavailable"); }
for (const [g, canisterId] of groups) {
  const club = Actor.createActor(clubIdl, { agent, canisterId });
  console.log(`\n=== Club service ${g} (${canisterId})`);
  try {
    const names = new Map();
    let after = [];
    for (;;) { const page = await club.list_clubs(after, 100); const rows = page.Ok ?? []; rows.forEach((c) => names.set(c.id, c.name)); if (rows.length < 100) break; after = [rows[rows.length - 1].id]; }
    console.log(`Clubs: ${[...names.values()].join(", ") || "none"}`);
    const a = await club.export_acl();
    if (a.Err !== undefined) { console.log(`ACL refused: ${a.Err}`); continue; }
    const mine = a.Ok.acl.roles.filter((r) => texts.includes(r.user.toText()));
    console.log(`Role grants for these sign-in IDs: ${mine.length}`);
    for (const r of mine) console.log(json({ user: r.user.toText().slice(0, 5), role: r.role, club: names.get(r.club[0]) ?? r.club[0] ?? null, team: r.team[0] ?? null }));
    // What the app's club lookup sees for each sign-in ID (read-only).
    const acl = a.Ok.acl;
    for (const t of texts) {
      const own = (p) => p?.toText?.() === t;
      const appWide = acl.roles.some((r) => own(r.user) && r.club.length === 0);
      const direct = new Set(acl.roles.filter((r) => own(r.user) && r.club.length).map((r) => r.club[0]));
      const kids = acl.children.filter((c) => own(c.parent[0]) || acl.guardians.some((g) => g.child === c.id && own(g.user)));
      const excluded = acl.exclusions.filter((e) => own(e.user)).map((e) => names.get(e.club) ?? e.club);
      console.log(json({ signIn: t.slice(0, 5), appWideRole: appWide, clubsByRole: [...direct].map((c) => names.get(c) ?? c), familyChildren: kids.length, excludedFrom: excluded }));
    }
    try { const st = await club.read_membership_discovery_status(); console.log(`Lookup change status: ${json(st)}`); } catch (e) { console.log(`Lookup status read failed: ${String(e?.message ?? e).slice(0, 200)}`); }
    if (router) {
      const ownerClubs = new Set(acl.roles.filter((r) => texts.some((t) => r.user.toText() === t) && r.club.length).map((r) => r.club[0]));
      for (const id of ownerClubs) {
        try { const ga = await router.get_group_assignment(id); console.log(`Directory entry ${names.get(id) ?? id}: ${json(ga.Ok?.[0] ?? ga.Err ?? "MISSING")}`); }
        catch (e) { console.log(`Directory read ${id} failed: ${String(e?.message ?? e).slice(0, 200)}`); }
      }
    }
  } catch (e) { console.log(`Read failed: ${String(e?.message ?? e).slice(0, 300)}`); }
}
try { const dc = await actor.read_membership_directory_configuration(); console.log(`\nShared lookup configuration: ${json(dc.Ok ? { enabled: dc.Ok.enabled, appEnabled: dc.Ok.app_enabled, generation: dc.Ok.generation, sources: dc.Ok.sources } : dc)}`); }
catch (e) { console.log(`Shared lookup configuration read failed: ${String(e?.message ?? e).slice(0, 200)}`); }
console.log(`\nTotal accounts: ${s.accounts.length}. Nothing was changed.`);
