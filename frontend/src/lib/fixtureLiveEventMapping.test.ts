import { describe, expect, it } from "vitest";
import { buildLiveFixtureEventInput, DEFAULT_FIXTURE_GAME_DURATION_MS } from "./fixtureLiveEventMapping";

describe("buildLiveFixtureEventInput", () => {
  it("maps fixture fields to the createLiveEvent input shape", () => {
    const input = buildLiveFixtureEventInput(
      {
        title: "Saturday League Match",
        date: "2025-04-05",
        time: "14:00",
        address: "Riverside Fields",
        description: "Round 3",
        opponent: "Riverside FC",
        teamId: "team-123",
      },
      "club-abc",
      "fallback-team",
    );

    expect(input.clubId).toBe("club-abc");
    expect(input.teamId).toBe("team-123");
    expect(input.title).toBe("Saturday League Match");
    expect(input.opponent).toBe("Riverside FC");
    expect(input.location).toBe("Riverside Fields");
    expect(input.address).toBe("Riverside Fields");
    expect(input.description).toBe("Round 3");
    expect(input.eventType).toBe("game");

    const starts = new Date(input.startsAtMs as Date);
    const ends = new Date(input.endsAtMs as Date);
    expect(starts.toISOString()).toBe(new Date("2025-04-05T14:00").toISOString());
    expect(ends.getTime() - starts.getTime()).toBe(DEFAULT_FIXTURE_GAME_DURATION_MS);
  });

  it("falls back to the selected team and empty optional fields when the row omits them", () => {
    const input = buildLiveFixtureEventInput(
      { title: "Friendly", date: "2025-05-01", time: "10:00" },
      "club-abc",
      "fallback-team",
    );

    expect(input.teamId).toBe("fallback-team");
    expect(input.opponent).toBeNull();
    expect(input.location).toBeNull();
    expect(input.address).toBeNull();
    expect(input.description).toBe("");
  });
});
