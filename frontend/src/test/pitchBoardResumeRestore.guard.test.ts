import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const redirect = readFileSync(
  "src/components/pitch/PitchBoardResumeRedirect.tsx",
  "utf8",
);
const lifecycle = readFileSync(
  "src/components/pitch/hooks/usePitchBoardLifecycle.ts",
  "utf8",
);
const openFlag = readFileSync("src/components/pitch/pitchBoardOpenFlag.ts", "utf8");
const teamPage = readFileSync("src/pages/TeamDetailPage.tsx", "utf8");
const eventPage = readFileSync("src/pages/EventDetailPage.tsx", "utf8");
const eventPitchBoardPortal = readFileSync(
  "src/components/event/EventPitchBoardPortal.tsx",
  "utf8",
);
const app = readFileSync("src/App.tsx", "utf8");

describe("pitch board resume restore", () => {
  it("does not gate restore on the brittle 8s performance.now() cold-start check", () => {
    expect(redirect).not.toMatch(/performance\.now\(\)\s*<\s*8000/);
    expect(redirect).toContain("PITCH_BOARD_OPEN_AT_KEY");
    expect(redirect).toContain("RECENT_OPEN_MAX_AGE_MS");
  });

  it("stamps an open-recency timestamp while the board is mounted", () => {
    expect(lifecycle).toContain("PITCH_BOARD_OPEN_AT_KEY");
    // Heartbeat keeps the stamp fresh during long games.
    expect(lifecycle).toMatch(/setInterval\(stamp/);
  });

  it("clears the recency stamp on explicit close", () => {
    expect(openFlag).toContain("PITCH_BOARD_OPEN_AT_KEY");
  });

  it("keeps a durable route-scoped restore fallback after query consumption", () => {
    expect(openFlag).toContain("shouldRestorePitchBoardForCurrentPath");
    expect(teamPage).toContain("shouldRestorePitchBoardForCurrentPath(window.location.pathname)");
    expect(eventPage).toContain("shouldRestorePitchBoardForCurrentPath(window.location.pathname)");
  });

  it("keeps the team pitch board mounted via a sticky access latch", () => {
    expect(teamPage).toContain("pitchBoardAccessEverGrantedRef");
    expect(teamPage).toContain("{showPitchBoard && pitchBoardAccessGranted &&");
    expect(teamPage).not.toContain(
      "showPitchBoard && isSoccerClub && (hasProFootball || isAppAdmin)",
    );
  });

  it("keeps the restore lease alive across slow native bootstrap", () => {
    expect(redirect).toContain("const RESTORE_WINDOW_MS = 30_000");
    expect(redirect).toContain("29_000");
    expect(redirect).not.toContain("openRestoreWindow = (ms = 6000)");
  });

  it("reclaims competing protected routes but never auth/legal routes", () => {
    expect(redirect).toContain("isPublicBootstrapPath");
    expect(redirect).toContain("if (!onStored && isPublicBootstrapPath(loc.pathname)) return");
    expect(redirect).not.toContain("if (!onNeutral && !onStored) return");
  });

  it("keeps event-scoped pitch board access sticky through resume refetches", () => {
    expect(eventPage).toContain("pitchBoardAccessEverGrantedRef");
    expect(eventPage).toContain("accessGranted={pitchBoardAccessGranted}");
    expect(eventPitchBoardPortal).toContain(
      "!open || !isSoccerClub || !accessGranted",
    );
  });

  it("mounts the resume redirect above the protected route tree", () => {
    const redirectIndex = app.indexOf("<PitchBoardResumeRedirect />");
    const routesIndex = app.indexOf("<Routes>");
    expect(redirectIndex).toBeGreaterThan(-1);
    expect(routesIndex).toBeGreaterThan(redirectIndex);
  });

  it("treats route changes during backgrounding as native drift, not a close", () => {
    expect(redirect).toContain("PITCH_BOARD_BACKGROUNDED_AT_KEY");
    expect(redirect).toContain("isNativeRouteDriftLikely");
    expect(redirect).toContain("!isNativeRouteDriftLikely()");
    expect(redirect).toContain("markBackgrounded()");
    expect(openFlag).toContain("PITCH_BOARD_BACKGROUNDED_AT_KEY");
  });
});
