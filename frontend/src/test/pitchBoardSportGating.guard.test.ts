/**
 * Regression guard: the pitch board must only surface for football/soccer
 * clubs. Netball & basketball boards are archived (archive/sports/), so any
 * entry point gated on `detectGameBoardKind() !== null` (which still matches
 * those sports) would open an empty/soccer board for the wrong club.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasGameBoardSupport } from "@/lib/sportDetection";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("hasGameBoardSupport", () => {
  it("matches only football family sports", () => {
    expect(hasGameBoardSupport("Soccer")).toBe(true);
    expect(hasGameBoardSupport("Football")).toBe(true);
    expect(hasGameBoardSupport("Futsal")).toBe(true);
    expect(hasGameBoardSupport("Netball")).toBe(false);
    expect(hasGameBoardSupport("Basketball")).toBe(false);
    expect(hasGameBoardSupport("Cricket")).toBe(false);
    expect(hasGameBoardSupport(null)).toBe(false);
  });
});

describe("pitch board entry points gate on football only", () => {
  it("desktop nav rail resolves board access per club sport and active club", () => {
    const src = read("src/hooks/useDesktopNavAccess.ts");
    expect(src).toMatch(/hasGameBoardSupport/);
    expect(src).not.toMatch(/detectGameBoardKind/);
    expect(src).toMatch(/activeClubFilter/);
  });

  it("desktop nav opens the canonical team board without an event-route race", () => {
    const access = read("src/hooks/useDesktopNavAccess.ts");
    const rail = read("src/components/layout/DesktopNavRail.tsx");
    expect(access).toContain("`/teams/${preferredTeamId}?openPitchBoard=1`");
    expect(access).toContain("fallbackTeamId");
    expect(access).not.toContain("`/events/${eventId}/groups/${groupId}/pitch`");
    expect(rail).not.toContain('navigate("/events")');
  });

  it("home Next Up CTAs use the football-only helper", () => {
    const src = read("src/components/NextUpCarousel.tsx");
    expect(src).toMatch(/hasGameBoardSupport\(event\.clubs\?\.sport\)/);
    expect(src).not.toMatch(/detectGameBoardKind/);
  });

  it("event detail no longer shows board affordances for netball/basketball", () => {
    const src = read("src/pages/EventDetailPage.tsx");
    expect(src).not.toMatch(/isNetballClub \|\| isBasketballClub/);
  });

  it("team page board tile is football only", () => {
    const src = read("src/pages/TeamDetailPage.tsx");
    const showPitch = src.slice(src.indexOf("const showPitch ="), src.indexOf("const launchPitchBoard"));
    expect(showPitch).toMatch(/isSoccerClub/);
    expect(showPitch).not.toMatch(/isNetballClub|isBasketballClub/);
  });

  it("mini-league surfaces gate on the league club sport", () => {
    expect(read("src/components/EventGroupsManager.tsx")).toMatch(/boardSupported/);
    expect(read("src/pages/EventGroupPitchPage.tsx")).toMatch(/hasGameBoardSupport\(leagueSettings\.clubs\?\.sport\)/);
  });
});
