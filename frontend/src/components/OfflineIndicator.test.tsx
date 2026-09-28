import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  online: { isOnline: true, wasOffline: false },
  messageCount: 0,
  rsvpCount: 0,
  syncMessages: vi.fn(),
  syncRsvps: vi.fn(),
  successToast: vi.fn(),
  errorToast: vi.fn(),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mocks.online,
}));
vi.mock("@/lib/messageQueue", () => ({
  getQueueCount: () => mocks.messageCount,
  syncQueuedMessages: mocks.syncMessages,
}));
vi.mock("@/lib/rsvpQueue", () => ({
  getQueuedRsvpCount: () => mocks.rsvpCount,
  syncQueuedRsvps: mocks.syncRsvps,
}));
vi.mock("sonner", () => ({
  toast: {
    success: mocks.successToast,
    error: mocks.errorToast,
  },
}));

function renderIndicator() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <OfflineIndicator />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

import { OfflineIndicator } from "./OfflineIndicator";

describe("OfflineIndicator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.online = { isOnline: true, wasOffline: false };
    mocks.messageCount = 0;
    mocks.rsvpCount = 0;
    mocks.syncMessages.mockResolvedValue({ synced: 0, failed: 0 });
    mocks.syncRsvps.mockResolvedValue({ synced: 0, failed: 0 });
  });

  it("stays hidden while online with no queued work", () => {
    renderIndicator();
    expect(screen.queryByText(/Offline|pending/)).not.toBeInTheDocument();
  });

  it("shows an offline warning when connectivity is lost", () => {
    mocks.online = { isOnline: false, wasOffline: false };
    renderIndicator();
    expect(screen.getByText("Offline")).toBeVisible();
  });

  it("shows the combined number of queued messages and RSVPs while offline", () => {
    mocks.online = { isOnline: false, wasOffline: false };
    mocks.messageCount = 2;
    mocks.rsvpCount = 1;
    renderIndicator();
    expect(screen.getByText("Offline • 3 pending")).toBeVisible();
  });

  it("lets an online user retry queued work and refreshes affected event data", async () => {
    mocks.messageCount = 1;
    mocks.rsvpCount = 1;
    mocks.syncMessages.mockResolvedValue({ synced: 1, failed: 0 });
    mocks.syncRsvps.mockImplementation(async () => {
      mocks.messageCount = 0;
      mocks.rsvpCount = 0;
      return { synced: 1, failed: 0 };
    });
    const { client } = renderIndicator();
    const invalidate = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() => expect(mocks.syncMessages).toHaveBeenCalledOnce());
    expect(mocks.syncRsvps).toHaveBeenCalledOnce();
    expect(mocks.successToast).toHaveBeenCalledWith("Synced 2 items");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["event-rsvps"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events"] });
  });

  it("automatically synchronizes queued work after an offline-to-online transition", async () => {
    mocks.online = { isOnline: false, wasOffline: false };
    mocks.messageCount = 1;
    mocks.syncMessages.mockImplementation(async () => {
      mocks.messageCount = 0;
      return { synced: 1, failed: 0 };
    });
    const view = renderIndicator();

    mocks.online = { isOnline: true, wasOffline: true };
    view.rerender(
      <QueryClientProvider client={view.client}>
        <OfflineIndicator />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(mocks.syncMessages).toHaveBeenCalledOnce());
    expect(mocks.syncRsvps).toHaveBeenCalledOnce();
    expect(mocks.successToast).toHaveBeenCalledWith("Synced 1 item");
  });
});
