/**
 * Guard: every chat page — not just Team — has an Android-resume escape hatch.
 *
 * Team chat survived long-inactivity resumes because it renders its header
 * from `clubTeamCache` and puts a hard abort budget inside its messages
 * `queryFn`. The other chat pages gated their entire render on a metadata
 * query (`club-subscription`, `chat-group`, `dm-conversation`,
 * `club-admin-conversation`) with no timeout, so a zombie GET left them on a
 * skeleton until force-quit. `useChatStuckWatchdog` gives them all the same
 * abort-and-reissue recovery.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string) =>
  readFileSync(path.resolve(__dirname, rel), "utf8");

const PAGES = [
  "ClubChatPage",
  "GroupChatPage",
  "DirectMessagePage",
  "BroadcastChatPage",
  "ClubAdminChatPage",
] as const;

describe("chat resume watchdog coverage", () => {
  it("the shared watchdog aborts zombie GETs then refetches, repeatedly", () => {
    const src = read("../lib/chatStuckWatchdog.ts");
    const abortIdx = src.indexOf("abortAllInFlightRestGets(");
    const refetchIdx = src.indexOf("queryClient.refetchQueries(");
    expect(abortIdx).toBeGreaterThan(-1);
    expect(refetchIdx).toBeGreaterThan(abortIdx);
    expect(src).toMatch(/setInterval\(kick, 6000\)/);
  });

  for (const page of PAGES) {
    it(`${page} installs the stuck watchdog`, () => {
      const src = read(`../pages/${page}.tsx`);
      expect(src).toMatch(
        /import \{[^}]*useChatStuckWatchdog[^}]*\} from "@\/lib\/chatStuckWatchdog"/
      );

      expect(src).toMatch(/useChatStuckWatchdog\(/);
    });
  }

  it("watchdogs cover the metadata gate, not just the messages query", () => {
    expect(read("../pages/ClubChatPage.tsx")).toMatch(
      /isLoadingClubSubscription && !club/
    );
    expect(read("../pages/GroupChatPage.tsx")).toMatch(
      /groupLoading \|\| showLoading/
    );
    expect(read("../pages/DirectMessagePage.tsx")).toMatch(
      /conversationLoading \|\| checkingCanDM \|\| showLoading/
    );
    expect(read("../pages/ClubAdminChatPage.tsx")).toMatch(
      /conversationLoading \|\| showLoading/
    );
  });
});
