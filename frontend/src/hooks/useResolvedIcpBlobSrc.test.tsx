import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localUploadPreviews } from "@/components/media/localUploadPreviews";
import { useResolvedIcpBlobSrc } from "./useResolvedIcpBlobSrc";

vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock("@/live/mediaStorage", () => ({ listBlobStoreCanisterIds: () => ["photos-cai"] }));
const decrypt = vi.hoisted(() => vi.fn());
vi.mock("@/live/mediaDecrypt", () => ({ resolveIcpBlobObjectUrl: decrypt }));

afterEach(() => {
  localUploadPreviews.clear();
  vi.clearAllMocks();
});

describe("newly uploaded profile photo resolution", () => {
  it("uses the local uploaded bytes without downloading or decrypting again", () => {
    const uploaded = "https://photos-cai.raw.icp0.io/avatars/new.jpg";
    localUploadPreviews.set(uploaded, "blob:local-photo");
    const { result } = renderHook(() => useResolvedIcpBlobSrc(uploaded));
    expect(result.current).toEqual({ src: "blob:local-photo", pending: false, failed: false });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("keeps ordinary image addresses unchanged", () => {
    const { result } = renderHook(() => useResolvedIcpBlobSrc("https://example.com/avatar.jpg"));
    expect(result.current.src).toBe("https://example.com/avatar.jpg");
    expect(decrypt).not.toHaveBeenCalled();
  });
});