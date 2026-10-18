import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, clubs: vi.fn(), roles: vi.fn(), fan: vi.fn(), minimums: vi.fn(), saveMinimums: vi.fn(), audience: vi.fn(), success: vi.fn(), error: vi.fn(), from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin" } }) }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: unknown) => unknown }) => h.icp({ identity: { getPrincipal: () => ({ toText: () => "admin" }) } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from, functions: { invoke: m.invoke } } }));
vi.mock("@/live/features/club", () => ({ listLiveClubs: m.clubs }));
vi.mock("@/live/features/membership", () => ({ listLiveRoleGrants: m.roles }));
vi.mock("@/live/features/notifications", () => ({ fanOutLiveNotifications: m.fan, getLiveUpdateReminderAudience: m.audience }));
vi.mock("@/live/features/messaging", () => ({ getLiveMinimumAppVersions: m.minimums, setLiveMinimumAppVersions: m.saveMinimums }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import Page from "./SendUpdateReminderPage";
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.minimums.mockResolvedValue([["ios", "1.2.0"], ["android", "40"]]); m.saveMinimums.mockResolvedValue(undefined); m.audience.mockResolvedValue([]); m.clubs.mockResolvedValue([{ id: "club-1", name: "Club one" }]); m.roles.mockResolvedValue([{ account_id: "member-1" }, { account_id: "member-1" }, { account_id: "member-2" }]); m.fan.mockResolvedValue(1); });
async function send() { const button = screen.getByRole("button", { name: "Send Update Reminder" }); await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button); }
describe("ICP update reminder queueing", () => {
  it("blocks non-admins before reading recipients", () => { m.admin = false; open(); expect(screen.getByText("App admin role required.")).toBeInTheDocument(); expect(m.clubs).not.toHaveBeenCalled(); expect(m.fan).not.toHaveBeenCalled(); });
  it("deduplicates role holders and reports the actual queue count", async () => {
    open(); fireEvent.change(screen.getByLabelText("Message"), { target: { value: "  Please update  " } }); await send();
    await waitFor(() => expect(m.fan).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userIds: ["member-1", "member-2"], clubId: "club-1", kind: "update_reminder", body: "Please update" })));
    expect(await screen.findByText("Queued 1 reminder.")).toBeInTheDocument(); expect(m.from).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("does not fan out empty recipients", async () => { m.roles.mockResolvedValue([]); open(); await send(); expect(await screen.findByText("Queued 0 reminders.")).toBeInTheDocument(); expect(m.fan).not.toHaveBeenCalled(); });
  it("normalizes principal-prefixed role IDs before deduplication", async () => {
    m.roles.mockResolvedValue([{ account_id: "principal:aaaaa-aa" }, { account_id: "aaaaa-aa" }]);
    open(); await send();
    await waitFor(() => expect(m.fan).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userIds: ["aaaaa-aa"] })));
  });
  it("surfaces authoritative club-recipient denial without fallback", async () => {
    m.fan.mockRejectedValue(new Error("Recipient is not in the reminder club"));
    open(); await send();
    await waitFor(() => expect(m.error).toHaveBeenCalledWith("Recipient is not in the reminder club"));
    expect(m.success).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("splits audiences at the canister's 500-recipient boundary", async () => {
    m.roles.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ account_id: `member-${i}` }))); m.fan.mockResolvedValueOnce(500).mockResolvedValueOnce(1); open(); await send();
    expect(await screen.findByText("Queued 501 reminders.")).toBeInTheDocument(); expect(m.fan).toHaveBeenCalledTimes(2); expect(m.fan.mock.calls.map(c => c[1].userIds.length)).toEqual([500, 1]);
    expect(m.fan.mock.calls[0]?.[1].idempotencyKeyPrefix).not.toEqual(m.fan.mock.calls[1]?.[1].idempotencyKeyPrefix);
  });
  it("reports queue rejection without fallback or success", async () => { m.fan.mockRejectedValue(new Error("Queue rejected")); open(); await send(); await waitFor(() => expect(m.error).toHaveBeenCalledWith("Queue rejected")); expect(m.success).not.toHaveBeenCalled(); expect(m.invoke).not.toHaveBeenCalled(); });
  it("prevents sending after club discovery fails", async () => { m.clubs.mockRejectedValue(new Error("Connection failed")); open(); expect(await screen.findByRole("alert")).toHaveTextContent("Could not load clubs: Connection failed"); expect(screen.getByRole("button", { name: "Send Update Reminder" })).toBeDisabled(); expect(m.fan).not.toHaveBeenCalled(); });
  it("saves minimum versions through messaging without Supabase", async () => {
    open(); await waitFor(() => expect(screen.getByLabelText("iOS minimum version")).toHaveValue("1.2.0"));
    fireEvent.click(screen.getByRole("button", { name: "Save minimum versions" }));
    await waitFor(() => expect(m.saveMinimums).toHaveBeenCalledWith(expect.any(Object), [["ios", "1.2.0"], ["android", "40"]])); expect(m.invoke).not.toHaveBeenCalled();
  });
  it("test sends only to the signed-in administrator who is in the selected club", async () => {
    m.roles.mockResolvedValue([{ account_id: "admin" }, { account_id: "member-1" }]); open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send test to me" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await waitFor(() => expect(m.fan).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ userIds: ["admin"] })));
  });
});
