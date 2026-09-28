import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { fetchVaultLargeFiles } from "./vaultLargeFileRepository";

type IgniteSupabaseClient = SupabaseClient<Database>;
type Result = { data: any; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function scriptedClient(script: Record<string, Result[]>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const query: Record<string, any> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    for (const method of ["select", "eq", "is", "not", "order", "limit"]) query[method] = record(method);
    const take = () => script[table]?.shift() ?? { data: null, error: null };
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(take()).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, calls };
}

describe("Vault large-file repository", () => {
  it("scopes every source to one club and excludes deleted team labels", async () => {
    const { client, calls } = scriptedClient({
      teams: [{ data: [{ id: "team-a", name: "U10 Blue" }], error: null }],
      photos: [{ data: [{
        id: "photo-a", file_url: "/photo", file_size: 100, team_id: "team-a",
        title: "Training", created_at: "2026-01-01",
      }], error: null }],
      vault_files: [{ data: [{
        id: "file-a", file_url: "/file", file_size: 50, team_id: null,
        name: "Policy", created_at: "2026-01-02",
      }], error: null }],
    });

    await expect(fetchVaultLargeFiles("club-a", client)).resolves.toEqual([
      { id: "photo-a", type: "photo", name: "Training", size: 100, url: "/photo", teamName: "U10 Blue", createdAt: "2026-01-01" },
      { id: "file-a", type: "file", name: "Policy", size: 50, url: "/file", teamName: "Club-level", createdAt: "2026-01-02" },
    ]);
    for (const table of ["teams", "photos", "vault_files"]) {
      expect(calls).toContainEqual({ table, method: "eq", args: ["club_id", "club-a"] });
    }
    expect(calls).toContainEqual({ table: "teams", method: "is", args: ["deleted_at", null] });
  });

  it("retains non-null size, descending order and 50-row limits for both item sources", async () => {
    const { client, calls } = scriptedClient({
      teams: [{ data: [], error: null }],
      photos: [{ data: [], error: null }],
      vault_files: [{ data: [], error: null }],
    });
    await fetchVaultLargeFiles("club-a", client);
    for (const table of ["photos", "vault_files"]) {
      expect(calls).toContainEqual({ table, method: "not", args: ["file_size", "is", null] });
      expect(calls).toContainEqual({ table, method: "order", args: ["file_size", { ascending: false }] });
      expect(calls).toContainEqual({ table, method: "limit", args: [50] });
    }
  });

  it("returns an empty display model when reads have no data", async () => {
    const { client } = scriptedClient({});
    await expect(fetchVaultLargeFiles("club-a", client)).resolves.toEqual([]);
  });
});
