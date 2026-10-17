import { describe, expect, it } from "vitest";

/**
 * ICP coverage register — every feature the Codespaces ICP sentinel flagged
 * must be either built on-chain ("onchain"), intentionally off-chain with an
 * approved reason ("offchain"), or explicitly blocked ("blocked").
 * "todo" entries are open work from the 2026-10-16 coverage plan and show as
 * todo tests until a behaviour-level ICP test replaces them.
 */
type Status = "onchain" | "offchain" | "blocked" | "todo";
const REGISTER: Record<string, { status: Status; reason?: string }> = {
  "AdMob settings": { status: "offchain", reason: "ads config is not user data; approved exception" },
  "AI catch-up administration": { status: "todo" },
  "Photo-reminder administration": { status: "todo" },
  "LLM testing": { status: "blocked", reason: "static app cannot hold the AI key" },
  "Temporary passwords": { status: "offchain", reason: "Internet Identity has no passwords" },
  "Application payment configuration": { status: "offchain", reason: "payments stay off-chain" },
  "Club editing": { status: "todo" },
  "Team editing": { status: "todo" },
  "Personal team creation": { status: "todo" },
  "External fixture import": { status: "onchain", reason: "PlayHQ team fixtures on events_domain; association imports off-chain" },
  "Backup administration": { status: "todo" },
  "Promo-code management and redemption": { status: "onchain", reason: "club_domain promo codes (migration 20261021/22)" },
  "Subscription management": { status: "offchain", reason: "payments; native IAP only in ICP" },
  "Schedule broadcasts": { status: "todo" },
  "Fee payments": { status: "offchain", reason: "payments stay off-chain" },
  "Public competition pages": { status: "todo" },
  "Realtime health monitoring": { status: "todo" },
  "Password recovery and reset-code verification": { status: "offchain", reason: "Internet Identity has no passwords" },
  "Scheduled messages": { status: "todo" },
  "Update reminders": { status: "todo" },
  "Short invite resolution": { status: "onchain", reason: "Anonymous club_domain resolution; ShortInviteRedirect.test.tsx verifies success, rejection and missing results without Supabase" },
  "Payment settings": { status: "offchain", reason: "payments stay off-chain" },
  "Administrative video guides": { status: "todo" },
  "Account deletion": { status: "todo" },
  "Chat vault pinning": { status: "todo" },
  "Chat-image gallery publication": { status: "todo" },
  "Pitch-board event-link notifications": { status: "todo" },
  "Pitch-board formation notifications": { status: "todo" },
  "Team-admin email invitations": { status: "offchain", reason: "email delivery off-chain; join links on-chain" },
};

describe("ICP coverage register", () => {
  it("lists all 29 flagged features", () => {
    expect(Object.keys(REGISTER)).toHaveLength(29);
  });
  it("every off-chain or blocked feature states a reason", () => {
    for (const [name, e] of Object.entries(REGISTER)) {
      if (e.status === "offchain" || e.status === "blocked") expect(e.reason, name).toBeTruthy();
    }
  });
  for (const [name, e] of Object.entries(REGISTER)) {
    if (e.status === "todo") it.todo(`ICP path: ${name}`);
  }
});
