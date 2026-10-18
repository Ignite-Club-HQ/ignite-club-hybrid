import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, from: vi.fn(), get: vi.fn(), set: vi.fn(), run: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: m.from } }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, handlers: { icp: (ctx: unknown) => unknown }) => handlers.icp({}) }));
vi.mock("@/live/features/appSettings", () => ({ getLiveAppSetting: m.get, setLiveAppSetting: m.set }));
vi.mock("@/live/features/messaging", () => ({ runLiveChatPhotoGalleryReminders: m.run, getLiveChatPhotoReminderSettings: m.get, setLiveChatPhotoReminderSettings: m.set }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import Page from "./AdminChatPhotoRemindersPage";
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks();
  m.admin = true;
  m.get.mockResolvedValue({ enabled: true, window_start_hours: 24, window_end_hours: 48, cooldown_days: 7 });
  m.set.mockResolvedValue(undefined);
  m.run.mockResolvedValue({ scanned: 3, posted: 2, skipped: 1 });
});
describe("ICP photo reminder administration", () => {
  it("loads and saves reminder timing on-chain without Supabase", async () => {
    open();
    const start = await screen.findByLabelText("Window start (hours ago)");
    fireEvent.change(start, { target: { value: "36" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(m.set).toHaveBeenCalledWith({}, {
      enabled: true, window_start_hours: 36, window_end_hours: 48, cooldown_days: 7,
    }));
    expect(m.from).not.toHaveBeenCalled();
  });
  it("runs now through the canister and reports its counts", async () => {
    open();
    const button = await screen.findByRole("button", { name: "Run now" });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(m.run).toHaveBeenCalledWith({}, expect.any(Number), 24, 48, 7));
    await waitFor(() => expect(m.success).toHaveBeenCalledWith("Done — scanned 3, queued 2, skipped 1"));
    expect(m.from).not.toHaveBeenCalled();
  });
  it("reports a failed run instead of success", async () => {
    m.run.mockRejectedValue(new Error("App admin required"));
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Run now" }));
    await waitFor(() => expect(m.error).toHaveBeenCalledWith("Run failed: App admin required"));
    expect(m.success).not.toHaveBeenCalled();
  });
  it("does not read settings or execute reminders for non-admins", async () => {
    m.admin = false;
    open();
    expect(screen.getByText("Access denied. App admin role required.")).toBeInTheDocument();
    expect(m.get).not.toHaveBeenCalled();
    expect(m.run).not.toHaveBeenCalled();
  });
  it("rejects fractional timing before saving", async () => {
    open(); fireEvent.change(await screen.findByLabelText("Window start (hours ago)"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(m.error).toHaveBeenCalledWith("Enter whole numbers.")); expect(m.set).not.toHaveBeenCalled();
  });
  it("persists disabled automatic sending", async () => {
    open(); await screen.findByLabelText("Window start (hours ago)"); fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(m.set).toHaveBeenCalledWith({}, expect.objectContaining({ enabled: false })));
  });
});