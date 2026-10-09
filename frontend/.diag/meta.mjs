import { HttpAgent, CanisterStatus } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
const agent = await HttpAgent.create({ host: "https://icp-api.io" });
for (const [name,id] of [["messaging","mx3u5-iqaaa-aaaal-qxlqq-cai"],["club","mzzzv-taaaa-aaaal-qxlrq-cai"]]) {
  const res = await CanisterStatus.request({ agent, canisterId: Principal.fromText(id), paths: ["candid","module_hash",{kind:"metadata",key:"candid:service",path:"candid:service",decodeStrategy:"utf-8"}] });
  const c = res.get("candid") || res.get("candid:service") || "";
  console.log(name, "hash", res.get("module_hash"));
  console.log(name, "has create_group_with_roles:", String(c).includes("create_group_with_roles"), "len", String(c).length);
  const fs = await import("fs"); fs.writeFileSync(`/tmp/icp/${name}.did`, String(c));
}
