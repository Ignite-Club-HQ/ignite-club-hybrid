import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signOut: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/appNavigator", () => ({ navigateApp: state.navigate }));
vi.mock("@/live/icpAgent", () => ({ clearLiveAgentCache: vi.fn() }));
vi.mock("@/live/features/events", () => ({ clearListedLiveEvents: vi.fn() }));
vi.mock("@/live/features/messaging", () => ({ clearWarmLiveLatestPages: vi.fn() }));
vi.mock("@/live/groupDispatch", () => ({ clearGroupDispatchCache: vi.fn(), wipeGroupOwnerCache: vi.fn() }));
vi.mock("@/live/piiVetKeys", () => ({ clearPiiVetKeyCache: state.signOut }));
vi.mock("@/live/identityEntitlementsCache", () => ({ clearIcpEntitlementsCache: vi.fn() }));
vi.mock("@/live/wsRealtime", () => ({ disconnectChatRealtime: vi.fn() }));
vi.mock("@/lib/icpQueryCachePersist", () => ({ clearPersistedIcpQueryCache: async () => undefined }));
import { IcpAuthProvider, useAuth } from "./useAuth";

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

it("retires page observers before delegation cleanup and navigates to sign-in with replacement", async () => {
  let finishCleanup: (() => void) | undefined;
  state.signOut.mockResolvedValueOnce(undefined).mockImplementation(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
  const client = new QueryClient();
  const cancel = vi.spyOn(client, "cancelQueries");
  let logout: (() => Promise<void>) | undefined;
  function Page() {
    logout = useAuth().signOut;
    return <div>Protected page</div>;
  }
  render(<QueryClientProvider client={client}><IcpAuthProvider><Page /></IcpAuthProvider></QueryClientProvider>);
  expect(screen.getByText("Protected page")).toBeTruthy();
  let pending: Promise<void> | undefined;
  act(() => { pending = logout?.(); });
  await waitFor(() => expect(state.signOut).toHaveBeenCalledTimes(2));
  expect(screen.queryByText("Protected page")).toBeNull();
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(state.navigate).toHaveBeenCalledWith("/auth", { replace: true });
  await act(async () => { finishCleanup?.(); await pending; });
  expect(localStorage.getItem("ignite_icp_internet_identity_session")).toBeNull();
  expect(screen.getByText("Protected page")).toBeTruthy();
});