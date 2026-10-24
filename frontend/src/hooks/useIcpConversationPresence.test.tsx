import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ user: "self", initialized: true, scope: undefined as unknown, read: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.user }, initialized: state.initialized }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: unknown, providers: { icp: (ctx: object) => unknown }, scope: unknown) => { state.scope = scope; return providers.icp({}); } }));
vi.mock("@/live/features/messaging", () => ({ listLiveConversationOnlineUsers: (...args: unknown[]) => state.read(...args) }));
import { useIcpConversationPresence } from "./useIcpConversationPresence";
function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => { state.read.mockReset().mockResolvedValue(["peer"]); state.initialized = true; });
describe("private ICP presence", () => {
  it("routes group reads to the owning club and shares only returned participants", async () => {
    const { result } = renderHook(() => useIcpConversationPresence("group-1", { clubId: "club-2" }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.has("peer")).toBe(true));
    expect(state.scope).toEqual({ clubId: "club-2" });
    expect(state.read).toHaveBeenCalledWith({}, "group-1");
    expect(result.current.has("unrelated-person")).toBe(false);
  });
  it("keeps DM reads on the shared person service", async () => {
    const { result } = renderHook(() => useIcpConversationPresence("dm-1", { shared: true }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.has("peer")).toBe(true));
    expect(state.scope).toEqual({ shared: "person" });
  });
  it("does not make private reads before identity restoration", () => {
    state.initialized = false;
    renderHook(() => useIcpConversationPresence("dm-1", { shared: true }), { wrapper: wrapper() });
    expect(state.read).not.toHaveBeenCalled();
  });
});