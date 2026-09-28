import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  calculateVaultStorageBreakdown,
  DEFAULT_VAULT_PHOTO_SIZE,
  fetchVaultStorageBreakdown,
  fetchVaultStorageSubscription,
  isVaultStorageImageFilename,
} from "./vaultStorageRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    query.select = record("select");
    query.eq = record("eq");
    query.is = record("is");
    const take = () => ({ data: script[table]?.shift() ?? null, error: null });
    query.maybeSingle = async () => take();
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

describe("Vault storage accounting", () => {
  it("classifies storage images by filename extension only", () => {
    expect(isVaultStorageImageFilename("PHOTO.HEIC")).toBe(true);
    expect(isVaultStorageImageFilename("photo.jpg.download")).toBe(false);
    expect(isVaultStorageImageFilename("document.pdf")).toBe(false);
  });

  it("uses the existing 500KB estimate for photos with absent or zero size", () => {
    const result = calculateVaultStorageBreakdown({
      photos: [
        { file_size: null, team_id: null, mini_league_id: null },
        { file_size: 0, team_id: null, mini_league_id: null },
      ],
      files: [],
      teams: [],
      miniLeagues: [],
    });
    expect(result.photos).toBe(DEFAULT_VAULT_PHOTO_SIZE * 2);
    expect(result.byTeam[0]).toMatchObject({
      teamId: null,
      teamName: "Club-level",
      photosSize: DEFAULT_VAULT_PHOTO_SIZE * 2,
    });
  });

  it("counts Vault image files as photos and other files as documents", () => {
    const result = calculateVaultStorageBreakdown({
      photos: [],
      files: [
        { file_size: 100, team_id: "team-a", mini_league_id: null, name: "image.png" },
        { file_size: 250, team_id: "team-a", mini_league_id: null, name: "policy.pdf" },
      ],
      teams: [{ id: "team-a", name: "Team A" }],
      miniLeagues: [],
    });
    expect(result).toMatchObject({ photos: 100, documents: 250, total: 350 });
    expect(result.byTeam).toEqual([{
      teamId: "team-a",
      teamName: "Team A",
      size: 350,
      photosSize: 100,
      documentsSize: 250,
    }]);
  });

  it("attributes mini-league content exclusively to the mini-league", () => {
    const result = calculateVaultStorageBreakdown({
      photos: [{ file_size: 300, team_id: "team-a", mini_league_id: "league-a" }],
      files: [{ file_size: 200, team_id: "team-a", mini_league_id: "league-a", name: "rules.pdf" }],
      teams: [{ id: "team-a", name: "Team A" }],
      miniLeagues: [{ id: "league-a", name: "League A" }],
    });
    expect(result.byTeam).toEqual([]);
    expect(result.byMiniLeague).toEqual([{
      miniLeagueId: "league-a",
      miniLeagueName: "League A",
      size: 500,
      photosSize: 300,
      documentsSize: 200,
    }]);
  });

  it("uses stable unknown labels and sorts scopes by descending size", () => {
    const result = calculateVaultStorageBreakdown({
      photos: [],
      files: [
        { file_size: 100, team_id: "missing", mini_league_id: null, name: "a.pdf" },
        { file_size: 300, team_id: "known", mini_league_id: null, name: "b.pdf" },
      ],
      teams: [{ id: "known", name: "Known Team" }],
      miniLeagues: [],
    });
    expect(result.byTeam.map((entry) => [entry.teamName, entry.size])).toEqual([
      ["Known Team", 300],
      ["Unknown Team", 100],
    ]);
  });

  it("reads purchased storage for the exact club and defaults an absent row", async () => {
    const present = scriptedClient({ club_subscriptions: [{ storage_purchased_gb: 5, scheduled_storage_downgrade_gb: null, storage_downgrade_at: null }] });
    await expect(fetchVaultStorageSubscription("club-a", present.client)).resolves.toMatchObject({ storage_purchased_gb: 5 });
    expect(present.calls).toContainEqual({ table: "club_subscriptions", method: "eq", args: ["club_id", "club-a"] });

    const absent = scriptedClient({ club_subscriptions: [null] });
    await expect(fetchVaultStorageSubscription("club-a", absent.client)).resolves.toEqual({
      storage_purchased_gb: 0,
      scheduled_storage_downgrade_gb: null,
      storage_downgrade_at: null,
    });
  });

  it("scopes every storage source to the club and excludes deleted photos, files, and teams", async () => {
    const fake = scriptedClient({
      photos: [[]],
      vault_files: [[]],
      teams: [[]],
      mini_leagues: [[]],
    });
    await fetchVaultStorageBreakdown("club-a", fake.client);
    for (const table of ["photos", "vault_files", "teams", "mini_leagues"]) {
      expect(fake.calls).toContainEqual({ table, method: "eq", args: ["club_id", "club-a"] });
    }
    for (const table of ["photos", "vault_files", "teams"]) {
      expect(fake.calls).toContainEqual({ table, method: "is", args: ["deleted_at", null] });
    }
    expect(fake.calls.some((call) => call.table === "mini_leagues" && call.method === "is")).toBe(false);
  });
});
