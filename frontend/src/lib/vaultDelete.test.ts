import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: any[]) => invoke(...args) } },
}));

import { permanentlyDeleteVaultItems, VAULT_DELETE_CHUNK } from "@/lib/vaultDelete";

beforeEach(() => invoke.mockReset());

const ok = (body: any) => ({ data: body, error: null });

describe("permanentlyDeleteVaultItems", () => {
  it("returns explicit succeeded[] and failed[] entries", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 0,
        succeeded: [{ id: "p1", kind: "photo" }],
        failed: [{ id: "f1", kind: "file", code: "storage_delete_failed" }],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1"], fileIds: ["f1"] });
    expect(r.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(r.failed).toEqual([{ id: "f1", kind: "file", code: "storage_delete_failed" }]);
  });

  it("deduplicates requested IDs and sends the intended deletion type", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 1,
        succeeded: [
          { id: "photo-1", kind: "photo" },
          { id: "file-1", kind: "file" },
        ],
        failed: [],
      }),
    );

    await permanentlyDeleteVaultItems({
      photoIds: ["photo-1", "photo-1"],
      fileIds: ["file-1", "file-1"],
      deletionType: "empty_trash",
    });

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("permanent-delete-photos", {
      body: {
        photoIds: ["photo-1"],
        fileIds: ["file-1"],
        deletionType: "empty_trash",
      },
    });
  });

  it("sends every requested ID exactly once and accumulates results across batches", async () => {
    const photoIds = Array.from({ length: VAULT_DELETE_CHUNK + 20 }, (_, i) => `p${i}`);
    invoke.mockImplementation((...args: any[]) => {
      const ids: string[] = args[1]?.body?.photoIds ?? [];
      return Promise.resolve(
        ok({
          photosDeleted: ids.length,
          filesDeleted: 0,
          succeeded: ids.map((id) => ({ id, kind: "photo" })),
          failed: [],
        }),
      );
    });
    const r = await permanentlyDeleteVaultItems({ photoIds });
    expect(invoke).toHaveBeenCalledTimes(2);
    const sent = invoke.mock.calls.flatMap((c: any[]) => c[1]?.body?.photoIds ?? []);
    expect(sent).toEqual(photoIds);
    expect(new Set(sent).size).toBe(photoIds.length);
    expect(r.succeeded).toHaveLength(photoIds.length);
  });

  it("never exceeds the batch bound and sends mixed requested IDs exactly once", async () => {
    const photoIds = Array.from({ length: 75 }, (_, index) => `photo-${index}`);
    const fileIds = Array.from({ length: 137 }, (_, index) => `file-${index}`);
    invoke.mockResolvedValue(ok({ photosDeleted: 0, filesDeleted: 0, succeeded: [], failed: [] }));

    await permanentlyDeleteVaultItems({ photoIds, fileIds });
    expect(invoke).toHaveBeenCalledTimes(3);
    const bodies = invoke.mock.calls.map((call: any[]) => call[1].body);
    expect(
      bodies.every((body: any) => body.photoIds.length + body.fileIds.length <= VAULT_DELETE_CHUNK),
    ).toBe(true);
    expect(bodies.flatMap((body: any) => body.photoIds)).toEqual(photoIds);
    expect(bodies.flatMap((body: any) => body.fileIds)).toEqual(fileIds);
  });

  it("accumulates explicit successes, counts and failures across batches", async () => {
    invoke
      .mockResolvedValueOnce(
        ok({
          photosDeleted: 60,
          filesDeleted: 40,
          succeeded: [
            ...Array.from({ length: 60 }, (_, i) => ({ id: `photo-${i}`, kind: "photo" })),
            ...Array.from({ length: 40 }, (_, i) => ({ id: `file-${i}`, kind: "file" })),
          ],
          failed: [],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          photosDeleted: 0,
          filesDeleted: 19,
          succeeded: Array.from({ length: 19 }, (_, i) => ({
            id: `file-${40 + i}`,
            kind: "file",
          })),
          failed: [
            { id: "file-59", kind: "file", code: "denied" },
            { id: "file-60", kind: "file", code: "missing" },
          ],
        }),
      );

    const r = await permanentlyDeleteVaultItems({
      photoIds: Array.from({ length: 60 }, (_, i) => `photo-${i}`),
      fileIds: Array.from({ length: 61 }, (_, i) => `file-${i}`),
    });
    expect(r.photosDeleted).toBe(60);
    expect(r.filesDeleted).toBe(59);
    expect(r.succeeded).toHaveLength(119);
    expect(r.failed).toEqual([
      { id: "file-59", kind: "file", code: "denied" },
      { id: "file-60", kind: "file", code: "missing" },
    ]);
  });

  it("deduplicates duplicate server entries by kind+id", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 3,
        filesDeleted: 0,
        succeeded: [
          { id: "p1", kind: "photo" },
          { id: "p1", kind: "photo" },
        ],
        failed: [
          { id: "p2", kind: "photo", code: "x" },
          { id: "p2", kind: "photo", code: "x" },
        ],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(r.succeeded).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
  });

  it("keeps photo and file identifiers with the same string ID distinct", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 1,
        succeeded: [
          { id: "same", kind: "photo" },
          { id: "same", kind: "file" },
        ],
        failed: [],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["same"], fileIds: ["same"] });
    expect(r.succeeded).toEqual([
      { id: "same", kind: "photo" },
      { id: "same", kind: "file" },
    ]);
  });

  it("a failed invocation stops the operation instead of claiming later batches succeeded", async () => {
    const photoIds = Array.from({ length: VAULT_DELETE_CHUNK + 5 }, (_, i) => `p${i}`);
    invoke
      .mockResolvedValueOnce(ok({ photosDeleted: 0, filesDeleted: 0, succeeded: [], failed: [] }))
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(permanentlyDeleteVaultItems({ photoIds })).rejects.toThrow("boom");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("performs no invocation for an empty selection", async () => {
    const r = await permanentlyDeleteVaultItems({});
    expect(invoke).not.toHaveBeenCalled();
    expect(r).toEqual({ photosDeleted: 0, filesDeleted: 0, succeeded: [], failed: [] });
  });

  it("ignores malformed result entries", async () => {
    invoke.mockResolvedValue(
      ok({
        photosDeleted: 1,
        filesDeleted: 0,
        succeeded: [{ id: 42, kind: "photo" }, { id: "p1", kind: "sticker" }, { id: "p1", kind: "photo" }],
        failed: [{ id: "p2", kind: "photo" }],
      }),
    );
    const r = await permanentlyDeleteVaultItems({ photoIds: ["p1", "p2"] });
    expect(r.succeeded).toEqual([{ id: "p1", kind: "photo" }]);
    expect(r.failed).toEqual([{ id: "p2", kind: "photo", code: "unknown_error" }]);
  });
});
