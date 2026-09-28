import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishImage, unpublishPhoto, usageChanged, toastSuccess, toastError } = vi.hoisted(() => ({
  publishImage: vi.fn(), unpublishPhoto: vi.fn(), usageChanged: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn(),
}));
vi.mock("@/lib/publishChatImageToGallery", () => ({ publishChatImageToGallery: publishImage, unpublishGalleryPhoto: unpublishPhoto }));
vi.mock("@/hooks/useClubFreeUsage", () => ({ notifyClubFreeUsageChanged: usageChanged }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));
vi.mock("@/lib/galleryPublishNudge", () => ({ shouldShowGalleryNudge: vi.fn(), markGalleryNudgeShown: vi.fn() }));

import { usePublishChatImage } from "./usePublishChatImage";

describe("usePublishChatImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishImage.mockResolvedValue({ photoId: "photo-1", alreadyPublished: false });
    unpublishPhoto.mockResolvedValue(undefined);
  });

  it("allows publishing only with an uploader and team destination", () => {
    expect(renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" })).result.current.canPublish).toBe(true);
    expect(renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: null, clubId: "club-1" })).result.current.canPublish).toBe(false);
    expect(renderHook(() => usePublishChatImage({ uploaderId: undefined, teamId: "team-1", clubId: "club-1" })).result.current.canPublish).toBe(false);
  });

  it("does not invoke publishing when the chat is ineligible", async () => {
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: null, clubId: "club-1" }));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(publishImage).not.toHaveBeenCalled();
  });

  it("passes exact uploader/team/club scope and records successful publication", async () => {
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" }));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(publishImage).toHaveBeenCalledWith({
      imageUrl: "https://example.invalid/a.jpg", uploaderId: "user-1", teamId: "team-1", clubId: "club-1",
    });
    expect(result.current.publishedIds.has("message-1")).toBe(true);
    expect(result.current.publishingIds.has("message-1")).toBe(false);
    expect(usageChanged).toHaveBeenCalledWith("club-1");
  });

  it("suppresses duplicate requests while publishing and after completion", async () => {
    let resolve!: (value: unknown) => void;
    publishImage.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" }));
    let first!: Promise<void>;
    act(() => { first = result.current.publish("message-1", "https://example.invalid/a.jpg"); });
    await waitFor(() => expect(result.current.publishingIds.has("message-1")).toBe(true));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(publishImage).toHaveBeenCalledOnce();
    resolve({ photoId: "photo-1", alreadyPublished: false });
    await act(async () => first);
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(publishImage).toHaveBeenCalledOnce();
  });

  it("does not increment usage for an already-published image", async () => {
    publishImage.mockResolvedValue({ photoId: "photo-1", alreadyPublished: true });
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" }));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(usageChanged).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("Already in the media gallery");
  });

  it("clears in-flight state and reports failure without marking publication", async () => {
    publishImage.mockRejectedValue(new Error("RLS denied"));
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" }));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    expect(result.current.publishingIds.has("message-1")).toBe(false);
    expect(result.current.publishedIds.has("message-1")).toBe(false);
    expect(toastError).toHaveBeenCalledWith("RLS denied");
  });

  it("undo removes the exact photo and clears the corresponding message state", async () => {
    const { result } = renderHook(() => usePublishChatImage({ uploaderId: "user-1", teamId: "team-1", clubId: "club-1" }));
    await act(async () => result.current.publish("message-1", "https://example.invalid/a.jpg"));
    const options = toastSuccess.mock.calls.find(([message]) => message === "Added to media gallery")![1];
    await act(async () => options.action.onClick());
    await waitFor(() => expect(unpublishPhoto).toHaveBeenCalledWith("photo-1"));
    expect(result.current.publishedIds.has("message-1")).toBe(false);
    expect(usageChanged).toHaveBeenLastCalledWith("club-1");
  });
});
