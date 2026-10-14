import { beforeEach, describe, expect, it, vi } from "vitest";
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));
import { listSupabaseRoleRequests } from "./roleRequestRepository";
function arrange(requests: unknown[], profiles: unknown[], profileError: Error | null = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockResolvedValue({ data: requests, error: null }) };
  const profileQuery = { select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: profiles, error: profileError }) };
  from.mockImplementation(table => table === "role_requests" ? query : profileQuery);
  return { query, profileQuery };
}
describe("Supabase pending role requests", () => {
  beforeEach(() => from.mockReset());
  it.each([{ clubId: "club-a" }, { teamId: "team-a" }])("reads pending requests within scope, newest first: %j", async scope => {
    const { query } = arrange([], []);
    await listSupabaseRoleRequests(scope);
    expect(query.eq).toHaveBeenCalledWith("clubId" in scope ? "club_id" : "team_id", "clubId" in scope ? scope.clubId : scope.teamId);
    expect(query.eq).toHaveBeenCalledWith("status", "pending");
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
  });
  it("reads names afresh without expiring genuine old requests", async () => {
    arrange([{ id: "request-a", user_id: "user-a", created_at: "2026-04-07T00:00:00Z" }], [{ id: "user-a", display_name: "Kieran", avatar_url: null }]);
    expect(await listSupabaseRoleRequests({ clubId: "club-a" })).toMatchObject([{ id: "request-a", requester: { display_name: "Kieran" } }]);
    arrange([{ id: "request-a", user_id: "user-a" }], [{ id: "user-a", display_name: "Updated name", avatar_url: null }]);
    expect(await listSupabaseRoleRequests({ clubId: "club-a" })).toMatchObject([{ requester: { display_name: "Updated name" } }]);
  });
  it("surfaces profile read failures", async () => {
    arrange([{ id: "request-a", user_id: "user-a" }], [], new Error("Profile read failed"));
    await expect(listSupabaseRoleRequests({ teamId: "team-a" })).rejects.toThrow("Profile read failed");
  });
});