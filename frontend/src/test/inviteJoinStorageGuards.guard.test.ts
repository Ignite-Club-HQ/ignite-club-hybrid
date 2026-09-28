/**
 * Guard: every invite/join entry point must use the guarded storage helpers
 * before navigating to /auth.
 *
 * An unguarded `sessionStorage.setItem` throws in restricted webviews (blocked
 * storage, private mode, some Android WebViews). Because the write happened
 * before `navigate(...)`, the throw aborted the whole click handler and the
 * "Create Account to Join" button appeared to do nothing.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const PAGES = [
  "src/pages/JoinTeamPage.tsx",
  "src/pages/JoinClubPage.tsx",
  "src/pages/CompetitionJoinPage.tsx",
];

describe("invite join flows never write storage unguarded", () => {
  for (const page of PAGES) {
    it(`${page} has no bare sessionStorage.setItem`, () => {
      const src = readFileSync(page, "utf8");
      expect(src).not.toMatch(/(?<!\/\/.*)\bsessionStorage\.setItem\(/);
    });
  }

  it("useAuth reads redirectAfterAuth defensively", () => {
    const src = readFileSync("src/hooks/useAuth.tsx", "utf8");
    // Every read must sit inside a try/catch — assert no bare read remains.
    const bareReads = src
      .split("\n")
      .filter((l) => l.includes('sessionStorage.getItem("redirectAfterAuth")'))
      .filter((l) => !l.trim().startsWith("//"));
    for (const line of bareReads) {
      expect(line).toMatch(/pendingRedirect = sessionStorage\.getItem/);
    }
  });
});
