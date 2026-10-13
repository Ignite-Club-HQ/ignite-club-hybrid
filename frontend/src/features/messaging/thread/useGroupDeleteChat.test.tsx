import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useGroupDeleteChat } from "./useGroupDeleteChat";

const softDeleteLiveGroupMock = vi.fn();
let withFeatureBackendImpl: (feature: string, providers: any) => any;

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (feature: string, providers: any) => withFeatureBackendImpl(feature, providers),
}));

vi.mock("@/live/features/messaging", () => ({
  softDeleteLiveGroup: (...args: unknown[]) => softDeleteLiveGroupMock(...args),
}));

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useGroupDeleteChat", () => {
  beforeEach(() => {
    softDeleteLiveGroupMock.mockReset();
  });

  it("calls the ICP soft-delete wrapper for Internet Identity (ICP-live) users instead of being blocked", async () => {
    // Simulates withFeatureBackend resolving to the ICP branch, as it does
    // for a signed-in Internet Identity user once the canister is configured.
    withFeatureBackendImpl = (_feature, providers) =>
      providers.icp({ identity: {} as any, target: {} as any });

    const navigate = vi.fn();
    const supabaseClient = { from: vi.fn() } as any;
    const queryClient = new QueryClient();

    const { result } = renderHook(
      () =>
        useGroupDeleteChat({
          groupId: "group-1",
          userId: "user-1",
          useIcpLab: false,
          queryClient,
          supabaseClient,
          navigate,
        }),
      { wrapper: makeWrapper() },
    );

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(softDeleteLiveGroupMock).toHaveBeenCalledWith(expect.anything(), "group-1");
    expect(supabaseClient.from).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("/messages");
  });

  it("falls back to the Supabase soft-delete path when routed to Supabase", async () => {
    withFeatureBackendImpl = (_feature, providers) => providers.supabase();

    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const supabaseClient = { from: vi.fn(() => ({ update })) } as any;
    const navigate = vi.fn();
    const queryClient = new QueryClient();

    const { result } = renderHook(
      () =>
        useGroupDeleteChat({
          groupId: "group-2",
          userId: "user-1",
          useIcpLab: false,
          queryClient,
          supabaseClient,
          navigate,
        }),
      { wrapper: makeWrapper() },
    );

    result.current.mutate();

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(softDeleteLiveGroupMock).not.toHaveBeenCalled();
    expect(supabaseClient.from).toHaveBeenCalledWith("chat_groups");
    expect(eq).toHaveBeenCalledWith("id", "group-2");
  });
});
