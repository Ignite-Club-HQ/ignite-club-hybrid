import { describe, expect, it, vi } from "vitest";
import {
  fetchTargetedAttendanceRoster,
  mergeTargetedChildren,
  selectScopedChildRoster,
  selectTargetedReminderMembers,
  type ScopedAttendanceRosterRow,
} from "@/features/events/targetedAttendanceRepository";

const childRow = (overrides: Partial<ScopedAttendanceRosterRow> = {}): ScopedAttendanceRosterRow => ({
  kind: "child",
  person_id: "child-1",
  display_name: "Child One",
  parent_id: "parent-1",
  team_ids: ["team-1"],
  ...overrides,
});

describe("targeted attendance RPC repository", () => {
  it("calls the event-scoped roster RPC with only the exact event id", async () => {
    const rows = [childRow()];
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    await expect(fetchTargetedAttendanceRoster({ rpc }, "event-1")).resolves.toBe(rows);
    expect(rpc).toHaveBeenCalledWith("get_targeted_event_attendance_roster", {
      p_event_id: "event-1",
    });
  });

  it("propagates RPC permission failures rather than returning an empty roster", async () => {
    const denied = { code: "42501", message: "denied" };
    const rpc = vi.fn().mockResolvedValue({ data: null, error: denied });
    await expect(fetchTargetedAttendanceRoster({ rpc }, "event-1")).rejects.toBe(denied);
  });
});

describe("targeted child composition", () => {
  it("keeps only child rows from a mixed scoped roster", () => {
    const child = childRow();
    expect(selectScopedChildRoster([
      child,
      { ...child, kind: "adult", person_id: "adult-1" },
    ])).toEqual([child]);
  });

  it("merges RLS-visible and scoped children once without mutating input", () => {
    const visible = [{ id: "child-1", name: null, parent_id: "parent-1", local: true }];
    const merged = mergeTargetedChildren(visible, [
      childRow(),
      childRow({ person_id: "child-2", display_name: "Child Two", parent_id: "parent-2" }),
      childRow({ person_id: "child-2", display_name: "Duplicate", parent_id: "parent-2" }),
    ]);
    expect(merged).toEqual([
      { id: "child-1", name: "Child One", parent_id: "parent-1", local: true },
      { id: "child-2", name: "Child Two", parent_id: "parent-2" },
    ]);
    expect(visible[0].name).toBeNull();
  });

  it("preserves an existing visible child name over scoped fallback data", () => {
    expect(mergeTargetedChildren(
      [{ id: "child-1", name: "Preferred Name", parent_id: "parent-1" }],
      [childRow({ display_name: "Fallback Name" })],
    )[0].name).toBe("Preferred Name");
  });
});

describe("targeted reminder audience composition", () => {
  const members = [
    { id: "target-adult", role_team_pairs: [{ role: "player", team_id: "team-1" }] },
    { id: "other-team", role_team_pairs: [{ role: "player", team_id: "team-9" }] },
    { id: "primary-parent", role_team_pairs: [] },
    { id: "guardian", role_team_pairs: [] },
    { id: "unlinked-official", role_team_pairs: [{ role: "committee_member", team_id: null }] },
  ];

  it("includes targeted-team adults plus linked parents and guardians only", () => {
    const selected = selectTargetedReminderMembers(
      members,
      ["team-1", "team-2"],
      [{ id: "child-1", parent_id: "primary-parent" }],
      [{ child_id: "child-1", guardian_id: "guardian" }],
    );
    expect(selected.map((member) => member.id)).toEqual([
      "target-adult", "primary-parent", "guardian",
    ]);
  });

  it("excludes unrelated teams and unlinked club officials", () => {
    const selected = selectTargetedReminderMembers(members, ["team-1"], [], []);
    expect(selected.map((member) => member.id)).toEqual(["target-adult"]);
  });

  it("does not duplicate a multi-role or parent-and-team member", () => {
    const selected = selectTargetedReminderMembers(
      [{
        id: "multi",
        role_team_pairs: [
          { role: "coach", team_id: "team-1" },
          { role: "player", team_id: "team-2" },
        ],
      }],
      ["team-1", "team-2"],
      [{ id: "child-1", parent_id: "multi" }],
      [{ child_id: "child-1", guardian_id: "multi" }],
    );
    expect(selected).toHaveLength(1);
  });
});
