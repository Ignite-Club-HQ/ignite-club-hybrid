import { describe, expect, it } from "vitest";
import {
  buildVaultLargeFileItems,
  prepareVaultLargeFileDeletion,
  sortVaultLargeFileItems,
  type VaultLargeFileItem,
} from "./vaultLargeFileManagement";

const items: VaultLargeFileItem[] = [
  { id: "small-file", type: "file", name: "Small", size: 10, url: "/small", teamName: "Blue", createdAt: "2026-01-01" },
  { id: "large-photo", type: "photo", name: "Large", size: 100, url: "/large", teamName: "Club-level", createdAt: "2026-03-01" },
  { id: "medium-file", type: "file", name: "Medium", size: 50, url: "/medium", teamName: "Blue", createdAt: "2026-02-01" },
];

describe("Vault large-file management", () => {
  it("maps photos and files, labels their scope and retains the largest items", () => {
    const result = buildVaultLargeFileItems(
      [{ id: "team-1", name: "Blue" }],
      [
        { id: "p1", file_url: "/p1", file_size: 100, team_id: null, title: null, created_at: "2026-01-01" },
        { id: "p2", file_url: "/p2", file_size: 20, team_id: "team-1", title: "Training", created_at: "2026-01-02" },
      ],
      [{ id: "f1", file_url: "/f1", file_size: 50, team_id: "team-1", name: null, created_at: "2026-01-03" }],
      2,
    );

    expect(result).toEqual([
      { id: "p1", type: "photo", name: "Photo", size: 100, url: "/p1", teamName: "Club-level", createdAt: "2026-01-01" },
      { id: "f1", type: "file", name: "File", size: 50, url: "/f1", teamName: "Blue", createdAt: "2026-01-03" },
    ]);
  });

  it("sorts by size without mutating the source collection", () => {
    const source = [...items];
    expect(sortVaultLargeFileItems(source, "size").map(({ id }) => id)).toEqual([
      "large-photo", "medium-file", "small-file",
    ]);
    expect(source).toEqual(items);
  });

  it("sorts newest first by date", () => {
    expect(sortVaultLargeFileItems(items, "date").map(({ id }) => id)).toEqual([
      "large-photo", "medium-file", "small-file",
    ]);
  });

  it("sorts files before photos using the established type ordering", () => {
    expect(sortVaultLargeFileItems(items, "type").map(({ type }) => type)).toEqual([
      "file", "file", "photo",
    ]);
  });

  it("prepares exact photo/file IDs and selected bytes in display order", () => {
    expect(prepareVaultLargeFileDeletion(
      items,
      new Set(["large-photo", "small-file", "missing"]),
    )).toEqual({
      items: [items[0], items[1]],
      photoIds: ["large-photo"],
      fileIds: ["small-file"],
      selectedBytes: 110,
    });
  });

  it("returns an empty deletion request when no visible IDs are selected", () => {
    expect(prepareVaultLargeFileDeletion(items, new Set(["stale-id"]))).toEqual({
      items: [], photoIds: [], fileIds: [], selectedBytes: 0,
    });
  });
});
