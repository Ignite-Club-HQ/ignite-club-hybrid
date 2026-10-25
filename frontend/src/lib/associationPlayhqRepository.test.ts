import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), link: vi.fn(), sync: vi.fn(), scopes: [] as unknown[] }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_feature: string, providers: { icp: (ctx: unknown) => unknown }, scope: unknown) => { m.scopes.push(scope); return providers.icp({}); } }));
vi.mock("@/live/domains", () => ({ connectLiveCompetitionDomain: async () => ({ actor: { list_playhq_competitions: m.list, link_playhq_competition: m.link, sync_playhq_grade: m.sync } }) }));
import { readIcpAssociationPlayhq, linkIcpAssociationPlayhq, syncIcpAssociationPlayhq } from "./associationPlayhqRepository";
beforeEach(() => { vi.clearAllMocks(); m.scopes.length = 0; });
describe("on-chain association PlayHQ links", () => {
  it("reads source metadata through the owning club without inventing a sync date", async () => {
    m.list.mockResolvedValue({ Ok: [{ competition: { id: "cup", name: "Cup", season: "2026", status: "active" }, link: { tenant: "bv", grade_id: "grade", sport: ["basketball"], last_synced_at_ms: [] } }] });
    expect(await readIcpAssociationPlayhq("group2-club")).toEqual([{ id: "cup", name: "Cup", season: "2026", status: "active", source: "playhq", sport: "basketball", external_tenant: "bv", external_id: "grade", last_synced_at: null }]);
    expect(m.scopes).toEqual([{ clubId: "group2-club" }]);
  });
  it("creates the competition and immutable source in one single-attempt call", async () => {
    m.link.mockResolvedValue({ Ok: { id: "cup" } });
    await linkIcpAssociationPlayhq({ clubId: "club", name: " Cup ", season: "", tenant: " BV ", gradeId: "grade", sport: "basketball" });
    expect(m.link).toHaveBeenCalledExactlyOnceWith("club", "Cup", "", "bv", "grade", ["basketball"]);
    expect(m.scopes[0]).toMatchObject({ clubId: "club", attempts: 1 });
  });
  it("syncs only the selected saved source through the owning club", async () => {
    m.sync.mockResolvedValue({ Ok: 0n });
    expect(await syncIcpAssociationPlayhq("club", "cup", "bv", "grade")).toBe(0n);
    expect(m.sync).toHaveBeenCalledExactlyOnceWith("cup", "bv", "grade");
    expect(m.scopes[0]).toMatchObject({ clubId: "club", attempts: 1 });
  });
});