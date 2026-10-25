import { beforeEach, describe, expect, it } from "vitest";
import { blockedLabelFromMessage, clearTestingIssues, getTestingIssues, recordTestingIssue, testingIssuesDiagnostic } from "./testingIssues";

describe("testing issues summary", () => {
  beforeEach(() => clearTestingIssues());

  it("extracts the sanitized label", () => {
    expect(blockedLabelFromMessage("ICP testing blocked a Supabase fallback: data club_members.")).toBe("data club_members");
  });

  it("groups repeated failures into one entry and keeps every page", () => {
    recordTestingIssue("ICP testing blocked a Supabase fallback: data club_members.", "/");
    recordTestingIssue("ICP testing blocked a Supabase fallback: data club_members.", "/events");
    recordTestingIssue("ICP testing blocked a Supabase fallback: live updates.", "/");
    const list = getTestingIssues();
    expect(list).toHaveLength(2);
    expect(list[0].count).toBe(2);
    expect(list[0].pages).toEqual(["/", "/events"]);
    expect(list[0].title).toContain("club members");
    expect(testingIssuesDiagnostic(list)).toBe("data club_members (x2; /, /events); live updates (x1; /)");
  });
});
