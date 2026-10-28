// Stores the Resend sender on every group's club service so the Email invite
// button can deliver. The key is passed via environment only and never printed.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const key = process.env.RESEND_API_KEY || "";
const from = process.env.FROM_ADDRESS || "";
const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
if (!key) throw Error("RESEND_API_KEY secret is not set");
if (!from || !/^https:\/\//.test(appUrl)) throw Error("from_address and https app_url are required");

const ids = JSON.parse(readFileSync("deploy/mainnet/.icp/data/mappings/ic.ids.json", "utf8"));
const targets = [{ label: "g1", id: ids.club_domain }];
for (const dir of existsSync("deploy/groups") ? readdirSync("deploy/groups") : []) {
  const file = `deploy/groups/${dir}/provision.json`;
  if (!existsSync(file)) continue;
  const g = JSON.parse(readFileSync(file, "utf8"));
  if (g.canisters?.club_domain) targets.push({ label: g.groupId || dir, id: g.canisters.club_domain });
}
const q = (s) => JSON.stringify(s);
let failed = 0;
for (const t of targets) {
  if (!t.id) { console.log(`${t.label}: no club service id, skipped`); failed++; continue; }
  const out = execFileSync("icp", ["canister", "call", t.id, "set_invite_email_sender", `(${q(key)}, ${q(from)}, ${q(appUrl)})`, "-e", "ic"], { encoding: "utf8" });
  const ok = /variant\s*\{\s*Ok/.test(out);
  console.log(`${t.label}: ${ok ? "configured" : "refused"}`);
  if (!ok) failed++;
  const status = execFileSync("icp", ["canister", "call", t.id, "invite_email_sender_status", "()", "-e", "ic", "--query"], { encoding: "utf8" });
  console.log(`${t.label} status: ${status.replace(/\s+/g, " ").trim()}`);
}
if (failed) process.exit(1);
