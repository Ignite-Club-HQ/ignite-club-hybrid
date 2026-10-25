import { beforeEach, describe, expect, it } from "vitest";
import { blockedLabelFromMessage, clearTestingIssues, getTestingIssues, recordTestingIssue, testingIssuesDiagnostic } from "./testingIssues";

describe("testing issues summary", () => {
  beforeEach(() => clearTestingIssues());

  it("extracts the sanitized label", () => {
    expect(blockedLabelFromMessage("ICP testing blocked a Supabase fallback: data club_members.")).toBe("data club_members");
  });

  it('retains distinct notification outcomes and combines repeated failures without claiming delivery', () => {
    for (const status of ['not_configured', 'refused', 'denied', 'capacity', 'unknown']) {
      recordTestingIssue(`gallery_notice ${status}`, '/media');
    }
    recordTestingIssue('gallery_notice unknown', '/groups/chat-1');
    const list = getTestingIssues();
    expect(list).toHaveLength(5);
    expect(list.find(issue => issue.label === 'gallery_notice unknown')?.count).toBe(2);
    expect(list.find(issue => issue.label === 'gallery_notice unknown')?.pages).toEqual(['/media', '/groups/chat-1']);
    expect(list.find(issue => issue.label === 'gallery_notice refused')?.label).toBe('gallery_notice refused');
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
