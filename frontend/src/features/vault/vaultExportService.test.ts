import { describe, expect, it, vi } from "vitest";
import {
  buildVaultZip,
  VAULT_EXPORT_CANCELLED_MESSAGE,
} from "./vaultExportService";

const response = (value: string) => ({ blob: vi.fn().mockResolvedValue(new Blob([value])) });

function makeZip() {
  const blob = new Blob(["zip"]);
  return {
    file: vi.fn(),
    generateAsync: vi.fn().mockResolvedValue(blob),
    blob,
  };
}

describe("Vault ZIP export service", () => {
  it("downloads photos before files and preserves nested paths", async () => {
    const zip = makeZip();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response("photo"))
      .mockResolvedValueOnce(response("file"));
    const progress = vi.fn();

    const result = await buildVaultZip({
      photos: [{ id: "p1", file_url: "/photo", title: "team.jpg", path: "Season/Photos" }],
      files: [{ id: "f1", file_url: "/file", name: "rules.pdf", path: "Season" }],
      signal: new AbortController().signal,
      fetcher,
      zipFactory: () => zip,
      onProgress: progress,
    });

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/photo", "/file"]);
    expect(zip.file.mock.calls.map(([path]) => path)).toEqual([
      "Season/Photos/team.jpg",
      "Season/rules.pdf",
    ]);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
    expect(result).toEqual({ blob: zip.blob, successfulCount: 2, failures: [] });
  });

  it("uses the established fallback photo filename and root path", async () => {
    const zip = makeZip();
    await buildVaultZip({
      photos: [{ id: "p1", file_url: "/photo" }],
      files: [],
      signal: new AbortController().signal,
      fetcher: vi.fn().mockResolvedValue(response("photo")),
      zipFactory: () => zip,
    });
    expect(zip.file.mock.calls[0][0]).toBe("photo-p1.jpg");
  });

  it("continues after an individual failure and reports the partial result truthfully", async () => {
    const zip = makeZip();
    const failure = new Error("unavailable");
    const onItemFailure = vi.fn();
    const result = await buildVaultZip({
      photos: [{ id: "p1", file_url: "/bad", title: "bad.jpg" }],
      files: [{ id: "f1", file_url: "/good", name: "good.pdf" }],
      signal: new AbortController().signal,
      fetcher: vi.fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce(response("good")),
      zipFactory: () => zip,
      onItemFailure,
    });

    expect(result.successfulCount).toBe(1);
    expect(result.failures).toEqual([{ id: "p1", type: "photo", error: failure }]);
    expect(onItemFailure).toHaveBeenCalledWith(result.failures[0]);
    expect(zip.generateAsync).toHaveBeenCalledOnce();
  });

  it("does not generate an empty ZIP when every download fails", async () => {
    const zip = makeZip();
    const result = await buildVaultZip({
      photos: [{ id: "p1", file_url: "/bad" }],
      files: [],
      signal: new AbortController().signal,
      fetcher: vi.fn().mockRejectedValue(new Error("unavailable")),
      zipFactory: () => zip,
    });
    expect(result.blob).toBeNull();
    expect(result.successfulCount).toBe(0);
    expect(zip.generateAsync).not.toHaveBeenCalled();
  });

  it("stops before the first fetch when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    await expect(buildVaultZip({
      photos: [{ id: "p1", file_url: "/photo" }],
      files: [],
      signal: controller.signal,
      fetcher,
    })).rejects.toThrow(VAULT_EXPORT_CANCELLED_MESSAGE);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("converts an abort during download into the stable cancellation contract", async () => {
    const abortError = Object.assign(new Error("request aborted"), { name: "AbortError" });
    await expect(buildVaultZip({
      photos: [{ id: "p1", file_url: "/photo" }],
      files: [{ id: "f1", file_url: "/file", name: "file.pdf" }],
      signal: new AbortController().signal,
      fetcher: vi.fn().mockRejectedValue(abortError),
    })).rejects.toThrow(VAULT_EXPORT_CANCELLED_MESSAGE);
  });
});
