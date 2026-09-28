import { describe, expect, it } from "vitest";
import { runZipExport, summarizeZipExport, type ZipExportItem } from "./vaultZipExport";
import {
  summarizeVaultDeletion,
  buildVaultDeleteMessage,
} from "./vaultDeleteReporting";

const blob = (s: string) => new Blob([s]);

const items = (): ZipExportItem[] => [
  { id: "p1", kind: "photo", url: "u/p1", filename: "p1.jpg" },
  { id: "p2", kind: "photo", url: "u/p2", filename: "p2.jpg" },
  { id: "f1", kind: "file", url: "u/f1", filename: "f1.pdf" },
];

function harness(opts: { fail?: string[]; abortAfter?: number; abortBefore?: boolean } = {}) {
  const added: string[] = [];
  const progress: number[] = [];
  let calls = 0;
  let aborted = Boolean(opts.abortBefore);
  return {
    added,
    progress,
    get calls() {
      return calls;
    },
    deps: {
      isAborted: () => aborted,
      fetchBlob: async (url: string) => {
        calls++;
        if (opts.fail?.some((f) => url.endsWith(f))) throw new Error("network");
        if (opts.abortAfter && calls >= opts.abortAfter) aborted = true;
        return blob(url);
      },
      addToZip: (filename: string) => added.push(filename),
      onProgress: (n: number) => progress.push(n),
    },
  };
}

describe("folder ZIP export", () => {
  it("all items succeed", async () => {
    const h = harness();
    const r = await runZipExport(items(), h.deps);
    expect(r).toMatchObject({ processed: 3, added: 3, failedPhotos: 0, failedFiles: 0, cancelled: false });
    expect(summarizeZipExport(r)).toEqual({
      outcome: "success",
      message: "Exported 3 items as ZIP",
      shouldDownload: true,
    });
  });

  it("processes photos before files", async () => {
    const h = harness();
    await runZipExport(
      [
        { id: "f1", kind: "file", url: "u/f1", filename: "f1.pdf" },
        { id: "p1", kind: "photo", url: "u/p1", filename: "p1.jpg" },
      ],
      h.deps,
    );
    expect(h.added).toEqual(["p1.jpg", "f1.pdf"]);
  });

  it("one photo fails but later files still succeed", async () => {
    const h = harness({ fail: ["p1"] });
    const r = await runZipExport(items(), h.deps);
    expect(r).toMatchObject({ processed: 3, added: 2, failedPhotos: 1, failedFiles: 0 });
    expect(h.added).toEqual(["p2.jpg", "f1.pdf"]);
    expect(summarizeZipExport(r)).toEqual({
      outcome: "partial",
      message: "Exported 2 items as ZIP, 1 failed",
      shouldDownload: true,
    });
  });

  it("one file fails but other items succeed", async () => {
    const h = harness({ fail: ["f1"] });
    const r = await runZipExport(items(), h.deps);
    expect(r).toMatchObject({ added: 2, failedPhotos: 0, failedFiles: 1 });
    expect(summarizeZipExport(r).outcome).toBe("partial");
  });

  it("every download fails — no empty ZIP", async () => {
    const h = harness({ fail: ["p1", "p2", "f1"] });
    const r = await runZipExport(items(), h.deps);
    expect(r.added).toBe(0);
    expect(h.added).toEqual([]);
    expect(summarizeZipExport(r)).toEqual({
      outcome: "failure",
      message: "No files could be added to ZIP",
      shouldDownload: false,
    });
  });

  it("cancellation before the first request performs zero fetches", async () => {
    const h = harness({ abortBefore: true });
    const r = await runZipExport(items(), h.deps);
    expect(h.calls).toBe(0);
    expect(r).toMatchObject({ processed: 0, added: 0, cancelled: true });
    expect(summarizeZipExport(r)).toEqual({
      outcome: "cancelled",
      message: "Export cancelled",
      shouldDownload: false,
    });
  });

  it("cancellation during a request stops immediately and adds nothing further", async () => {
    const h = harness({ abortAfter: 1 });
    const r = await runZipExport(items(), h.deps);
    expect(h.calls).toBe(1);
    expect(r.cancelled).toBe(true);
    expect(r.added).toBe(0);
    expect(summarizeZipExport(r).shouldDownload).toBe(false);
  });

  it("cancellation after some successful items still reports cancelled and no ZIP", async () => {
    let calls = 0;
    let aborted = false;
    const added: string[] = [];
    const r = await runZipExport(items(), {
      isAborted: () => aborted,
      fetchBlob: async (url) => {
        calls++;
        return blob(url);
      },
      addToZip: (f) => {
        added.push(f);
        if (added.length === 2) aborted = true;
      },
      isAbortedAfter: undefined,
    } as any);
    expect(calls).toBe(2);
    expect(added).toEqual(["p1.jpg", "p2.jpg"]);
    expect(r).toMatchObject({ added: 2, cancelled: true });
    expect(summarizeZipExport(r)).toEqual({
      outcome: "cancelled",
      message: "Export cancelled",
      shouldDownload: false,
    });
  });

  it("progress counts processed items while the success count counts added items", async () => {
    const h = harness({ fail: ["p2"] });
    const r = await runZipExport(items(), h.deps);
    expect(h.progress).toEqual([1, 2, 3]);
    expect(r.added).toBe(2);
    expect(summarizeZipExport(r).message).toContain("Exported 2 items");
  });
});

describe("large-file deletion reporting", () => {
  const selected = [
    { id: "p1", type: "photo" as const, size: 100 },
    { id: "p2", type: "photo" as const, size: 200 },
    { id: "f1", type: "file" as const, size: 400 },
  ];
  const ok = (id: string, kind: "photo" | "file") => ({ id, kind });
  const fmt = (b: number) => `${b}B`;

  it("all selected items explicitly succeed", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 2,
      filesDeleted: 1,
      succeeded: [ok("p1", "photo"), ok("p2", "photo"), ok("f1", "file")],
      failed: [],
    });
    expect(s).toMatchObject({ deletedCount: 3, failedCount: 0, freedBytes: 700 });
    expect(buildVaultDeleteMessage(s, fmt)).toEqual({
      outcome: "success",
      message: "Deleted 3 file(s), freed 700B",
    });
  });

  it("partial success with explicit successful and failed IDs", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo")],
      failed: [
        { id: "p2", kind: "photo", code: "storage_delete_failed" },
        { id: "f1", kind: "file", code: "metadata_delete_failed" },
      ],
    });
    expect(s.deletedIds).toEqual(["p1"]);
    expect(s.freedBytes).toBe(100);
    expect(s.failedCount).toBe(2);
    expect(buildVaultDeleteMessage(s, fmt)).toEqual({
      outcome: "partial",
      message: "Deleted 1 file(s), freed 100B; 2 failed",
    });
  });

  it("all items fail", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 0,
      filesDeleted: 0,
      succeeded: [],
      failed: selected.map((i) => ({ id: i.id, kind: i.type, code: "unexpected_error" })),
    });
    expect(s).toMatchObject({ deletedCount: 0, freedBytes: 0, failedCount: 3 });
    expect(buildVaultDeleteMessage(s, fmt)).toEqual({
      outcome: "failure",
      message: "No files were deleted; 3 failed",
    });
  });

  it("missing succeeded[] entries are never inferred from aggregate counts", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 2,
      filesDeleted: 1,
      succeeded: [],
      failed: [],
    });
    expect(s.deletedCount).toBe(0);
    expect(s.failedCount).toBe(3);
    expect(buildVaultDeleteMessage(s, fmt).outcome).toBe("failure");
  });

  it("duplicate succeeded entries cannot inflate counts", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo"), ok("p1", "photo"), ok("p1", "photo")],
      failed: [],
    });
    expect(s.deletedIds).toEqual(["p1"]);
    expect(s.deletedCount).toBe(1);
    expect(s.freedBytes).toBe(100);
  });

  it("unknown successful ID never counts as deleted", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 2,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo"), ok("ghost", "photo")],
      failed: [],
    });
    expect(s.deletedIds).toEqual(["p1"]);
    expect(s.deletedCount).toBe(1);
  });

  it("unknown failed ID does not cause a selected item to count as deleted", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo")],
      failed: [{ id: "ghost-id", kind: "photo", code: "unexpected_error" }],
    });
    expect(s.deletedIds).toEqual(["p1"]);
    expect(s.failedIds).toContain("ghost-id");
    expect(s.deletedCount).toBe(1);
  });

  it("an ID in both succeeded and failed is treated as failed", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo")],
      failed: [{ id: "p1", kind: "photo", code: "storage_delete_failed" }],
    });
    expect(s.deletedCount).toBe(0);
    expect(s.failedIds).toContain("p1");
  });

  it("a kind mismatch does not count as success", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 0,
      filesDeleted: 1,
      succeeded: [ok("p1", "file")],
      failed: [],
    });
    expect(s.deletedCount).toBe(0);
  });

  it("aggregate counts larger than validated successes do not inflate", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 9,
      filesDeleted: 9,
      succeeded: [ok("p1", "photo")],
      failed: [],
    });
    expect(s.deletedCount).toBe(1);
    expect(s.freedBytes).toBe(100);
  });

  it("aggregate counts smaller than validated successes cap the credit", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("p1", "photo"), ok("p2", "photo")],
      failed: [],
    });
    expect(s.deletedCount).toBe(1);
    expect(s.freedBytes).toBe(100);
    expect(buildVaultDeleteMessage(s, fmt).outcome).toBe("partial");
  });

  it("a photo and a file sharing the same string ID stay distinct", () => {
    const shared = [
      { id: "same", type: "photo" as const, size: 10 },
      { id: "same", type: "file" as const, size: 20 },
    ];
    const s = summarizeVaultDeletion(shared, {
      photosDeleted: 1,
      filesDeleted: 0,
      succeeded: [ok("same", "photo")],
      failed: [{ id: "same", kind: "file", code: "storage_delete_failed" }],
    });
    expect(s.deletedCount).toBe(1);
    expect(s.freedBytes).toBe(10);
  });

  it("empty selection performs no mutation and reports nothing deleted", () => {
    const s = summarizeVaultDeletion([], {
      photosDeleted: 0,
      filesDeleted: 0,
      succeeded: [],
      failed: [],
    });
    expect(s).toMatchObject({ deletedCount: 0, failedCount: 0, freedBytes: 0, deletedIds: [] });
  });

  it("only validated successes are removed from selection; failed stay selected", () => {
    const s = summarizeVaultDeletion(selected, {
      photosDeleted: 1,
      filesDeleted: 1,
      succeeded: [ok("p1", "photo"), ok("f1", "file")],
      failed: [{ id: "p2", kind: "photo", code: "storage_delete_failed" }],
    });
    const selection = new Set(["p1", "p2", "f1"]);
    const deleted = new Set(s.deletedIds);
    expect([...selection].filter((id) => !deleted.has(id))).toEqual(["p2"]);
  });

  it("shows exactly one outcome per operation (no contradictory toasts)", () => {
    const outcomes = [
      summarizeVaultDeletion(selected, {
        photosDeleted: 2,
        filesDeleted: 1,
        succeeded: [ok("p1", "photo"), ok("p2", "photo"), ok("f1", "file")],
        failed: [],
      }),
      summarizeVaultDeletion(selected, {
        photosDeleted: 1,
        filesDeleted: 0,
        succeeded: [ok("p1", "photo")],
        failed: [{ id: "p2", kind: "photo", code: "x" }, { id: "f1", kind: "file", code: "x" }],
      }),
    ].map((s) => buildVaultDeleteMessage(s, fmt));
    expect(outcomes.map((o) => o.outcome)).toEqual(["success", "partial"]);
    expect(new Set(outcomes.map((o) => o.message)).size).toBe(2);
  });
});

