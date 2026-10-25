import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultPickerSheet } from "./VaultPickerSheet";
import { VaultFileCard } from "./VaultFileCard";

const mocks = vi.hoisted(() => ({ folders: vi.fn(), files: vi.fn(), counts: vi.fn(), dispatch: vi.fn(), userId: "paul", initialized: true }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: mocks.userId }, initialized: mocks.initialized }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/lib/icpClubTeamLookup", () => ({ isIcpSession: () => true, icpGetClubName: async () => "Goat", icpGetTeam: async () => ({ name: "Team" }) }));
vi.mock("@/features/vault/vaultReadRepository", () => ({ listVaultPickerFolders: (...a: unknown[]) => mocks.folders(...a), listVaultPickerFiles: (...a: unknown[]) => mocks.files(...a), listVaultPickerFolderChildCounts: (...a: unknown[]) => mocks.counts(...a) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (...a: unknown[]) => mocks.dispatch(...a) }));
vi.mock("@/live/features/vault", () => ({ getLiveVaultFolder: vi.fn(), getLiveVaultFile: vi.fn() }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: vi.fn(), getLiveClubProfile: vi.fn() }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/groups/coaches" }) }));

afterEach(() => { cleanup(); vi.clearAllMocks(); mocks.initialized = true; mocks.userId = "paul"; });
const folder = { id: "rules", name: "Rules", parent_id: null, club_id: "goat", team_id: null };
const clientForTest = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("Vault attachment selection", () => {
  it("allows folder sharing while the file inventory is still pending and paints its draft without another read", async () => {
    const client = clientForTest();
    mocks.folders.mockResolvedValue([folder]);
    mocks.files.mockImplementation(() => new Promise(() => {}));
    mocks.counts.mockResolvedValue(new Map());
    const picked = vi.fn();
    const view = render(<QueryClientProvider client={client}><VaultPickerSheet open clubId="goat" onOpenChange={vi.fn()} onPick={picked} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole("button", { name: "Share", exact: true })).toBeDefined());
    fireEvent.click(screen.getByRole("button", { name: "Share", exact: true }));
    expect(picked).toHaveBeenCalledWith({ kind: "folder", id: "rules", name: "Rules" });
    expect(client.getQueryData(["vault-folder-card", "rules", true, "paul"])).toEqual({ id: "rules", name: "Rules", club_id: "goat", team_id: null });
    view.rerender(<QueryClientProvider client={client}><VaultFileCard folderId="rules" /></QueryClientProvider>);
    expect(screen.getByText("Rules")).toBeDefined();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    client.clear();
  });

  it("warms listings before the sheet opens and reuses them on opening", async () => {
    const client = clientForTest();
    mocks.folders.mockResolvedValue([folder]); mocks.files.mockResolvedValue([]); mocks.counts.mockResolvedValue(new Map());
    const props = { clubId: "goat", onOpenChange: vi.fn(), onPick: vi.fn() };
    const view = render(<QueryClientProvider client={client}><VaultPickerSheet {...props} open={false} warm /></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData(["vault-picker-folders", "goat", undefined, null, true, "paul"])).toEqual([folder]));
    view.rerender(<QueryClientProvider client={client}><VaultPickerSheet {...props} open /></QueryClientProvider>);
    expect(screen.getByText("Rules")).toBeDefined();
    expect(mocks.folders).toHaveBeenCalledTimes(1);
    expect(mocks.files).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it("does not warm reads before sign-in restoration", () => {
    mocks.initialized = false;
    const client = clientForTest();
    render(<QueryClientProvider client={client}><VaultPickerSheet open={false} warm clubId="goat" onOpenChange={vi.fn()} onPick={vi.fn()} /></QueryClientProvider>);
    expect(mocks.folders).not.toHaveBeenCalled(); expect(mocks.files).not.toHaveBeenCalled();
    client.clear();
  });
});