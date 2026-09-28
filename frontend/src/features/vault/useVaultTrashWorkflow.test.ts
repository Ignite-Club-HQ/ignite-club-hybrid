import { describe, expect, it } from "vitest";
import { getVaultTrashQueryScope } from "./useVaultTrashWorkflow";

describe("Vault trash workflow query scope", () => {
  it("uses the owning club for every non-root scope and never enables root trash", () => {
    expect(getVaultTrashQueryScope({ type: "root" }, true)).toEqual({
      clubId: null,
      enabled: false,
    });
    expect(getVaultTrashQueryScope({
      type: "club",
      clubId: "club-1",
      clubName: "Synthetic Club",
    }, true)).toEqual({ clubId: "club-1", enabled: true });
    expect(getVaultTrashQueryScope({
      type: "team",
      clubId: "club-1",
      clubName: "Synthetic Club",
      teamId: "team-1",
      teamName: "U10 Blue",
    }, true)).toEqual({ clubId: "club-1", enabled: true });
    expect(getVaultTrashQueryScope({
      type: "mini-league",
      clubId: "club-1",
      clubName: "Synthetic Club",
      miniLeagueId: "league-1",
      miniLeagueName: "Synthetic League",
    }, false)).toEqual({ clubId: "club-1", enabled: false });
  });
});
