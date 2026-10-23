import { describe, expect, it } from "vitest";
import { competitionFixtureKey, deriveImportedFinalsLabel, getCompetitionFinalsLabel } from "./competitionFinalsLabel";

describe("competition finals labels", () => {
  it.each(["Finals", "Semi Final", "Semi-finals", "Grand Final", "Finals 1"])("preserves %s", (label) => {
    expect(getCompetitionFinalsLabel(label)).toBe(label);
  });
  it("recognises generated finals without displaying seed notes", () => {
    expect(getCompetitionFinalsLabel("Grand Final · 1 v 2")).toBe("Grand Final");
  });
  it.each([null, "", "Round 1", "12", "Bring water"])("does not label ordinary matches: %s", (label) => {
    expect(getCompetitionFinalsLabel(label)).toBeNull();
  });
});

describe("imported finals labels", () => {
  it("strips the 'vs TBD' part of a round cell", () => {
    expect(deriveImportedFinalsLabel("Finals vs TBD", [])).toBe("Finals");
    expect(deriveImportedFinalsLabel("Grand Final", [])).toBe("Grand Final");
  });
  it("falls back to other cells such as notes", () => {
    expect(deriveImportedFinalsLabel("", ["2026-03-03", "Finals fixture. Opponent and pitch TBD."])).toBe("Finals");
    expect(deriveImportedFinalsLabel("", ["semi final 2"])).toBe("Semi Final 2");
    expect(deriveImportedFinalsLabel("", ["Finals Match 1"])).toBe("Finals Match 1");
  });
  it("ignores ordinary rows", () => {
    expect(deriveImportedFinalsLabel("3", ["Bridgewater Oval", "Bring water"])).toBeNull();
  });
});

describe("fixture duplicate keys", () => {
  const at = "2026-03-03T08:00:00Z";
  it("treats swapped home/away at the same time as the same game", () => {
    expect(competitionFixtureKey({ scheduledAt: at, homeId: "a", awayId: "b" }))
      .toBe(competitionFixtureKey({ scheduledAt: new Date(at), homeId: "b", awayId: "a" }));
  });
  it("matches a team-vs-TBD game imported twice", () => {
    expect(competitionFixtureKey({ scheduledAt: at, homeId: "pink", awayId: null, venue: "Oval" }))
      .toBe(competitionFixtureKey({ scheduledAt: at, homeId: "pink", awayId: null, venue: "Other" }));
  });
  it("keeps TBD-vs-TBD games on different pitches apart", () => {
    expect(competitionFixtureKey({ scheduledAt: at, homeId: null, awayId: null, pitch: "1" }))
      .not.toBe(competitionFixtureKey({ scheduledAt: at, homeId: null, awayId: null, pitch: "2" }));
  });
  it("treats numbered finals at the same time as separate games", () => {
    expect(competitionFixtureKey({ scheduledAt: at, homeId: "green", awayId: null, finalsLabel: "Finals Match 1" }))
      .not.toBe(competitionFixtureKey({ scheduledAt: at, homeId: "green", awayId: null, finalsLabel: "Finals Match 2" }));
  });
  it("still flags the same numbered final imported twice", () => {
    expect(competitionFixtureKey({ scheduledAt: at, homeId: null, awayId: "blue", finalsLabel: "Finals Match 1" }))
      .toBe(competitionFixtureKey({ scheduledAt: at, homeId: "blue", awayId: null, finalsLabel: "finals match 1" }));
  });
});

import { isFinalsPlaceholderEvent } from "./competitionFinalsLabel";
describe("finals placeholder events", () => {
  it("flags a competition game vs TBD", () => expect(isFinalsPlaceholderEvent({ type: "game", opponent: "TBD", competition_match_id: "m" })).toBe(true));
  it("ignores normal games", () => expect(isFinalsPlaceholderEvent({ type: "game", opponent: "Green", competition_match_id: "m" })).toBe(false));
  it("ignores non-competition games vs TBD", () => expect(isFinalsPlaceholderEvent({ type: "game", opponent: "TBD", competition_match_id: null })).toBe(false));
});
