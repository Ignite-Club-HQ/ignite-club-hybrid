import { HttpAgent, Actor } from "@icp-sdk/core/agent";
import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { idlFactory as clubIdl } from "./club.did.mjs";
import { readFileSync } from "fs";
const seed = new Uint8Array(32); crypto.getRandomValues(seed);
const identity = Ed25519KeyIdentity.fromSecretKey(seed);
const agent = await HttpAgent.create({ host: "https://icp-api.io", identity });
const club = Actor.createActor(clubIdl, { agent, canisterId: "mzzzv-taaaa-aaaal-qxlrq-cai" });
// identity_access
const { idlFactory: iaIdl } = await import("./ia.did.mjs");
const ia = Actor.createActor(iaIdl, { agent, canisterId: "mq2sj-fiaaa-aaaal-qxlqa-cai" });
console.log("reg", JSON.stringify(await ia.register_account(), (k,v)=>typeof v==="bigint"?String(v):v).slice(0,150));
console.log("prof", JSON.stringify(await ia.set_profile("Zz Probe", []), (k,v)=>typeof v==="bigint"?String(v):v).slice(0,150));
const id = crypto.randomUUID();
const r = await club.create_club(id, "zz probe ui", "zz-probe-ui-"+id.slice(0,8), [], []);
console.log("club", Object.keys(r), id);
const fs = await import("fs");
fs.writeFileSync("/tmp/icp/probe-ident.json", JSON.stringify({ seed: Buffer.from(seed).toString("hex"), principal: identity.getPrincipal().toText(), der: Buffer.from(identity.getPublicKey().toDer()).toString("hex"), clubId: id }));
console.log(identity.getPrincipal().toText());
