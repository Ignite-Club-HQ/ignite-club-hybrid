import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/ClubDetailPage.tsx"), "utf8");

describe("ClubDetailPage ICP membership wiring", () => {
  it("routes club delete/restore/permanent-delete through withFeatureBackend(\"membership\")", () => {
    expect(source).toContain('isFeatureRoutedToIcp("membership")');
    expect(source).toContain("softDeleteLiveClub(ctx, id!, true)");
    expect(source).toContain("restoreLiveClub(ctx, id!, true)");
    expect(source).toContain("deleteLiveClubPermanent(ctx, id!)");
  });

  it("routes the club role-request mutation through requestLiveRole while keeping the Supabase insert", () => {
    expect(source).toContain("requestLiveRole(ctx, id!, selectedRole)");
    expect(source).toContain('supabase.from("role_requests").insert({');
  });

  it("keeps the ICP lab short-circuit ahead of the ICP-account branch for role requests", () => {
    expect(source).toContain('if (useIcpLab) throw new Error("Club role requests are unavailable in ICP lab mode.");');
  });
});
