import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, list: vi.fn(), create: vi.fn(), get: vi.fn(), restore: vi.fn(), remove: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: unknown) => unknown }) => h.icp({}) }));
vi.mock("@/live/features/vault", () => ({ listLiveVaultBackups: m.list, createLiveVaultBackup: m.create, getLiveVaultBackup: m.get, restoreLiveVaultBackup: m.restore, deleteLiveVaultBackup: m.remove }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error } }));
import Page from "./IcpManageBackupsPage";
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); m.admin = true;
  m.list.mockResolvedValue([{ id: "backup-1", backup_label: "Snapshot", created_at_ms: 1792195200000n, file_count: 3n, folder_count: 2n }]);
  m.create.mockResolvedValue(undefined); m.restore.mockResolvedValue(2); m.remove.mockResolvedValue(undefined);
  m.get.mockResolvedValue({ files: [{ size: 3n }], created_by: { toText: () => "admin-principal" } }); vi.stubGlobal("confirm", vi.fn(() => true));
});
describe("ICP vault metadata backup administration", () => {
  it("does not read backups for non-admins", () => {
    m.admin = false; open(); expect(screen.getByText("Only app admins can manage backups.")).toBeInTheDocument(); expect(m.list).not.toHaveBeenCalled();
  });
  it("creates a labeled snapshot and reloads summaries", async () => {
    open(); await screen.findByText("Snapshot"); fireEvent.change(screen.getByPlaceholderText("Label (optional)"), { target: { value: "  October backup  " } }); fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(m.create).toHaveBeenCalledWith({}, "October backup")); await waitFor(() => expect(m.list).toHaveBeenCalledTimes(2));
  });
  it("requires confirmation before restoring or deleting", async () => {
    vi.mocked(confirm).mockReturnValue(false); open(); await screen.findByText("Snapshot");
    fireEvent.click(screen.getByRole("button", { name: "Restore Snapshot" })); fireEvent.click(screen.getByRole("button", { name: "Delete Snapshot" }));
    expect(m.restore).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled();
  });
  it("restores missing metadata and deletes the selected snapshot", async () => {
    open(); await screen.findByText("Snapshot"); fireEvent.click(screen.getByRole("button", { name: "Restore Snapshot" }));
    await waitFor(() => expect(m.restore).toHaveBeenCalledWith({}, "backup-1")); await waitFor(() => expect(screen.getByRole("button", { name: "Delete Snapshot" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Delete Snapshot" })); await waitFor(() => expect(m.remove).toHaveBeenCalledWith({}, "backup-1"));
  });
  it("reports rejected reads instead of claiming there are no backups", async () => {
    m.list.mockRejectedValue(new Error("App admin required")); open(); expect(await screen.findByRole("alert")).toHaveTextContent("Could not load backups: App admin required"); expect(screen.queryByText("No backups yet.")).not.toBeInTheDocument();
  });
  it("reports failed creation without success", async () => {
    m.create.mockRejectedValue(new Error("Snapshot failed")); open(); fireEvent.click(screen.getByRole("button", { name: "Create" })); await waitFor(() => expect(m.error).toHaveBeenCalledWith("Snapshot failed")); expect(m.success).not.toHaveBeenCalled();
  });
  it("downloads metadata preserving bigint and principal values", async () => {
    const objectUrl = vi.fn((_blob: Blob) => "blob:backup"); vi.stubGlobal("URL", { createObjectURL: objectUrl, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); open(); fireEvent.click(await screen.findByRole("button", { name: "Download Snapshot" }));
    await waitFor(() => expect(objectUrl).toHaveBeenCalled()); const blob = objectUrl.mock.calls[0]?.[0]; if (!blob) throw new Error("No download");
    const content = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(JSON.parse(content)).toEqual({ files: [{ size: "3" }], created_by: "admin-principal" }); expect(click).toHaveBeenCalled(); click.mockRestore();
  });
});
