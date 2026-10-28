import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/chat/ChatParticipantsList.tsx"),
  "utf8",
);

// The chat details "Participants" panel must show real members in ICP mode:
// the panel's data query previously ran only against Supabase, which has no
// rows for Internet Identity accounts, so ICP users saw "No participants
// found" in every team/group chat.
describe("chat participants in ICP mode", () => {
  it("enables the members query for signed-in ICP users instead of disabling it", () => {
    expect(source).toContain(
      'enabled: enabled && (resolveAuthBackend() !== "icp" || !!user),',
    );
  });

  it("no longer renders the lab stub member", () => {
    expect(source).not.toContain("Local ICP Member");
  });

  it("reads team roster roles from club_domain team role grants", () => {
    expect(source).toContain("listLiveTeamRoleGrants(ctx, chatId)");
  });

  it("reads the chat's own member list from the messaging canister", () => {
    expect(source).toContain("getLiveGroupMetadata(ctx, chatId)");
  });

  it("lists club admins from the canister for club-admin threads", () => {
    expect(source).toContain("listLiveClubAdminThreads(ctx, clubId36)");
  });

  it("resolves member names through the identity_access profile lookup", () => {
    expect(source).toContain("listLiveProfilesByIds(ctx, ids, resolvedClubId ? { clubId: resolvedClubId } : undefined)");
  });
});
