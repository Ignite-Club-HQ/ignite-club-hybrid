import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IcpRealtimeHealthPanel } from "./IcpRealtimeHealthPanel";

vi.mock("@/live/targetRegistry", () => ({
  getActiveIcpTarget: () => ({
    alias: "icp-public-mainnet",
    host: "https://icp-api.io",
    canisterIds: { club_points_domain: "aaaaa-aa", events_domain: "bbbbb-bb" },
  }),
  registerIcpEngineResolver: () => {},
}));

const cyclesBalance = vi.hoisted(() => vi.fn());
vi.mock("@icp-sdk/core/agent", async () => {
  const actual = await vi.importActual<typeof import("@icp-sdk/core/agent")>("@icp-sdk/core/agent");
  return {
    ...actual,
    HttpAgent: { create: vi.fn(async () => ({})) },
    Actor: { createActor: vi.fn(() => ({ cycles_balance: cyclesBalance })) },
  };
});

function renderPanel() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <IcpRealtimeHealthPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("IcpRealtimeHealthPanel", () => {
  it("shows reachable + timing per configured canister and the chat poll intervals", async () => {
    cyclesBalance.mockResolvedValue(1_000_000n);
    renderPanel();

    await waitFor(() => expect(screen.getByText("2/2 canisters reachable")).toBeInTheDocument());
    expect(screen.getByText("Club points domain")).toBeInTheDocument();
    expect(screen.getByText("Events domain")).toBeInTheDocument();
    expect(screen.getAllByText(/ms$/)).toHaveLength(2);
    expect(screen.getByText(/Visible tab: every 10s/)).toBeInTheDocument();
    expect(screen.getByText(/Hidden tab: every 60s/)).toBeInTheDocument();
  });

  it("marks a canister unreachable when its query throws", async () => {
    cyclesBalance.mockRejectedValue(new Error("IC0536"));
    renderPanel();

    await waitFor(() => expect(screen.getByText("0/2 canisters reachable")).toBeInTheDocument());
    expect(screen.getAllByText("Unreachable")).toHaveLength(2);
  });
});
