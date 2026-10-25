import { describe, expect, it } from "vitest";
import { playhqGradeId } from "./playhqLinkInput";
describe("PlayHQ grade link parsing", () => {
  it("uses the grade rather than the organization identifier", () => {
    expect(playhqGradeId("https://www.playhq.com/org/11111111-1111-1111-1111-111111111111/grade/22222222-2222-2222-2222-222222222222/ladder")).toBe("22222222-2222-2222-2222-222222222222");
  });
  it("rejects unrelated website URLs", () => expect(playhqGradeId("https://example.org/grade/a")).toBeNull());
});