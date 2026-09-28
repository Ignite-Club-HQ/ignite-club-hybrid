import { describe, expect, it, vi } from "vitest";
import {
  fetchPendingInvitesForUser,
  refreshAcceptedInviteMembership,
} from "./pendingInviteRepository";

function clientWith(result: { data: any; error: any }) {
  const query: any = {
    select: vi.fn(), eq: vi.fn(), limit: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return { client: { from: vi.fn().mockReturnValue(query) }, query };
}

describe("pending invite repository", () => {
  it("reads only pending invites assigned to the exact signed-in user", async () => {
    const rows = [{ id: "invite-1", role: "committee_member" }];
    const { client, query } = clientWith({ data: rows, error: null });
    await expect(fetchPendingInvitesForUser(client, "user-1")).resolves.toEqual(rows);
    expect(client.from).toHaveBeenCalledWith("pending_invites");
    expect(query.eq).toHaveBeenNthCalledWith(1, "invited_user_id", "user-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "status", "pending");
    expect(query.limit).toHaveBeenCalledWith(10);
  });

  it("preserves the background flow's safe empty fallback on read failure", async () => {
    const { client } = clientWith({ data: null, error: new Error("invite read denied") });
    await expect(fetchPendingInvitesForUser(client, "user-1")).resolves.toEqual([]);
  });

  it("refreshes roles and every pending-invite user view after processing", () => {
    const invalidateQueries = vi.fn();
    refreshAcceptedInviteMembership({ invalidateQueries });
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["user-roles"] }],
      [{ queryKey: ["pending-invites-for-user"] }],
    ]);
  });
});
