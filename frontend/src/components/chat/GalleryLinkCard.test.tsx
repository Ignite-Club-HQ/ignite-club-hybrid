import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ getCard: vi.fn(), getTeam: vi.fn(), dispatch: vi.fn(), resolveImage: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "paul" }, sessionRestoration: "authenticated" }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (feature: string, providers: any, scope: any) => {
  mocks.dispatch(feature, scope); return providers.icp({ scope });
} }));
vi.mock("@/live/features/media", () => ({ getLiveGalleryChatCard: mocks.getCard }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: mocks.getTeam }));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: () => null }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ resolveSignedUrl: mocks.resolveImage }));
vi.mock("@/hooks/useResolvedIcpBlobSrc", () => ({ isIcpBlobUrl: (url: string) => url.includes("icp0.io") }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw Error("Supabase forbidden"); } } }));
import { GalleryLinkCard } from "./GalleryLinkCard";

function openCard(pathname = "/messages/club/g2-test") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[pathname]}>
    <GalleryLinkCard cardId="gallery-card-u9" />
  </MemoryRouter></QueryClientProvider>;
  const rendered = render(element());
  return { client, ...rendered, refresh: () => rendered.rerender(element()) };
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.getTeam.mockReturnValue(new Promise(() => {}));
  mocks.resolveImage.mockResolvedValue("blob:gallery-photo");
  mocks.getCard.mockResolvedValue({ id: "gallery-card-u9", club_id: "g2-test", team_id: "u9", hero_image_url: ["https://store.icp0.io/clubs/g2-test/image"],
    photo_count: 1, event_id: [], is_prompt: false, created_at_ms: 1n }); });
describe("Group 2 gallery announcement reads", () => {
  it("replaces stalled cold team discovery once the open team's club is resolved", async () => {
    mocks.getCard.mockReturnValueOnce(new Promise(() => {}));
    const { client, unmount, refresh } = openCard("/messages/u9");
    await waitFor(() => expect(mocks.dispatch.mock.calls[0]).toEqual(["media", { teamId: "u9" }]));
    await act(async () => {
      client.setQueryData(["team", "u9"], { id: "u9", club_id: "g2-test" });
      refresh();
    });
    await screen.findByRole("button", { name: /View Gallery/ });
    expect(mocks.dispatch.mock.calls[1]).toEqual(["media", { clubId: "g2-test" }]);
    expect(mocks.getCard).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });
  it("ends a stalled metadata read with retry instead of an endless blank card", async () => {
    vi.useFakeTimers();
    mocks.getCard.mockReturnValue(new Promise(() => {}));
    const { client, unmount } = openCard();
    try {
      // 45s deadline, one quiet retry after 2s, then a second 45s deadline.
      await act(async () => { await vi.advanceTimersByTimeAsync(45_001 + 2_000 + 45_001); });
      expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
      expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    } finally { unmount(); client.clear(); vi.useRealTimers(); }
  });
  it("retries an unlock failure independently without rereading the gallery card", async () => {
    mocks.resolveImage.mockRejectedValueOnce(Error("Unlock refused"));
    const { client, unmount } = openCard();
    await screen.findByRole("button", { name: "Try photo again" });
    fireEvent.click(screen.getByRole("button", { name: "Try photo again" }));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toBe("blob:gallery-photo"));
    fireEvent.load(document.querySelector('img') as HTMLImageElement);
    expect(mocks.resolveImage).toHaveBeenCalledTimes(2);
    expect(mocks.getCard).toHaveBeenCalledTimes(1);
    expect(document.querySelector('img[src*="icp0.io"]')).toBeNull();
    unmount(); client.clear();
  });
  it("reads once in the open club and displays the card without waiting for team enrichment", async () => {
    const { client, unmount } = openCard();
    await screen.findByRole("button", { name: /View Gallery/ });
    expect(mocks.dispatch.mock.calls[0]).toEqual(["media", { clubId: "g2-test" }]);
    expect(mocks.getCard).toHaveBeenCalledTimes(1);
    expect(document.querySelector('img[src*="icp0.io"]')).toBeNull();
    unmount(); client.clear();
  });
  it("discovers a cross-club card only after confirmed absence in the current club", async () => {
    mocks.getCard.mockResolvedValueOnce(null);
    const { client, unmount } = openCard();
    await screen.findByRole("button", { name: /View Gallery/ });
    expect(mocks.dispatch.mock.calls.slice(0, 2)).toEqual([["media", { clubId: "g2-test" }], ["media", { galleryCardId: "gallery-card-u9" }]]);
    unmount(); client.clear();
  });
  it("retains a refused read as a retryable error rather than missing content or discovery", async () => {
    mocks.getCard.mockRejectedValue(new Error("Access denied"));
    const { client, unmount } = openCard();
    await screen.findByRole("button", { name: "Try again" }, { timeout: 5_000 });
    await waitFor(() => expect(mocks.getCard).toHaveBeenCalledTimes(2));
    expect(mocks.dispatch).toHaveBeenCalledTimes(2);
    unmount(); client.clear();
  });
  it("shows a removed card as no longer available instead of an error", async () => {
    mocks.getCard.mockRejectedValue(new Error("galleryCard not found or not authorized"));
    const { client, unmount } = openCard();
    await screen.findByText("This photo update is no longer available.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    unmount(); client.clear();
  });
});
