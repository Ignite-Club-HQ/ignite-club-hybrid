import { describe, expect, it, vi } from "vitest";
import { loadTeamClubDetails } from "./teamClubDetails";

describe("team club detail loading", () => {
  it("starts settings and subscription before a slow profile finishes", async () => {
    let finishProfile: (value: string) => void = () => {};
    const profile = new Promise<string>(resolve => { finishProfile = resolve; });
    const subscription = vi.fn(async () => "subscription");
    const settings = vi.fn(async () => "settings");
    const pending = loadTeamClubDetails({ profile: () => profile, subscription, settings });
    expect(subscription).toHaveBeenCalledTimes(1);
    expect(settings).toHaveBeenCalledTimes(1);
    finishProfile("profile");
    expect(await pending).toEqual(["profile", "subscription", "settings"]);
  });

  it("preserves rejected reads instead of inventing club settings", async () => {
    await expect(loadTeamClubDetails({
      profile: async () => "profile", subscription: async () => "subscription",
      settings: async () => { throw new Error("denied"); },
    })).rejects.toThrow("denied");
  });
});