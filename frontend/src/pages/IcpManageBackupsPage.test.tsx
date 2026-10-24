import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, list: vi.fn(), create: vi.fn(), get: vi.fn(), stream: vi.fn(), restore: vi.fn(), restoreMedia: vi.fn(), remove: vi.fn(), exportDomain: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, h: { icp: (ctx: unknown) => unknown }) => h.icp({}) }));
vi.mock("@/live/features/vault", () => ({ listLiveVaultBackups: m.list, createLiveVaultBackup: m.create, exportLiveVaultBackupBlob: m.get, exportLiveVaultBackupToSink: m.stream, restoreLiveVaultBackup: m.restore, restoreLiveVaultBackupWithMedia: m.restoreMedia, deleteLiveVaultBackup: m.remove }));
vi.mock("@/live/adminBackupExport", () => ({ BACKUP_DOMAINS: ["club_domain"], exportAdminDomain: (...args: unknown[]) => m.exportDomain(...args) }));
vi.mock("sonner", () => ({ toast: { success: m.success, error: m.error, warning: m.error } }));
import Page from "./IcpManageBackupsPage";
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><Page /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); m.admin = true;
  m.list.mockResolvedValue([{ id: "backup-1", backup_label: "Snapshot", created_at_ms: 1792195200000n, file_count: 3n, folder_count: 2n }]);
  m.create.mockResolvedValue(undefined); m.restore.mockResolvedValue({ restoredRows: 2 }); m.restoreMedia.mockResolvedValue({ restoredRows: 2, missingBytes: [], grantsRepaired: 1 }); m.remove.mockResolvedValue(undefined);
  m.get.mockResolvedValue(new Blob([JSON.stringify({ files: [{ size: "3" }], created_by: "admin-principal" })], { type: "application/x-ndjson" })); vi.stubGlobal("confirm", vi.fn(() => true));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    await waitFor(() => expect(m.restoreMedia).toHaveBeenCalledWith({}, "backup-1")); await waitFor(() => expect(screen.getByRole("button", { name: "Delete Snapshot" })).toBeEnabled());
    expect(m.success).toHaveBeenCalledWith("Backup restored: 2 records, 1 media access grants repaired");
    fireEvent.click(screen.getByRole("button", { name: "Delete Snapshot" })); await waitFor(() => expect(m.remove).toHaveBeenCalledWith({}, "backup-1"));
  });
  it("warns when restore metadata references missing encrypted media bytes", async () => {
    m.restoreMedia.mockResolvedValue({ restoredRows: 2, missingBytes: ["file-ref"], grantsRepaired: 0 }); open(); await screen.findByText("Snapshot");
    fireEvent.click(screen.getByRole("button", { name: "Restore Snapshot" }));
    await waitFor(() => expect(m.error).toHaveBeenCalledWith(expect.stringMatching(/1 media file no longer have their encrypted bytes/i)));
    expect(m.success).not.toHaveBeenCalledWith(expect.stringMatching(/Backup restored/i));
  });
  it("reports rejected reads instead of claiming there are no backups", async () => {
    m.list.mockRejectedValue(new Error("App admin required")); open(); expect(await screen.findByRole("alert")).toHaveTextContent("Could not load backups: App admin required"); expect(screen.queryByText("No backups yet.")).not.toBeInTheDocument();
  });
  it("reports failed creation without success", async () => {
    m.create.mockRejectedValue(new Error("Snapshot failed")); open(); await screen.findByText("Snapshot"); fireEvent.click(screen.getByRole("button", { name: "Create" })); await waitFor(() => expect(m.error).toHaveBeenCalledWith("Snapshot failed")); expect(m.success).not.toHaveBeenCalled();
  });
  it("downloads metadata preserving bigint and principal values", async () => {
    // Keep delayed cleanup inside this test, rather than leaking into the next URL mock.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const revokeObjectURL = vi.fn();
    const objectUrl = vi.fn((_blob: Blob) => "blob:backup"); vi.stubGlobal("URL", { createObjectURL: objectUrl, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {}); open(); fireEvent.click(await screen.findByRole("button", { name: "Download Snapshot" }));
    await waitFor(() => expect(objectUrl).toHaveBeenCalled()); const blob = objectUrl.mock.calls[0]?.[0]; if (!blob) throw new Error("No download");
    const content = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(JSON.parse(content)).toEqual({ files: [{ size: "3" }], created_by: "admin-principal" }); expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:backup");
  });
  it("exports an admin domain as JSON and revokes its download URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createObjectURL = vi.fn(() => "blob:domain-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    m.exportDomain.mockResolvedValue({ rows: [{ id: "row-1" }] });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Export club_domain" }));

    await waitFor(() => expect(m.exportDomain).toHaveBeenCalledWith({}, "club_domain"));
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:domain-export");
    expect(m.success).toHaveBeenCalledWith("Export downloaded");
    expect(click).toHaveBeenCalledOnce();
  });
  it("selects a writable destination and streams rather than accumulating a backup Blob", async () => {
    const sink = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
    const picker = vi.fn().mockResolvedValue({ createWritable: async () => sink });
    vi.stubGlobal("showSaveFilePicker", picker); m.stream.mockResolvedValue(undefined);
    open(); fireEvent.click(await screen.findByRole("button", { name: "Download Snapshot" }));
    await waitFor(() => expect(m.stream).toHaveBeenCalledWith({}, "backup-1", sink));
    expect(picker).toHaveBeenCalledWith({ suggestedName: "vault-backup-backup-1.jsonl" });
    expect(m.get).not.toHaveBeenCalled();
  });
});
