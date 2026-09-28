import { describe, expect, it } from "vitest";
import {
  CURRENT_VAULT_EXPORT_FOLDER,
  excludeVaultExportFolders,
  resolveSelectedVaultExportItems,
  selectAllVaultExportItems,
  summarizeVaultExport,
  toggleVaultExportSelection,
} from "./vaultExportSelection";

describe("Vault export selection", () => {
  it("adds and removes an item without mutating the existing selection", () => {
    const original = new Set(["photo-1"]);
    const added = toggleVaultExportSelection(original, "photo-2");
    const removed = toggleVaultExportSelection(added, "photo-1");

    expect(original).toEqual(new Set(["photo-1"]));
    expect(added).toEqual(new Set(["photo-1", "photo-2"]));
    expect(removed).toEqual(new Set(["photo-2"]));
    expect(added).not.toBe(original);
  });

  it("selects every current item exactly once", () => {
    expect(selectAllVaultExportItems([
      { id: "file-1" },
      { id: "file-2" },
      { id: "file-1" },
    ])).toEqual(new Set(["file-1", "file-2"]));
  });

  it("resolves selected photos and files independently in display order", () => {
    const result = resolveSelectedVaultExportItems(
      [{ id: "photo-1" }, { id: "photo-2" }],
      [{ id: "file-1" }, { id: "file-2" }],
      new Set(["photo-2", "file-1"]),
      new Set(["file-1"]),
    );

    expect(result.photos.map(({ id }) => id)).toEqual(["photo-2"]);
    expect(result.files.map(({ id }) => id)).toEqual(["file-1"]);
  });

  it("excludes both photo and file items in an explicitly excluded folder", () => {
    const result = excludeVaultExportFolders(
      [{ id: "root-photo", path: "" }, { id: "nested-photo", path: "Coaches" }],
      [{ id: "nested-file", path: "Coaches" }, { id: "other-file", path: "Teams" }],
      new Set(["Coaches"]),
    );

    expect(result.photos.map(({ id }) => id)).toEqual(["root-photo"]);
    expect(result.files.map(({ id }) => id)).toEqual(["other-file"]);
  });

  it("treats absent, null and empty paths as the current folder", () => {
    const result = excludeVaultExportFolders(
      [{ id: "missing" }, { id: "null", path: null }],
      [{ id: "empty", path: "" }, { id: "nested", path: "Nested" }],
      new Set([CURRENT_VAULT_EXPORT_FOLDER]),
    );

    expect(result.photos).toEqual([]);
    expect(result.files.map(({ id }) => id)).toEqual(["nested"]);
  });

  it("reports selected counts while selection mode is active", () => {
    expect(summarizeVaultExport(
      true,
      [{ id: "photo-1" }, { id: "photo-2" }],
      [{ id: "file-1" }],
      new Set(["photo-2"]),
      new Set(["file-1", "stale-file-id"]),
    )).toEqual({ photoCount: 1, fileCount: 2, isSelection: true });
  });

  it("reports current-view counts when selection mode is inactive", () => {
    expect(summarizeVaultExport(
      false,
      [{ id: "photo-1" }, { id: "photo-2" }],
      [{ id: "file-1" }],
      new Set(["photo-2"]),
      new Set(["file-1"]),
    )).toEqual({ photoCount: 2, fileCount: 1, isSelection: false });
  });
});
