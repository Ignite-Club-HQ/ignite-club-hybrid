import { act, renderHook, waitFor } from "@testing-library/react";
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
  vi.useRealTimers();
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

  it("recovers a failed cold-refresh unlock after the cooldown without remounting", async () => {
    decrypt.mockRejectedValueOnce(new Error("Sign-in is still restoring"))
      .mockResolvedValueOnce("blob:restored-logo");
    const { result } = renderHook(() => useResolvedIcpBlobSrc("https://photos-cai.raw.icp0.io/clubs/cold/logo.jpg"));
    await waitFor(() => expect(result.current.failed).toBe(true));
    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(result.current).toEqual({ src: "blob:restored-logo", pending: false, failed: false });
    expect(decrypt).toHaveBeenCalledTimes(2);
  });
});