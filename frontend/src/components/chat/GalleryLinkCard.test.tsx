import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const mocks = vi.hoisted(() => ({ getCard: vi.fn(), getTeam: vi.fn(), dispatch: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "paul" }, sessionRestoration: "authenticated" }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (feature: string, providers: any, scope: any) => {
  mocks.dispatch(feature, scope); return providers.icp({ scope });
} }));
vi.mock("@/live/features/media", () => ({ getLiveGalleryChatCard: mocks.getCard }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: mocks.getTeam }));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: () => null }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({ useSignedPhotoUrl: () => ({ signedUrl: null }) }));
vi.mock("@/hooks/useResolvedIcpBlobSrc", () => ({ isIcpBlobUrl: (url: string) => url.includes("icp0.io") }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw Error("Supabase forbidden"); } } }));
import { GalleryLinkCard } from "./GalleryLinkCard";

function openCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/messages/club/g2-test"]}>
    <GalleryLinkCard cardId="gallery-card-u9" />
  </MemoryRouter></QueryClientProvider>);
  return { client, ...rendered };
}
beforeEach(() => { cleanup(); vi.clearAllMocks(); mocks.getTeam.mockReturnValue(new Promise(() => {}));
  mocks.getCard.mockResolvedValue({ id: "gallery-card-u9", club_id: "g2-test", team_id: "u9", hero_image_url: ["https://store.icp0.io/clubs/g2-test/image"],
    photo_count: 1, event_id: [], is_prompt: false, created_at_ms: 1n }); });
describe("Group 2 gallery announcement reads", () => {
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
    await screen.findByRole("button", { name: "Try again" });
    await waitFor(() => expect(mocks.getCard).toHaveBeenCalledTimes(1));
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    unmount(); client.clear();
  });
});