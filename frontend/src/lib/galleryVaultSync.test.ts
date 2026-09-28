import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  existingFile: null as { id: string } | null,
  existingFolder: null as { id: string } | null,
  createdFolder: { id: "folder-created" } as { id: string } | null,
  folderError: null as { message: string } | null,
  fileInsertError: null as { message: string } | null,
  folderInsertPayloads: [] as any[],
  fileInsertPayloads: [] as any[],
  queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: state.rpc, from: state.from },
}));

import { syncGalleryPhotoToVault } from "./galleryVaultSync";

function builder(table: string) {
  const filters: Array<[string, unknown]> = [];
  state.queries.push({ table, filters });
  const chain: Record<string, any> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain; });
  chain.is = vi.fn((column: string, value: unknown) => { filters.push([column, value]); return chain; });
  chain.limit = vi.fn(() => chain);
  chain.insert = vi.fn((payload: any) => {
    if (table === "vault_folders") state.folderInsertPayloads.push(payload);
    if (table === "vault_files") state.fileInsertPayloads.push(payload);
    return chain;
  });
  chain.maybeSingle = vi.fn(async () => ({
    data: table === "vault_files" ? state.existingFile : state.existingFolder,
    error: null,
  }));
  chain.single = vi.fn(async () => ({ data: state.createdFolder, error: state.folderError }));
  chain.then = vi.fn((resolve: (value: unknown) => unknown) => Promise.resolve(resolve({
    data: null,
    error: table === "vault_files" ? state.fileInsertError : state.folderError,
  })));
  return chain;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    fileUrl: "https://storage.example/photos/photo.jpg",
    fileName: "match-day.jpg",
    fileSize: 2048,
    fileType: "image/jpeg",
    userId: "user-1",
    clubId: `club-${crypto.randomUUID()}`,
    teamId: "team-1",
    miniLeagueId: null,
    ...overrides,
  } as any;
}

describe("gallery photo to vault synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.existingFile = null;
    state.existingFolder = null;
    state.createdFolder = { id: "folder-created" };
    state.folderError = null;
    state.fileInsertError = null;
    state.folderInsertPayloads = [];
    state.fileInsertPayloads = [];
    state.queries = [];
    state.rpc.mockResolvedValue({ data: true, error: null });
    state.from.mockImplementation((table: string) => builder(table));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it.each([
    ["a missing club", { clubId: "" }],
    ["a missing source URL", { fileUrl: "" }],
  ])("does nothing for %s", async (_label, overrides) => {
    await syncGalleryPhotoToVault(input(overrides));
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
  });

  it("does not mirror gallery files for a Free club", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const request = input();
    await syncGalleryPhotoToVault(request);
    expect(state.rpc).toHaveBeenCalledWith("has_active_pro_for_club", { _club_id: request.clubId });
    expect(state.from).not.toHaveBeenCalled();
  });

  it("deduplicates by exact club and source URL before creating folders", async () => {
    state.existingFile = { id: "already-mirrored" };
    const request = input();
    await syncGalleryPhotoToVault(request);

    const lookup = state.queries.find((query) => query.table === "vault_files")!;
    expect(lookup.filters).toEqual(expect.arrayContaining([
      ["club_id", request.clubId], ["file_url", request.fileUrl],
    ]));
    expect(state.folderInsertPayloads).toEqual([]);
    expect(state.fileInsertPayloads).toEqual([]);
  });

  it("uses an existing team Gallery Uploads folder and writes the complete scoped row", async () => {
    state.existingFolder = { id: "folder-existing" };
    const request = input({ miniLeagueId: "league-1" });
    await syncGalleryPhotoToVault(request);

    expect(state.folderInsertPayloads).toEqual([]);
    expect(state.fileInsertPayloads).toEqual([expect.objectContaining({
      file_url: request.fileUrl,
      name: "match-day.jpg",
      file_type: "image/jpeg",
      file_size: 2048,
      club_id: request.clubId,
      team_id: "team-1",
      mini_league_id: "league-1",
      uploaded_by: "user-1",
      folder_id: "folder-existing",
      is_external_link: false,
    })]);
    const folderLookup = state.queries.find((query) => query.table === "vault_folders")!;
    expect(folderLookup.filters).toContainEqual(["team_id", "team-1"]);
  });

  it("creates a club-level Gallery Uploads folder when none exists", async () => {
    const request = input({ teamId: null });
    await syncGalleryPhotoToVault(request);

    expect(state.folderInsertPayloads).toEqual([{
      club_id: request.clubId,
      name: "Gallery Uploads",
      created_by: "user-1",
      team_id: null,
    }]);
    expect(state.fileInsertPayloads[0]).toMatchObject({ team_id: null, folder_id: "folder-created" });
    const folderLookup = state.queries.find((query) => query.table === "vault_folders")!;
    expect(folderLookup.filters).toContainEqual(["team_id", null]);
  });

  it("still mirrors without a folder when folder creation is rejected", async () => {
    state.createdFolder = null;
    state.folderError = { message: "folder RLS denied" };
    await syncGalleryPhotoToVault(input());
    expect(state.fileInsertPayloads[0]).toMatchObject({ folder_id: null });
  });

  it("is best-effort and does not fail the completed gallery upload when vault insertion fails", async () => {
    state.existingFolder = { id: "folder-existing" };
    state.fileInsertError = { message: "vault unavailable" };
    await expect(syncGalleryPhotoToVault(input())).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith("galleryVaultSync insert failed:", state.fileInsertError);
  });

  it("contains unexpected Pro-check failures rather than breaking gallery upload", async () => {
    state.rpc.mockRejectedValue(new Error("network unavailable"));
    await expect(syncGalleryPhotoToVault(input())).resolves.toBeUndefined();
    expect(state.from).not.toHaveBeenCalled();
  });
});
