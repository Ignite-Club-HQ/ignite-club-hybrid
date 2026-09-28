/**
 * Contract tests for `useVaultContentDataModel` — the Vault content/folder/
 * item/search data model extracted from `VaultPage`. Exercises the actual
 * composed React Query behaviour (query enablement, argument threading, and
 * the active-view/recursive-search source switch), not just source-string
 * matches, since this is a higher-risk data-model extraction.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useVaultContentDataModel } from "./useVaultContentDataModel";
import type { VaultFolderView } from "./types";
import type { VaultFileRow, VaultFolderRow, VaultFolderTree } from "./vaultReadRepository";

const fetchVaultSubfolders = vi.fn();
const fetchVaultItems = vi.fn();
const fetchVaultFolderTree = vi.fn();
const searchVaultContents = vi.fn();

vi.mock("./vaultReadRepository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultReadRepository")>();
  return {
    ...actual,
    fetchVaultSubfolders: (...args: unknown[]) => fetchVaultSubfolders(...args),
    fetchVaultItems: (...args: unknown[]) => fetchVaultItems(...args),
    fetchVaultFolderTree: (...args: unknown[]) => fetchVaultFolderTree(...args),
    searchVaultContents: (...args: unknown[]) => searchVaultContents(...args),
  };
});

const rootView: VaultFolderView = { type: "root" };
const clubView: VaultFolderView = { type: "club", clubId: "club-a", clubName: "Club A" };
const teamView: VaultFolderView = {
  type: "team",
  clubId: "club-a",
  clubName: "Club A",
  teamId: "team-a",
  teamName: "Team A",
};

const folderRow = (overrides: Partial<VaultFolderRow> = {}): VaultFolderRow => ({
  id: "folder-1",
  name: "Match Reports",
  parent_id: null,
  club_id: "club-a",
  team_id: null,
  chat_group_id: null,
  restricted_roles: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  created_by: null,
  deleted_at: null,
  drive_folder_id: null,
  ...overrides,
} as VaultFolderRow);

const fileRow = (overrides: Partial<VaultFileRow> = {}): VaultFileRow => ({
  id: "file-1",
  folder_id: null,
  club_id: "club-a",
  team_id: null,
  mini_league_id: null,
  name: "notes.pdf",
  file_url: "https://example.test/notes.pdf",
  file_size: 100,
  file_type: "application/pdf",
  uploaded_by: "user-1",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  is_external_link: false,
  deleted_at: null,
  deleted_by: null,
  drive_file_id: null,
  drive_modified_time: null,
  storage_bucket: null,
  storage_path: null,
  ...overrides,
} as VaultFileRow);

const EMPTY_TREE: VaultFolderTree = { descendants: [], pathById: new Map(), descendantIds: [] };

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function renderContentDataModel(overrides: {
  currentView?: VaultFolderView;
  showTrash?: boolean;
  vaultSearchQuery?: string;
  debouncedVaultSearchQuery?: string;
  isClubAdmin?: boolean;
  isCoachOrTeamAdmin?: boolean;
  isAppAdmin?: boolean | undefined;
  userRoles?: Array<{ role?: string | null; club_id?: string | null; team_id?: string | null }>;
} = {}) {
  const wrapper = makeWrapper();
  const props = {
    currentView: overrides.currentView ?? rootView,
    showTrash: overrides.showTrash ?? false,
    vaultSearchQuery: overrides.vaultSearchQuery ?? "",
    debouncedVaultSearchQuery: overrides.debouncedVaultSearchQuery ?? "",
    isClubAdmin: overrides.isClubAdmin ?? false,
    isCoachOrTeamAdmin: overrides.isCoachOrTeamAdmin ?? false,
    isAppAdmin: overrides.isAppAdmin,
    userRoles: overrides.userRoles ?? [],
  };
  return renderHook(
    (p: typeof props) => useVaultContentDataModel(p),
    { wrapper, initialProps: props },
  );
}

beforeEach(() => {
  fetchVaultSubfolders.mockReset().mockResolvedValue([]);
  fetchVaultItems.mockReset().mockResolvedValue([]);
  fetchVaultFolderTree.mockReset().mockResolvedValue(EMPTY_TREE);
  searchVaultContents.mockReset().mockResolvedValue({ folders: [], files: [] });
});

describe("useVaultContentDataModel — active-view queries", () => {
  it("does not fetch subfolders or files at the root view", async () => {
    renderContentDataModel({ currentView: rootView });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchVaultSubfolders).not.toHaveBeenCalled();
    expect(fetchVaultItems).not.toHaveBeenCalled();
  });

  it("fetches subfolders for a non-root view, passing the resolved role/admin flags", async () => {
    fetchVaultSubfolders.mockResolvedValue([folderRow()]);
    const { result } = renderContentDataModel({
      currentView: clubView,
      isClubAdmin: true,
      isAppAdmin: false,
    });
    await waitFor(() => expect(result.current.subfolders?.length).toBe(1));
    expect(fetchVaultSubfolders).toHaveBeenCalledWith(
      expect.objectContaining({
        view: clubView,
        isAppAdmin: false,
        isClubAdmin: true,
        isCoachOrTeamAdmin: false,
      }),
    );
  });

  it("coerces an undefined app-admin lookup to false only when calling the repository, not in the query identity", async () => {
    renderContentDataModel({ currentView: clubView, isAppAdmin: undefined });
    await waitFor(() => expect(fetchVaultSubfolders).toHaveBeenCalled());
    expect(fetchVaultSubfolders).toHaveBeenCalledWith(
      expect.objectContaining({ isAppAdmin: false }),
    );
  });

  it("does not fetch files while the trash view is showing", async () => {
    renderContentDataModel({ currentView: clubView, showTrash: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchVaultItems).not.toHaveBeenCalled();
  });

  it("classifies fetched vault_files rows into photos and files using the shared classifier", async () => {
    fetchVaultItems.mockResolvedValue([
      fileRow({ id: "photo-1", name: "team.jpg", file_type: "image/jpeg" }),
      fileRow({ id: "file-1", name: "notes.pdf", file_type: "application/pdf" }),
    ]);
    const { result } = renderContentDataModel({ currentView: clubView, isClubAdmin: true });
    await waitFor(() => expect(result.current.vaultItems?.length).toBe(2));
    expect(result.current.photos.map((p) => p.id)).toEqual(["photo-1"]);
    expect(result.current.files.map((f) => f.id)).toEqual(["file-1"]);
    expect(result.current.photos[0].image_url).toBe(result.current.photos[0].file_url);
    expect(result.current.photos[0].title).toBe("team.jpg");
  });
});

describe("useVaultContentDataModel — non-recursive search (active view)", () => {
  it("fuzzy-filters the active view's own folders/photos/files when the query is empty", async () => {
    fetchVaultSubfolders.mockResolvedValue([folderRow({ id: "f1", name: "Alpha" }), folderRow({ id: "f2", name: "Beta" })]);
    fetchVaultItems.mockResolvedValue([fileRow({ id: "photo-1", name: "beach.png", file_type: "image/png" })]);
    const { result } = renderContentDataModel({ currentView: clubView, isClubAdmin: true });
    await waitFor(() => expect(result.current.displaySubfolders.length).toBe(2));
    expect(result.current.displayPhotos.map((p) => p.id)).toEqual(["photo-1"]);
    expect(searchVaultContents).not.toHaveBeenCalled();
  });

  it("fuzzy-filters the active view's own folders/photos/files by an immediate (non-debounced) query", async () => {
    fetchVaultSubfolders.mockResolvedValue([folderRow({ id: "f1", name: "Alpha" }), folderRow({ id: "f2", name: "Beta" })]);
    const { result } = renderContentDataModel({
      currentView: clubView,
      isClubAdmin: true,
      vaultSearchQuery: "alp",
      debouncedVaultSearchQuery: "",
    });
    await waitFor(() => expect(result.current.subfolders?.length).toBe(2));
    await waitFor(() => expect(result.current.displaySubfolders.map((f) => f.id)).toEqual(["f1"]));
    expect(searchVaultContents).not.toHaveBeenCalled();
  });
});

describe("useVaultContentDataModel — recursive search", () => {
  it("does not enable recursive search at root, while trashed, or with an empty debounced query", async () => {
    const { result: atRoot } = renderContentDataModel({ currentView: rootView, debouncedVaultSearchQuery: "team" });
    expect(atRoot.current.recursiveEnabled).toBe(false);

    const { result: trashed } = renderContentDataModel({
      currentView: clubView,
      showTrash: true,
      debouncedVaultSearchQuery: "team",
    });
    expect(trashed.current.recursiveEnabled).toBe(false);

    const { result: empty } = renderContentDataModel({ currentView: clubView, debouncedVaultSearchQuery: "  " });
    expect(empty.current.recursiveEnabled).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(searchVaultContents).not.toHaveBeenCalled();
  });

  it("fetches the folder tree only for club or team scopes, not mini-league", async () => {
    renderContentDataModel({
      currentView: { type: "mini-league", clubId: "club-a", clubName: "Club A", miniLeagueId: "ml-1", miniLeagueName: "U10" },
      debouncedVaultSearchQuery: "cup",
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchVaultFolderTree).not.toHaveBeenCalled();

    renderContentDataModel({ currentView: teamView, debouncedVaultSearchQuery: "cup" });
    await waitFor(() => expect(fetchVaultFolderTree).toHaveBeenCalled());
  });

  it("waits for the folder tree to resolve before searching, then searches with it", async () => {
    let resolveTree!: (v: VaultFolderTree) => void;
    fetchVaultFolderTree.mockReturnValue(new Promise((resolve) => { resolveTree = resolve; }));
    const { result } = renderContentDataModel({ currentView: clubView, debouncedVaultSearchQuery: "cup" });
    expect(result.current.recursiveEnabled).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(searchVaultContents).not.toHaveBeenCalled();

    resolveTree(EMPTY_TREE);
    await waitFor(() => expect(searchVaultContents).toHaveBeenCalled());
    expect(searchVaultContents).toHaveBeenCalledWith(
      expect.objectContaining({ view: clubView, searchQuery: "cup", tree: EMPTY_TREE }),
    );
  });

  it("splits recursive file matches into photos/files with the same classifier as the active view", async () => {
    searchVaultContents.mockResolvedValue({
      folders: [{ ...folderRow({ id: "f1", name: "Cup Matches" }), folder_path: "Cup Matches" }],
      files: [
        { ...fileRow({ id: "photo-1", name: "cup.jpg", file_type: "image/jpeg" }), image_url: "u", uploader_id: "user-1", title: "cup.jpg", folder_path: "" },
        { ...fileRow({ id: "file-1", name: "cup-notes.pdf", file_type: "application/pdf" }), image_url: "u2", uploader_id: "user-1", title: "cup-notes.pdf", folder_path: "" },
      ],
    });
    const { result } = renderContentDataModel({ currentView: clubView, debouncedVaultSearchQuery: "cup" });
    await waitFor(() => expect(result.current.displaySubfolders.length).toBe(1));
    expect(result.current.displayPhotos.map((p: any) => p.id)).toEqual(["photo-1"]);
    expect(result.current.displayFiles.map((f: any) => f.id)).toEqual(["file-1"]);
  });

  it("reports isFetchingRecursive while the recursive search is in flight", async () => {
    let resolveSearch!: (v: { folders: unknown[]; files: unknown[] }) => void;
    searchVaultContents.mockReturnValue(new Promise((resolve) => { resolveSearch = resolve; }));
    const { result } = renderContentDataModel({ currentView: clubView, debouncedVaultSearchQuery: "cup" });
    await waitFor(() => expect(result.current.isFetchingRecursive).toBe(true));
    resolveSearch({ folders: [], files: [] });
    await waitFor(() => expect(result.current.isFetchingRecursive).toBe(false));
  });
});
