import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: cross-thread message bleed (a message posted in group A rendering in
 * group B). Two invariants must hold:
 *
 * 1. Chat routes remount when their route param changes — React Router reuses
 *    the element instance otherwise, keeping the previous conversation's render
 *    state (localMessages, optimistic merges) alive.
 * 2. GroupChatPage never renders, seeds, or persists a row whose `group_id`
 *    differs from the active `groupId`.
 */
describe("chat cross-thread bleed guard", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  it("chat routes are keyed on their route param", () => {
    const app = src("App.tsx");
    expect(app).toMatch(/const RemountOnParamChange/);
    for (const [path, param] of [
      ["/groups/:groupId", "groupId"],
      ["/messages/:teamId", "teamId"],
      ["/messages/club/:clubId", "clubId"],
      ["/messages/dm/:conversationId", "conversationId"],
      ["/messages/club-admin/:conversationId", "conversationId"],
    ] as const) {
      const line = app
        .split("\n")
        .find((l) => l.includes(`path="${path}"`));
      expect(line, `route ${path} missing`).toBeTruthy();
      expect(line!).toContain(`RemountOnParamChange param="${param}"`);
    }
  });

  it("GroupChatPage scopes rendered/seeded/merged messages to the active group", () => {
    const groupChatSource = [
      src("pages/GroupChatPage.tsx"),
      src("features/messaging/thread/useGroupMessagesQuery.ts"),
      src("features/messaging/thread/useGroupLocalMessagesSync.ts"),
    ].join("\n");
    const scopedGuards = groupChatSource.match(/group_id !== groupId|m\.group_id === groupId/g) ?? [];
    // render filter + placeholderData reuse check + seed filter + merge filter
    expect(scopedGuards.length).toBeGreaterThanOrEqual(4);
  });

  it("GroupChatPage never reuses placeholder data from another group verbatim", () => {
    const groupChatSource = [
      src("pages/GroupChatPage.tsx"),
      src("features/messaging/thread/useGroupMessagesQuery.ts"),
    ].join("\n");
    expect(groupChatSource).not.toMatch(/^\s*if \(prev\) return prev;\s*$/m);
    expect(groupChatSource).toMatch(/prevBelongsToThisGroup/);
  });

  it("TeamChatPage scopes rendered/seeded/merged/realtime messages to the active team", () => {
    const page = src("pages/TeamChatPage.tsx");
    // The scope guard now lives in teamChatMessageHelpers.ts and is imported
    // (aliased) into TeamChatPage.tsx rather than declared locally.
    expect(page).toMatch(/belongsToTeamChatThread as belongsToTeam/);
    // render filter + placeholderData reuse check + seed filter + merge filter + realtime INSERT guard
    const scopedGuards = page.match(/belongsToTeam\(/g) ?? [];
    expect(scopedGuards.length).toBeGreaterThanOrEqual(6);
    expect(page).toMatch(/prevBelongsToThisTeam/);
    expect(page).not.toMatch(/^\s*if \(prev\) return prev;\s*$/m);
  });

  it("in-app notification taps resolve the owning club before navigating", () => {
    const page = src("pages/NotificationsPage.tsx");
    expect(page).toMatch(/requestClubSwitchForChatTarget\(/);
    const lib = src("lib/notificationClubSwitch.ts");
    expect(lib).toMatch(/export async function resolveClubIdForChatTarget/);
  });
});
