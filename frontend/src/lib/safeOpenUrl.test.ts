import { describe, expect, it, vi } from "vitest";
const openFile = vi.hoisted(() => vi.fn());
const parseBlob = vi.hoisted(() => vi.fn());
vi.mock("./safeOpenFile", () => ({ safeOpenFile: openFile }));
vi.mock("@/live/mediaDecrypt", () => ({ parseIcpBlobUrl: parseBlob }));
vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
import { safeOpenUrl } from "./safeOpenUrl";

describe("encrypted URLs", () => {
  it("delegates stored spreadsheets to the decrypting file opener, not the browser", async () => {
    parseBlob.mockReturnValue({ path: "budget.xlsx", canisterId: "store" });
    openFile.mockResolvedValue(undefined);
    const browser = vi.spyOn(window, "open").mockImplementation(() => null);
    await safeOpenUrl("https://store.raw.icp0.io/budget.xlsx");
    expect(openFile).toHaveBeenCalledWith("https://store.raw.icp0.io/budget.xlsx");
    expect(browser).not.toHaveBeenCalled();
    browser.mockRestore();
  });
});