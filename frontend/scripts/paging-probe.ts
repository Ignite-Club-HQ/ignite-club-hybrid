import { Ed25519KeyIdentity } from "@icp-sdk/core/identity";
import { createLiveConversation, listLiveLatestMessagesPage, sendLiveMessage } from "@/live/features/messaging";
import type { IcpTargetConfig } from "@/live/targetRegistry";

const target: IcpTargetConfig = {
  provider: "icp",
  alias: "icp-public-mainnet",
  networkKind: "public_mainnet",
  host: "https://icp-api.io",
  canisterIds: {
    messaging_domain: "mx3u5-iqaaa-aaaal-qxlqq-cai",
    club_domain: "mzzzv-taaaa-aaaal-qxlrq-cai",
  },
  deploymentClass: "public_subnet",
};

const identity = Ed25519KeyIdentity.generate();
const caller = identity.getPrincipal();
const ctx = { target, identity: identity as any };

let convId = "";
try {
  const conv: any = await createLiveConversation(ctx, `probe-club-${Date.now()}`, [caller], null);
  convId = String(conv?.id ?? conv?.conversation_id ?? conv);
  console.log("conversation created:", convId);
} catch (err) {
  console.log("create failed:", err instanceof Error ? err.message : JSON.stringify(err).slice(0, 200));
}

for (let i = 1; i <= 3; i++) {
  try {
    await sendLiveMessage(ctx, convId, `probe ${i}`, `${convId}:${i}`);
    console.log("sent", i);
  } catch (err) {
    console.log("send failed", i, ":", err instanceof Error ? err.message : JSON.stringify(err).slice(0, 200));
    break;
  }
}

try {
  const page = await listLiveLatestMessagesPage(ctx, convId, null, 10);
  console.log("READ OK:", page.messages.length, "msgs; next:", JSON.stringify(page.next_sequence), "latest:", String((page as any).latest_sequence));
  console.log("order:", page.messages.map((m: any) => `${String(m.sequence)}:${m.body}`).join(","));
} catch (err) {
  console.log("READ FAILED:", err instanceof Error ? err.message : JSON.stringify(err).slice(0, 200));
}
