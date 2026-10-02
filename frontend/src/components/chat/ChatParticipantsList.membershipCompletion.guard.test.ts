import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/chat/ChatParticipantsList.tsx"),
  "utf8",
);

describe("chat participant team-membership completion", () => {
  it("uses distinct shared completion policies for role and atomic member removal", () => {
    // Called once per backend branch (Supabase + ICP) since the messaging
    // ICP wiring added the withFeatureBackend("membership") path.
    expect(
      source.match(/refreshChatManagedTeamMembership\(/g),
    ).toHaveLength(2);
    expect(source.match(/refreshChatRemovedTeamMember\(/g)).toHaveLength(2);
    expect(source).toContain('supabase.rpc("remove_team_member"');
    expect(source).not.toContain(
      'invalidateQueries({ queryKey: ["team-roles", effectiveTeamId] })',
    );
  });

  it("retains chat-only refresh when no team scope exists", () => {
    expect(source).toContain(
      'invalidateQueries({ queryKey: ["chat-members", chatType, chatId] })',
    );
  });
});
