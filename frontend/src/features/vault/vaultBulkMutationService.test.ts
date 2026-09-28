import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import {
  permanentlyDeleteVaultTrash,
  softDeleteVaultSelection,
} from "./vaultBulkMutationService";

type IgniteSupabaseClient = SupabaseClient<Database>;

function softDeleteClient(failingIds: string[] = []) {
  const writes: Array<{ payload: unknown; id?: string }> = [];
  const from = () => {
    const write: { payload: unknown; id?: string } = { payload: null };
    const query: Record<string, unknown> = {};
    query.update = (payload: unknown) => {
      write.payload = payload;
      writes.push(write);
      return query;
    };
    query.eq = (_column: string, value: string) => {
      write.id = value;
      return query;
    };
    query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({
        data: null,
        error: failingIds.includes(write.id ?? "") ? { message: `failed ${write.id}` } : null,
      }).then(resolve, reject);
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, writes };
}

function trashLookupClient(records: Record<string, string | null>) {
  const lookups: Array<{ url?: string }> = [];
  const from = () => {
    const lookup: { url?: string } = {};
    const query = {
      select: () => query,
      eq: (_column: string, value: string) => {
        lookup.url = value;
        lookups.push(lookup);
        return query;
      },
      maybeSingle: async () => ({
        data: lookup.url && records[lookup.url] ? { id: records[lookup.url] } : null,
        error: null,
      }),
    };
    return query;
  };
  return { client: { from } as unknown as IgniteSupabaseClient, lookups };
}

describe("bulk Vault soft deletion", () => {
  it("deletes photos before files and returns exact successful IDs", async () => {
    const fake = softDeleteClient();
    const result = await softDeleteVaultSelection({
      photoIds: ["photo-a", "photo-b"],
      fileIds: ["file-a"],
      deletedBy: "user-a",
    }, fake.client);

    expect(fake.writes.map((write) => write.id)).toEqual(["photo-a", "photo-b", "file-a"]);
    expect(fake.writes.every((write) =>
      typeof (write.payload as { deleted_at: unknown }).deleted_at === "string"
      && (write.payload as { deleted_by: unknown }).deleted_by === "user-a"
    )).toBe(true);
    expect(result).toEqual({
      deletedPhotoIds: ["photo-a", "photo-b"],
      deletedFileIds: ["file-a"],
      failed: [],
    });
  });

  it("continues after individual failures and reports their kind and original error", async () => {
    const fake = softDeleteClient(["photo-b", "file-a"]);
    const result = await softDeleteVaultSelection({
      photoIds: ["photo-a", "photo-b"],
      fileIds: ["file-a", "file-b"],
      deletedBy: undefined,
    }, fake.client);

    expect(fake.writes.map((write) => write.id)).toEqual(["photo-a", "photo-b", "file-a", "file-b"]);
    expect(result.deletedPhotoIds).toEqual(["photo-a"]);
    expect(result.deletedFileIds).toEqual(["file-b"]);
    expect(result.failed).toEqual([
      { id: "photo-b", kind: "photo", error: { message: "failed photo-b" } },
      { id: "file-a", kind: "file", error: { message: "failed file-a" } },
    ]);
  });

  it("performs no writes for an empty selection", async () => {
    const fake = softDeleteClient();
    await expect(softDeleteVaultSelection({
      photoIds: [], fileIds: [], deletedBy: "user-a",
    }, fake.client)).resolves.toEqual({
      deletedPhotoIds: [], deletedFileIds: [], failed: [],
    });
    expect(fake.writes).toEqual([]);
  });
});

describe("empty Vault trash preparation", () => {
  it("maps legacy photo rows and sends every Vault item exactly once", async () => {
    const fake = trashLookupClient({
      "https://files/a.jpg": "legacy-a",
      "https://files/b.jpg": "legacy-b",
    });
    const deleteItems = vi.fn().mockResolvedValue({ photosDeleted: 2, filesDeleted: 3, succeeded: [], failed: [] });

    const result = await permanentlyDeleteVaultTrash({
      photos: [
        { id: "vault-photo-a", file_url: "https://files/a.jpg" },
        { id: "vault-photo-b", file_url: "https://files/b.jpg" },
      ],
      files: [{ id: "vault-file-a" }],
    }, fake.client, deleteItems);

    expect(fake.lookups).toEqual([
      { url: "https://files/a.jpg" },
      { url: "https://files/b.jpg" },
    ]);
    expect(deleteItems).toHaveBeenCalledWith({
      photoIds: ["legacy-a", "legacy-b"],
      fileIds: ["vault-photo-a", "vault-photo-b", "vault-file-a"],
    });
    expect(result).toEqual({
      photosDeleted: 2,
      filesDeleted: 3,
      requested: [
        { id: "legacy-a", kind: "photo" },
        { id: "legacy-b", kind: "photo" },
        { id: "vault-photo-a", kind: "file" },
        { id: "vault-photo-b", kind: "file" },
        { id: "vault-file-a", kind: "file" },
      ],
      succeeded: [],
      failed: [],
    });
  });

  it("skips missing URLs and absent mirrors without omitting Vault rows", async () => {
    const fake = trashLookupClient({ "https://files/missing.jpg": null });
    const deleteItems = vi.fn().mockResolvedValue({
      photosDeleted: 0,
      filesDeleted: 2,
      succeeded: [],
      failed: [],
    });

    await permanentlyDeleteVaultTrash({
      photos: [
        { id: "vault-photo-a", file_url: null },
        { id: "vault-photo-b", file_url: "https://files/missing.jpg" },
      ],
      files: [],
    }, fake.client, deleteItems);

    expect(fake.lookups).toEqual([{ url: "https://files/missing.jpg" }]);
    expect(deleteItems).toHaveBeenCalledWith({
      photoIds: [],
      fileIds: ["vault-photo-a", "vault-photo-b"],
    });
  });

  it("returns partial failures unchanged for truthful page-level reporting", async () => {
    const fake = trashLookupClient({});
    const outcome = {
      photosDeleted: 0,
      filesDeleted: 1,
      succeeded: [{ id: "vault-file-a", kind: "file" as const }],
      failed: [{ id: "vault-file-b", kind: "file" as const, code: "denied" }],
    };
    const deleteItems = vi.fn().mockResolvedValue(outcome);

    await expect(permanentlyDeleteVaultTrash({
      photos: [],
      files: [{ id: "vault-file-a" }, { id: "vault-file-b" }],
    }, fake.client, deleteItems)).resolves.toEqual({
      ...outcome,
      requested: [
        { id: "vault-file-a", kind: "file" },
        { id: "vault-file-b", kind: "file" },
      ],
    });
  });
});
