import { describe, it, expect, vi } from "vitest";
import {
  fetchVaultFolderContents,
  collectVaultExportContents,
  hasVaultExportScope,
} from "./vaultExportRepository";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

interface Row {
  id: string;
  name: string;
  file_url?: string;
  file_type?: string | null;
  folder_id: string | null;
  club_id?: string | null;
  team_id?: string | null;
  deleted_at?: string | null;
}

/**
 * Minimal PostgREST-shaped fake. Records every table touched and every filter
 * applied so tests can assert scope and that `public.photos` is never read.
 */
const makeClient = (data: { vault_files: Row[]; vault_folders: any[] }) => {
  const calls: { table: string; filters: string[] }[] = [];
  const client: any = {
    from(table: string) {
      const entry = { table, filters: [] as string[] };
      calls.push(entry);
      let rows: any[] = (data as any)[table] ? [...(data as any)[table]] : [];
      const builder: any = {
        select: () => builder,
        is: (col: string, val: null) => {
          entry.filters.push(`${col} IS NULL`);
          rows = rows.filter(r => (r[col] ?? null) === val);
          return builder;
        },
        eq: (col: string, val: any) => {
          entry.filters.push(`${col}=${val}`);
          rows = rows.filter(r => r[col] === val);
          return builder;
        },
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    },
    calls,
  };
  return client;
};

const CLUB = "club-1";

const baseRows: Row[] = [
  { id: "img1", name: "team-photo.jpg", file_url: "u/img1.jpg", file_type: "image/jpeg", folder_id: null, club_id: CLUB, team_id: null, deleted_at: null },
  { id: "img2", name: "no-mime.PNG", file_url: "u/img2.png", file_type: null, folder_id: null, club_id: CLUB, team_id: null, deleted_at: null },
  { id: "doc1", name: "rules.pdf", file_url: "u/doc.pdf", file_type: "application/pdf", folder_id: null, club_id: CLUB, team_id: null, deleted_at: null },
  { id: "gone", name: "deleted.jpg", file_url: "u/gone.jpg", file_type: "image/jpeg", folder_id: null, club_id: CLUB, team_id: null, deleted_at: "2026-01-01" },
  { id: "nested", name: "nested.jpg", file_url: "u/nested.jpg", file_type: "image/jpeg", folder_id: "f1", club_id: CLUB, team_id: null, deleted_at: null },
  { id: "other-club", name: "elsewhere.jpg", file_url: "u/x.jpg", file_type: "image/jpeg", folder_id: null, club_id: "club-2", team_id: null, deleted_at: null },
  { id: "team-row", name: "team.jpg", file_url: "u/t.jpg", file_type: "image/jpeg", folder_id: null, club_id: CLUB, team_id: "team-1", deleted_at: null },
];

const folders = [
  { id: "f1", name: "Gallery Uploads", parent_id: null, club_id: CLUB, team_id: null, deleted_at: null },
];

describe("Vault export folder reads", () => {
  it("never queries public.photos", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: folders });
    await collectVaultExportContents({ folderId: null, clubId: CLUB, teamId: null }, "", [], client);
    expect(client.calls.map((c: any) => c.table)).not.toContain("photos");
    expect(client.calls.some((c: any) => c.table === "vault_files")).toBe(true);
  });

  it("uses vault_files as the only item source and excludes soft-deleted rows", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: [] });
    const res = await fetchVaultFolderContents({ folderId: null, clubId: CLUB, teamId: null }, "", client);
    expect(client.calls.map((c: any) => c.table)).not.toContain("photos");
    expect(res.photos.map(p => p.id).sort()).toEqual(["img1", "img2"]);
    expect(res.files.map(f => f.id)).toEqual(["doc1"]);
    expect(res.photos.every(p => p.image_url && p.title)).toBe(true);
  });

  it("uses exact club-level scope and excludes team rows", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: [] });
    await fetchVaultFolderContents({ folderId: null, clubId: CLUB, teamId: null }, "", client);
    const filters = client.calls[0].filters;
    expect(filters).toContain(`club_id=${CLUB}`);
    expect(filters).toContain("team_id IS NULL");
    expect(filters).toContain("deleted_at IS NULL");
  });

  it("uses exact team scope", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: [] });
    const res = await fetchVaultFolderContents({ folderId: null, clubId: CLUB, teamId: "team-1" }, "", client);
    expect(client.calls[0].filters).toContain("team_id=team-1");
    expect(res.photos.map(p => p.id)).toEqual(["team-row"]);
  });

  it("uses exact nested-folder scope and preserves its export path", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: [] });
    const res = await fetchVaultFolderContents({ folderId: "f1", clubId: CLUB, teamId: null }, "Gallery Uploads", client);
    expect(client.calls[0].filters).toContain("folder_id=f1");
    expect(res.photos.map(p => p.id)).toEqual(["nested"]);
    expect(res.photos[0].path).toBe("Gallery Uploads");
  });

  it("exports a mirrored gallery item exactly once with a truthful breakdown", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: folders });
    const res = await collectVaultExportContents({ folderId: null, clubId: CLUB, teamId: null }, "", [], client);
    expect(res.photos.filter(p => p.id === "nested")).toHaveLength(1);
    expect(res.photos.map(p => p.id)).toEqual(["img1", "img2", "nested"]);
    expect(res.folderBreakdown).toEqual([
      { path: "(current folder)", photoCount: 2, fileCount: 1 },
      { path: "Gallery Uploads", photoCount: 1, fileCount: 0 },
    ]);
  });

  it("fails closed and performs zero queries without club or team scope", async () => {
    const client = makeClient({ vault_files: baseRows, vault_folders: folders });
    const res = await collectVaultExportContents({ folderId: null, clubId: null, teamId: null }, "", [], client);
    expect(res).toEqual({ photos: [], files: [], subfolders: [], folderBreakdown: [] });
    expect(client.calls).toHaveLength(0);
    expect(hasVaultExportScope({ clubId: null, teamId: null })).toBe(false);
  });
});
