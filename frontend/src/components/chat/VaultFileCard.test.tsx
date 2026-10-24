import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultFileCard } from "./VaultFileCard";

const state = vi.hoisted(() => ({ initialized: true, userId: "paul" }));
const readFile = vi.hoisted(() => vi.fn());
const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.userId }, initialized: state.initialized }) }));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: "/groups/coaches" }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (...args: unknown[]) => dispatch(...args) }));
vi.mock("@/live/features/vault", () => ({ getLiveVaultFile: (...args: unknown[]) => readFile(...args), getLiveVaultFolder: vi.fn() }));
vi.mock("@/live/features/club", () => ({ getLiveTeam: vi.fn(), getLiveClubProfile: vi.fn() }));

afterEach(() => { cleanup(); vi.clearAllMocks(); state.initialized = true; state.userId = "paul"; });

describe("Vault cards in a loaded chat", () => {
  it("fetches duplicate mounted file cards once through the listed club", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["my-chat-groups-with-messages", "paul"], { groups: [{ id: "coaches", club_id: "goat" }] });
    readFile.mockResolvedValue({ id: "file", name: "Rules.pdf", club: "goat", team: [], size: 1024n, mime: "application/pdf", file_url: "https://example.org/rules.pdf", is_external_link: true, folder_id: null });
    dispatch.mockImplementation((_feature, providers, scope) => providers.icp({ scope }));
    render(<QueryClientProvider client={client}><VaultFileCard fileId="file" /><VaultFileCard fileId="file" /></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData<any>(["vault-file-card", "file", true, "paul"])?.name).toBe("Rules.pdf"));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][2]).toEqual({ clubId: "goat" });
    expect(readFile).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it("does not start file reads before authentication is restored", () => {
    state.initialized = false;
    const client = new QueryClient();
    render(<QueryClientProvider client={client}><VaultFileCard fileId="file" /></QueryClientProvider>);
    expect(dispatch).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    client.clear();
  });
});