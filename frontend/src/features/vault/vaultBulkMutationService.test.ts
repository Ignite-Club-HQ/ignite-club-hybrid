import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/integrations/supabase/types";
import { softDeleteVaultSelection } from "./vaultBulkMutationService";

const bulkMocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  trashFile: vi.fn(),
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: {}, target: { alias: "test" } };

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    bulkMocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/vault", () => ({
  trashLiveVaultFile: (...args: unknown[]) => bulkMocks.trashFile(...args),
}));

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
  beforeEach(() => {
    bulkMocks.backend = process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase";
    bulkMocks.trashFile.mockReset().mockResolvedValue(undefined);
  });

  it.runIf(supabaseMode)("deletes photos before files and returns exact successful IDs", async () => {
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

  it.runIf(supabaseMode)("continues after individual failures and reports their kind and original error", async () => {
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

  it.runIf(!supabaseMode)("trashes every selected ICP file without Supabase updates", async () => {
    const fake = softDeleteClient();
    await expect(softDeleteVaultSelection({
      photoIds: ["photo-a"],
      fileIds: ["file-a"],
      deletedBy: "principal-a",
    }, fake.client)).resolves.toEqual({
      deletedPhotoIds: ["photo-a"],
      deletedFileIds: ["file-a"],
      failed: [],
    });
    expect(bulkMocks.trashFile).toHaveBeenNthCalledWith(1, icpContext, "photo-a");
    expect(bulkMocks.trashFile).toHaveBeenNthCalledWith(2, icpContext, "file-a");
    expect(fake.writes).toEqual([]);
  });

  it.runIf(!supabaseMode)("preserves photo-before-file order and reports exact successful ICP IDs", async () => {
    const fake = softDeleteClient();
    await expect(softDeleteVaultSelection({
      photoIds: ["photo-a", "photo-b"],
      fileIds: ["file-a"],
      deletedBy: "principal-a",
    }, fake.client)).resolves.toEqual({
      deletedPhotoIds: ["photo-a", "photo-b"],
      deletedFileIds: ["file-a"],
      failed: [],
    });

    expect(bulkMocks.trashFile.mock.calls.map((call) => call[1])).toEqual([
      "photo-a",
      "photo-b",
      "file-a",
    ]);
    expect(fake.writes).toEqual([]);
  });

  it.runIf(!supabaseMode)("continues after ICP failures and reports their kind and original error", async () => {
    const photoError = new Error("failed photo-b");
    const fileError = new Error("failed file-a");
    bulkMocks.trashFile.mockImplementation(async (_ctx: unknown, id: string) => {
      if (id === "photo-b") throw photoError;
      if (id === "file-a") throw fileError;
    });
    const fake = softDeleteClient();

    const result = await softDeleteVaultSelection({
      photoIds: ["photo-a", "photo-b"],
      fileIds: ["file-a", "file-b"],
      deletedBy: undefined,
    }, fake.client);

    expect(bulkMocks.trashFile.mock.calls.map((call) => call[1])).toEqual([
      "photo-a",
      "photo-b",
      "file-a",
      "file-b",
    ]);
    expect(result.deletedPhotoIds).toEqual(["photo-a"]);
    expect(result.deletedFileIds).toEqual(["file-b"]);
    expect(result.failed).toEqual([
      { id: "photo-b", kind: "photo", error: photoError },
      { id: "file-a", kind: "file", error: fileError },
    ]);
    expect(fake.writes).toEqual([]);
  });
});
