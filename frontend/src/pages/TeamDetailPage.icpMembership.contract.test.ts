import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/pages/TeamDetailPage.tsx"), "utf8");

describe("TeamDetailPage ICP membership wiring", () => {
  it("routes team delete/restore/permanent-delete through withFeatureBackend(\"membership\")", () => {
    expect(source).toContain('isFeatureRoutedToIcp("membership")');
    expect(source).toContain("softDeleteLiveTeam(ctx, id!)");
    expect(source).toContain("restoreLiveTeam(ctx, id!)");
    expect(source).toContain("deleteLiveTeamPermanent(ctx, id!)");
  });

  it("routes member removal through removeLiveMember with a principal, keeping the Supabase RPC branch intact", () => {
    expect(source).toContain("removeLiveMember(ctx, team!.club_id, Principal.fromText(removeMember.userId))");
    expect(source).toContain('supabase.rpc("remove_team_member"');
  });

  it("keeps the ICP lab (fixture) short-circuits untouched, ahead of the ICP-account branches", () => {
    expect(source).toContain('toast({ title: "Team deletion is unavailable in ICP lab mode", variant: "destructive" });');
    expect(source).toContain('toast({ title: "Member removal is unavailable in ICP lab mode", variant: "destructive" });');
  });
});
