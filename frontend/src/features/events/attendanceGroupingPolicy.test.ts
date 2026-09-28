import { describe, expect, it } from "vitest";
import {
  bucketAttendance,
  bucketNonResponders,
  rsvpAttendanceIdentity,
} from "@/features/events/attendanceGroupingPolicy";

const groups = [
  { key: "u8", label: "U8" },
  { key: "u10", label: "U10" },
  { key: "other", label: "Other" },
];
const groupOf = ({ userId, childId }: { userId?: string | null; childId?: string | null }) => {
  if (childId === "child-u8" || userId === "adult-u8") return groups[0];
  if (childId === "child-u10" || userId === "adult-u10") return groups[1];
  if (userId === "club-admin") return groups[2];
  return null;
};

describe("attendance grouping policy", () => {
  it("prefers direct child identity over the guardian user", () => {
    expect(rsvpAttendanceIdentity({ user_id: "guardian-u10", child_id: "child-u8" }))
      .toEqual({ userId: null, childId: "child-u8" });
  });

  it("uses a linked child for a mini-league RSVP", () => {
    expect(rsvpAttendanceIdentity({
      user_id: "guardian-u10",
      mini_league_players: { child_id: "child-u8" },
    })).toEqual({ userId: null, childId: "child-u8" });
  });

  it("uses adult identity only when no child identity exists", () => {
    expect(rsvpAttendanceIdentity({ user_id: "adult-u10" }))
      .toEqual({ userId: "adult-u10", childId: null });
  });

  it("keeps stable configured group ordering and original item order", () => {
    const rows = [
      { id: "u10-a", user_id: "adult-u10" },
      { id: "u8-a", user_id: "adult-u8" },
      { id: "u8-b", child_id: "child-u8" },
    ];
    const buckets = bucketAttendance(rows, groups, rsvpAttendanceIdentity, groupOf);
    expect(buckets.map((bucket) => bucket.label)).toEqual(["U8", "U10"]);
    expect(buckets[0].items.map((row) => row.id)).toEqual(["u8-a", "u8-b"]);
  });

  it("excludes an attendee that resolves outside the targeted audience", () => {
    const buckets = bucketAttendance(
      [{ id: "invited", user_id: "adult-u8" }, { id: "uninvited", user_id: "adult-u12" }],
      groups,
      rsvpAttendanceIdentity,
      groupOf,
    );
    expect(buckets.flatMap((bucket) => bucket.items).map((row) => row.id)).toEqual(["invited"]);
  });

  it("keeps a legitimate club-level adult in Other", () => {
    const buckets = bucketAttendance(
      [{ id: "admin", user_id: "club-admin" }], groups, rsvpAttendanceIdentity, groupOf,
    );
    expect(buckets).toEqual([{ ...groups[2], items: [{ id: "admin", user_id: "club-admin" }] }]);
  });

  it("combines child and adult non-responders without losing their identities", () => {
    const buckets = bucketNonResponders(
      [{ id: "child-u8" }, { id: "child-out" }],
      [{ id: "adult-u8" }, { id: "club-admin" }],
      groups,
      (child) => ({ childId: child.id, userId: null }),
      (adult) => ({ userId: adult.id, childId: null }),
      groupOf,
    );
    expect(buckets).toEqual([
      { ...groups[0], children: [{ id: "child-u8" }], adults: [{ id: "adult-u8" }] },
      { ...groups[2], children: [], adults: [{ id: "club-admin" }] },
    ]);
  });

  it("omits empty groups and does not duplicate multi-role entries", () => {
    const adult = { id: "adult-u8", roles: ["parent", "coach"] };
    const buckets = bucketNonResponders(
      [], [adult], groups,
      (child: { id: string }) => ({ childId: child.id, userId: null }),
      (member) => ({ userId: member.id, childId: null }),
      groupOf,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].adults).toEqual([adult]);
  });
});
