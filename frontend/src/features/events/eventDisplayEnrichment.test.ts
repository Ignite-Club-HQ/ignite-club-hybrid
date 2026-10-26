import { describe, expect, it } from "vitest";
import { readEventDisplayNames } from "./eventDisplayEnrichment";

describe("event display enrichment", () => {
  it("starts adult reads before private child names resolve", async () => {
    let release: ((names: Map<string, string>) => void) | undefined;
    let profilesStarted = false;
    const pending = readEventDisplayNames(
      () => new Promise<Map<string, string>>(resolve => { release = resolve; }),
      async () => { profilesStarted = true; return [{ id: "adult-1" }]; },
    );
    expect(profilesStarted).toBe(true);
    release?.(new Map([["child-1", "Alex"]]));
    expect((await pending).profiles).toEqual([{ id: "adult-1" }]);
  });
  it("keeps available adult names when child unlocking fails", async () => {
    const result = await readEventDisplayNames(async () => { throw new Error("denied"); }, async () => [{ id: "adult-1" }]);
    expect(result.children.size).toBe(0);
    expect(result.profiles).toEqual([{ id: "adult-1" }]);
  });
});