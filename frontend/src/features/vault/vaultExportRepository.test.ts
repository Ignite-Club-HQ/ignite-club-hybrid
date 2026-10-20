import { describe, it, expect, vi } from "vitest";

const liveMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  listLiveVaultFolders: vi.fn(),
  listLiveVaultClubFilesWithFolder: vi.fn(),
  listLiveVaultFilesWithFolder: vi.fn(),
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    liveMocks.mode === "icp" ? providers.icp({}) : providers.supabase(),
}));
vi.mock("@/live/features/vault", () => ({
  listLiveVaultFolders: liveMocks.listLiveVaultFolders,
  listLiveVaultClubFilesWithFolder: liveMocks.listLiveVaultClubFilesWithFolder,
  listLiveVaultFilesWithFolder: liveMocks.listLiveVaultFilesWithFolder,
}));

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
  competition_id?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  deleted_at?: string | null;
}

/**
 * Minimal PostgREST-shaped fake. Records every table touched and every filter
 * applied so tests can assert scope and that `public.photos` is never read.
 */
const makeClient = (data: { vault_files: Row[]; vault_folders: any[] }) => {
  const calls: { table: string; filters: string[] }[] = [];
  const signedPaths: string[] = [];
  const client: any = {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          signedPaths.push(`${bucket}:${path}`);
          return { data: { signedUrl: `https://signed.invalid/${path}` }, error: null };
        },
      }),
    },
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
    signedPaths,
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

describe.runIf(liveMocks.mode === "supabase")("Vault export folder reads — Supabase", () => {
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

  it("filters competition exports by organizer and competition and signs private files", async () => {
    const client = makeClient({
      vault_files: [
        {
          id: "comp-file", name: "rules.pdf", file_url: "storage://competition-vault/rules.pdf",
          file_type: "application/pdf", folder_id: null, club_id: CLUB,
          competition_id: "comp-a", storage_bucket: "competition-vault", storage_path: "clubs/club-1/competitions/comp-a/rules.pdf",
        },
        {
          id: "other-comp", name: "other.pdf", file_url: "public://other.pdf",
          file_type: "application/pdf", folder_id: null, club_id: CLUB,
          competition_id: "comp-b", storage_bucket: "competition-vault", storage_path: "clubs/club-1/competitions/comp-b/other.pdf",
        },
      ],
      vault_folders: [],
    });
    const result = await fetchVaultFolderContents({
      folderId: null,
      clubId: CLUB,
      teamId: null,
      competitionId: "comp-a",
    }, "", client);
    expect(result.files.map((file) => file.id)).toEqual(["comp-file"]);
    expect(result.files[0].file_url).toBe("https://signed.invalid/clubs/club-1/competitions/comp-a/rules.pdf");
    expect(client.calls[0].filters).toContain(`club_id=${CLUB}`);
    expect(client.calls[0].filters).toContain("competition_id=comp-a");
    expect(client.signedPaths).toEqual(["competition-vault:clubs/club-1/competitions/comp-a/rules.pdf"]);
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

describe.runIf(liveMocks.mode === "icp")("Vault export folder reads — ICP", () => {
  beforeEach(() => {
    liveMocks.listLiveVaultFolders.mockReset().mockResolvedValue([]);
    liveMocks.listLiveVaultClubFilesWithFolder.mockReset().mockResolvedValue([]);
    liveMocks.listLiveVaultFilesWithFolder.mockReset().mockResolvedValue([]);
  });

  it("uses competition-specific canister folder and file reads", async () => {
    const result = await fetchVaultFolderContents({
      folderId: null,
      clubId: CLUB,
      teamId: null,
      competitionId: "comp-a",
    });

    expect(result).toEqual({ photos: [], files: [], subfolders: [] });
    expect(liveMocks.listLiveVaultFolders).toHaveBeenCalledWith({}, CLUB, null, null, "comp-a");
    expect(liveMocks.listLiveVaultFilesWithFolder).toHaveBeenCalledWith({}, "", "comp-a");
    expect(liveMocks.listLiveVaultClubFilesWithFolder).not.toHaveBeenCalled();
  });

  it.each([
    ["club", null],
    ["team", "team-1"],
  ] as const)("maps %s canister files into export photos and documents", async (_scope, teamId) => {
    liveMocks.listLiveVaultClubFilesWithFolder.mockResolvedValue([
      {
        file: {
          id: "photo-1", folder_id: [], club: CLUB, team: teamId ? [teamId] : [], mini_league_id: [], competition_id: [],
          name: "Photo.jpg", file_url: "clubs/club-1/photo.jpg", size: 24n, mime: "image/jpeg",
          uploaded_by: { toText: () => "principal-a" }, created_at_ms: 1_000n, deleted_at_ms: [], deleted_by: [], is_external_link: false,
        },
        folder_name: [], folder_path: [],
      },
      {
        file: {
          id: "doc-1", folder_id: [], club: CLUB, team: teamId ? [teamId] : [], mini_league_id: [], competition_id: [],
          name: "Rules.pdf", file_url: "clubs/club-1/rules.pdf", size: 12n, mime: "application/pdf",
          uploaded_by: { toText: () => "principal-a" }, created_at_ms: 1_000n, deleted_at_ms: [], deleted_by: [], is_external_link: false,
        },
        folder_name: [], folder_path: [],
      },
    ]);
    const client = makeClient({ vault_files: [], vault_folders: [] });

    const result = await fetchVaultFolderContents({ folderId: null, clubId: CLUB, teamId }, "", client);

    expect(result.photos).toEqual([expect.objectContaining({
      id: "photo-1",
      path: "",
      image_url: "clubs/club-1/photo.jpg",
      title: "Photo.jpg",
      file_size: 24,
    })]);
    expect(result.files).toEqual([expect.objectContaining({ id: "doc-1", path: "" })]);
    expect(liveMocks.listLiveVaultClubFilesWithFolder).toHaveBeenCalledWith({}, CLUB, teamId);
    expect(client.calls).toEqual([]);
  });

  it("recursively exports nested canister files with stable paths and per-folder counts", async () => {
    liveMocks.listLiveVaultFolders.mockResolvedValue([{
      id: "folder-1", name: "Gallery Uploads", club: CLUB, team: [], mini_league_id: [], competition_id: [],
      parent_id: [], restricted_roles: [], created_at_ms: 1_000n, deleted_at_ms: [],
    }]);
    liveMocks.listLiveVaultClubFilesWithFolder.mockResolvedValue([
      {
        file: {
          id: "photo-1", folder_id: [], club: CLUB, team: [], mini_league_id: [], competition_id: [],
          name: "Photo.jpg", file_url: "photo.jpg", size: 24n, mime: "image/jpeg",
          uploaded_by: { toText: () => "principal-a" }, created_at_ms: 1_000n, deleted_at_ms: [], deleted_by: [], is_external_link: false,
        },
        folder_name: [], folder_path: [],
      },
      {
        file: {
          id: "doc-1", folder_id: ["folder-1"], club: CLUB, team: [], mini_league_id: [], competition_id: [],
          name: "Rules.pdf", file_url: "rules.pdf", size: 12n, mime: "application/pdf",
          uploaded_by: { toText: () => "principal-a" }, created_at_ms: 1_000n, deleted_at_ms: [], deleted_by: [], is_external_link: false,
        },
        folder_name: ["Gallery Uploads"], folder_path: ["Gallery Uploads"],
      },
    ]);
    const client = makeClient({ vault_files: [], vault_folders: [] });

    const result = await collectVaultExportContents({ folderId: null, clubId: CLUB, teamId: null }, "", [], client);

    expect(result.photos.map(photo => photo.id)).toEqual(["photo-1"]);
    expect(result.files.map(file => ({ id: file.id, path: file.path }))).toEqual([
      { id: "doc-1", path: "Gallery Uploads" },
    ]);
    expect(result.folderBreakdown).toEqual([
      { path: "(current folder)", photoCount: 1, fileCount: 0 },
      { path: "Gallery Uploads", photoCount: 0, fileCount: 1 },
    ]);
    expect(liveMocks.listLiveVaultClubFilesWithFolder).toHaveBeenCalledTimes(2);
    expect(client.calls).toEqual([]);
  });

  it("fails closed without an export scope before querying canisters", async () => {
    const result = await collectVaultExportContents({ folderId: null, clubId: null, teamId: null }, "");

    expect(result).toEqual({ photos: [], files: [], subfolders: [], folderBreakdown: [] });
    expect(liveMocks.listLiveVaultFolders).not.toHaveBeenCalled();
    expect(liveMocks.listLiveVaultClubFilesWithFolder).not.toHaveBeenCalled();
    expect(liveMocks.listLiveVaultFilesWithFolder).not.toHaveBeenCalled();
  });
});
