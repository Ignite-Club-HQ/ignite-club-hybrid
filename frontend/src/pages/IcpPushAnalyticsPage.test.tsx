import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, health: vi.fn(), settings: vi.fn(), save: vi.fn(), cleanup: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: async (_: string, h: { icp: (ctx: unknown) => Promise<unknown> }, scope: { everyGroup?: boolean; merge?: (parts: unknown[]) => unknown }) => { const value = await h.icp({ target: { canisterIds: { notification_queue: "queue-1" } } }); return scope.everyGroup ? scope.merge?.([value]) : value; } }));
vi.mock("@/live/features/notifications", () => ({ getLivePushDeliveryHealth: m.health, getLivePushAlertSettings: m.settings, upsertLivePushAlertSettings: m.save, cleanupLiveStaleDeviceTokens: m.cleanup }));
import Page from "./IcpPushAnalyticsPage";
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.health.mockResolvedValue({ total24h: 12, pending24h: 3, processing24h: 2, delivered24h: 6, failed24h: 1, deviceTokenCount: 9, generatedAtMs: 10, windowHours: 24 }); m.settings.mockResolvedValue({ failureThresholdPercent: 20, checkWindowHours: 24, minNotifications: 10, cooldownHours: 6, alertsEnabled: true }); m.save.mockResolvedValue({}); m.cleanup.mockResolvedValue(2); });
describe("ICP admin notification actions", () => {
  it("does not fetch admin data for nonadmins", () => { m.admin = false; open(); expect(m.health).not.toHaveBeenCalled(); expect(m.settings).not.toHaveBeenCalled(); });
  it("reads actual queue counts and writes alert settings", async () => {
    open(); await screen.findByText("12"); expect(screen.getByText("6", { selector: "dd" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Failure threshold (%)"), { target: { value: "30" } }); fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ failureThresholdPercent: 30 })));
  });
  it("surfaces denied health instead of zero counts", async () => { m.health.mockRejectedValue(new Error("App admin required")); open(); expect(await screen.findByRole("alert")).toHaveTextContent("App admin required"); expect(screen.queryByText("0", { selector: "dd" })).not.toBeInTheDocument(); });
});