import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: cached team messages must never be laundered into the open thread.
 *
 * `getCachedTeamMessages()` used to stamp the active `teamId` onto every cached
 * row, so a cached row that already carried another team's immutable `team_id`
 * became indistinguishable from a legitimate row and passed `belongsToTeam()`.
 */
describe("team chat cached-message scope guard", () => {
  const page = readFileSync(
    join(__dirname, "..", "pages", "TeamChatPage.tsx"),
    "utf8",
  );
  // The cached-message scope guard now lives in teamChatMessageHelpers.ts and
  // is imported (aliased) into TeamChatPage.tsx rather than declared locally.
  const helpers = readFileSync(
    join(__dirname, "..", "features", "messaging", "thread", "teamChatMessageHelpers.ts"),
    "utf8",
  );

  it("never rewrites a cached row's team_id with the active team", () => {
    expect(helpers).not.toMatch(/^\s*team_id: teamId,\s*$/m);
  });

  it("rejects cached rows whose existing team_id conflicts, keeps legacy rows", () => {
    expect(helpers).toMatch(/getCachedMessages\("team", teamId\)\s*\n\s*\.filter\(/);
    expect(helpers).toMatch(/typeof cachedTeamId !== "string" \|\| cachedTeamId === teamId/);
    expect(helpers).toMatch(/team_id\?: unknown \}\)\.team_id as string \| undefined\) \?\? teamId/);
    expect(page).toMatch(/getCachedTeamChatMessages as getCachedTeamMessages/);
  });

  it("persists an immutable team_id on cached team messages", () => {
    const stamped = page.match(/team_id: m\.team_id \?\? teamId/g) ?? [];
    expect(stamped.length).toBeGreaterThanOrEqual(2);
  });
});
