import { describe, expect, it, vi } from "vitest";
import { fetchIcpThreadLabels } from "./ScheduledMessagesPage";
import type { ScheduledMessageRow } from "@/hooks/useScheduledMessages";
import type { FeatureBackendContext } from "@/live/featureRouter";

vi.mock("@/live/features/club", () => ({
  getLiveTeam: vi.fn(async (_ctx: unknown, teamId: string) => [{ id: teamId, name: "Lions U12" }]),
  getLiveClubProfile: vi.fn(async (_ctx: unknown, clubId: string) => [{ id: clubId, name: "Acme FC" }]),
}));

vi.mock("@/live/features/messaging", () => ({
  getLiveGroupMetadata: vi.fn(async (_ctx: unknown, conversationId: string) => ({
    conversationId,
    name: "Weekend Crew",
  })),
}));

vi.mock("@/live/identityProfileCache", () => ({
  getCachedIcpIdentityProfile: vi.fn((principal: string) => ({
    accountId: principal,
    displayName: "Jordan",
    avatarRef: null,
    roles: [],
    profileMissing: false,
  })),
}));

const ctx = {} as FeatureBackendContext;

describe("fetchIcpThreadLabels", () => {
  it("resolves team, club, group, direct and club_admin labels via live feature readers", async () => {
    const rows: ScheduledMessageRow[] = [];
    const labels = await fetchIcpThreadLabels(
      ctx,
      rows,
      ["team-1"],
      ["club-1"],
      ["group-1"],
      ["dm-1"],
      ["admin-1"],
    );

    expect(labels["team:team-1"]).toMatchObject({ label: "Lions U12 chat", href: "/teams/team-1/chat" });
    expect(labels["club:club-1"]).toMatchObject({ label: "Acme FC club chat", href: "/clubs/club-1/chat" });
    expect(labels["group:group-1"]).toMatchObject({ label: "Weekend Crew", sublabel: "Group chat" });
    expect(labels["direct:dm-1"]).toMatchObject({ label: "Jordan", sublabel: "Direct message" });
    expect(labels["club_admin:admin-1"]).toMatchObject({ label: "Club admin chat" });
  });
});
