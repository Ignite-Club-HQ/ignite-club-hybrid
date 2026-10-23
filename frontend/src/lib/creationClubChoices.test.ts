import { describe, expect, it } from "vitest";
import { creationClubChoices } from "./creationClubChoices";

describe("Home creation club choices", () => {
  const clubs = [{ id: "giddy-goat" }, { id: "winter-cats" }];
  it("offers only the theme-selected club for event/media creation", () => {
    expect(creationClubChoices(clubs, "giddy-goat")).toEqual([{ id: "giddy-goat" }]);
  });
  it("does not reveal other clubs while the selected club is unavailable", () => {
    expect(creationClubChoices(clubs, "riverdogs")).toEqual([]);
    expect(creationClubChoices(undefined, "giddy-goat")).toBeUndefined();
  });
  it("retains normal choices without a theme-selected club", () => {
    expect(creationClubChoices(clubs, null)).toEqual(clubs);
  });
});