import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  backend: "supabase" as "supabase" | "icp",
  principal: { toText: () => "principal-guardian" },
  acceptLiveParentInvite: vi.fn(),
  addLiveGuardianRelationship: vi.fn(async () => undefined),
  grantLivePiiRead: vi.fn(async () => undefined),
  supabaseRpc: vi.fn(),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: async (_feature: string, providers: any) => {
    if (mocks.backend !== "icp") return providers.supabase();
    return providers.icp({
      identity: { getPrincipal: () => mocks.principal },
      target: { alias: "test", canisterIds: {} },
    });
  },
}));

vi.mock("@/live/features/club", () => ({
  acceptLiveParentInvite: (...args: unknown[]) => mocks.acceptLiveParentInvite(...args),
}));

vi.mock("@/live/features/vault", () => ({
  addLiveGuardianRelationship: (ctx: unknown, guardian: unknown, childId: string) =>
    mocks.addLiveGuardianRelationship(ctx, guardian, childId),
  grantLivePiiRead: (ctx: unknown, piiId: string, fieldId: string, reader: unknown) =>
    mocks.grantLivePiiRead(ctx, piiId, fieldId, reader),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.supabaseRpc(...args),
  },
}));

import { acceptParentTeamInvite } from "./acceptParentInvite";

describe("acceptParentTeamInvite", () => {
  beforeEach(() => {
    mocks.backend = "supabase";
    mocks.acceptLiveParentInvite.mockReset();
    mocks.addLiveGuardianRelationship.mockReset().mockResolvedValue(undefined);
    mocks.grantLivePiiRead.mockReset().mockResolvedValue(undefined);
    mocks.supabaseRpc.mockReset();
  });

  describe("ICP branch", () => {
    beforeEach(() => {
      mocks.backend = "icp";
    });

    it("succeeds and returns child/team/club ids when the guardian PII grant also succeeds", async () => {
      mocks.acceptLiveParentInvite.mockResolvedValueOnce({
        child_id: "child-1",
        team_id: ["team-1"],
        club_id: "club-1",
      });
      const result = await acceptParentTeamInvite({ inviteToken: "tok" });
      expect(result).toEqual({
        childIds: ["child-1"],
        alreadyAccepted: false,
        teamId: "team-1",
        clubId: "club-1",
      });
      expect(mocks.addLiveGuardianRelationship).toHaveBeenCalledWith(
        expect.anything(),
        mocks.principal,
        "child-1",
      );
      expect(mocks.grantLivePiiRead).toHaveBeenCalledWith(
        expect.anything(),
        "child-1",
        "name",
        mocks.principal,
      );
      expect(mocks.supabaseRpc).not.toHaveBeenCalled();
    });

    it("still succeeds when grant_pii_read rejects (best-effort, non-blocking)", async () => {
      mocks.acceptLiveParentInvite.mockResolvedValueOnce({
        child_id: "child-1",
        team_id: [],
        club_id: "club-1",
      });
      mocks.grantLivePiiRead.mockRejectedValueOnce(new Error("grant failed"));
      const result = await acceptParentTeamInvite({ inviteToken: "tok" });
      expect(result.childIds).toEqual(["child-1"]);
      expect(mocks.supabaseRpc).not.toHaveBeenCalled();
    });

    it("still succeeds when addLiveGuardianRelationship rejects (best-effort, non-blocking)", async () => {
      mocks.acceptLiveParentInvite.mockResolvedValueOnce({
        child_id: "child-1",
        team_id: [],
        club_id: "club-1",
      });
      mocks.addLiveGuardianRelationship.mockRejectedValueOnce(new Error("relationship failed"));
      const result = await acceptParentTeamInvite({ inviteToken: "tok" });
      expect(result.childIds).toEqual(["child-1"]);
      expect(mocks.grantLivePiiRead).not.toHaveBeenCalled();
    });

    it("skips the guardian PII grant entirely when the invite has no child", async () => {
      mocks.acceptLiveParentInvite.mockResolvedValueOnce({
        child_id: null,
        team_id: [],
        club_id: "club-1",
      });
      const result = await acceptParentTeamInvite({ inviteToken: "tok" });
      expect(result.childIds).toEqual([]);
      expect(mocks.addLiveGuardianRelationship).not.toHaveBeenCalled();
      expect(mocks.grantLivePiiRead).not.toHaveBeenCalled();
    });

    it("falls through to the Supabase RPC when there is no invite token in ICP mode", async () => {
      mocks.supabaseRpc.mockResolvedValueOnce({
        data: { child_ids: ["child-x"], already_accepted: true, team_id: null, club_id: null },
        error: null,
      });
      const result = await acceptParentTeamInvite({ inviteId: "invite-1" });
      expect(mocks.acceptLiveParentInvite).not.toHaveBeenCalled();
      expect(mocks.supabaseRpc).toHaveBeenCalledWith("accept_parent_team_invite", {
        _invite_id: "invite-1",
        _invite_token: null,
      });
      expect(result.alreadyAccepted).toBe(true);
    });
  });

  describe("Supabase branch (not ICP-routed)", () => {
    it("calls the Supabase RPC directly and never touches ICP helpers", async () => {
      mocks.supabaseRpc.mockResolvedValueOnce({
        data: { child_ids: ["child-2"], already_accepted: false, team_id: "team-2", club_id: "club-2" },
        error: null,
      });
      const result = await acceptParentTeamInvite({ inviteId: "invite-2" });
      expect(result).toEqual({
        childIds: ["child-2"],
        alreadyAccepted: false,
        teamId: "team-2",
        clubId: "club-2",
      });
      expect(mocks.acceptLiveParentInvite).not.toHaveBeenCalled();
      expect(mocks.addLiveGuardianRelationship).not.toHaveBeenCalled();
      expect(mocks.grantLivePiiRead).not.toHaveBeenCalled();
    });

    it("throws when the Supabase RPC returns an error", async () => {
      mocks.supabaseRpc.mockResolvedValueOnce({ data: null, error: { message: "invite_not_found" } });
      await expect(acceptParentTeamInvite({ inviteId: "bad" })).rejects.toEqual({
        message: "invite_not_found",
      });
    });
  });
});
