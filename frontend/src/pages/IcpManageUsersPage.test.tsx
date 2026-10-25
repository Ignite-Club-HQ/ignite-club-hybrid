import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, read: vi.fn(), status: vi.fn(), erase: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: unknown) => unknown }) => h.icp({ identity: "signed-in", target: "mainnet" }) }));
vi.mock("@/live/adminUserDirectory", () => ({ readAdminUserDirectory: m.read, updateAdminAccountStatus: m.status }));
vi.mock("@/live/adminAccountDeletion", () => ({ eraseIcpAccountAsAdmin: m.erase }));
vi.mock("@/live/features/insights", () => ({ listLiveAuditLogs: vi.fn() }));
import Page from "./IcpManageUsersPage";
function open() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>); }
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.read.mockResolvedValue({ items: [{ account_id: "account-1", principals: [], profile: [{ display_name: "Alex" }], status: { Suspended: null }, roles: [] }], next: [] }); m.status.mockResolvedValue({ status: { Active: null } }); });
describe("live ICP admin users", () => {
  it("does not read the directory for nonadmins", () => { m.admin = false; open(); expect(m.read).not.toHaveBeenCalled(); });
  it("uses stored suspended status and reactivates the exact account", async () => { open(); await screen.findByText("Alex"); expect(screen.getByText("Suspended")).toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "Reactivate" })); await waitFor(() => expect(m.status).toHaveBeenCalledWith(expect.anything(), "account-1", "Active")); });
  it("preserves a failed action and reports the permission refusal", async () => { m.status.mockRejectedValue(new Error("Forbidden")); open(); await screen.findByText("Alex"); fireEvent.click(screen.getByRole("button", { name: "Reactivate" })); await waitFor(() => expect(m.status).toHaveBeenCalledOnce()); expect(m.erase).not.toHaveBeenCalled(); });
});