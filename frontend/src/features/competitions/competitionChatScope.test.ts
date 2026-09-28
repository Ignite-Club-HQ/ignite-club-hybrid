import { describe, expect, it } from "vitest";
import {
  canPostInCompetitionChat,
  competitionChatSublabel,
  normaliseCompetitionChatScope,
} from "./competitionChatScope";

describe("competitionChatScope", () => {
  it("normalises only known scopes", () => {
    expect(normaliseCompetitionChatScope("all_members")).toBe("all_members");
    expect(normaliseCompetitionChatScope("coordinators")).toBe("coordinators");
    expect(normaliseCompetitionChatScope(null)).toBeNull();
    expect(normaliseCompetitionChatScope("something")).toBeNull();
  });

  it("labels each thread distinctly", () => {
    expect(competitionChatSublabel("all_members")).toContain("all members");
    expect(competitionChatSublabel("coordinators")).toContain("coordinators");
    expect(competitionChatSublabel(undefined)).toBe("Competition chat");
  });

  it("never restricts the coordinators thread", () => {
    expect(
      canPostInCompetitionChat({
        scope: "coordinators",
        adminsOnly: true,
        isCompetitionAdmin: false,
      }),
    ).toBe(true);
  });

  it("allows everyone in the member chat by default", () => {
    expect(
      canPostInCompetitionChat({
        scope: "all_members",
        adminsOnly: false,
        isCompetitionAdmin: false,
      }),
    ).toBe(true);
  });

  it("restricts the member chat to organisers when configured", () => {
    expect(
      canPostInCompetitionChat({
        scope: "all_members",
        adminsOnly: true,
        isCompetitionAdmin: false,
      }),
    ).toBe(false);
    expect(
      canPostInCompetitionChat({
        scope: "all_members",
        adminsOnly: true,
        isCompetitionAdmin: true,
      }),
    ).toBe(true);
  });
});
