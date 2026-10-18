import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localUploadPreviews } from "@/components/media/localUploadPreviews";
import { useResolvedIcpBlobSrc } from "./useResolvedIcpBlobSrc";

vi.mock("@/live/targetRegistry", () => ({ getActiveIcpTarget: () => ({}) }));
vi.mock("@/live/mediaStorage", () => ({ listBlobStoreCanisterIds: () => ["photos-cai"] }));
const decrypt = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: { id: "member-1" }, sessionRestoration: "authenticated" }));
const authContext = vi.hoisted(() => ({ present: true }));
vi.mock("@/hooks/useAuth", () => ({ useOptionalAuth: () => authContext.present ? auth : null }));
vi.mock("@/live/mediaDecrypt", () => ({ resolveIcpBlobObjectUrl: decrypt }));

afterEach(() => {
  localUploadPreviews.clear();
  vi.clearAllMocks();
  auth.user = { id: "member-1" };
  auth.sessionRestoration = "authenticated";
  authContext.present = true;
  vi.useRealTimers();
});

describe("newly uploaded profile photo resolution", () => {
  it("renders public images without a sign-in provider", () => {
    authContext.present = false;
    const { result } = renderHook(() => useResolvedIcpBlobSrc("https://example.com/public.jpg"));
    expect(result.current).toEqual({ src: "https://example.com/public.jpg", pending: false, failed: false });
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("never exposes ciphertext or unlocks a protected image without a sign-in provider", () => {
    authContext.present = false;
    const { result } = renderHook(() => useResolvedIcpBlobSrc("https://photos-cai.raw.icp0.io/private.jpg"));
    expect(result.current).toEqual({ src: undefined, pending: false, failed: false });
    expect(decrypt).not.toHaveBeenCalled();
  });
  it("waits for sign-in restoration and loads immediately when it completes", async () => {
    auth.sessionRestoration = "restoring";
    decrypt.mockResolvedValueOnce("blob:ready-logo");
    const { result, rerender } = renderHook(() => useResolvedIcpBlobSrc("https://photos-cai.raw.icp0.io/clubs/restoring/logo.jpg"));
    expect(result.current.pending).toBe(true);
    expect(decrypt).not.toHaveBeenCalled();
    auth.sessionRestoration = "authenticated";
    rerender();
    await waitFor(() => expect(result.current.src).toBe("blob:ready-logo"));
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it("shares one unlock between the header and switcher", async () => {
    let finish: ((url: string) => void) | undefined;
    decrypt.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve; }));
    const url = "https://photos-cai.raw.icp0.io/clubs/shared/logo.jpg";
    const first = renderHook(() => useResolvedIcpBlobSrc(url));
    const second = renderHook(() => useResolvedIcpBlobSrc(url));
    await waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    await act(async () => { finish?.("blob:shared-logo"); });
    expect(first.result.current.src).toBe("blob:shared-logo");
    expect(second.result.current.src).toBe("blob:shared-logo");
  });

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
    vi.useFakeTimers();
    decrypt.mockRejectedValueOnce(new Error("Sign-in is still restoring"))
      .mockResolvedValueOnce("blob:restored-logo");
    const { result } = renderHook(() => useResolvedIcpBlobSrc("https://photos-cai.raw.icp0.io/clubs/cold/logo.jpg"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.failed).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(result.current.failed).toBe(false));
    expect(result.current).toEqual({ src: "blob:restored-logo", pending: false, failed: false });
    expect(decrypt).toHaveBeenCalledTimes(2);
  });
});