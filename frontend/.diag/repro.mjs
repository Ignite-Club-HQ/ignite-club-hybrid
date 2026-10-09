import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { idlFactory as msgIdl } from "./msg.did.mjs";
import { idlFactory as clubIdl } from "./club.did.mjs";
const identity = Ed25519KeyIdentity.generate();
const me = identity.getPrincipal();
console.log("me", me.toText());
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
const club = Actor.createActor(clubIdl, { agent, canisterId: "mzzzv-taaaa-aaaal-qxlrq-cai" });
const msg = Actor.createActor(msgIdl, { agent, canisterId: "mx3u5-iqaaa-aaaal-qxlqq-cai" });
const id = crypto.randomUUID();
const j = (x) => JSON.stringify(x, (k, v) => typeof v === "bigint" ? v.toString() : (v && v._isPrincipal) ? "P:"+v.toText?.() : v);
const c = await club.create_club(id, "zz diag " + id.slice(0,6), "zz-diag-" + id.slice(0,8), [], []);
console.log("create_club", j(c).slice(0,200));
console.log("my_role_grants", j(await club.my_role_grants()));
console.log("list_role_grants", j(await club.list_role_grants(id)));
console.log("list_groups_by_clubs BEFORE", j(await msg.list_groups_by_clubs([id])));
console.log("list_groups_by_club BEFORE", j(await msg.list_groups_by_club(id)));
for (const name of ["Coaches","Team Admins","Club Committee","Fundraising"]) {
  const r = await msg.create_group_with_roles(id, [], name, "group", [[me, "owner"]]);
  console.log("create", name, j(r).slice(0,250));
}
console.log("list_groups_by_clubs AFTER", j(await msg.list_groups_by_clubs([id])));
console.log("soft_delete", j(await club.soft_delete_club(id, true)).slice(0,120));
