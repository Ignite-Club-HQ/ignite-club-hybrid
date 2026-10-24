import { describe, expect, it } from "vitest";
import { vaultDeletionCandidates } from "./vaultDeletionCandidates";
import { summarizeVaultDeletion } from "./vaultDeleteReporting";

describe("Vault deletion acknowledgements", () => {
  const items = [{ id: "image-a", type: "photo" as const, size: 120 }];
  it("matches an ICP image's actual file acknowledgement", () => {
    const summary = summarizeVaultDeletion(vaultDeletionCandidates(items, true), {
      photosDeleted: 0, filesDeleted: 1, succeeded: [{ id: "image-a", kind: "file" }], failed: [],
    });
    expect(summary.deletedCount).toBe(1);
    expect(summary.deletedIds).toEqual(["image-a"]);
  });
  it("preserves Supabase photo identifiers", () => {
    expect(vaultDeletionCandidates(items, false)).toEqual(items);
  });
});