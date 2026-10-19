import { describe, expect, it, vi } from "vitest";
vi.mock("../domains", () => ({ connectLiveClubDomain: vi.fn() }));
import { mergeRoleGrants } from "./myRoleGrants";

const g = (role: string, club?: string, team?: string) => ({ role, club: club ? [club] : [], team: team ? [team] : [] }) as any;

describe("mergeRoleGrants", () => {
  it("counts the same grant held in the shared canister and a group once", () => {
    expect(mergeRoleGrants([[g("club_admin", "c1")], [g("club_admin", "c1")]])).toHaveLength(1);
  });
  it("keeps grants for different clubs, teams and roles from every group", () => {
    const out = mergeRoleGrants([[g("club_admin", "c1")], [g("coach", "c2", "t1"), g("coach", "c2", "t2"), g("parent", "c2")]]);
    expect(out).toHaveLength(4);
  });
});
