import type { PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteMediaPhoto, removePhotoFromCache, toastError } = vi.hoisted(() => ({
  deleteMediaPhoto: vi.fn(),
  removePhotoFromCache: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/mediaPhotoDeletion", () => ({ deleteMediaPhoto }));
vi.mock("@/lib/mediaCache", () => ({ removePhotoFromCache }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { local: true } }));

import { removePhotoFromMediaFeedCache, useMediaPhotoDeletion } from "./useMediaPhotoDeletion";

const queryKey = ["photos", "user-a", "scope-a"] as const;

function setup(onDeleteStarted = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue(undefined);
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useMediaPhotoDeletion({
    userId: "user-a", photosQueryKey: queryKey, onDeleteStarted,
  }), { wrapper });
  return { ...hook, queryClient, invalidate, onDeleteStarted };
}

describe("Media photo deletion orchestration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes a photo from every cached page without mutating unrelated state", () => {
    const cache = {
      pages: [
        { photos: [{ id: "photo-a" }, { id: "photo-b" }], nextCursor: 2 },
        { photos: [{ id: "photo-c" }, { id: "photo-a" }] },
      ],
      pageParams: [0, 2],
    };
    expect(removePhotoFromMediaFeedCache(cache, "photo-a")).toEqual({
      pages: [
        { photos: [{ id: "photo-b" }], nextCursor: 2 },
        { photos: [{ id: "photo-c" }] },
      ],
      pageParams: [0, 2],
    });
    expect(cache.pages[0].photos).toHaveLength(2);
  });

  it.each([
    [false, "feed_only"],
    [true, "feed_and_vault"],
  ] as const)("maps deleteFromVault=%s to %s", async (deleteFromVault, mode) => {
    deleteMediaPhoto.mockResolvedValue(undefined);
    const { result } = setup();
    act(() => result.current.deletePhoto({ photoId: "photo-a", deleteFromVault }));
    await waitFor(() => expect(deleteMediaPhoto).toHaveBeenCalledWith(
      { local: true },
      { photoId: "photo-a", mode, callerId: "user-a" },
    ));
  });

  it("optimistically removes, closes controls, then cleans local cache on success", async () => {
    deleteMediaPhoto.mockResolvedValue(undefined);
    const { result, queryClient, onDeleteStarted } = setup();
    queryClient.setQueryData(queryKey, { pages: [{ photos: [{ id: "photo-a" }, { id: "photo-b" }] }] });
    act(() => result.current.deletePhoto({ photoId: "photo-a", deleteFromVault: false }));
    await waitFor(() => expect(onDeleteStarted).toHaveBeenCalledOnce());
    expect(queryClient.getQueryData<any>(queryKey).pages[0].photos).toEqual([{ id: "photo-b" }]);
    await waitFor(() => expect(removePhotoFromCache).toHaveBeenCalledWith("photo-a"));
    await waitFor(() => expect(result.current.deletingPhotoId).toBeNull());
  });

  it("restores the exact previous cache and reports a backend failure", async () => {
    const failure = new Error("RLS denied");
    deleteMediaPhoto.mockRejectedValue(failure);
    const { result, queryClient, invalidate } = setup();
    const previous = { pages: [{ photos: [{ id: "photo-a" }] }], pageParams: [0] };
    queryClient.setQueryData(queryKey, previous);
    act(() => result.current.deletePhoto({ photoId: "photo-a", deleteFromVault: true }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("RLS denied"));
    expect(queryClient.getQueryData(queryKey)).toEqual(previous);
    expect(removePhotoFromCache).not.toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalledWith({ queryKey });
  });
});
