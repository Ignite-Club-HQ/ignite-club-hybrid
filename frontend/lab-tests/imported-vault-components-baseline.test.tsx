import { expect, test } from "vitest";
import {
  canRenameVaultValue,
  getVaultExportState,
  getVaultMutationState,
  getVaultSelectedBytes,
  getVaultSelectedCount,
  getVaultStorageTone,
} from "../src/lab/componentCandidatePolicies";

test("preserves storage threshold colors and compact counts", () => {
  expect(getVaultStorageTone(69)).toBe("primary");
  expect(getVaultStorageTone(70)).toBe("warning");
  expect(getVaultStorageTone(89)).toBe("warning");
  expect(getVaultStorageTone(90)).toBe("destructive");
  expect(getVaultSelectedCount(2, 1)).toBe(3);
});

test("preserves folder and recursive export selection boundaries", () => {
  expect(getVaultExportState(2, 1)).toEqual({
    selectedCount: 3,
    canExport: true,
    confirmationLabel: "Export 3 Items as ZIP",
  });
  expect(getVaultExportState(0, 0)).toEqual({
    selectedCount: 0,
    canExport: false,
    confirmationLabel: "Export 0 Items as ZIP",
  });
  expect(getVaultSelectedBytes([
    { id: "small", size: 10 },
    { id: "large", size: 100 },
  ], new Set(["small", "large"]))).toBe(110);
  expect(getVaultSelectedBytes([
    { id: "small", size: 10 },
    { id: "large", size: 100 },
  ], new Set(["large"]))).toBe(100);
});

test("preserves rename validation and mutation confirmation safety", () => {
  expect(canRenameVaultValue("Updated.pdf")).toBe(true);
  expect(canRenameVaultValue("   ")).toBe(false);
  expect(getVaultMutationState({
    kind: "photo",
    permanent: false,
  })).toMatchObject({
    title: "Move Photo to Trash",
    confirmLabel: "Move to Trash",
    destructive: false,
    canConfirm: true,
  });
  expect(getVaultMutationState({
    kind: "file",
    permanent: true,
  })).toMatchObject({
    title: "Permanently Delete File",
    confirmLabel: "Delete Permanently",
    destructive: true,
  });
  expect(getVaultMutationState({
    kind: "folder",
    selectedCount: 1,
  })).toEqual({
    title: "Delete 1 selected item?",
    confirmLabel: "Delete 1 Item",
    destructive: true,
    canConfirm: true,
  });
  expect(getVaultMutationState({
    kind: "folder",
    selectedCount: 3,
    deletingSelected: true,
  }).canConfirm).toBe(false);
});
