import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryConfigs: [] as any[],
  queryData: new Map<string, unknown>(),
  sponsorTrackView: vi.fn(),
  sponsorTrackClick: vi.fn(),
  adTrackView: vi.fn(),
  adTrackClick: vi.fn(),
  safeOpenUrl: vi.fn(),
  openAdLink: vi.fn(),
  writeStripHint: vi.fn(),
  writeHomeSponsorHint: vi.fn(),
}));

vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    keepPreviousData: actual.keepPreviousData,
    useQuery: (config: any) => {
      mocks.queryConfigs.push(config);
      return {
        data: mocks.queryData.get(config.queryKey?.[0]),
        isSuccess: true,
        isLoading: false,
        isFetching: false,
      };
    },
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "user-1" }, initialized: true }) }));
vi.mock("@/hooks/useSponsorAnalytics", () => ({
  useSponsorAnalytics: () => ({
    trackView: mocks.sponsorTrackView,
    trackClick: mocks.sponsorTrackClick,
  }),
}));
vi.mock("@/hooks/useAdAnalytics", () => ({
  useAdAnalytics: () => ({
    trackView: mocks.adTrackView,
    trackClick: mocks.adTrackClick,
  }),
}));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: mocks.safeOpenUrl }));
vi.mock("@/lib/adLinkNavigation", () => ({ openAdLink: mocks.openAdLink }));
vi.mock("@/lib/stripContentHint", () => ({
  readStripHint: () => true,
  readAnyStripHint: () => true,
  writeStripHint: mocks.writeStripHint,
}));
vi.mock("@/lib/homeSponsorHint", () => ({ writeHomeSponsorHint: mocks.writeHomeSponsorHint }));
vi.mock("@/lib/adTierHint", () => ({
  readAdTierHint: () => null,
  writeAdTierHint: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("embla-carousel-react", () => ({ default: () => [vi.fn(), undefined] }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  AvatarImage: (props: any) => <img {...props} />,
  AvatarFallback: ({ children, ...props }: any) => <span {...props}>{children}</span>,
}));
vi.mock("@/components/PrimarySponsorDisplay", () => ({
  PrimarySponsorDisplay: ({ sponsorId, context, entityName }: any) => (
    <div data-testid={`primary-sponsor-${context}`}>
      {sponsorId}:{entityName}
    </div>
  ),
}));
vi.mock("@/components/AdMobBannerZone", () => ({ AdMobBannerZone: () => <div>Native banner</div> }));
vi.mock("@/components/AppAdCarousel", () => ({ AppAdCarousel: () => <div>App ads</div> }));

import { ClubSponsorSection } from "./ClubSponsorSection";
import { MessagesSponsorCarousel } from "./MessagesSponsorCarousel";
import { MultiClubSponsorCarousel } from "./MultiClubSponsorCarousel";
import { SponsorOrAdCarousel } from "./SponsorOrAdCarousel";
import { ChatThreadSponsorStrip } from "./chat/ChatThreadSponsorStrip";
import { EventsHeaderSponsorStrip } from "./events/EventsHeaderSponsorStrip";
import { MediaHeaderSponsorStrip } from "./media/MediaHeaderSponsorStrip";

const sponsor = {
  id: "sponsor-1",
  name: "Acme Sports",
  logo_url: null,
  website_url: "https://acme.invalid",
  tier: "gold" as const,
};
const carouselItem = {
  id: "club-1-sponsor-1",
  sponsorId: sponsor.id,
  entityName: "Riverside",
};

function seed(...entries: Array<[string, unknown]>) {
  mocks.queryData = new Map(entries);
}

function queryKeys() {
  return mocks.queryConfigs.map(config => config.queryKey);
}

describe("sponsor presentation characterization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryConfigs = [];
    seed();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps event, media, and chat compact strips independently gated while preserving tracking contexts and placement", () => {
    seed(
      ["events-header-strip-resolve", { clubId: "club-1" }],
      ["club-is-pro", true],
      ["events-header-sponsors", [sponsor]],
      ["media-header-sponsors-enabled", { media_header_sponsors_enabled: true }],
      ["media-header-sponsors", [sponsor]],
      ["club-chat-thread-ads-enabled", { chat_thread_ads_enabled: true }],
      ["app-ad-settings", { is_enabled: true }],
      ["chat-thread-strip-sponsors", [sponsor]],
    );

    const { unmount: unmountEvents } = render(<EventsHeaderSponsorStrip activeClubFilter="club-1" />);
    fireEvent.click(screen.getByRole("button", { name: /acme sports/i }));
    expect(mocks.sponsorTrackClick).toHaveBeenLastCalledWith("sponsor-1", "event_page");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss club sponsor" }));
    expect(screen.queryByText("Acme Sports")).not.toBeInTheDocument();
    unmountEvents();

    render(<MediaHeaderSponsorStrip clubId="club-1" />);
    fireEvent.click(screen.getByRole("button", { name: /acme sports/i }));
    expect(mocks.sponsorTrackClick).toHaveBeenLastCalledWith("sponsor-1", "messages_page");
    cleanup();

    const { container } = render(<ChatThreadSponsorStrip clubId="club-1" />);
    fireEvent.click(screen.getByRole("button", { name: /acme sports/i }));
    expect(mocks.sponsorTrackClick).toHaveBeenLastCalledWith("sponsor-1", "messages_page");
    expect(container.querySelector(".border-b")).toBeInTheDocument();
    expect(queryKeys()).toEqual(expect.arrayContaining([
      ["events-header-strip-resolve", "club-1", "user-1"],
      ["media-header-sponsors-enabled", "club-1"],
      ["club-chat-thread-ads-enabled", "club-1"],
    ]));
  });

  it("preserves the distinct full-carousel scopes, contexts, and placement spacing", () => {
    seed(
      ["club-section-sponsors", [carouselItem]],
      ["messages-all-sponsors", [carouselItem]],
      ["user-all-sponsors", [carouselItem]],
    );

    const club = render(<ClubSponsorSection clubId="club-1" />);
    expect(screen.getByTestId("primary-sponsor-home_page")).toHaveTextContent("sponsor-1:Riverside");
    expect(club.container.querySelector("section")).toHaveClass("space-y-3");
    expect(mocks.writeHomeSponsorHint).toHaveBeenCalledWith("user-1", "club-1", "has");
    cleanup();

    const messages = render(<MessagesSponsorCarousel activeClubFilter="club-1" />);
    expect(screen.getByTestId("primary-sponsor-messages_page")).toHaveTextContent("sponsor-1:Riverside");
    expect(messages.container.querySelector("section")).toHaveClass("mt-6");
    cleanup();

    render(<MultiClubSponsorCarousel />);
    expect(screen.getByTestId("primary-sponsor-home_page")).toHaveTextContent("sponsor-1:Riverside");
    expect(mocks.writeHomeSponsorHint).toHaveBeenLastCalledWith("user-1", null, "has");
    expect(queryKeys()).toEqual(expect.arrayContaining([
      ["club-section-sponsors", "club-1", "user-1"],
      ["messages-all-sponsors", "user-1", "club-1"],
      ["user-all-sponsors", "user-1"],
    ]));
  });

  it("keeps tier routing and native-banner ownership in the separate sponsor-or-ad router", () => {
    seed(
      ["user-pro-status-per-club", { isProFiltered: true, hasAnyPro: true, resolved: true }],
      ["user-has-active-sponsors", true],
      ["messages-all-sponsors", [carouselItem]],
    );

    render(<SponsorOrAdCarousel location="messages" activeClubFilter="club-1" />);

    expect(screen.getByTestId("primary-sponsor-messages_page")).toBeInTheDocument();
    expect(queryKeys()).toEqual(expect.arrayContaining([
      ["user-pro-status-per-club", "user-1", "club-1"],
      ["user-has-active-sponsors", "club-1"],
      ["messages-all-sponsors", "user-1", "club-1"],
    ]));
  });
});
