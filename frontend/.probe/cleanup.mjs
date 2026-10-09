import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { idlFactory as clubIdl } from "./club.did.mjs";
import { idlFactory as iaIdl } from "./ia.did.mjs";
import { readFileSync } from "fs";
const P = JSON.parse(readFileSync("/tmp/icp/probe-ident.json","utf8"));
const identity = Ed25519KeyIdentity.fromSecretKey(Uint8Array.from(Buffer.from(P.seed,"hex")));
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
const club = Actor.createActor(clubIdl, { agent, canisterId: "mzzzv-taaaa-aaaal-qxlrq-cai" });
const ids = [...new Set((await club.my_role_grants()).map(g=>g.club[0]).filter(Boolean))];
for (const id of ids) { const r = await club.soft_delete_club(id, true); console.log(id, Object.keys(r)); }
const ia = Actor.createActor(iaIdl, { agent, canisterId: "mq2sj-fiaaa-aaaal-qxlqa-cai" });
console.log(Object.keys(ia).filter(k=>/delete|erase|deactivate/i.test(k)));
