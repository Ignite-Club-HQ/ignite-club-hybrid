import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, from: vi.fn(), rpc: vi.fn(), get: vi.fn(), set: vi.fn(), clubs: vi.fn(), subs: vi.fn(), settings: vi.fn(), flag: vi.fn(), members: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from, rpc: m.rpc } }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: unknown) => unknown }) => h.icp({}) }));
vi.mock("@/live/features/appSettings", () => ({ getLiveAppSetting: m.get, setLiveAppSetting: m.set, decodeAppSettingBool: (v: string | null, fallback: boolean) => v == null ? fallback : JSON.parse(v) === true }));
vi.mock("@/live/features/club", () => ({ listLiveClubs: m.clubs }));
vi.mock("@/live/features/proAccess", () => ({ listLiveClubSubscriptions: m.subs }));
vi.mock("@/live/features/messaging", () => ({ listLiveAllClubDmSettings: m.settings, setLiveClubAiCatchUp: m.flag, enableLiveAiCatchUpForAllMembers: m.members }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import Page from "./AdminAICatchUpPage";
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); m.admin = true; m.get.mockResolvedValue("false"); m.set.mockResolvedValue(undefined);
  m.clubs.mockResolvedValue(["active", "expired", "free", "deleted"].map(id => ({ id, name: id, is_active: true, deleted_at_ms: id === "deleted" ? [1n] : [] })));
  m.subs.mockResolvedValue(new Map([
    ["active", { is_pro: true, expires_at_ms: [] }], ["expired", { is_pro: true, expires_at_ms: [1n] }], ["free", { is_pro: false, expires_at_ms: [] }],
  ]));
  m.settings.mockResolvedValue([]); m.flag.mockResolvedValue(undefined); m.members.mockResolvedValue(7);
});
describe("ICP AI recap administration", () => {
  it("blocks non-admins before reading settings", () => {
    m.admin = false; open(); expect(screen.getByText("Access denied. App admin role required.")).toBeInTheDocument();
    expect(m.get).not.toHaveBeenCalled(); expect(m.clubs).not.toHaveBeenCalled();
  });
  it("saves the rollout flag on-chain", async () => {
    open(); fireEvent.click(await screen.findByRole("switch", { name: "Enable AI Chat Recap rollout" }));
    await waitFor(() => expect(m.set).toHaveBeenCalledWith({}, "ai_catch_up_global_rollout_enabled", true));
    expect(m.from).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("enables only eligible active Pro clubs and their members", async () => {
    open(); fireEvent.click(await screen.findByRole("button", { name: "Enable for ALL Pro clubs (1)" }));
    fireEvent.click(screen.getByRole("button", { name: "Enable", exact: true }));
    await waitFor(() => expect(m.members).toHaveBeenCalledWith({}, "active"));
    expect(m.flag).toHaveBeenCalledTimes(1); expect(m.flag).toHaveBeenCalledWith({}, "active", true);
    await waitFor(() => expect(m.success).toHaveBeenCalledWith("Enabled on 1 Pro club · 7 members switched on"));
    expect(m.from).not.toHaveBeenCalled();
  });
  it("does not report rejected bulk enables as success", async () => {
    m.members.mockRejectedValue(new Error("App admin required")); open();
    fireEvent.click(await screen.findByRole("button", { name: "Enable for ALL Pro clubs (1)" })); fireEvent.click(screen.getByRole("button", { name: "Enable", exact: true }));
    await waitFor(() => expect(m.error).toHaveBeenCalledWith("Failed: App admin required")); expect(m.success).not.toHaveBeenCalled(); expect(m.rpc).not.toHaveBeenCalled();
  });
  it("reports failed reads rather than empty defaults", async () => {
    m.get.mockRejectedValue(new Error("Connection failed")); m.clubs.mockRejectedValue(new Error("Club read failed")); open();
    expect(await screen.findByText("Could not load rollout setting: Connection failed")).toBeInTheDocument();
    expect(await screen.findByText("Could not load Pro clubs: Club read failed")).toBeInTheDocument(); expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
