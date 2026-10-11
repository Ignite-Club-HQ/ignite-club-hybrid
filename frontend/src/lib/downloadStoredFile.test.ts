import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveUrl = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ resolveSignedUrl: resolveUrl }));
import { downloadStoredFile } from "./downloadStoredFile";

beforeEach(() => {
  vi.restoreAllMocks();
  resolveUrl.mockReset();
});

describe("stored spreadsheet downloads", () => {
  it("downloads only unlocked bytes and gives the browser the original filename", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 3, 4, 0, 255]);
    const original = new Blob([bytes]);
    resolveUrl.mockResolvedValue("blob:http://localhost/unlocked");
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => original });
    vi.stubGlobal("fetch", fetchMock);
    const create = vi.fn().mockReturnValue("blob:http://localhost/download");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
    let savedName = "";
    let savedUrl = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      savedName = this.download;
      savedUrl = this.href;
    });
    await downloadStoredFile("https://store.raw.icp0.io/encrypted.xlsx", "Budget.xlsx");
    expect(fetchMock).toHaveBeenCalledWith("blob:http://localhost/unlocked");
    expect(create).toHaveBeenCalledWith(original);
    expect(savedName).toBe("Budget.xlsx");
    expect(savedUrl).toBe("blob:http://localhost/download");
  });

  it("does not download raw storage bytes when unlocking fails", async () => {
    resolveUrl.mockRejectedValue(new Error("denied"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadStoredFile("https://store.raw.icp0.io/encrypted.xlsx", "Budget.xlsx")).rejects.toThrow("denied");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});