import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { softDeleteVaultSelection } from "./vaultBulkMutationService";

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
