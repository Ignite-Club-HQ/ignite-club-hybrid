import { describe, expect, it, vi } from "vitest";
import { invalidateVaultCache, vaultKeys } from "./vaultQueryKeys";

describe("vaultKeys", () => {
  it("preserves prefix keys used for broad invalidation", () => {
    expect(vaultKeys.files()).toEqual(["vault-files"]);
    expect(vaultKeys.subfolders()).toEqual(["vault-subfolders"]);
    expect(vaultKeys.trash()).toEqual(["vault-trash"]);
    expect(vaultKeys.storageBreakdown()).toEqual(["storage-breakdown"]);
    expect(vaultKeys.clubFreeUsage()).toEqual(["club-free-usage"]);
  });

  it("builds the exact view key used by optimistic item removal", () => {
    const view = { type: "team", clubId: "club-1", teamId: "team-1", teamName: "U10 Blue" } as const;
    expect(vaultKeys.filesForView(view, false, true)).toEqual([
      "vault-files",
      view,
      false,
      true,
    ]);
  });

  it("retains every role and scope dimension in shared read keys", () => {
    const view = { type: "club", clubId: "club-1", clubName: "Synthetic Club" } as const;
    expect(vaultKeys.subfoldersForView(view, true, false, false, "club_admin,coach")).toEqual([
      "vault-subfolders", view, true, false, false, "club_admin,coach",
    ]);
    expect(vaultKeys.clubTeamsForAccess("club-1", false, ["team-1"], true)).toEqual([
      "vault-club-teams", "club-1", false, ["team-1"], true,
    ]);
    expect(vaultKeys.trashForClub("club-1")).toEqual(["vault-trash", "club-1"]);
  });
});


describe("invalidateVaultCache", () => {
  it("invalidates only the requested broad Vault scopes", () => {
    const invalidateQueries = vi.fn();

    invalidateVaultCache({ invalidateQueries }, ["files", "trash", "storageBreakdown"]);

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(invalidateQueries).toHaveBeenNthCalledWith(1, { queryKey: ["vault-files"] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(2, { queryKey: ["vault-trash"] });
    expect(invalidateQueries).toHaveBeenNthCalledWith(3, { queryKey: ["storage-breakdown"] });
  });
});
