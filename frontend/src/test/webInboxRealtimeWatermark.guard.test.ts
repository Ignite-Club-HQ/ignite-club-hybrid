import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const src = readFileSync("src/pages/MessagesPage.tsx", "utf8");
const realtimeCacheSrc = readFileSync("src/features/messaging/inbox/inboxRealtimeCache.ts", "utf8");
const combinedSrc = `${src}\n${realtimeCacheSrc}`;
const webStart = src.indexOf("HARD-STOP PERF GUARD (native)");
const webEnd = src.indexOf("Native-only: lightweight realtime", webStart);
const webBlock = src.slice(webStart, webEnd);

describe("web inbox Realtime preview watermarks", () => {
  it("records the exact accepted preview before writing it to React Query", () => {
    const note = webBlock.indexOf("previewWatermarks.note(`${scope}:${targetId}`, preview)");
    const cacheWrite = combinedSrc.indexOf("[targetId]: preview", note);

    expect(note).toBeGreaterThan(-1);
    expect(cacheWrite).toBeGreaterThan(note);
  });

  it("uses the correct watermark scope at every web map call site", () => {
    expect(webBlock).toContain("patchLatest([\"my-teams-with-messages\", user.id], 'team'");
    expect(webBlock).toContain("patchLatest([\"member-clubs-with-messages\", user.id], 'club'");
    expect(webBlock).toContain("patchLatest([\"my-chat-groups-with-messages\", user.id], 'group'");
  });

  it("keeps authorization ahead of every web preview patch", () => {
    for (const [kind, id] of [
      ["team", "row?.team_id"],
      ["club", "row?.club_id"],
      ["group", "row?.group_id"],
    ]) {
      const guard = webBlock.indexOf(`if (!isAuthorized('${kind}', ${id})) return;`);
      const patch = webBlock.indexOf(`patchLatest(`, guard);
      expect(guard).toBeGreaterThan(-1);
      expect(patch).toBeGreaterThan(guard);
    }
  });

  it("clears watermarks on authorization failure and user teardown", () => {
    expect(src).toContain('if (authScopes.status === "failed") {');
    expect(src).toContain("previewWatermarks.clear()");
    expect(src).toContain("Sign-out / user switch");
  });
});