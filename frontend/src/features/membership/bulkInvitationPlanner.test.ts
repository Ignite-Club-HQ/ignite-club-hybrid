import { describe, expect, it, vi } from "vitest";
import { buildBulkPendingInviteMetadata, planBulkInvitations } from "./bulkInvitationPlanner";

function member(name: string, role: "parent" | "coach" = "parent", children: string[] = []) {
  return {
    id: `id-${name}`,
    name,
    role,
    children: children.map((childName) => ({ name: childName })),
  };
}

function tokens(...values: string[]) {
  const createToken = vi.fn();
  values.forEach((value) => createToken.mockReturnValueOnce(value));
  return createToken;
}

describe("bulk invitation planning", () => {
  it("rejects an empty or blank-only batch with the existing validation message", () => {
    expect(() => planBulkInvitations([], tokens())).toThrow("Please enter at least one name");
    expect(() => planBulkInvitations([member("   ")], tokens())).toThrow(
      "Please enter at least one name",
    );
  });

  it("filters blank members before assigning stable sequential tokens", () => {
    const first = member("First", "coach");
    const second = member("Second", "coach");
    const createToken = tokens("token-a", "token-b");
    const plans = planBulkInvitations([first, member(" "), second], createToken);
    expect(plans).toEqual([
      { member: first, inviteToken: "token-a", linkedInviteToken: null },
      { member: second, inviteToken: "token-b", linkedInviteToken: null },
    ]);
    expect(createToken).toHaveBeenCalledTimes(2);
  });

  it("cross-links exactly two parents with the same normalized child set", () => {
    const first = member("Parent A", "parent", [" Child B ", "CHILD A"]);
    const second = member("Parent B", "parent", ["child a", "child b"]);
    expect(planBulkInvitations([first, second], tokens("token-a", "token-b"))).toEqual([
      { member: first, inviteToken: "token-a", linkedInviteToken: "token-b" },
      { member: second, inviteToken: "token-b", linkedInviteToken: "token-a" },
    ]);
  });

  it("does not pair different child sets, blank-child parents, or non-parent roles", () => {
    const plans = planBulkInvitations([
      member("Parent A", "parent", ["Child A"]),
      member("Parent B", "parent", ["Child B"]),
      member("Parent C", "parent", [" "]),
      member("Coach A", "coach", ["Child A"]),
    ], tokens("a", "b", "c", "d"));
    expect(plans.map((plan) => plan.linkedInviteToken)).toEqual([null, null, null, null]);
  });

  it("preserves the established no-link behavior when more than two parents share a fingerprint", () => {
    const plans = planBulkInvitations([
      member("Parent A", "parent", ["Child A"]),
      member("Parent B", "parent", ["Child A"]),
      member("Parent C", "parent", ["Child A"]),
    ], tokens("a", "b", "c"));
    expect(plans.map((plan) => plan.linkedInviteToken)).toEqual([null, null, null]);
  });

  it("preserves duplicate child names as part of the fingerprint", () => {
    const plans = planBulkInvitations([
      member("Parent A", "parent", ["Child A", "Child A"]),
      member("Parent B", "parent", ["Child A"]),
    ], tokens("a", "b"));
    expect(plans.map((plan) => plan.linkedInviteToken)).toEqual([null, null]);
  });
});

describe("bulk pending-invite metadata", () => {
  const base = {
    name: "Parent A",
    role: "parent" as const,
    children: [{
      name: " Child A ",
      yearOfBirth: "2016",
      jerseyNumber: "08",
      existingChildId: "child-a",
    }],
  };

  it("normalizes the exact child and linked-invite metadata", () => {
    const result = buildBulkPendingInviteMetadata(base, "token-b");
    expect(result.validChildren).toEqual(base.children);
    expect(result.validChildren[0]).toBe(base.children[0]);
    expect(result.metadata).toEqual({
      children: [{
        name: "Child A",
        yearOfBirth: 2016,
        jerseyNumber: 8,
        existingChildId: "child-a",
      }],
      linked_invite_token: "token-b",
    });
  });

  it("preserves parseInt prefixes and JSON-normalized invalid numeric values", () => {
    const { metadata } = buildBulkPendingInviteMetadata({
      ...base,
      children: [
        { name: "One", yearOfBirth: "2016 season", jerseyNumber: "12x" },
        { name: "Two", yearOfBirth: " ", jerseyNumber: "not-a-number" },
      ],
    }, null);
    expect(metadata?.children).toEqual([
      { name: "One", yearOfBirth: 2016, jerseyNumber: 12, existingChildId: null },
      { name: "Two", yearOfBirth: null, jerseyNumber: null, existingChildId: null },
    ]);
  });

  it("uses typed second-guardian identity before a selected profile", () => {
    const { metadata } = buildBulkPendingInviteMetadata({
      ...base,
      secondParentName: " Parent B ",
      secondParentEmail: " PARENT.B@EXAMPLE.TEST ",
      selectedSecondParent: { id: "parent-selected", display_name: "Selected Parent" },
    }, null);
    expect(metadata).toEqual(expect.objectContaining({
      second_guardian_name: "Parent B",
      second_guardian_email: "parent.b@example.test",
    }));
    expect(metadata).not.toHaveProperty("second_guardian_user_id");
  });

  it("falls back to selected second-guardian identity including a null display name", () => {
    const { metadata } = buildBulkPendingInviteMetadata({
      ...base,
      secondParentName: "Parent B",
      secondParentEmail: " ",
      selectedSecondParent: { id: "parent-selected", display_name: null },
    }, null);
    expect(metadata).toEqual(expect.objectContaining({
      second_guardian_user_id: "parent-selected",
      second_guardian_name: null,
    }));
    expect(metadata).not.toHaveProperty("second_guardian_email");
  });

  it("discards linking and second-guardian metadata when every child is blank", () => {
    const result = buildBulkPendingInviteMetadata({
      ...base,
      children: [{ name: " " }],
      secondParentName: "Parent B",
      secondParentEmail: "parent.b@example.test",
    }, "token-b");
    expect(result).toEqual({ validChildren: [], metadata: null });
  });

  it("does not add an absent linked token or second guardian", () => {
    const { metadata } = buildBulkPendingInviteMetadata(base, null);
    expect(metadata).toEqual({
      children: expect.any(Array),
    });
  });
});
