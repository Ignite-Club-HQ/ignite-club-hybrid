import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Hoisted mocks ---
const capacitorMock = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
}));
const filesystemMock = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  writeFile: vi.fn(async (_options: { path: string; data: string; directory?: unknown; recursive?: boolean }) => ({ uri: "file:///cache/written" })),
  stat: vi.fn(async () => ({ size: 1234 })),
  getUri: vi.fn(async () => ({ uri: "file:///cache/x" })),
}));
const fileOpenerMock = vi.hoisted(() => ({ open: vi.fn() }));
const shareMock = vi.hoisted(() => ({ share: vi.fn() }));
const fetchMock = vi.hoisted(() => vi.fn());
const safeOpenUrlMock = vi.hoisted(() => vi.fn(async () => {}));
const resolveSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorMock.isNativePlatform(),
  },
}));
vi.mock("@capacitor/filesystem", () => ({
  Filesystem: filesystemMock,
  Directory: { Cache: "CACHE" },
}));
vi.mock("@capacitor-community/file-opener", () => ({
  FileOpener: fileOpenerMock,
}));
vi.mock("@capacitor/share", () => ({ Share: shareMock }));
vi.mock("./safeOpenUrl", () => ({ safeOpenUrl: safeOpenUrlMock }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({
  resolveSignedUrl: resolveSignedUrlMock,
}));
// The production code loads @capacitor-community/file-opener through a
// `new Function(...)`-based dynamic import (see loadOptionalNativeModule.ts)
// so bundlers never try to resolve it statically. Vitest's module sandbox
// can't satisfy that pattern at all (throws "A dynamic import callback was
// not specified"), so route it through the mockable seam instead.
vi.mock("./loadOptionalNativeModule", () => ({
  loadOptionalNativeModule: vi.fn(async (specifier: string) => {
    if (specifier === "@capacitor-community/file-opener") {
      return { FileOpener: fileOpenerMock };
    }
    throw new Error(`Unexpected optional native module in test: ${specifier}`);
  }),
}));

import { safeOpenFile } from "./safeOpenFile";

const RAW_PRIVATE =
  "https://reference.invalid/storage/v1/object/public/photos/private-doc.pdf";
const SIGNED =
  "https://reference.invalid/storage/v1/object/sign/photos/private-doc.pdf?token=abc";

beforeEach(() => {
  vi.clearAllMocks();
  capacitorMock.isNativePlatform.mockReturnValue(true);
  filesystemMock.downloadFile.mockResolvedValue({ path: "file:///cache/x" });
  filesystemMock.writeFile.mockResolvedValue({ uri: "file:///cache/written" });
  filesystemMock.stat.mockResolvedValue({ size: 1234 });
  fileOpenerMock.open.mockResolvedValue(undefined);
  shareMock.share.mockRejectedValue(new Error("Share not available"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // jsdom FileReader works on real Blobs; keep it.
});

function okResponse(type = "application/pdf") {
  const blob = new Blob(["%PDF-1.4 test"], { type });
  return {
    ok: true,
    status: 200,
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? type : null) },
    blob: async () => blob,
  } as unknown as Response;
}

describe("safeOpenFile — private URL fail-closed", () => {
  it("must not download or expose a raw private URL when signing fails", async () => {
    resolveSignedUrlMock.mockRejectedValueOnce(new Error("Unable to create signed URL"));

    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toThrow();

    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(fileOpenerMock.open).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();

    // Any thrown error must not leak the raw URL, tokens, or query params.
    try {
      await safeOpenFile(RAW_PRIVATE);
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).not.toContain(RAW_PRIVATE);
      expect(msg).not.toContain("token");
      expect(msg).not.toContain("secret.pdf");
    }
  });

  it("signing failure triggers no native download or file opener", async () => {
    resolveSignedUrlMock.mockRejectedValue(new Error("signing failed"));
    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toBeTruthy();
    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(fileOpenerMock.open).not.toHaveBeenCalled();
  });

  it("signing failure never sends the raw private URL to safeOpenUrl", async () => {
    resolveSignedUrlMock.mockRejectedValue(new Error("signing failed"));
    await expect(safeOpenFile(RAW_PRIVATE)).rejects.toBeTruthy();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    "/storage/v1/object/public/photos/a.pdf",
    "/storage/v1/object/sign/photos/a.pdf",
    "/storage/v1/object/authenticated/photos/a.pdf",
    "/storage/v1/render/image/public/photos/a.png",
    "/storage/v1/render/image/sign/photos/a.png",
  ])("every supported private storage URL form fails closed when signing fails: %s", async (path) => {
    resolveSignedUrlMock.mockRejectedValue(new Error("nope"));
    const url = `https://reference.invalid${path}`;
    await expect(safeOpenFile(url)).rejects.toBeTruthy();
    expect(filesystemMock.downloadFile).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });
});

describe("safeOpenFile — successful signing", () => {
  it("downloads and opens using the signed URL, never the raw URL", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    await safeOpenFile(RAW_PRIVATE);

    expect(filesystemMock.downloadFile).toHaveBeenCalledTimes(1);
    const arg = filesystemMock.downloadFile.mock.calls[0][0];
    expect(arg.url).toBe(SIGNED);
    expect(fileOpenerMock.open).toHaveBeenCalledTimes(1);
  });

  it("retries generically when the viewer rejects the content type", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValueOnce(new Error("bad content type"));

    await safeOpenFile(RAW_PRIVATE);

    expect(fileOpenerMock.open).toHaveBeenCalledTimes(2);
    expect(fileOpenerMock.open.mock.calls[1][0].contentType).toBe("application/octet-stream");
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("only falls back to the browser with the signed URL when viewer AND share both fail", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValue(new Error("no viewer"));
    shareMock.share.mockRejectedValue(new Error("no share"));

    await safeOpenFile(RAW_PRIVATE);

    expect(shareMock.share).toHaveBeenCalledTimes(1);
    expect(safeOpenUrlMock).toHaveBeenCalledTimes(1);
    expect(safeOpenUrlMock).toHaveBeenCalledWith(SIGNED);
    expect(safeOpenUrlMock).not.toHaveBeenCalledWith(RAW_PRIVATE);
  });

  it("offers the share sheet (real file name) instead of the browser when no viewer accepts the file", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValue(new Error("no viewer"));
    shareMock.share.mockResolvedValue({ activityType: "x" });

    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf" });

    expect(shareMock.share).toHaveBeenCalledTimes(1);
    expect(shareMock.share.mock.calls[0][0].title).toBe("Club_policy.pdf");
    expect(shareMock.share.mock.calls[0][0].files[0]).toBe("file:///cache/x");
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("treats a dismissed share sheet as handled (no browser tab)", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    fileOpenerMock.open.mockRejectedValue(new Error("no viewer"));
    shareMock.share.mockRejectedValue(new Error("Share canceled"));

    await safeOpenFile(RAW_PRIVATE);

    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("passes a bare extension file_type through the MIME guesser", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf", mimeType: "pdf" });
    expect(fileOpenerMock.open.mock.calls[0][0].contentType).toBe("application/pdf");
  });

  it("keeps the real file name as the last path segment so the viewer title is the document name", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf" });
    const path: string = filesystemMock.downloadFile.mock.calls[0][0].path;
    expect(path.endsWith("/Club_policy.pdf")).toBe(true);
    expect(path).not.toContain("secret.pdf");
  });
});

describe("safeOpenFile — download resilience (native)", () => {
  it("falls back to fetch + writeFile when Filesystem.downloadFile throws, then opens the viewer", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    filesystemMock.downloadFile.mockRejectedValue(new Error("downloadFile not implemented"));
    fetchMock.mockResolvedValue(okResponse("application/pdf"));

    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf" });

    expect(fetchMock).toHaveBeenCalledWith(SIGNED);
    expect(filesystemMock.writeFile).toHaveBeenCalledTimes(1);
    expect(filesystemMock.writeFile.mock.calls[0][0].path.endsWith("/Club_policy.pdf")).toBe(true);
    expect(fileOpenerMock.open).toHaveBeenCalledTimes(1);
    expect(fileOpenerMock.open.mock.calls[0][0].filePath).toBe("file:///cache/written");
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("re-downloads via fetch when the native downloader leaves an empty file", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    filesystemMock.stat.mockResolvedValue({ size: 0 });
    fetchMock.mockResolvedValue(okResponse("application/pdf"));

    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(filesystemMock.writeFile).toHaveBeenCalledTimes(1);
    expect(safeOpenUrlMock).not.toHaveBeenCalled();
  });

  it("uses the server content type when the record has no usable MIME", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    filesystemMock.downloadFile.mockRejectedValue(new Error("nope"));
    fetchMock.mockResolvedValue(okResponse("application/msword"));

    await safeOpenFile(RAW_PRIVATE, { fileName: "letter" });

    expect(fileOpenerMock.open.mock.calls[0][0].contentType).toBe("application/msword");
  });

  it("retries with a flat cache path when the nested write fails", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    filesystemMock.downloadFile.mockRejectedValue(new Error("nope"));
    fetchMock.mockResolvedValue(okResponse());
    filesystemMock.writeFile
      .mockRejectedValueOnce(new Error("ENOENT nested"))
      .mockResolvedValueOnce({ uri: "file:///cache/flat" });

    await safeOpenFile(RAW_PRIVATE, { fileName: "Club policy.pdf" });

    expect(filesystemMock.writeFile).toHaveBeenCalledTimes(2);
    expect(filesystemMock.writeFile.mock.calls[1][0].path).not.toContain("/");
    expect(filesystemMock.writeFile.mock.calls[1][0].path.endsWith("-Club_policy.pdf")).toBe(true);
    expect(fileOpenerMock.open.mock.calls[0][0].filePath).toBe("file:///cache/flat");
  });

  it("only opens the browser when no local copy could be produced at all", async () => {
    resolveSignedUrlMock.mockResolvedValue(SIGNED);
    filesystemMock.downloadFile.mockRejectedValue(new Error("nope"));
    fetchMock.mockResolvedValue({ ok: false, status: 403 } as unknown as Response);

    await safeOpenFile(RAW_PRIVATE);

    expect(fileOpenerMock.open).not.toHaveBeenCalled();
    expect(shareMock.share).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).toHaveBeenCalledWith(SIGNED);
  });

});

describe("safeOpenFile — external / public non-storage URLs", () => {
  it("does not call the signer for external URLs and retains browser fallback", async () => {
    const externalUrl = "https://reference.invalid";
    filesystemMock.downloadFile.mockRejectedValueOnce(new Error("download failed"));
    fetchMock.mockRejectedValue(new Error("network"));

    await safeOpenFile(externalUrl);

    expect(resolveSignedUrlMock).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).toHaveBeenCalledWith(externalUrl);
  });

  it("does not call the signer for external URLs on web", async () => {
    capacitorMock.isNativePlatform.mockReturnValue(false);
    const externalUrl = "https://reference.invalid";
    await safeOpenFile(externalUrl);
    expect(resolveSignedUrlMock).not.toHaveBeenCalled();
    expect(safeOpenUrlMock).toHaveBeenCalledWith(externalUrl);
  });
});
