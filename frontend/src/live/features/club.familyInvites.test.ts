import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), register: vi.fn(), grant: vi.fn() }));
vi.mock("../domains", () => ({ connectLiveClubDomain: async () => ({ actor: { create_family_invite: mocks.create } }) }));
vi.mock("./vault", () => ({ registerLivePii: mocks.register, grantLivePiiReadClub: mocks.grant, registerLivePiiText: vi.fn() }));
vi.mock("./batching", () => ({ batched: vi.fn() }));
import { createLiveFamilyInvite } from "./club";
import type { FeatureBackendContext } from "../featureRouter";
const ctx = { identity: { getPrincipal: () => ({ toText: () => "owner" }) }, target: {} } as unknown as FeatureBackendContext;
describe("family invite serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.register.mockResolvedValue(undefined); mocks.grant.mockResolvedValue(undefined);
    mocks.create.mockResolvedValue({ Ok: { invite: { id: "pinv-one" }, secondary: [], child_ids: ["existing-1", "child-new-1"] } });
  });
  it("keeps every child and sends only opaque references to the club service", async () => {
    await createLiveFamilyInvite(ctx, { requestId: "request-123456789", clubId: "club", teamId: "team", children: [
      { id: "existing-1", existing: true, name: "Existing" },
      { id: "child-new-1", existing: false, name: "Private name", yearOfBirth: "2016", jerseyNumber: "12" },
    ], second: true, email: "" });
    expect(mocks.create).toHaveBeenCalledWith("request-123456789", "club", "team", [
      { id: "existing-1", existing: true }, { id: "child-new-1", existing: false },
    ], true, []);
    expect(mocks.register.mock.calls.map(c => c[2])).toEqual(["name", "year_of_birth", "jersey_number"]);
    expect(mocks.grant).toHaveBeenCalledTimes(3);
  });
  it("does not issue any invitation when encrypted child details cannot be stored", async () => {
    mocks.register.mockRejectedValueOnce(new Error("PII unavailable"));
    await expect(createLiveFamilyInvite(ctx, { requestId: "request-123456789", clubId: "club", teamId: "team", children: [
      { id: "child-new-1", existing: false, name: "Private name" },
    ], second: false, email: "" })).rejects.toThrow("PII unavailable");
    expect(mocks.create).not.toHaveBeenCalled();
  });
});