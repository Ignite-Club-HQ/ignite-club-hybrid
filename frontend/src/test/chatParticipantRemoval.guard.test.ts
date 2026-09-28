import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const src = readFileSync("src/components/chat/ChatParticipantsList.tsx", "utf8");
const removalFn = src.slice(
  src.indexOf("const handleRemoveMember"),
  src.indexOf("useEffect(() => {\n    if (!membersLoading"),
);

describe("ChatParticipantsList team-member removal", () => {
  it("uses the authoritative remove_team_member RPC exactly once", () => {
    const matches = removalFn.match(/rpc\("remove_team_member"/g) ?? [];
    expect(matches).toHaveLength(1);
    expect(removalFn).toContain("_team_id: effectiveTeamId");
    expect(removalFn).toContain("_user_id: selectedMember.userId");
  });

  it("no longer deletes team roles directly from user_roles", () => {
    expect(removalFn).not.toContain('from("user_roles")');
    expect(removalFn).not.toContain(".delete()");
  });

  it("refreshes team roster, chat members and authorized scopes on success", () => {
    expect(removalFn).toContain("refreshChatRemovedTeamMember(queryClient, effectiveTeamId, chatType, chatId)");
  });

  it("bails out on RPC failure without closing the sheet or invalidating", () => {
    const failureBlock = removalFn.slice(
      removalFn.indexOf("if (error) {"),
      removalFn.indexOf("const refreshMembership"),
    );
    expect(failureBlock).toContain('toast.error("Failed to remove member")');
    expect(failureBlock).toContain("return;");
    expect(failureBlock).not.toContain("setSelectedMember(null)");
    expect(failureBlock).not.toContain("invalidateQueries");
  });

  it("treats a post-commit notification failure as partial success", () => {
    expect(removalFn).toContain("notifyError");
    expect(removalFn).toContain("Member removed — notification failed");
    // Caches still refresh, and the role is never recreated.
    expect(removalFn.indexOf("refreshMembership();")).toBeGreaterThan(
      removalFn.indexOf("notifications"),
    );
    expect(removalFn).not.toContain("insert({ user_id: selectedMember.userId, role");
  });

  it("keeps team-scoped removal gated on a resolved team id", () => {
    expect(removalFn).toContain("if (!selectedMember || !effectiveTeamId) return;");
  });

  it("does not route group-only chat membership through remove_team_member", () => {
    // Group membership removal lives in its own mutation and stays untouched.
    const rpcUses = src.match(/remove_team_member/g) ?? [];
    expect(rpcUses.length).toBeLessThanOrEqual(2);
  });
});
