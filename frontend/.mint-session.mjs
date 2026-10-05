import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { DelegationChain } from "@icp-sdk/core/identity";
import { writeFileSync } from "fs";
const base = Ed25519KeyIdentity.generate();
const session = Ed25519KeyIdentity.generate();
const chain = await DelegationChain.create(base, session.getPublicKey().toDer(), new Date(Date.now() + 24*3600*1000));
writeFileSync("/tmp/browser/img-upload/session.json", JSON.stringify({
  identity: JSON.stringify(session.toJSON()),
  delegation: JSON.stringify(chain.toJSON()),
}));
console.log("session minted, principal:", (await import("@icp-sdk/core/identity")).DelegationIdentity.fromDelegation(session, chain).getPrincipal().toText());
